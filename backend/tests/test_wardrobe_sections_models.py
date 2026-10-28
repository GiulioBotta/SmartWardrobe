from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.item import ClothingItem, ItemStatus
from app.models.wardrobe_section import CollectionItem, SectionKind, WardrobeSection


async def _collection_with_item(db: AsyncSession, user_id):
    item = ClothingItem(
        user_id=user_id, type="sweater", image_path=f"test/{uuid4()}.jpg", status=ItemStatus.ready
    )
    section = WardrobeSection(
        user_id=user_id, kind=SectionKind.collection, name="Festa", position=0
    )
    db.add_all([item, section])
    await db.flush()
    db.add(CollectionItem(section_id=section.id, item_id=item.id))
    await db.commit()
    return section, item


async def _links(db: AsyncSession, section_id):
    # The test database keeps rows between tests, so only this test's collection counts.
    result = await db.execute(select(CollectionItem).where(CollectionItem.section_id == section_id))
    return result.scalars().all()


@pytest.mark.asyncio
async def test_deleting_an_item_removes_it_from_collections(db_session: AsyncSession, test_user):
    section, item = await _collection_with_item(db_session, test_user.id)
    await db_session.delete(item)
    await db_session.commit()
    db_session.expunge_all()
    assert await _links(db_session, section.id) == []


@pytest.mark.asyncio
async def test_deleting_a_collection_keeps_the_items(db_session: AsyncSession, test_user):
    section, item = await _collection_with_item(db_session, test_user.id)
    await db_session.delete(section)
    await db_session.commit()
    db_session.expunge_all()
    assert await _links(db_session, section.id) == []
    assert await db_session.get(ClothingItem, item.id) is not None


@pytest.mark.asyncio
async def test_feature_flag_reported_off_by_default(client: AsyncClient):
    response = await client.get("/api/v1/health/features")
    assert response.json()["wardrobe_sections"] is False
