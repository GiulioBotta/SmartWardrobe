"""Batch upload logic shared by the API and the workers: grouping, duplicates, batch status."""

from collections.abc import Sequence
from datetime import UTC, datetime
from uuid import UUID

import numpy as np
from sqlalchemy import Float, and_, func, literal, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.embedding import EMBEDDING_DIM, ItemEmbedding, Vector
from app.models.item import ClothingItem
from app.models.upload_batch import (
    PENDING_PHOTO_STATUSES,
    BatchStatus,
    PhotoStatus,
    UploadBatch,
    UploadPhoto,
)


def group_consecutive(
    vectors: Sequence[Sequence[float] | None], threshold: float
) -> list[list[int]]:
    """Split photos, in shooting order, into runs that look like one garment.

    A photo joins the current run when it is at least `threshold` similar to any photo
    already in it, so front, back and close-up chain together. Only neighbours are
    compared: different garments of one type are often as similar as two sides of the same
    one, and shooting order is what tells them apart. A photo without a vector stands alone.
    """
    groups: list[list[int]] = []
    current: list[int] = []
    for index, vector in enumerate(vectors):
        joins = (
            vector is not None
            and current
            and vectors[current[0]] is not None
            and max(_cosine(vector, vectors[i]) for i in current if vectors[i] is not None)
            >= threshold
        )
        if joins:
            current.append(index)
        else:
            if current:
                groups.append(current)
            current = [index]
    if current:
        groups.append(current)
    return groups


def _cosine(a: Sequence[float], b: Sequence[float]) -> float:
    va, vb = np.asarray(a, dtype=np.float32), np.asarray(b, dtype=np.float32)
    denom = float(np.linalg.norm(va) * np.linalg.norm(vb))
    return float(va @ vb) / denom if denom else 0.0


async def nearest_item(
    db: AsyncSession, user_id: UUID, vector: Sequence[float], model: str
) -> tuple[UUID, float] | None:
    """The user's most similar wardrobe item by CLIP embedding, with its cosine similarity."""
    distance = ItemEmbedding.embedding.op("<=>", return_type=Float)(
        literal(list(vector), type_=Vector(EMBEDDING_DIM))
    )
    row = (
        await db.execute(
            select(ClothingItem.id, distance.label("distance"))
            .join(ItemEmbedding, ItemEmbedding.item_id == ClothingItem.id)
            .where(
                and_(
                    ClothingItem.user_id == user_id,
                    ClothingItem.is_archived.is_(False),
                    ItemEmbedding.model == model,
                )
            )
            .order_by(distance)
            .limit(1)
        )
    ).first()
    if row is None:
        return None
    return row[0], round(1.0 - float(row[1]), 4)


async def item_with_same_hash(db: AsyncSession, user_id: UUID, image_hash: str) -> UUID | None:
    return (
        await db.execute(
            select(ClothingItem.id)
            .where(
                and_(
                    ClothingItem.user_id == user_id,
                    ClothingItem.image_hash == image_hash,
                    ClothingItem.is_archived.is_(False),
                )
            )
            .limit(1)
        )
    ).scalar_one_or_none()


async def refresh_batch_status(db: AsyncSession, batch: UploadBatch) -> None:
    """Move a batch between processing, review and closed from its photos; the caller commits."""
    if batch.status == BatchStatus.closed or batch.sealed_at is None:
        return
    # Sessions here run without autoflush; the caller's status changes must count.
    await db.flush()
    pending = (
        await db.execute(
            select(func.count())
            .select_from(UploadPhoto)
            .where(
                and_(
                    UploadPhoto.batch_id == batch.id,
                    UploadPhoto.status.in_([s.value for s in PENDING_PHOTO_STATUSES]),
                )
            )
        )
    ).scalar_one()
    if pending:
        batch.status = BatchStatus.processing
        return
    batch.paused_until = None
    batch.pause_reason = None
    to_review = (
        await db.execute(
            select(func.count())
            .select_from(UploadPhoto)
            .where(
                and_(
                    UploadPhoto.batch_id == batch.id,
                    UploadPhoto.status.in_([PhotoStatus.ready.value, PhotoStatus.error.value]),
                )
            )
        )
    ).scalar_one()
    # Every photo confirmed or discarded: the inbox is done with this batch.
    batch.status = BatchStatus.review if to_review else BatchStatus.closed


def is_paused(batch: UploadBatch, now: datetime | None = None) -> bool:
    return batch.paused_until is not None and batch.paused_until > (now or datetime.now(UTC))


async def ungrouped_count(db: AsyncSession, batch_id: UUID) -> tuple[int, int]:
    """(photos still queued for preparation, prepared photos not yet grouped)."""
    rows = (
        await db.execute(
            select(UploadPhoto.status, func.count())
            .where(
                and_(
                    UploadPhoto.batch_id == batch_id,
                    UploadPhoto.status.in_([PhotoStatus.queued.value, PhotoStatus.prepared.value]),
                )
            )
            .group_by(UploadPhoto.status)
        )
    ).all()
    counts = dict(rows)
    return counts.get(PhotoStatus.queued.value, 0), counts.get(PhotoStatus.prepared.value, 0)
