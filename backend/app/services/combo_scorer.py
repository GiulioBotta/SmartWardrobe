"""Stage 1 of the fork's suggestion pipeline: whole-outfit combinations and their scores.

Upstream scores pieces one by one and hands the model up to 70 of them. Here the pieces are
assembled into outfits slot by slot (top, bottom, shoes, outerwear when cold or wet, or a
one-piece instead of top and bottom), each outfit is scored as a whole, and only the best
ones reach the model. The same list is the fallback when the model's answer is unusable.
"""

from dataclasses import dataclass, field
from itertools import product
from statistics import mean
from uuid import UUID

from app.models.item import ClothingItem
from app.services.outfit_filters import NEUTRAL_COLORS, formality_level
from app.utils.garment_vocabulary import ITEM_ROLE, WORN_ALONE_TYPES, canonical_color

DEFAULT_TOP_COMBOS = 15
# Best-fitting options kept per slot before combining, which bounds the product
# (12 * 12 * 8 * 5 = 5760 outfits at most).
SLOT_OPTIONS = {"upper": 12, "lower": 12, "full_body": 8, "feet": 8, "outer": 5}
# A piece may lead at most this many of the kept outfits, so the model sees variety
# instead of fifteen outfits around the single best top.
MAX_REUSE_PER_ITEM = 5
# Optional pieces offered to the model next to the outfits, never part of a combination.
EXTRA_ACCESSORIES = 3

WEIGHTS = {"fit": 0.35, "harmony": 0.25, "formality": 0.20, "recency": 0.20}
MAX_PAIR_BONUS = 0.15
PAIR_BONUS_STEP = 0.05
FAVORITE_BONUS = 0.02

UPPER_ROLES = {"base_top"}
LOWER_ROLES = {"bottom", "suit"}
FULL_BODY_ROLES = {"full_body"}
FEET_ROLES = {"footwear"}
OUTER_ROLES = {"outer_layer"}


@dataclass
class Combo:
    item_ids: tuple[UUID, ...]
    score: float
    fit: float = 0.0
    harmony: float = 0.0
    formality: float = 0.0
    recency: float = 0.0
    bonus: float = 0.0
    extras: tuple[UUID, ...] = field(default_factory=tuple)

    def as_outfit_data(self, rank: int) -> dict:
        """outfit_data in the shape _save_outfit stores, for an outfit the model never wrote."""
        return {
            "items": [],
            "headline": None,
            "highlights": None,
            "_fallback": "combo_scorer",
            "_combo_rank": rank,
            "_combo_score": round(self.score, 3),
        }


def _role(item: ClothingItem) -> str | None:
    return ITEM_ROLE.get((item.type or "").lower())


def color_harmony(items: list[ClothingItem]) -> float:
    """1.0 for neutrals plus at most one accent colour, lower as accents pile up.

    Mirrors the prompt's rules (neutral base + accent, at most 3 colours), with a penalty
    for more than one patterned piece.
    """
    accents = set()
    for item in items:
        for c in [item.primary_color, *(item.colors or [])]:
            if c:
                name = canonical_color(c)
                if name not in NEUTRAL_COLORS:
                    accents.add(name)
    score = {0: 1.0, 1: 1.0, 2: 0.75}.get(len(accents), 0.35)
    patterned = sum(1 for i in items if i.pattern and i.pattern.lower() != "solid")
    if patterned > 1:
        score *= 0.7
    return score


def formality_coherence(items: list[ClothingItem]) -> float:
    levels = [lvl for lvl in (formality_level(i) for i in items) if lvl is not None]
    if len(levels) < 2:
        return 1.0
    spread = max(levels) - min(levels)
    return {0: 1.0, 1: 0.9, 2: 0.5}.get(spread, 0.1)


def _pair_bonus(ids: tuple[UUID, ...], good_pairs: dict[UUID, list[UUID]]) -> float:
    pairs = sum(1 for i, a in enumerate(ids) for b in ids[i + 1 :] if b in good_pairs.get(a, ()))
    return min(MAX_PAIR_BONUS, pairs * PAIR_BONUS_STEP)


def score_combo(
    items: list[ClothingItem],
    item_fit: dict[UUID, float],
    item_recency: dict[UUID, float],
    good_pairs: dict[UUID, list[UUID]],
) -> Combo:
    ids = tuple(i.id for i in items)
    fit = mean(item_fit.get(i, 1.0) for i in ids)
    recency = mean(item_recency.get(i, 1.0) for i in ids)
    harmony = color_harmony(items)
    formality = formality_coherence(items)
    bonus = _pair_bonus(ids, good_pairs) + FAVORITE_BONUS * sum(1 for i in items if i.favorite)
    score = (
        WEIGHTS["fit"] * fit
        + WEIGHTS["harmony"] * harmony
        + WEIGHTS["formality"] * formality
        + WEIGHTS["recency"] * recency
        + bonus
    )
    return Combo(ids, score, fit, harmony, formality, recency, bonus)


def _best(items: list[ClothingItem], item_fit: dict[UUID, float], n: int) -> list[ClothingItem]:
    return sorted(items, key=lambda i: item_fit.get(i.id, 1.0), reverse=True)[:n]


def build_combos(
    candidates: list[ClothingItem],
    pinned_ids: set[UUID],
    item_fit: dict[UUID, float],
    item_recency: dict[UUID, float],
    good_pairs: dict[UUID, list[UUID]],
    need_outer: bool,
    top_n: int = DEFAULT_TOP_COMBOS,
) -> list[Combo]:
    """The top_n best outfits, every one containing every pinned piece.

    Pinned pieces take their slot outright; pinned pieces outside the core slots (a
    cardigan, a bag, a tie) ride along in every outfit. A slot the wardrobe has nothing
    for is skipped rather than blocking every outfit, as upstream's missing_regions does.
    """
    pinned = [i for i in candidates if i.id in pinned_ids]
    free = [i for i in candidates if i.id not in pinned_ids]

    def options(roles: set[str], slot: str, extra: list[ClothingItem] = ()) -> list:
        chosen = [i for i in pinned if _role(i) in roles]
        if chosen:
            return chosen[:1]
        pool = [i for i in free if _role(i) in roles] + list(extra)
        return _best(pool, item_fit, SLOT_OPTIONS[slot])

    # A pinned hoodie dresses the upper body unless a real top is pinned too.
    pinned_tops = [i for i in pinned if _role(i) in UPPER_ROLES]
    hoodies_pinned = [i for i in pinned if (i.type or "").lower() in WORN_ALONE_TYPES]
    if hoodies_pinned and not pinned_tops:
        upper = hoodies_pinned[:1]
    else:
        worn_alone = [i for i in free if (i.type or "").lower() in WORN_ALONE_TYPES]
        upper = options(UPPER_ROLES, "upper", worn_alone)
    lower = options(LOWER_ROLES, "lower")
    full_body = options(FULL_BODY_ROLES, "full_body")
    feet = options(FEET_ROLES, "feet")

    upper_ids = {i.id for i in upper}
    outer_pinned = [i for i in pinned if _role(i) in OUTER_ROLES and i.id not in upper_ids]
    if outer_pinned:
        outer = outer_pinned[:1]
    elif need_outer:
        outer = _best([i for i in free if _role(i) in OUTER_ROLES], item_fit, SLOT_OPTIONS["outer"])
    else:
        outer = []

    core_roles = UPPER_ROLES | LOWER_ROLES | FULL_BODY_ROLES | FEET_ROLES | OUTER_ROLES
    riders = [
        i
        for i in pinned
        if _role(i) not in core_roles and (i.type or "").lower() not in WORN_ALONE_TYPES
    ]

    any_full_pinned = any(_role(i) in FULL_BODY_ROLES for i in pinned)
    any_separate_pinned = any(_role(i) in UPPER_ROLES | LOWER_ROLES for i in pinned) or (
        hoodies_pinned and not pinned_tops
    )

    silhouettes: list[list[list[ClothingItem]]] = []
    if not any_full_pinned and (upper or lower):
        silhouettes.append([s for s in (upper, lower) if s])
    if not any_separate_pinned and full_body:
        silhouettes.append([full_body])

    combos: list[Combo] = []
    seen: set[frozenset[UUID]] = set()
    for core in silhouettes:
        slots = core + [s for s in (feet, outer) if s]
        for picks in product(*slots):
            pieces = list(picks) + riders
            ids = frozenset(i.id for i in pieces)
            if len(ids) < len(pieces) or ids in seen:
                continue
            seen.add(ids)
            combos.append(score_combo(pieces, item_fit, item_recency, good_pairs))

    combos.sort(key=lambda c: c.score, reverse=True)
    kept: list[Combo] = []
    uses: dict[UUID, int] = {}
    for combo in combos:
        free_ids = [i for i in combo.item_ids if i not in pinned_ids]
        if any(uses.get(i, 0) >= MAX_REUSE_PER_ITEM for i in free_ids):
            continue
        kept.append(combo)
        for i in free_ids:
            uses[i] = uses.get(i, 0) + 1
        if len(kept) >= top_n:
            break
    return kept


def prompt_item_ids(
    combos: list[Combo],
    candidates: list[ClothingItem],
    pinned_ids: set[UUID],
    item_fit: dict[UUID, float],
) -> list[UUID]:
    """Pieces the model may choose from: the kept outfits' pieces plus a few accessories.

    Pinned first, then by fit, so the prompt's "pre-ranked" promise still holds.
    """
    in_combos = {i for c in combos for i in c.item_ids}
    accessories = _best(
        [
            i
            for i in candidates
            if i.id not in in_combos and _role(i) == "accessory" and i.id not in pinned_ids
        ],
        item_fit,
        EXTRA_ACCESSORIES,
    )
    keep = in_combos | {i.id for i in accessories} | pinned_ids
    ordered = sorted(
        (i for i in candidates if i.id in keep),
        key=lambda i: (i.id not in pinned_ids, -item_fit.get(i.id, 1.0)),
    )
    return [i.id for i in ordered]


def format_combos_section(combos: list[Combo], number_of: dict[UUID, int]) -> str:
    if not combos:
        return ""
    lines = [
        "PRE-SCORED COMBINATIONS (best first; scored on weather fit, colour harmony, "
        "formality coherence and recent wear):"
    ]
    for rank, combo in enumerate(combos, 1):
        refs = ", ".join(f"[{number_of[i]}]" for i in combo.item_ids if i in number_of)
        lines.append(f"{rank}. {refs} (score {combo.score:.2f})")
    lines.append(
        "Prefer choosing your 3 outfits among these combinations. You may swap or add a "
        "piece from the list above when it clearly improves the look, but use only the "
        "item numbers shown."
    )
    return "\n".join(lines)
