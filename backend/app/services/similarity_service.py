"""Nearest items by CLIP embedding (pgvector cosine distance), within one user's wardrobe."""

from uuid import UUID

from sqlalchemy import Float, and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.embedding import ItemEmbedding
from app.models.item import ClothingItem


class ItemNotEmbeddedError(LookupError):
    """The item exists but has no embedding yet (still processing, or embeddings are off)."""


async def similar_items(
    db: AsyncSession, user_id: UUID, item_id: UUID, limit: int
) -> list[tuple[ClothingItem, float]]:
    item = (
        await db.execute(
            select(ClothingItem).where(
                and_(ClothingItem.id == item_id, ClothingItem.user_id == user_id)
            )
        )
    ).scalar_one_or_none()
    if item is None:
        raise LookupError("item not found")
    target = await db.get(ItemEmbedding, item_id)
    if target is None:
        raise ItemNotEmbeddedError("item has no embedding yet")

    # return_type, or the distance would come back through the vector type's result processor.
    distance = ItemEmbedding.embedding.op("<=>", return_type=Float)(
        select(ItemEmbedding.embedding).where(ItemEmbedding.item_id == item_id).scalar_subquery()
    )
    rows = await db.execute(
        select(ClothingItem, distance.label("distance"))
        .join(ItemEmbedding, ItemEmbedding.item_id == ClothingItem.id)
        .where(
            and_(
                ClothingItem.user_id == user_id,
                ClothingItem.id != item_id,
                ClothingItem.is_archived.is_(False),
                ItemEmbedding.model == target.model,
            )
        )
        .order_by(distance)
        .limit(limit)
    )
    return [(row[0], round(1.0 - float(row[1]), 4)) for row in rows.all()]
