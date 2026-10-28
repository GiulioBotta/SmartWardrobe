from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.item import ClothingItem, ItemStatus
from app.schemas.item import ItemFilter
from app.services.item_category_order import CATEGORY_TYPE_ORDER
from app.services.item_service import ItemService
from app.utils.garment_vocabulary import TYPES


def test_every_type_has_a_place():
    assert sorted(CATEGORY_TYPE_ORDER) == sorted(TYPES)


def test_order_follows_the_way_you_dress():
    pos = CATEGORY_TYPE_ORDER.index
    assert pos("coat") < pos("sweater") < pos("pants") < pos("sneakers") < pos("scarf")


@pytest.mark.asyncio
async def test_category_sort_groups_by_category_then_name(db_session: AsyncSession, test_user):
    def item(kind, name):
        return ClothingItem(
            user_id=test_user.id,
            type=kind,
            name=name,
            image_path=f"test/{uuid4()}.jpg",
            status=ItemStatus.ready,
        )

    db_session.add_all(
        [
            item("scarf", "Sciarpa"),
            item("pants", "Pantaloni B"),
            item("sweater", "Maglione"),
            item("sneakers", "Sneakers"),
            item("pants", "Pantaloni A"),
            item("coat", "Cappotto"),
            item("unknown", "Da classificare"),
        ]
    )
    await db_session.commit()

    items, _ = await ItemService(db_session).get_list(
        test_user.id, ItemFilter(sort_by="category", sort_order="asc")
    )
    assert [i.name for i in items] == [
        "Cappotto",
        "Maglione",
        "Pantaloni A",
        "Pantaloni B",
        "Sneakers",
        "Sciarpa",
        "Da classificare",
    ]
