"""Alternatives for one piece of a suggested outfit (the fork's "swap a single item").

Every candidate of the same role is put into the outfit in place of the piece and the whole
outfit is scored with combo_scorer, so an alternative ranks high when it suits the pieces
that stay, not just the weather. The swap itself goes through the existing PATCH /outfits.
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.item import ClothingItem, ItemStatus
from app.models.outfit import Outfit, OutfitItem
from app.models.preference import UserPreference
from app.models.user import User
from app.services.combo_scorer import score_combo
from app.services.item_scorer import get_season
from app.services.outfit_validation import fit_and_recency
from app.services.weather_service import WeatherData
from app.utils.garment_vocabulary import ITEM_ROLE, WORN_ALONE_TYPES
from app.utils.timezone import get_user_today

DEFAULT_SWAP_OPTIONS = 6
# Used when an outfit was saved without weather (manual or external outfits).
MILD_WEATHER = {
    "temperature": 18.0,
    "feels_like": 18.0,
    "humidity": 50,
    "precipitation_chance": 0,
    "precipitation_mm": 0.0,
    "wind_speed": 5.0,
    "condition": "clear",
    "condition_code": 0,
    "is_day": True,
    "uv_index": 3.0,
}


class SwapItemNotInOutfitError(LookupError):
    pass


def _weather(data: dict | None) -> WeatherData:
    fields = {**MILD_WEATHER, **{k: v for k, v in (data or {}).items() if v is not None}}
    timestamp = fields.pop("timestamp", None)
    try:
        when = datetime.fromisoformat(timestamp) if isinstance(timestamp, str) else datetime.now()
    except ValueError:
        when = datetime.now()
    known = set(WeatherData.__dataclass_fields__)
    return WeatherData(timestamp=when, **{k: v for k, v in fields.items() if k in known})


def _role(item: ClothingItem) -> str | None:
    return ITEM_ROLE.get((item.type or "").lower())


def _same_slot(candidate: ClothingItem, target: ClothingItem) -> bool:
    # A hoodie standing in for a top may be swapped for a top and vice versa.
    def slot(i: ClothingItem) -> str | None:
        if (i.type or "").lower() in WORN_ALONE_TYPES and _role(target) == "base_top":
            return "base_top"
        return _role(i)

    return slot(candidate) is not None and slot(candidate) == slot(target)


async def swap_options(
    db: AsyncSession,
    user: User,
    outfit_id: UUID,
    item_id: UUID,
    limit: int = DEFAULT_SWAP_OPTIONS,
) -> list[ClothingItem]:
    outfit = (
        await db.execute(
            select(Outfit)
            .where(and_(Outfit.id == outfit_id, Outfit.user_id == user.id))
            .options(selectinload(Outfit.items).selectinload(OutfitItem.item))
        )
    ).scalar_one_or_none()
    if outfit is None:
        raise LookupError("outfit not found")

    pieces = [oi.item for oi in outfit.items]
    target = next((p for p in pieces if p.id == item_id), None)
    if target is None:
        raise SwapItemNotInOutfitError("item is not part of this outfit")
    staying = [p for p in pieces if p.id != item_id]
    in_outfit = {p.id for p in pieces}

    wardrobe = (
        await db.execute(
            select(ClothingItem).where(
                and_(
                    ClothingItem.user_id == user.id,
                    ClothingItem.status == ItemStatus.ready,
                    ClothingItem.is_archived.is_(False),
                    ClothingItem.needs_wash.is_(False),
                )
            )
        )
    ).scalars()
    candidates = [i for i in wardrobe if i.id not in in_outfit and _same_slot(i, target)]
    if not candidates:
        return []

    # Queried rather than read off user.preferences, which is a lazy relationship that async
    # sessions cannot load on attribute access.
    preferences = (
        await db.execute(select(UserPreference).where(UserPreference.user_id == user.id))
    ).scalar_one_or_none()
    today = get_user_today(user)
    lat = float(user.location_lat) if user.location_lat is not None else None
    worn = {i.id: i.last_worn_at for i in candidates + staying if i.last_worn_at}
    fit, recency = fit_and_recency(
        candidates + staying,
        _weather(outfit.weather_data),
        outfit.occasion or "casual",
        get_season(today.month, lat),
        preferences,
        None,
        today,
        worn,
    )
    ranked = sorted(
        candidates,
        key=lambda c: score_combo(staying + [c], fit, recency, {}).score,
        reverse=True,
    )
    return ranked[:limit]
