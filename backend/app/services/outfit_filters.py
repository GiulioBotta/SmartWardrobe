"""Stage 1 of the fork's suggestion pipeline: user filters and pinned-item rules.

Pure functions over the candidate list, applied after RecommendationService.get_candidate_items
when SUGGESTION_COMBOS_ENABLED is on. Pinned items (include_items) are never filtered out.
"""

from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.item import ClothingItem
from app.services.ai_service import VALID_PATTERNS, VALID_SEASONS
from app.utils.clothing import REGION_SLOTS, _slots_for_type, covered_regions
from app.utils.garment_vocabulary import (
    COLORS,
    FORMALITY,
    MATERIALS,
    TYPES,
    canonical_color,
)

FORMALITY_ORDER = list(FORMALITY)
# How far, in formality levels, a suggested piece may sit from every pinned piece.
PINNED_FORMALITY_TOLERANCE = 1
# Colours that go with any palette, so a palette filter never drops them (same list as the
# recommendation prompt's "neutral base").
NEUTRAL_COLORS = frozenset({"black", "white", "gray", "navy", "beige", "brown", "cream", "tan"})


class OutfitFilterError(ValueError):
    """The request cannot produce an outfit; the message is shown to the user."""


def _vocabulary_list(values: list[str], vocabulary, field: str) -> list[str]:
    cleaned = [v.strip().lower() for v in values if v and v.strip()]
    unknown = [v for v in cleaned if v not in vocabulary]
    if unknown:
        raise ValueError(f"Unknown {field}: {', '.join(unknown)}")
    return list(dict.fromkeys(cleaned))


class OutfitFilters(BaseModel):
    model_config = ConfigDict(extra="forbid")

    colors: list[str] = Field(
        default_factory=list,
        description="Palette: keep pieces whose main colour is one of these or a neutral",
    )
    exclude_colors: list[str] = Field(
        default_factory=list, description="Drop pieces showing any of these colours"
    )
    formality: list[str] = Field(default_factory=list, description="Allowed formality levels")
    patterns: list[str] = Field(default_factory=list, description="Allowed patterns")
    materials: list[str] = Field(default_factory=list, description="Allowed materials")
    seasons: list[str] = Field(default_factory=list, description="Pieces for these seasons")
    exclude_types: list[str] = Field(default_factory=list, description="Garment types to skip")
    favorites_only: bool = False
    not_worn_in_days: int | None = Field(
        default=None, ge=1, le=365, description="Skip pieces worn in the last N days"
    )

    @field_validator("colors", "exclude_colors", mode="before")
    @classmethod
    def _colors(cls, v: list[str]) -> list[str]:
        canonical = [canonical_color(c) for c in v or [] if isinstance(c, str) and c.strip()]
        return _vocabulary_list(canonical, COLORS, "colors")

    @field_validator("formality")
    @classmethod
    def _formality(cls, v: list[str]) -> list[str]:
        return _vocabulary_list(v, FORMALITY, "formality")

    @field_validator("patterns")
    @classmethod
    def _patterns(cls, v: list[str]) -> list[str]:
        return _vocabulary_list(v, VALID_PATTERNS, "patterns")

    @field_validator("materials")
    @classmethod
    def _materials(cls, v: list[str]) -> list[str]:
        return _vocabulary_list(v, MATERIALS, "materials")

    @field_validator("seasons")
    @classmethod
    def _seasons(cls, v: list[str]) -> list[str]:
        return _vocabulary_list(v, VALID_SEASONS, "seasons")

    @field_validator("exclude_types")
    @classmethod
    def _types(cls, v: list[str]) -> list[str]:
        return _vocabulary_list(v, TYPES, "types")

    def is_empty(self) -> bool:
        return self == OutfitFilters()


def formality_level(item: ClothingItem) -> int | None:
    value = (item.formality or "").lower()
    return FORMALITY_ORDER.index(value) if value in FORMALITY_ORDER else None


def describe_item(item: ClothingItem) -> str:
    if item.name:
        return f'"{item.name}"'
    return " ".join(p for p in (item.primary_color, item.type) if p) or "item"


def check_pinned_conflicts(pinned: list[ClothingItem]) -> None:
    """Two pinned pieces for the same body slot (two tops, a dress and trousers) is an error.

    The upstream path silently keeps the first one; the fork reports it instead.
    """
    claimed: dict[str, ClothingItem] = {}
    for item in pinned:
        for slot in sorted(_slots_for_type((item.type or "").lower())):
            if slot in claimed:
                raise OutfitFilterError(
                    f"Pinned items {describe_item(claimed[slot])} and {describe_item(item)} "
                    f"both fill the {slot.replace('_', ' ')} slot; unpin one of them."
                )
        for slot in _slots_for_type((item.type or "").lower()):
            claimed[slot] = item


def _matches(
    item: ClothingItem,
    filters: OutfitFilters,
    pinned_levels: list[int],
    user_today: date,
) -> bool:
    item_colors = {canonical_color(c) for c in (item.colors or [])}
    if item.primary_color:
        item_colors.add(canonical_color(item.primary_color))

    if filters.exclude_colors and item_colors & set(filters.exclude_colors):
        return False
    if filters.colors:
        main = canonical_color(item.primary_color) if item.primary_color else None
        if main is not None and main not in filters.colors and main not in NEUTRAL_COLORS:
            return False
    level = formality_level(item)
    if filters.formality and item.formality and item.formality.lower() not in filters.formality:
        return False
    if pinned_levels and level is not None:
        if any(abs(level - p) > PINNED_FORMALITY_TOLERANCE for p in pinned_levels):
            return False
    if filters.patterns and item.pattern and item.pattern.lower() not in filters.patterns:
        return False
    if filters.materials and item.material and item.material.lower() not in filters.materials:
        return False
    if filters.seasons and item.season:
        seasons = {s.lower() for s in item.season}
        if "all-season" not in seasons and not seasons & set(filters.seasons):
            return False
    if filters.exclude_types and (item.type or "").lower() in filters.exclude_types:
        return False
    if filters.favorites_only and not item.favorite:
        return False
    if filters.not_worn_in_days and item.last_worn_at:
        if (user_today - item.last_worn_at).days < filters.not_worn_in_days:
            return False
    return True


def apply_filters(
    candidates: list[ClothingItem],
    filters: OutfitFilters | None,
    pinned_ids: set[UUID],
    user_today: date,
) -> list[ClothingItem]:
    """Drop candidates that fail the filters or sit too far in formality from a pinned piece.

    A piece whose attribute is unknown passes that filter: a missing tag says nothing about
    the garment. Raises OutfitFilterError when the filters leave a body region (top,
    bottom, shoes) that the wardrobe could otherwise dress with nothing to wear.
    """
    filters = filters or OutfitFilters()
    pinned = [item for item in candidates if item.id in pinned_ids]
    pinned_levels = [lvl for lvl in (formality_level(i) for i in pinned) if lvl is not None]

    kept = [
        item
        for item in candidates
        if item.id in pinned_ids or _matches(item, filters, pinned_levels, user_today)
    ]

    before = covered_regions(
        [i.id for i in candidates], {i.id: (i.type or "").lower() for i in candidates}
    )
    after = covered_regions([i.id for i in kept], {i.id: (i.type or "").lower() for i in kept})
    lost = [
        REGION_SLOTS[region].replace("_", " ")
        for region in REGION_SLOTS
        if region in before - after
    ]
    if lost:
        reason = (
            "the filters" if not pinned_levels else "the filters and the pinned items' formality"
        )
        raise OutfitFilterError(
            f"No {', '.join(lost)} is left after {reason}; loosen them to get an outfit."
        )
    return kept
