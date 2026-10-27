"""Image-worker jobs that keep item_embeddings in step with the wardrobe.

embed_pending_items_job runs on a cron and picks up every ready item whose embedding is
missing, made by another model, or older than its image (rotated or background removed), so
existing items are backfilled and new ones follow without hooks in the upload or image jobs.

    python -m app.workers.embeddings backfill   # embed everything pending now
"""

import asyncio
import logging
import sys
from pathlib import Path
from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.embedding import ItemEmbedding
from app.models.item import ClothingItem, ItemStatus
from app.services.embedding_service import ClipImageEncoder, load_image
from app.workers.db import get_db_session

logger = logging.getLogger(__name__)

BATCH_SIZE = 16


async def pending_items(
    db: AsyncSession,
    limit: int,
    exclude: set[UUID] | frozenset[UUID] = frozenset(),
    user_id: UUID | None = None,
) -> list[ClothingItem]:
    model = get_settings().embedding_model_name
    query = (
        select(ClothingItem)
        .outerjoin(ItemEmbedding, ItemEmbedding.item_id == ClothingItem.id)
        .where(
            and_(
                ClothingItem.status == ItemStatus.ready,
                ClothingItem.is_archived.is_(False),
                ClothingItem.image_path.is_not(None),
                or_(
                    ItemEmbedding.item_id.is_(None),
                    ItemEmbedding.model != model,
                    ItemEmbedding.source_path.is_distinct_from(ClothingItem.image_path),
                    ClothingItem.updated_at > ItemEmbedding.created_at,
                ),
            )
        )
        # Newest first, so a fresh upload never waits behind old items that keep failing.
        .order_by(ClothingItem.updated_at.desc())
        .limit(limit)
    )
    if exclude:
        query = query.where(ClothingItem.id.not_in(exclude))
    if user_id is not None:
        query = query.where(ClothingItem.user_id == user_id)
    return list((await db.execute(query)).scalars().all())


def _embed_files(paths: list[Path]) -> list[list[float] | None]:
    encoder = ClipImageEncoder.get()
    images, index = [], []
    for i, path in enumerate(paths):
        try:
            images.append(load_image(path))
            index.append(i)
        except Exception as e:
            logger.warning(f"Cannot open {path} for embedding: {e}")
    vectors = encoder.embed(images) if images else []
    out: list[list[float] | None] = [None] * len(paths)
    for i, vector in zip(index, vectors, strict=True):
        out[i] = vector.tolist()
    return out


async def embed_items(db: AsyncSession, items: list[ClothingItem]) -> tuple[int, set[UUID]]:
    """Store embeddings for `items`; returns how many were stored and the ids that failed."""
    settings = get_settings()
    root = Path(settings.storage_path)
    vectors = await asyncio.to_thread(_embed_files, [root / i.image_path for i in items])
    stored = 0
    failed: set[UUID] = set()
    for item, vector in zip(items, vectors, strict=True):
        if vector is None:
            failed.add(item.id)
            continue
        values = {
            "item_id": item.id,
            "model": settings.embedding_model_name,
            "embedding": vector,
            "source_path": item.image_path,
        }
        stmt = insert(ItemEmbedding).values(**values)
        stmt = stmt.on_conflict_do_update(
            index_elements=[ItemEmbedding.item_id],
            set_={
                "model": stmt.excluded.model,
                "embedding": stmt.excluded.embedding,
                "source_path": stmt.excluded.source_path,
                "created_at": stmt.excluded.created_at,
            },
        )
        await db.execute(stmt)
        stored += 1
    await db.commit()
    return stored, failed


async def embed_pending_items_job(ctx: dict, limit: int = BATCH_SIZE) -> dict:
    if not get_settings().embeddings_enabled:
        return {"status": "disabled"}
    # Items whose image cannot be read are skipped until the worker restarts, instead of
    # being retried every run ahead of everything else.
    failed: set[UUID] = ctx.setdefault("embedding_failed", set())
    db = get_db_session(ctx)
    try:
        items = await pending_items(db, limit, exclude=failed)
        if not items:
            return {"status": "idle", "embedded": 0}
        stored, newly_failed = await embed_items(db, items)
        failed |= newly_failed
        logger.info(f"Embedded {stored} of {len(items)} pending items")
        return {"status": "success", "embedded": stored, "pending_seen": len(items)}
    finally:
        await db.close()


async def _backfill() -> int:
    from app.workers.db import close_db, init_db

    ctx: dict = {}
    await init_db(ctx)
    total = 0
    failed: set[UUID] = set()
    try:
        while True:
            db = get_db_session(ctx)
            try:
                items = await pending_items(db, BATCH_SIZE, exclude=failed)
                if not items:
                    break
                stored, newly_failed = await embed_items(db, items)
            finally:
                await db.close()
            total += stored
            failed |= newly_failed
            print(f"embedded {total} items ({len(failed)} unreadable)", flush=True)
    finally:
        await close_db(ctx)
    return total


if __name__ == "__main__":
    if sys.argv[1:] != ["backfill"]:
        sys.exit("usage: python -m app.workers.embeddings backfill")
    logging.basicConfig(level=logging.INFO)
    print(f"done: {asyncio.run(_backfill())} items embedded")
