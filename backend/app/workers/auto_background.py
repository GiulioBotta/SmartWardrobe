import logging
from uuid import UUID

from sqlalchemy import select

from app.config import get_settings
from app.models.item import ClothingItem, ItemStatus, ProcessingKind
from app.workers.db import get_db_session
from app.workers.queues import IMAGE_QUEUE

logger = logging.getLogger(__name__)


async def queue_auto_background_removal(ctx: dict, item_id: str) -> bool:
    """Queue a background removal for a freshly tagged item when AUTO_REMOVE_BACKGROUND is on.

    Mirrors bulk_remove_background_items for a single item. Never raises: the item is
    already tagged, and a failure here must not make arq retry the tagging job.
    """
    settings = get_settings()
    if not settings.auto_remove_background:
        return False
    redis = ctx.get("redis")
    if redis is None:
        logger.warning(
            f"No redis in worker context; skipping auto background removal for {item_id}"
        )
        return False

    db = get_db_session(ctx)
    try:
        result = await db.execute(
            select(ClothingItem).where(ClothingItem.id == UUID(item_id)).with_for_update()
        )
        item = result.scalar_one_or_none()
        # original_image_path set means the background is already gone; running the
        # provider again would overwrite the backup of the real original.
        if (
            item is None
            or not item.image_path
            or item.original_image_path
            or item.status != ItemStatus.ready
        ):
            return False

        item.status = ItemStatus.processing
        item.processing_kind = ProcessingKind.background_removal
        item.ai_started_at = None
        await db.commit()

        try:
            job = await redis.enqueue_job(
                "remove_item_background_job",
                item_id,
                settings.auto_remove_background_color,
                _queue_name=IMAGE_QUEUE,
            )
            if job is None:
                raise RuntimeError("enqueue_job returned None")
        except Exception as e:
            logger.error(f"Failed to queue auto background removal for item {item_id}: {e}")
            item.status = ItemStatus.ready
            item.processing_kind = None
            await db.commit()
            return False

        item.ai_job_id = job.job_id
        await db.commit()
        logger.info(f"Queued auto background removal for item {item_id}")
        return True
    except Exception as e:
        logger.error(f"Auto background removal skipped for item {item_id}: {e}")
        await db.rollback()
        return False
    finally:
        await db.close()
