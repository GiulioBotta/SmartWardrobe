"""Wardrobe sort by category.

The original "type" sort is alphabetical on the English keys, which scatters a closet
(coat, hoodie, jeans, pants, polo, sweater...). This orders it the way one dresses:
outerwear, then tops, bottoms, shoes and accessories; within a category by type, then name.
Items of an unknown type go last.
"""

from sqlalchemy import case

from app.models.item import ClothingItem
from app.utils.garment_vocabulary import ITEM_ROLE, TYPES

ROLE_ORDER = (
    "outer_layer",
    "suit",
    "full_body",
    "mid_layer",
    "base_top",
    "bottom",
    "legwear",
    "footwear",
    "socks",
    "neckwear",
    "accessory",
)

CATEGORY_TYPE_ORDER: list[str] = sorted(
    TYPES, key=lambda t: (ROLE_ORDER.index(ITEM_ROLE[t]), TYPES.index(t))
)


def category_order_by() -> tuple:
    rank = case(
        {t: i for i, t in enumerate(CATEGORY_TYPE_ORDER)},
        value=ClothingItem.type,
        else_=len(CATEGORY_TYPE_ORDER),
    )
    return rank, ClothingItem.type, ClothingItem.name.asc().nulls_last()
