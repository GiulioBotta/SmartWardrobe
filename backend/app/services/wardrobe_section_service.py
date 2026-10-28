"""Fork: the user's wardrobe groups — order, hidden categories, collections.

Stored order invariant: everything the user sees (categories switched on and collections) comes
first, in the order they chose; switched-off categories wait after it in their default order.
"""

from collections import Counter
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.item import ClothingItem
from app.models.wardrobe_section import (
    COLLECTION_NAME_MAX,
    CollectionItem,
    SectionKind,
    WardrobeSection,
)
from app.schemas.wardrobe_section import SectionOut
from app.services.wardrobe_sections import HIDDEN_KEYS, SECTION_TYPES, STANDARD_KEYS

DEFAULT_KEYS = (*STANDARD_KEYS, *HIDDEN_KEYS)


class SectionError(ValueError):
    """A request the rules refuse; `code` lets the app word it in the user's language."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class SectionNotFound(LookupError):
    pass


def _visible(section: WardrobeSection) -> bool:
    return section.kind == SectionKind.collection or section.enabled


def _renumber(sections: list[WardrobeSection]) -> list[WardrobeSection]:
    ordered = [s for s in sections if _visible(s)] + [s for s in sections if not _visible(s)]
    for position, section in enumerate(ordered):
        section.position = position
    return ordered


class WardrobeSectionService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def ordered(self, user_id: UUID) -> list[WardrobeSection]:
        result = await self.db.execute(
            select(WardrobeSection)
            .where(WardrobeSection.user_id == user_id)
            .order_by(WardrobeSection.position, WardrobeSection.created_at)
        )
        sections = list(result.scalars().all())
        present = {s.key for s in sections}
        missing = [k for k in DEFAULT_KEYS if k not in present]
        if missing:
            for key in missing:
                section = WardrobeSection(
                    user_id=user_id,
                    kind=SectionKind.category,
                    key=key,
                    position=len(sections),
                    enabled=key in STANDARD_KEYS,
                )
                self.db.add(section)
                sections.append(section)
            sections = _renumber(sections)
            await self.db.flush()
        return sections

    async def list_out(self, user_id: UUID) -> list[SectionOut]:
        sections = await self.ordered(user_id)
        rows = await self.db.execute(
            select(CollectionItem.section_id, CollectionItem.item_id)
            .join(ClothingItem, ClothingItem.id == CollectionItem.item_id)
            .join(WardrobeSection, WardrobeSection.id == CollectionItem.section_id)
            .where(WardrobeSection.user_id == user_id, ClothingItem.is_archived.is_(False))
            .order_by(CollectionItem.added_at, CollectionItem.item_id)
        )
        items: dict[UUID, list[UUID]] = {}
        for section_id, item_id in rows.all():
            items.setdefault(section_id, []).append(item_id)
        return [
            SectionOut(
                id=s.id,
                kind=s.kind,
                key=s.key,
                name=s.name,
                position=s.position,
                enabled=s.enabled,
                item_ids=items.get(s.id, []),
            )
            for s in sections
        ]

    async def _get(self, user_id: UUID, section_id: UUID) -> WardrobeSection:
        section = await self.db.get(WardrobeSection, section_id)
        if section is None or section.user_id != user_id:
            raise SectionNotFound
        return section

    async def reorder(self, user_id: UUID, ids: list[UUID]) -> None:
        sections = await self.ordered(user_id)
        by_id = {s.id: s for s in sections}
        if len(ids) != len(by_id) or set(ids) != set(by_id):
            raise SectionError("bad_order", "The new order must list every group exactly once.")
        _renumber([by_id[i] for i in ids])

    async def reset_order(self, user_id: UUID) -> None:
        sections = await self.ordered(user_id)
        rank = {k: i for i, k in enumerate(DEFAULT_KEYS)}
        categories = sorted(
            (s for s in sections if s.kind == SectionKind.category), key=lambda s: rank[s.key]
        )
        collections = sorted(
            (s for s in sections if s.kind == SectionKind.collection), key=lambda s: s.created_at
        )
        _renumber(categories + collections)

    async def _check_name(self, user_id: UUID, name: str, exclude: UUID | None = None) -> str:
        cleaned = name.strip()
        if not cleaned:
            raise SectionError("name_required", "Give the collection a name.")
        if len(cleaned) > COLLECTION_NAME_MAX:
            raise SectionError(
                "name_too_long", f"The name can be at most {COLLECTION_NAME_MAX} characters."
            )
        query = select(WardrobeSection.id).where(
            WardrobeSection.user_id == user_id,
            WardrobeSection.kind == SectionKind.collection,
            func.lower(WardrobeSection.name) == cleaned.lower(),
        )
        if exclude is not None:
            query = query.where(WardrobeSection.id != exclude)
        if (await self.db.execute(query)).first():
            raise SectionError("name_taken", "A collection with this name already exists.")
        return cleaned

    async def update(
        self, user_id: UUID, section_id: UUID, *, enabled: bool | None, name: str | None
    ) -> None:
        section = await self._get(user_id, section_id)
        if name is not None:
            if section.kind != SectionKind.collection:
                raise SectionError("not_collection", "Only collections can be renamed.")
            section.name = await self._check_name(user_id, name, exclude=section.id)
        if enabled is not None and enabled != section.enabled:
            if section.kind != SectionKind.category or section.key not in HIDDEN_KEYS:
                raise SectionError(
                    "not_optional", "Only the optional categories can be switched on or off."
                )
            section.enabled = enabled
            sections = [s for s in await self.ordered(user_id) if s.id != section.id]
            visible = [s for s in sections if _visible(s)]
            hidden = [s for s in sections if not _visible(s)]
            _renumber([*visible, section, *hidden] if enabled else [*visible, *hidden, section])

    async def create_collection(
        self, user_id: UUID, name: str, item_ids: list[UUID]
    ) -> WardrobeSection:
        cleaned = await self._check_name(user_id, name)
        sections = await self.ordered(user_id)
        section = WardrobeSection(
            user_id=user_id, kind=SectionKind.collection, name=cleaned, position=len(sections)
        )
        self.db.add(section)
        visible = [s for s in sections if _visible(s)]
        _renumber([*visible, section, *(s for s in sections if not _visible(s))])
        await self.db.flush()
        await self.add_items(user_id, section.id, item_ids)
        return section

    async def delete_collection(self, user_id: UUID, section_id: UUID) -> None:
        section = await self._get(user_id, section_id)
        if section.kind != SectionKind.collection:
            raise SectionError("not_collection", "Categories cannot be deleted.")
        await self.db.delete(section)
        await self.db.flush()
        _renumber(await self.ordered(user_id))

    async def _collection(self, user_id: UUID, section_id: UUID) -> WardrobeSection:
        section = await self._get(user_id, section_id)
        if section.kind != SectionKind.collection:
            raise SectionError("not_collection", "Items can only be added to collections.")
        return section

    async def add_items(self, user_id: UUID, section_id: UUID, item_ids: list[UUID]) -> None:
        section = await self._collection(user_id, section_id)
        if not item_ids:
            return
        owned = await self.db.execute(
            select(ClothingItem.id).where(
                ClothingItem.user_id == user_id, ClothingItem.id.in_(set(item_ids))
            )
        )
        rows = [{"section_id": section.id, "item_id": i} for i in owned.scalars().all()]
        if rows:
            await self.db.execute(insert(CollectionItem).values(rows).on_conflict_do_nothing())

    async def remove_items(self, user_id: UUID, section_id: UUID, item_ids: list[UUID]) -> None:
        section = await self._collection(user_id, section_id)
        await self.db.execute(
            delete(CollectionItem).where(
                CollectionItem.section_id == section.id, CollectionItem.item_id.in_(item_ids)
            )
        )

    async def hidden_counts(self, user_id: UUID) -> dict[str, int]:
        result = await self.db.execute(
            select(ClothingItem.type).where(
                ClothingItem.user_id == user_id, ClothingItem.is_archived.is_(False)
            )
        )
        types = Counter(result.scalars().all())
        return {key: sum(types[t] for t in SECTION_TYPES[key]) for key in HIDDEN_KEYS}
