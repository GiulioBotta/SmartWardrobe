"""Fork: request and response shapes for /wardrobe-sections."""

from uuid import UUID

from pydantic import BaseModel, Field


class SectionOut(BaseModel):
    id: UUID
    kind: str
    key: str | None
    name: str | None
    position: int
    enabled: bool
    # Only for collections: their non-archived items, oldest addition first.
    item_ids: list[UUID] = Field(default_factory=list)


class SectionList(BaseModel):
    sections: list[SectionOut]


class OrderIn(BaseModel):
    ids: list[UUID]


class SectionPatch(BaseModel):
    enabled: bool | None = None
    name: str | None = None


class CollectionCreate(BaseModel):
    name: str
    item_ids: list[UUID] = Field(default_factory=list)


class ItemIdsIn(BaseModel):
    item_ids: list[UUID]
