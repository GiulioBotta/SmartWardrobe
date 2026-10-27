"""Review-inbox actions on a batch upload: confirm, edit, merge, split, discard, duplicates.

Every function works on garments (photos sharing group_id) of one batch, leaves the commit
to the caller, and returns the photo ids that need an AI tagging job queued afterwards.
"""

from collections.abc import Iterable
from datetime import UTC, datetime
from uuid import UUID, uuid4

from pydantic import BaseModel, Field
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.embedding import ItemEmbedding
from app.models.item import ClothingItem, ItemImage
from app.models.upload_batch import PhotoStatus, UploadBatch, UploadPhoto
from app.services.ai_service import ClothingTags
from app.services.image_service import ImageService
from app.services.upload_batch_service import refresh_batch_status
from app.workers.tagging import tags_to_item_fields

# Photos the inbox still shows; confirmed and discarded ones are done with.
ACTIVE_STATUSES = (
    PhotoStatus.queued,
    PhotoStatus.prepared,
    PhotoStatus.tagging,
    PhotoStatus.ready,
    PhotoStatus.error,
)


class InboxActionError(ValueError):
    """The action does not apply to the garments as they are (shown to the user as a 409)."""


class GroupChanges(BaseModel):
    """Fields the user can set on one or more garments; unset fields are left alone."""

    type: str | None = Field(default=None, max_length=50)
    subtype: str | None = Field(default=None, max_length=50)
    name: str | None = Field(default=None, max_length=100)
    brand: str | None = Field(default=None, max_length=100)
    primary_color: str | None = Field(default=None, max_length=50)
    colors: list[str] | None = None
    pattern: str | None = Field(default=None, max_length=50)
    material: str | None = Field(default=None, max_length=50)
    style: list[str] | None = None
    season: list[str] | None = None
    formality: str | None = Field(default=None, max_length=50)


async def active_groups(
    db: AsyncSession, batch: UploadBatch, group_ids: Iterable[UUID] | None = None
) -> dict[UUID, list[UploadPhoto]]:
    """Garments of the batch still in the inbox, photos in shooting order, primary first."""
    query = (
        select(UploadPhoto)
        .where(
            and_(
                UploadPhoto.batch_id == batch.id,
                UploadPhoto.group_id.is_not(None),
                UploadPhoto.status.in_([s.value for s in ACTIVE_STATUSES]),
            )
        )
        .order_by(UploadPhoto.position)
    )
    wanted = list(group_ids) if group_ids is not None else None
    if wanted is not None:
        query = query.where(UploadPhoto.group_id.in_(wanted))
    groups: dict[UUID, list[UploadPhoto]] = {}
    for photo in (await db.execute(query)).scalars():
        groups.setdefault(photo.group_id, []).append(photo)
    if wanted is not None:
        missing = set(wanted) - set(groups)
        if missing:
            raise LookupError(f"{len(missing)} garment(s) not found in this batch")
    for members in groups.values():
        members.sort(key=lambda p: (not p.is_primary, p.position))
    return groups


def _primary(members: list[UploadPhoto]) -> UploadPhoto:
    return members[0]


def confirmable(members: list[UploadPhoto]) -> str | None:
    """Why a garment cannot become an item yet, or None when it can."""
    primary = _primary(members)
    if any(p.status in (PhotoStatus.queued, PhotoStatus.prepared) for p in members):
        return "still processing"
    if primary.status == PhotoStatus.tagging:
        return "still being analyzed"
    if primary.duplicate_of_item_id is not None:
        return "possible duplicate to resolve"
    if not primary.tags or primary.tags.get("type") in (None, "", "unknown"):
        return "type missing"
    return None


async def confirm_groups(
    db: AsyncSession, batch: UploadBatch, group_ids: list[UUID] | None
) -> tuple[list[UUID], dict[UUID, str]]:
    """Turn garments into wardrobe items; returns the new item ids and the skipped garments.

    With group_ids None every confirmable garment is taken and the rest are skipped quietly;
    named garments that cannot be confirmed are reported with the reason.
    """
    created: list[UUID] = []
    skipped: dict[UUID, str] = {}
    for group_id, members in (await active_groups(db, batch, group_ids)).items():
        reason = confirmable(members)
        if reason is not None:
            skipped[group_id] = reason
            continue
        created.append(await _create_item(db, batch.user_id, members))
    await refresh_batch_status(db, batch)
    return created, skipped


async def _create_item(db: AsyncSession, user_id: UUID, members: list[UploadPhoto]) -> UUID:
    primary = _primary(members)
    tags = dict(primary.tags or {})
    fields = tags_to_item_fields(ClothingTags.model_validate(tags))
    item = ClothingItem(
        user_id=user_id,
        image_path=primary.image_path,
        thumbnail_path=primary.thumbnail_path,
        medium_path=primary.medium_path,
        original_image_path=primary.original_image_path,
        image_hash=primary.image_hash,
        name=tags.get("name") or None,
        ai_completed_at=datetime.now(UTC),
        **fields,
    )
    db.add(item)
    await db.flush()
    for position, photo in enumerate(members[1:]):
        db.add(
            ItemImage(
                item_id=item.id,
                image_path=photo.image_path,
                thumbnail_path=photo.thumbnail_path,
                medium_path=photo.medium_path,
                position=position,
            )
        )
    if primary.embedding is not None and primary.embedding_model:
        db.add(
            ItemEmbedding(
                item_id=item.id,
                model=primary.embedding_model,
                embedding=primary.embedding,
                source_path=primary.image_path,
            )
        )
    for photo in members:
        photo.status = PhotoStatus.confirmed
        photo.item_id = item.id
    return item.id


async def update_groups(
    db: AsyncSession, batch: UploadBatch, group_ids: list[UUID], changes: GroupChanges
) -> None:
    values = changes.model_dump(exclude_unset=True)
    if not values:
        return
    for members in (await active_groups(db, batch, group_ids)).values():
        primary = _primary(members)
        primary.tags = {**(primary.tags or {}), **values}
        # Typing the garment in by hand is how a failed analysis is rescued.
        if primary.status == PhotoStatus.error and primary.tags.get("type") not in (
            None,
            "",
            "unknown",
        ):
            primary.status = PhotoStatus.ready
            primary.error = None
    await refresh_batch_status(db, batch)


async def merge_groups(db: AsyncSession, batch: UploadBatch, group_ids: list[UUID]) -> UUID:
    """One garment from several; the earliest-shot garment keeps its primary photo and tags."""
    groups = await active_groups(db, batch, group_ids)
    if len(groups) < 2:
        raise InboxActionError("Select at least two garments to merge")
    target_id = min(groups, key=lambda gid: min(p.position for p in groups[gid]))
    for group_id, members in groups.items():
        if group_id == target_id:
            continue
        for photo in members:
            photo.group_id = target_id
            photo.is_primary = False
            photo.tags = None
            photo.duplicate_of_item_id = None
            photo.duplicate_score = None
            # A pending tagging job for a merged-away primary finds it ready and skips.
            if photo.status in (PhotoStatus.tagging, PhotoStatus.error):
                photo.status = PhotoStatus.ready
                photo.error = None
    await refresh_batch_status(db, batch)
    return target_id


async def split_photo(db: AsyncSession, batch: UploadBatch, photo_id: UUID) -> list[UUID]:
    """Make one photo a garment of its own; returns the photos to tag."""
    photo = await _batch_photo(db, batch, photo_id)
    members = (await active_groups(db, batch, [photo.group_id]))[photo.group_id]
    if len(members) < 2:
        raise InboxActionError("This photo is already a garment of its own")
    to_tag: list[UUID] = []
    if photo.is_primary:
        # The garment, with its tags and duplicate check, stays with the remaining photos.
        heir = members[1]
        heir.is_primary = True
        heir.tags = photo.tags
        heir.status = photo.status
        heir.error = photo.error
        heir.duplicate_of_item_id = photo.duplicate_of_item_id
        heir.duplicate_score = photo.duplicate_score
        if heir.status == PhotoStatus.tagging:
            to_tag.append(heir.id)
    photo.group_id = uuid4()
    photo.is_primary = True
    photo.tags = None
    photo.error = None
    photo.duplicate_of_item_id = None
    photo.duplicate_score = None
    photo.status = PhotoStatus.tagging
    to_tag.append(photo.id)
    await refresh_batch_status(db, batch)
    return to_tag


async def discard_groups(db: AsyncSession, batch: UploadBatch, group_ids: list[UUID]) -> None:
    groups = await active_groups(db, batch, group_ids)
    discard_photos([p for members in groups.values() for p in members])
    await refresh_batch_status(db, batch)


def discard_photos(photos: Iterable[UploadPhoto]) -> None:
    image_service = ImageService()
    for photo in photos:
        image_service.delete_images(
            {
                "image_path": photo.image_path,
                "thumbnail_path": photo.thumbnail_path,
                "medium_path": photo.medium_path,
                "original_image_path": photo.original_image_path,
            }
        )
        photo.status = PhotoStatus.discarded
        photo.embedding = None


async def not_duplicate(db: AsyncSession, batch: UploadBatch, group_id: UUID) -> list[UUID]:
    """The user says the garment is new: analyze it unless it already has a type."""
    members = (await active_groups(db, batch, [group_id]))[group_id]
    primary = _primary(members)
    primary.duplicate_of_item_id = None
    primary.duplicate_score = None
    to_tag: list[UUID] = []
    if primary.tags and primary.tags.get("type") not in (None, "", "unknown"):
        primary.status = PhotoStatus.ready
    elif primary.status != PhotoStatus.tagging:
        primary.status = PhotoStatus.tagging
        primary.error = None
        to_tag.append(primary.id)
    await refresh_batch_status(db, batch)
    return to_tag


async def attach_to_item(
    db: AsyncSession, batch: UploadBatch, group_id: UUID, item_id: UUID | None
) -> UUID:
    """The garment is already in the wardrobe: its photos become extra photos of that item."""
    members = (await active_groups(db, batch, [group_id]))[group_id]
    target_id = item_id or _primary(members).duplicate_of_item_id
    if target_id is None:
        raise InboxActionError("No wardrobe item to add these photos to")
    item = (
        await db.execute(
            select(ClothingItem).where(
                and_(ClothingItem.id == target_id, ClothingItem.user_id == batch.user_id)
            )
        )
    ).scalar_one_or_none()
    if item is None:
        raise LookupError("Wardrobe item not found")
    last = (
        await db.execute(
            select(func.coalesce(func.max(ItemImage.position), -1)).where(
                ItemImage.item_id == item.id
            )
        )
    ).scalar_one()
    for offset, photo in enumerate(members, start=1):
        db.add(
            ItemImage(
                item_id=item.id,
                image_path=photo.image_path,
                thumbnail_path=photo.thumbnail_path,
                medium_path=photo.medium_path,
                position=last + offset,
            )
        )
        photo.status = PhotoStatus.confirmed
        photo.item_id = item.id
    await refresh_batch_status(db, batch)
    return item.id


async def retag(db: AsyncSession, batch: UploadBatch, group_id: UUID) -> list[UUID]:
    members = (await active_groups(db, batch, [group_id]))[group_id]
    primary = _primary(members)
    if primary.status != PhotoStatus.error:
        raise InboxActionError("Only a garment whose analysis failed can be analyzed again")
    primary.status = PhotoStatus.tagging
    primary.error = None
    await refresh_batch_status(db, batch)
    return [primary.id]


async def abandon_batch(db: AsyncSession, batch: UploadBatch) -> None:
    """Delete the batch; files of confirmed photos belong to their items and stay."""
    photos = (
        await db.execute(select(UploadPhoto).where(UploadPhoto.batch_id == batch.id))
    ).scalars()
    discard_photos(
        p for p in photos if p.status not in (PhotoStatus.confirmed, PhotoStatus.discarded)
    )
    await db.delete(batch)


async def _batch_photo(db: AsyncSession, batch: UploadBatch, photo_id: UUID) -> UploadPhoto:
    photo = await db.get(UploadPhoto, photo_id)
    if (
        photo is None
        or photo.batch_id != batch.id
        or photo.group_id is None
        or photo.status not in [s.value for s in ACTIVE_STATUSES]
    ):
        raise LookupError("Photo not found in this batch")
    return photo
