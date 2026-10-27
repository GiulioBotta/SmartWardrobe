"""The fork's batch upload inbox (BATCH_UPLOAD_ENABLED): upload, processing state, review.

POST /upload-batches                 new batch
POST /upload-batches/{id}/photos     one chunk of photos (repeatable, idempotent keys)
POST /upload-batches/{id}/seal       no more photos: group and tag
GET  /upload-batches                 open batches
GET  /upload-batches/{id}            photos by garment, counts, quota pause
DELETE /upload-batches/{id}          abandon: unconfirmed photos and their files go

Review actions on garments (photos sharing group_id), each answering with the batch detail:
confirm, PATCH groups, merge, discard, photos/{photo_id}/split,
groups/{group_id}/not-duplicate, groups/{group_id}/attach, groups/{group_id}/retag.
"""

import logging
from collections import Counter
from datetime import UTC, datetime
from typing import Annotated, Any
from uuid import UUID

from arq import create_pool
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field, computed_field
from sqlalchemy import and_, func, select
from sqlalchemy.exc import IntegrityError

from app.config import get_settings
from app.database import DbSession
from app.models.item import ClothingItem
from app.models.upload_batch import BatchStatus, PhotoStatus, UploadBatch, UploadPhoto
from app.models.user import User
from app.services.image_service import ImageService
from app.services.upload_batch_service import item_with_same_hash, refresh_batch_status
from app.services.upload_inbox_service import (
    ACTIVE_STATUSES,
    GroupChanges,
    InboxActionError,
    abandon_batch,
    attach_to_item,
    confirm_groups,
    confirmable,
    discard_groups,
    merge_groups,
    not_duplicate,
    retag,
    split_photo,
    update_groups,
)
from app.utils.auth import get_current_user
from app.utils.signed_urls import sign_optional
from app.utils.uploads import UploadTooLargeError, read_upload_within_limit
from app.workers.queues import IMAGE_QUEUE, TAGGING_QUEUE
from app.workers.settings import get_redis_settings
from app.workers.upload_batches import enqueue_group_if_ready

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/upload-batches", tags=["Upload batches"])


def _require_enabled() -> None:
    if not get_settings().batch_upload_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Batch upload is off")


EnabledGuard = Depends(_require_enabled)


class PhotoResponse(BaseModel):
    id: UUID
    position: int
    filename: str | None = None
    status: str
    group_id: UUID | None = None
    is_primary: bool
    tags: dict[str, Any] | None = None
    duplicate_of_item_id: UUID | None = None
    duplicate_score: float | None = None
    item_id: UUID | None = None
    error: str | None = None
    thumbnail_path: str | None = None
    medium_path: str | None = None
    image_path: str

    model_config = {"from_attributes": True}

    @computed_field
    @property
    def thumbnail_url(self) -> str | None:
        return sign_optional(self.thumbnail_path, self.image_path)

    @computed_field
    @property
    def medium_url(self) -> str | None:
        return sign_optional(self.medium_path, self.image_path)


class DuplicateItemResponse(BaseModel):
    id: UUID
    type: str
    name: str | None = None
    primary_color: str | None = None
    thumbnail_path: str | None = None

    @computed_field
    @property
    def thumbnail_url(self) -> str | None:
        return sign_optional(self.thumbnail_path)


class GroupResponse(BaseModel):
    group_id: UUID
    primary_photo_id: UUID
    # Primary first, then shooting order.
    photos: list[PhotoResponse]
    # Why the garment cannot be confirmed yet (None when it can).
    blocked_reason: str | None = None
    duplicate_item: DuplicateItemResponse | None = None


class BatchResponse(BaseModel):
    id: UUID
    status: str
    sealed_at: datetime | None = None
    paused_until: datetime | None = None
    pause_reason: str | None = None
    created_at: datetime
    total_photos: int = 0
    counts: dict[str, int] = {}


class BatchDetailResponse(BatchResponse):
    groups: list[GroupResponse] = []
    # Photos not grouped yet (still being prepared, or failed before grouping). Confirmed and
    # discarded photos are left out of both lists; `counts` still has them.
    ungrouped: list[PhotoResponse] = []


class PhotoUploadResult(BaseModel):
    filename: str
    success: bool
    photo_id: UUID | None = None
    duplicate: bool = False
    error: str | None = None
    error_code: str | None = None


class PhotoUploadResponse(BaseModel):
    total: int
    successful: int
    failed: int
    results: list[PhotoUploadResult]


async def _get_batch(db: DbSession, user_id: UUID, batch_id: UUID) -> UploadBatch:
    batch = (
        await db.execute(
            select(UploadBatch).where(
                and_(UploadBatch.id == batch_id, UploadBatch.user_id == user_id)
            )
        )
    ).scalar_one_or_none()
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Batch not found")
    return batch


async def _counts(db: DbSession, batch_ids: list[UUID]) -> dict[UUID, Counter]:
    rows = (
        await db.execute(
            select(UploadPhoto.batch_id, UploadPhoto.status, func.count())
            .where(UploadPhoto.batch_id.in_(batch_ids))
            .group_by(UploadPhoto.batch_id, UploadPhoto.status)
        )
    ).all()
    out: dict[UUID, Counter] = {batch_id: Counter() for batch_id in batch_ids}
    for batch_id, photo_status, count in rows:
        out[batch_id][photo_status] = count
    return out


def _batch_response(batch: UploadBatch, counts: Counter) -> BatchResponse:
    return BatchResponse(
        id=batch.id,
        status=batch.status,
        sealed_at=batch.sealed_at,
        paused_until=batch.paused_until,
        pause_reason=batch.pause_reason,
        created_at=batch.created_at,
        total_photos=sum(counts.values()),
        counts=dict(counts),
    )


@router.post(
    "",
    response_model=BatchResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[EnabledGuard],
)
async def create_batch(
    db: DbSession, current_user: Annotated[User, Depends(get_current_user)]
) -> BatchResponse:
    batch = UploadBatch(user_id=current_user.id, status=BatchStatus.uploading)
    db.add(batch)
    await db.commit()
    await db.refresh(batch)
    return _batch_response(batch, Counter())


@router.get("", response_model=list[BatchResponse], dependencies=[EnabledGuard])
async def list_batches(
    db: DbSession, current_user: Annotated[User, Depends(get_current_user)]
) -> list[BatchResponse]:
    batches = list(
        (
            await db.execute(
                select(UploadBatch)
                .where(
                    and_(
                        UploadBatch.user_id == current_user.id,
                        UploadBatch.status != BatchStatus.closed,
                    )
                )
                .order_by(UploadBatch.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    counts = await _counts(db, [b.id for b in batches]) if batches else {}
    return [_batch_response(b, counts[b.id]) for b in batches]


@router.get("/{batch_id}", response_model=BatchDetailResponse, dependencies=[EnabledGuard])
async def get_batch(
    batch_id: UUID, db: DbSession, current_user: Annotated[User, Depends(get_current_user)]
) -> BatchDetailResponse:
    return await _detail(db, await _get_batch(db, current_user.id, batch_id))


async def _detail(db: DbSession, batch: UploadBatch) -> BatchDetailResponse:
    photos = list(
        (
            await db.execute(
                select(UploadPhoto)
                .where(UploadPhoto.batch_id == batch.id)
                .order_by(UploadPhoto.position)
            )
        )
        .scalars()
        .all()
    )
    active = [p for p in photos if p.status in ACTIVE_STATUSES]
    groups: dict[UUID, list[UploadPhoto]] = {}
    for photo in active:
        if photo.group_id is not None:
            groups.setdefault(photo.group_id, []).append(photo)
    for members in groups.values():
        members.sort(key=lambda p: (not p.is_primary, p.position))
    duplicate_ids = {m[0].duplicate_of_item_id for m in groups.values()} - {None}
    duplicates = (
        {
            item.id: item
            for item in (
                await db.execute(select(ClothingItem).where(ClothingItem.id.in_(duplicate_ids)))
            ).scalars()
        }
        if duplicate_ids
        else {}
    )
    base = _batch_response(batch, Counter(p.status for p in photos))
    return BatchDetailResponse(
        **base.model_dump(),
        groups=[
            GroupResponse(
                group_id=group_id,
                primary_photo_id=members[0].id,
                photos=[PhotoResponse.model_validate(p) for p in members],
                blocked_reason=confirmable(members),
                duplicate_item=_duplicate_item(duplicates.get(members[0].duplicate_of_item_id)),
            )
            for group_id, members in groups.items()
        ],
        ungrouped=[PhotoResponse.model_validate(p) for p in active if p.group_id is None],
    )


def _duplicate_item(item: ClothingItem | None) -> "DuplicateItemResponse | None":
    if item is None:
        return None
    return DuplicateItemResponse(
        id=item.id,
        type=item.type,
        name=item.name,
        primary_color=item.primary_color,
        thumbnail_path=item.thumbnail_path or item.image_path,
    )


@router.post(
    "/{batch_id}/photos",
    response_model=PhotoUploadResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[EnabledGuard],
)
async def upload_photos(
    batch_id: UUID,
    db: DbSession,
    current_user: Annotated[User, Depends(get_current_user)],
    images: list[UploadFile] = File(..., description="Photos, one garment per photo"),
    upload_keys: list[str] | None = Form(
        None, description="Optional per-file idempotency keys, same order/length as images"
    ),
) -> PhotoUploadResponse:
    settings = get_settings()
    # Plain values: a rollback below expires every ORM object in the session.
    user_id = current_user.id
    batch = await _get_batch(db, user_id, batch_id)
    if batch.sealed_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Batch already sealed")
    if not images:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No images")
    if len(images) > settings.max_bulk_upload_count:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Maximum {settings.max_bulk_upload_count} images per request",
        )
    if upload_keys is not None and len(upload_keys) != len(images):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="upload_keys must have the same length as images",
        )
    existing = (
        await db.execute(
            select(func.count(), func.coalesce(func.max(UploadPhoto.position), -1)).where(
                UploadPhoto.batch_id == batch_id
            )
        )
    ).one()
    stored_count, last_position = existing
    if stored_count + len(images) > settings.max_batch_photos:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Maximum {settings.max_batch_photos} photos per batch",
        )

    image_service = ImageService()
    results: list[PhotoUploadResult] = []
    new_photo_ids: list[UUID] = []
    position = last_position
    for index, upload_file in enumerate(images):
        filename = upload_file.filename or "unknown.jpg"
        upload_key = upload_keys[index] if upload_keys is not None else None
        if upload_key is not None:
            already = await _photo_by_key(db, user_id, upload_key)
            if already is not None:
                results.append(
                    PhotoUploadResult(
                        filename=filename, success=True, photo_id=already, duplicate=True
                    )
                )
                continue
        try:
            content = await read_upload_within_limit(upload_file, settings.max_upload_size_mb)
        except UploadTooLargeError as e:
            results.append(
                PhotoUploadResult(
                    filename=filename, success=False, error=str(e), error_code="too_large"
                )
            )
            continue
        content_type = upload_file.content_type or "application/octet-stream"
        if not image_service.validate_image(content, content_type):
            results.append(
                PhotoUploadResult(
                    filename=filename,
                    success=False,
                    error="Invalid image format. Supported: JPEG, PNG, WebP, HEIC",
                    error_code="unsupported_format",
                )
            )
            continue
        paths: dict[str, str] | None = None
        try:
            paths = await image_service.process_and_store(
                user_id=user_id, image_data=content, original_filename=filename
            )
            position += 1
            photo = UploadPhoto(
                batch_id=batch_id,
                user_id=user_id,
                position=position,
                upload_key=upload_key,
                filename=filename[:255],
                image_path=paths["image_path"],
                thumbnail_path=paths.get("thumbnail_path"),
                medium_path=paths.get("medium_path"),
                image_hash=paths.get("image_hash"),
                status=PhotoStatus.queued,
            )
            # An exact copy of a wardrobe photo is flagged right away; similar ones are
            # found after embedding, when the batch is grouped.
            if photo.image_hash:
                same = await item_with_same_hash(db, user_id, photo.image_hash)
                if same is not None:
                    photo.duplicate_of_item_id, photo.duplicate_score = same, 1.0
            db.add(photo)
            await db.commit()
            new_photo_ids.append(photo.id)
            results.append(PhotoUploadResult(filename=filename, success=True, photo_id=photo.id))
        except ValueError as e:
            results.append(
                PhotoUploadResult(
                    filename=filename, success=False, error=str(e), error_code="invalid_image"
                )
            )
        except IntegrityError:
            # The upload_key constraint: a concurrent retry of this chunk stored it first.
            await db.rollback()
            if paths:
                image_service.delete_images(paths)
            position -= 1
            already = await _photo_by_key(db, user_id, upload_key) if upload_key else None
            results.append(
                PhotoUploadResult(filename=filename, success=True, photo_id=already, duplicate=True)
            )
        except Exception as e:
            logger.error(f"Error storing batch photo {filename}: {e}")
            await db.rollback()
            if paths:
                image_service.delete_images(paths)
            results.append(
                PhotoUploadResult(
                    filename=filename,
                    success=False,
                    error="Failed to process image",
                    error_code="processing_failed",
                )
            )

    if new_photo_ids:
        await _enqueue_prepare(new_photo_ids)

    successful = sum(1 for r in results if r.success)
    return PhotoUploadResponse(
        total=len(images), successful=successful, failed=len(results) - successful, results=results
    )


async def _photo_by_key(db: DbSession, user_id: UUID, upload_key: str) -> UUID | None:
    return (
        await db.execute(
            select(UploadPhoto.id).where(
                and_(UploadPhoto.user_id == user_id, UploadPhoto.upload_key == upload_key)
            )
        )
    ).scalar_one_or_none()


async def _enqueue_prepare(photo_ids: list[UUID]) -> None:
    # A photo whose job never makes it to Redis stays queued and the recovery cron picks it up.
    try:
        redis = await create_pool(get_redis_settings())
    except Exception as e:
        logger.error(f"Failed to connect to Redis for batch photos: {e}")
        return
    try:
        for photo_id in photo_ids:
            await redis.enqueue_job(
                "prepare_upload_photo_job",
                str(photo_id),
                _queue_name=IMAGE_QUEUE,
                _job_id=f"upload-prepare:{photo_id}",
            )
    except Exception as e:
        logger.error(f"Failed to queue batch photo preparation: {e}")
    finally:
        await redis.aclose()


@router.post("/{batch_id}/seal", response_model=BatchResponse, dependencies=[EnabledGuard])
async def seal_batch(
    batch_id: UUID, db: DbSession, current_user: Annotated[User, Depends(get_current_user)]
) -> BatchResponse:
    batch = await _get_batch(db, current_user.id, batch_id)
    counts = (await _counts(db, [batch.id]))[batch.id]
    if batch.sealed_at is None:
        if not counts:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Batch is empty")
        batch.sealed_at = datetime.now(UTC)
        batch.status = BatchStatus.processing
        await refresh_batch_status(db, batch)
        await db.commit()
        await db.refresh(batch)
        try:
            redis = await create_pool(get_redis_settings())
            try:
                await enqueue_group_if_ready(redis, db, batch)
            finally:
                await redis.aclose()
        except Exception as e:
            logger.error(f"Failed to queue grouping for batch {batch.id}: {e}")
    return _batch_response(batch, counts)


class GroupSelection(BaseModel):
    group_ids: list[UUID] = Field(min_length=1)


class ConfirmRequest(BaseModel):
    # None confirms every garment that is ready.
    group_ids: list[UUID] | None = None


class ConfirmResponse(BatchDetailResponse):
    created_item_ids: list[UUID] = []
    # group_id -> why it was not confirmed
    skipped: dict[UUID, str] = {}


class GroupUpdateRequest(GroupSelection):
    changes: GroupChanges


class AttachRequest(BaseModel):
    # Defaults to the item the duplicate check found.
    item_id: UUID | None = None


async def _act(db: DbSession, batch: UploadBatch, action, *args):
    """Run an inbox action, commit, queue the tagging it asks for, and map its errors."""
    try:
        result = await action(db, batch, *args)
    except InboxActionError as e:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from None
    except LookupError as e:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from None
    await db.commit()
    return result


async def _enqueue_tagging(photo_ids: list[UUID]) -> None:
    # A job that never reaches Redis is re-queued by the recovery cron.
    if not photo_ids:
        return
    try:
        redis = await create_pool(get_redis_settings())
    except Exception as e:
        logger.error(f"Failed to connect to Redis for batch tagging: {e}")
        return
    try:
        for photo_id in photo_ids:
            await redis.enqueue_job(
                "tag_upload_group_job",
                str(photo_id),
                _queue_name=TAGGING_QUEUE,
                _job_id=f"upload-tag:{photo_id}",
            )
    except Exception as e:
        logger.error(f"Failed to queue batch tagging: {e}")
    finally:
        await redis.aclose()


CurrentUser = Annotated[User, Depends(get_current_user)]


@router.post("/{batch_id}/confirm", response_model=ConfirmResponse, dependencies=[EnabledGuard])
async def confirm(
    batch_id: UUID, body: ConfirmRequest, db: DbSession, current_user: CurrentUser
) -> ConfirmResponse:
    batch = await _get_batch(db, current_user.id, batch_id)
    created, skipped = await _act(db, batch, confirm_groups, body.group_ids)
    detail = await _detail(db, batch)
    return ConfirmResponse(
        **detail.model_dump(),
        created_item_ids=created,
        skipped=skipped if body.group_ids is not None else {},
    )


@router.patch("/{batch_id}/groups", response_model=BatchDetailResponse, dependencies=[EnabledGuard])
async def update(
    batch_id: UUID, body: GroupUpdateRequest, db: DbSession, current_user: CurrentUser
) -> BatchDetailResponse:
    batch = await _get_batch(db, current_user.id, batch_id)
    await _act(db, batch, update_groups, body.group_ids, body.changes)
    return await _detail(db, batch)


@router.post("/{batch_id}/merge", response_model=BatchDetailResponse, dependencies=[EnabledGuard])
async def merge(
    batch_id: UUID, body: GroupSelection, db: DbSession, current_user: CurrentUser
) -> BatchDetailResponse:
    batch = await _get_batch(db, current_user.id, batch_id)
    await _act(db, batch, merge_groups, body.group_ids)
    return await _detail(db, batch)


@router.post("/{batch_id}/discard", response_model=BatchDetailResponse, dependencies=[EnabledGuard])
async def discard(
    batch_id: UUID, body: GroupSelection, db: DbSession, current_user: CurrentUser
) -> BatchDetailResponse:
    batch = await _get_batch(db, current_user.id, batch_id)
    await _act(db, batch, discard_groups, body.group_ids)
    return await _detail(db, batch)


@router.post(
    "/{batch_id}/photos/{photo_id}/split",
    response_model=BatchDetailResponse,
    dependencies=[EnabledGuard],
)
async def split(
    batch_id: UUID, photo_id: UUID, db: DbSession, current_user: CurrentUser
) -> BatchDetailResponse:
    batch = await _get_batch(db, current_user.id, batch_id)
    await _enqueue_tagging(await _act(db, batch, split_photo, photo_id))
    return await _detail(db, batch)


@router.post(
    "/{batch_id}/groups/{group_id}/not-duplicate",
    response_model=BatchDetailResponse,
    dependencies=[EnabledGuard],
)
async def mark_not_duplicate(
    batch_id: UUID, group_id: UUID, db: DbSession, current_user: CurrentUser
) -> BatchDetailResponse:
    batch = await _get_batch(db, current_user.id, batch_id)
    await _enqueue_tagging(await _act(db, batch, not_duplicate, group_id))
    return await _detail(db, batch)


@router.post(
    "/{batch_id}/groups/{group_id}/attach",
    response_model=BatchDetailResponse,
    dependencies=[EnabledGuard],
)
async def attach(
    batch_id: UUID,
    group_id: UUID,
    body: AttachRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> BatchDetailResponse:
    batch = await _get_batch(db, current_user.id, batch_id)
    await _act(db, batch, attach_to_item, group_id, body.item_id)
    return await _detail(db, batch)


@router.post(
    "/{batch_id}/groups/{group_id}/retag",
    response_model=BatchDetailResponse,
    dependencies=[EnabledGuard],
)
async def retag_group(
    batch_id: UUID, group_id: UUID, db: DbSession, current_user: CurrentUser
) -> BatchDetailResponse:
    batch = await _get_batch(db, current_user.id, batch_id)
    await _enqueue_tagging(await _act(db, batch, retag, group_id))
    return await _detail(db, batch)


@router.delete("/{batch_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[EnabledGuard])
async def delete_batch(batch_id: UUID, db: DbSession, current_user: CurrentUser) -> None:
    batch = await _get_batch(db, current_user.id, batch_id)
    await abandon_batch(db, batch)
    await db.commit()
