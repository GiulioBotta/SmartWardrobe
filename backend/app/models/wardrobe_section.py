"""Fork: the user's wardrobe groups (WARDROBE_SECTIONS_ENABLED).

One row per category the user sees (standard or hidden, by key) and per collection they made
(by name), in one shared order. Which items a category holds comes from their type
(services/wardrobe_sections.py); a collection's items are listed in collection_items.
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

COLLECTION_NAME_MAX = 50


class SectionKind(enum.StrEnum):
    category = "category"
    collection = "collection"


class WardrobeSection(Base):
    __tablename__ = "wardrobe_sections"
    __table_args__ = (
        UniqueConstraint("user_id", "key", name="uq_wardrobe_sections_user_key"),
        Index(
            "uq_wardrobe_sections_user_collection_name",
            "user_id",
            func.lower(text("name")),
            unique=True,
            postgresql_where=text("kind = 'collection'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    # Category key from data/wardrobe_sections.json; null for collections.
    key: Mapped[str | None] = mapped_column(String(30))
    # Collection name; null for categories, whose names are translated in the frontend.
    name: Mapped[str | None] = mapped_column(String(COLLECTION_NAME_MAX))
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CollectionItem(Base):
    __tablename__ = "collection_items"

    section_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("wardrobe_sections.id", ondelete="CASCADE"), primary_key=True
    )
    item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("clothing_items.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    )
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
