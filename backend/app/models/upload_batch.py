"""The fork's batch upload: photos waiting in the review inbox before they become items."""

import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.embedding import EMBEDDING_DIM, Vector


class BatchStatus(enum.StrEnum):
    uploading = "uploading"  # chunks still arriving; not sealed
    processing = "processing"  # sealed, photos being prepared, grouped or tagged
    review = "review"  # everything processed, waiting in the inbox
    closed = "closed"


class PhotoStatus(enum.StrEnum):
    queued = "queued"  # stored, waiting for background removal + embedding
    prepared = "prepared"  # embedded, waiting for the batch to be grouped
    tagging = "tagging"  # group primary waiting for (or in) AI tagging
    ready = "ready"  # in the inbox
    error = "error"
    confirmed = "confirmed"
    discarded = "discarded"


# Statuses that still have work queued for them; a batch with none of these is in review.
PENDING_PHOTO_STATUSES = (PhotoStatus.queued, PhotoStatus.prepared, PhotoStatus.tagging)


class UploadBatch(Base):
    __tablename__ = "upload_batches"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=BatchStatus.uploading)
    sealed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Set when the AI's daily quota ran out; tagging resumes on its own after it.
    paused_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    pause_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class UploadPhoto(Base):
    __tablename__ = "upload_photos"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    batch_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("upload_batches.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # Upload order, which is shooting order: front, back and label of one garment are
    # usually consecutive, and grouping relies on it.
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    upload_key: Mapped[str | None] = mapped_column(String(64))
    filename: Mapped[str | None] = mapped_column(String(255))

    image_path: Mapped[str] = mapped_column(String(500), nullable=False)
    thumbnail_path: Mapped[str | None] = mapped_column(String(500))
    medium_path: Mapped[str | None] = mapped_column(String(500))
    original_image_path: Mapped[str | None] = mapped_column(String(500))
    image_hash: Mapped[str | None] = mapped_column(String(16))

    status: Mapped[str] = mapped_column(String(20), nullable=False, default=PhotoStatus.queued)
    embedding_model: Mapped[str | None] = mapped_column(String(100))
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBEDDING_DIM))

    # Photos sharing group_id are one garment; the primary carries the AI tags.
    group_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    tags: Mapped[dict | None] = mapped_column(JSONB)

    duplicate_of_item_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clothing_items.id", ondelete="SET NULL")
    )
    duplicate_score: Mapped[float | None] = mapped_column(Float)
    item_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clothing_items.id", ondelete="SET NULL")
    )
    error: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
