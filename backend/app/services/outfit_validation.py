"""Strict checks on the model's outfit choices for the fork's suggestion pipeline.

Upstream repairs a weak answer (drops unknown numbers, re-adds pinned pieces, fills gaps).
The fork rejects it instead and asks once more, then falls back to the best-scored
combinations, so every saved outfit is one the model actually chose or one stage 1 scored.
"""

from datetime import date
from uuid import UUID

from app.models.item import ClothingItem
from app.models.preference import UserPreference
from app.services.item_scorer import (
    DEFAULT_AVOID_REPEAT_DAYS,
    _fit_factors,
    _recency_score,
)
from app.services.weather_service import WeatherData
from app.utils.clothing import deduplicate_by_body_slot, has_wearable_piece, missing_regions

RETRY_NOTE = (
    "\n\nYOUR PREVIOUS ANSWER WAS REJECTED: {reason}. Answer again with the same JSON format, "
    "using ONLY item numbers from the AVAILABLE ITEMS list"
    "{mandatory}, one piece per body slot, and a complete look in every outfit."
)


def validate_outfit_choice(
    outfit_data: object,
    number_map: dict[int, UUID],
    item_type_map: dict[UUID, str],
    pinned_ids: set[UUID],
) -> tuple[list[UUID] | None, str | None]:
    """The outfit's item ids if the choice is valid as given, else (None, reason)."""
    if not isinstance(outfit_data, dict):
        return None, "an outfit was not a JSON object"
    numbers = outfit_data.get("items")
    if not isinstance(numbers, list) or not numbers:
        return None, "an outfit had no items"

    ids: list[UUID] = []
    for num in numbers:
        try:
            iid = number_map[int(num)]
        except (KeyError, TypeError, ValueError):
            return None, f"item {num!r} is not in the list"
        if iid not in ids:
            ids.append(iid)

    if not pinned_ids <= set(ids):
        return None, "an outfit left out a mandatory item"
    if deduplicate_by_body_slot(ids, item_type_map, mandatory_item_ids=pinned_ids) != ids:
        return None, "an outfit had two pieces for the same body slot"
    if not has_wearable_piece(ids, item_type_map) or missing_regions(ids, item_type_map):
        return None, "an outfit was incomplete"
    return ids, None


def retry_note(reason: str, mandatory_numbers: list[int]) -> str:
    mandatory = ""
    if mandatory_numbers:
        refs = ", ".join(f"[{n}]" for n in sorted(mandatory_numbers))
        mandatory = f", including every mandatory item ({refs}) in each outfit"
    return RETRY_NOTE.format(reason=reason, mandatory=mandatory)


def fit_and_recency(
    candidates: list[ClothingItem],
    weather: WeatherData,
    occasion: str,
    current_season: str,
    preferences: UserPreference | None,
    learned_prefs: dict | None,
    user_today: date,
    worn_dates: dict[UUID, date],
) -> tuple[dict[UUID, float], dict[UUID, float]]:
    """Per-piece fit (weather x formality x season x preference) and recency, as upstream
    score_items computes them, but for every candidate: score_items skips small wardrobes."""
    avoid_days = DEFAULT_AVOID_REPEAT_DAYS
    if preferences and preferences.avoid_repeat_days is not None:
        avoid_days = preferences.avoid_repeat_days
    fit: dict[UUID, float] = {}
    recency: dict[UUID, float] = {}
    for item in candidates:
        ws, fs, ss, ps = _fit_factors(
            item, weather, occasion, current_season, preferences, learned_prefs
        )
        fit[item.id] = ws * fs * ss * ps
        recency[item.id] = _recency_score(item, user_today, avoid_days, worn_dates)
    return fit, recency
