"""Worker jobs for the batch upload inbox (BATCH_UPLOAD_ENABLED).

Per photo, on the image worker: background removal (AUTO_REMOVE_BACKGROUND) then a CLIP
embedding. Once the batch is sealed and every photo is prepared, the batch is grouped into
garments and checked against the wardrobe for duplicates. Then one AI tagging call per
garment runs on the tagging worker, behind the quota limits in ai_quota; a used-up daily
quota pauses the batch and the job comes back on its own after the reset.
"""

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid4

from arq import Retry
from sqlalchemy import and_, select

from app.config import get_settings
from app.models.preference import UserPreference
from app.models.upload_batch import BatchStatus, PhotoStatus, UploadBatch, UploadPhoto
from app.models.user import User
from app.services.ai_quota import AIQuotaExceededError, seconds_until_daily_reset
from app.services.ai_service import AIService, repeats_identically
from app.services.embedding_service import ClipImageEncoder, load_image
from app.services.image_service import ImageService
from app.services.upload_batch_service import (
    group_consecutive,
    is_paused,
    item_with_same_hash,
    nearest_item,
    refresh_batch_status,
    ungrouped_count,
)
from app.utils.locale import DEFAULT_LOCALE
from app.workers.db import get_db_session
from app.workers.queues import IMAGE_QUEUE, TAGGING_QUEUE
from app.workers.tagging import TAGGING_MAX_TRIES, retry_delay_seconds, worker_job_timeout_seconds

logger = logging.getLogger(__name__)

# Rows left in a working status this long are re-queued by the recovery cron; the jobs are
# no-ops for a photo that has moved on, so a duplicate job costs nothing.
STUCK_QUEUED_MINUTES = 10
STUCK_TAGGING_MINUTES = 60
# Room left below the tagging worker's job_timeout for the AI call.
TAG_CALL_MARGIN_SECONDS = 30


def _hex_to_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return (int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16))


def _embed(path: Path) -> list[float]:
    return ClipImageEncoder.get().embed([load_image(path)])[0].tolist()


async def enqueue_group_if_ready(redis, db, batch: UploadBatch) -> bool:
    """Queue the grouping of a sealed batch once no photo is waiting for preparation."""
    if batch.sealed_at is None or batch.status == BatchStatus.closed:
        return False
    queued, prepared = await ungrouped_count(db, batch.id)
    if queued or not prepared:
        return False
    # Fixed id: the last prepare job and the seal request may both get here.
    await redis.enqueue_job(
        "group_upload_batch_job",
        str(batch.id),
        _queue_name=IMAGE_QUEUE,
        _job_id=f"upload-group:{batch.id}",
    )
    return True


async def prepare_upload_photo_job(ctx: dict, photo_id: str) -> dict:
    settings = get_settings()
    db = get_db_session(ctx)
    try:
        photo = await db.get(UploadPhoto, UUID(photo_id))
        if photo is None or photo.status != PhotoStatus.queued:
            return {"status": "skipped"}
        image_service = ImageService()
        if not image_service.get_image_path(photo.image_path).exists():
            photo.status = PhotoStatus.error
            photo.error = "Image file not found"
            await db.commit()
            return {"status": "error", "error": photo.error}

        # Both steps are best effort: a photo with its background or without an embedding
        # is still worth reviewing, it just stands alone in the grouping.
        if settings.auto_remove_background and not photo.original_image_path:
            try:
                out = await asyncio.to_thread(
                    image_service.remove_background,
                    photo.image_path,
                    _hex_to_rgb(settings.auto_remove_background_color),
                )
                photo.original_image_path = out["original_backup_path"]
            except Exception as e:
                logger.warning(f"Background removal failed for upload photo {photo_id}: {e}")
        if settings.embeddings_enabled:
            try:
                photo.embedding = await asyncio.to_thread(
                    _embed, image_service.get_image_path(photo.image_path)
                )
                photo.embedding_model = settings.embedding_model_name
            except Exception as e:
                logger.warning(f"Embedding failed for upload photo {photo_id}: {e}")

        photo.status = PhotoStatus.prepared
        await db.commit()

        batch = await db.get(UploadBatch, photo.batch_id)
        redis = ctx.get("redis")
        if batch is not None and redis is not None:
            await enqueue_group_if_ready(redis, db, batch)
        return {"status": "success", "embedded": photo.embedding is not None}
    finally:
        await db.close()


async def group_upload_batch_job(ctx: dict, batch_id: str) -> dict:
    settings = get_settings()
    db = get_db_session(ctx)
    try:
        batch = (
            await db.execute(
                select(UploadBatch).where(UploadBatch.id == UUID(batch_id)).with_for_update()
            )
        ).scalar_one_or_none()
        if batch is None or batch.sealed_at is None or batch.status == BatchStatus.closed:
            return {"status": "skipped"}
        photos = list(
            (
                await db.execute(
                    select(UploadPhoto)
                    .where(
                        and_(
                            UploadPhoto.batch_id == batch.id,
                            UploadPhoto.status == PhotoStatus.prepared,
                        )
                    )
                    .order_by(UploadPhoto.position)
                )
            )
            .scalars()
            .all()
        )
        if not photos:
            await refresh_batch_status(db, batch)
            await db.commit()
            return {"status": "idle"}

        runs = group_consecutive([p.embedding for p in photos], settings.batch_group_threshold)
        to_tag: list[UploadPhoto] = []
        for run in runs:
            members = [photos[i] for i in run]
            group_id = uuid4()
            for photo in members:
                photo.group_id = group_id
                photo.is_primary = False
                photo.status = PhotoStatus.ready
            primary = members[0]
            primary.is_primary = True

            duplicate = await _find_duplicate(db, batch.user_id, members, settings)
            if duplicate is not None:
                primary.duplicate_of_item_id, primary.duplicate_score = duplicate
            else:
                # A suspected duplicate is not tagged until the user says it is a new
                # garment, so it costs no AI quota.
                primary.status = PhotoStatus.tagging
                to_tag.append(primary)

        await refresh_batch_status(db, batch)
        await db.commit()

        redis = ctx.get("redis")
        for photo in to_tag:
            if redis is not None:
                await redis.enqueue_job(
                    "tag_upload_group_job",
                    str(photo.id),
                    _queue_name=TAGGING_QUEUE,
                    _job_id=f"upload-tag:{photo.id}",
                )
        logger.info(
            f"Grouped batch {batch_id}: {len(photos)} photos into {len(runs)} garments, "
            f"{len(to_tag)} to tag"
        )
        return {"status": "success", "groups": len(runs), "to_tag": len(to_tag)}
    finally:
        await db.close()


async def _find_duplicate(
    db, user_id: UUID, members: list[UploadPhoto], settings
) -> tuple[UUID, float] | None:
    for photo in members:
        if photo.image_hash:
            item_id = await item_with_same_hash(db, user_id, photo.image_hash)
            if item_id is not None:
                return item_id, 1.0
    best: tuple[UUID, float] | None = None
    for photo in members:
        if photo.embedding is None or photo.embedding_model is None:
            continue
        match = await nearest_item(db, user_id, photo.embedding, photo.embedding_model)
        if match is not None and (best is None or match[1] > best[1]):
            best = match
    if best is not None and best[1] >= settings.batch_duplicate_threshold:
        return best
    return None


async def _defer_until_resume(ctx: dict, photo_id: str, resume_at: datetime) -> None:
    redis = ctx.get("redis")
    if redis is None:
        return
    # A new id: the running job still holds the fixed one.
    await redis.enqueue_job(
        "tag_upload_group_job",
        photo_id,
        _queue_name=TAGGING_QUEUE,
        _job_id=f"upload-tag:{photo_id}:{int(resume_at.timestamp())}",
        _defer_until=resume_at,
    )


async def tag_upload_group_job(ctx: dict, photo_id: str) -> dict:
    db = get_db_session(ctx)
    try:
        photo = await db.get(UploadPhoto, UUID(photo_id))
        if photo is None or photo.status != PhotoStatus.tagging:
            return {"status": "skipped"}
        batch = await db.get(UploadBatch, photo.batch_id)
        if batch is None or batch.status == BatchStatus.closed:
            return {"status": "skipped"}
        if is_paused(batch):
            # Another garment of this batch already found the quota used up: wait for the
            # reset instead of spending a request to learn the same thing.
            await _defer_until_resume(ctx, photo_id, batch.paused_until)
            return {"status": "paused"}

        locale = (
            await db.execute(select(User.locale).where(User.id == photo.user_id))
        ).scalar_one_or_none() or DEFAULT_LOCALE
        prefs = (
            await db.execute(select(UserPreference).where(UserPreference.user_id == photo.user_id))
        ).scalar_one_or_none()
        endpoints = prefs.ai_endpoints if prefs and prefs.ai_endpoints else None
        path = ImageService().get_image_path(photo.image_path)

        try:
            tags = await asyncio.wait_for(
                AIService(endpoints=endpoints).analyze_image(path, locale=locale),
                timeout=worker_job_timeout_seconds() - TAG_CALL_MARGIN_SECONDS,
            )
        except AIQuotaExceededError as e:
            if e.daily:
                wait = e.retry_after_seconds or seconds_until_daily_reset()
                resume_at = datetime.now(UTC) + timedelta(seconds=wait + 60)
                batch.paused_until = resume_at
                batch.pause_reason = str(e)
                await db.commit()
                await _defer_until_resume(ctx, photo_id, resume_at)
                logger.warning(f"Batch {batch.id} paused until {resume_at}: {e}")
                return {"status": "paused", "until": resume_at.isoformat()}
            delay = max(retry_delay_seconds(ctx), e.retry_after_seconds or 0)
            if int(ctx.get("job_try") or 1) >= TAGGING_MAX_TRIES:
                # Out of arq retries on a per-minute limit: a quota is never a reason to
                # fail a garment, so start over as a fresh job.
                await _defer_until_resume(
                    ctx, photo_id, datetime.now(UTC) + timedelta(seconds=delay)
                )
                return {"status": "deferred"}
            raise Retry(defer=delay) from e
        except Exception as e:
            final = int(ctx.get("job_try") or 1) >= TAGGING_MAX_TRIES
            if not final and not repeats_identically(e):
                raise Retry(defer=retry_delay_seconds(ctx)) from e
            logger.exception(f"Tagging failed for upload photo {photo_id}")
            photo.status = PhotoStatus.error
            photo.error = str(e) or "AI tagging failed"
            await refresh_batch_status(db, batch)
            await db.commit()
            return {"status": "error", "error": photo.error}

        photo.tags = tags.model_dump(exclude={"raw_response"})
        photo.status = PhotoStatus.ready
        photo.error = None
        batch.paused_until = None
        batch.pause_reason = None
        await refresh_batch_status(db, batch)
        await db.commit()
        return {"status": "success", "type": tags.type}
    finally:
        await db.close()


async def recover_upload_batches(ctx: dict) -> dict:
    """Re-queue photos and batches whose job was lost (worker restart, Redis flush)."""
    if not get_settings().batch_upload_enabled:
        return {"status": "disabled"}
    redis = ctx.get("redis")
    if redis is None:
        return {"status": "no-redis"}
    now = datetime.now(UTC)
    requeued = {"prepare": 0, "group": 0, "tag": 0}
    db = get_db_session(ctx)
    try:
        stale_queued = (
            await db.execute(
                select(UploadPhoto.id).where(
                    and_(
                        UploadPhoto.status == PhotoStatus.queued,
                        UploadPhoto.updated_at < now - timedelta(minutes=STUCK_QUEUED_MINUTES),
                    )
                )
            )
        ).scalars()
        for photo_id in stale_queued:
            await redis.enqueue_job(
                "prepare_upload_photo_job", str(photo_id), _queue_name=IMAGE_QUEUE
            )
            requeued["prepare"] += 1

        stale_batches = (
            (
                await db.execute(
                    select(UploadBatch).where(
                        and_(
                            UploadBatch.status == BatchStatus.processing,
                            UploadBatch.updated_at < now - timedelta(minutes=STUCK_QUEUED_MINUTES),
                        )
                    )
                )
            )
            .scalars()
            .all()
        )
        for batch in stale_batches:
            queued, prepared = await ungrouped_count(db, batch.id)
            if prepared and not queued:
                await redis.enqueue_job(
                    "group_upload_batch_job", str(batch.id), _queue_name=IMAGE_QUEUE
                )
                requeued["group"] += 1
            if is_paused(batch, now):
                continue
            stale_tagging = (
                await db.execute(
                    select(UploadPhoto.id).where(
                        and_(
                            UploadPhoto.batch_id == batch.id,
                            UploadPhoto.status == PhotoStatus.tagging,
                            UploadPhoto.updated_at < now - timedelta(minutes=STUCK_TAGGING_MINUTES),
                        )
                    )
                )
            ).scalars()
            for photo_id in stale_tagging:
                # The fixed id is refused while the original job is still queued or running.
                await redis.enqueue_job(
                    "tag_upload_group_job",
                    str(photo_id),
                    _queue_name=TAGGING_QUEUE,
                    _job_id=f"upload-tag:{photo_id}",
                )
                requeued["tag"] += 1
        return {"status": "success", **requeued}
    finally:
        await db.close()
