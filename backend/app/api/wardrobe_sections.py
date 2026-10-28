"""Fork: the grouped wardrobe's groups (WARDROBE_SECTIONS_ENABLED).

Categories are filled from item types in the frontend; this stores only what the user chose:
the order, which optional categories are on, and their collections.
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.config import get_settings
from app.database import DbSession
from app.models.user import User
from app.schemas.wardrobe_section import (
    CollectionCreate,
    ItemIdsIn,
    OrderIn,
    SectionList,
    SectionOut,
    SectionPatch,
)
from app.services.wardrobe_section_service import (
    SectionError,
    SectionNotFound,
    WardrobeSectionService,
)
from app.utils.auth import get_current_user


def _require_enabled() -> None:
    if not get_settings().wardrobe_sections_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")


router = APIRouter(
    prefix="/wardrobe-sections",
    tags=["Wardrobe sections"],
    dependencies=[Depends(_require_enabled)],
)

CurrentUser = Annotated[User, Depends(get_current_user)]


async def _sections(service: WardrobeSectionService, user: User, db: DbSession) -> SectionList:
    sections = await service.list_out(user.id)
    await db.commit()
    return SectionList(sections=sections)


async def _run(db: DbSession, action) -> None:
    try:
        await action
    except SectionError as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": e.code, "message": str(e)},
        ) from None
    except SectionNotFound:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found") from None
    await db.commit()


@router.get("", response_model=SectionList)
async def list_sections(db: DbSession, current_user: CurrentUser) -> SectionList:
    return await _sections(WardrobeSectionService(db), current_user, db)


@router.get("/hidden-counts")
async def hidden_counts(db: DbSession, current_user: CurrentUser) -> dict[str, int]:
    return await WardrobeSectionService(db).hidden_counts(current_user.id)


@router.post("/order", response_model=SectionList)
async def reorder(body: OrderIn, db: DbSession, current_user: CurrentUser) -> SectionList:
    service = WardrobeSectionService(db)
    await _run(db, service.reorder(current_user.id, body.ids))
    return await _sections(service, current_user, db)


@router.post("/reset-order", response_model=SectionList)
async def reset_order(db: DbSession, current_user: CurrentUser) -> SectionList:
    service = WardrobeSectionService(db)
    await _run(db, service.reset_order(current_user.id))
    return await _sections(service, current_user, db)


@router.patch("/{section_id}", response_model=SectionList)
async def update_section(
    section_id: UUID, body: SectionPatch, db: DbSession, current_user: CurrentUser
) -> SectionList:
    service = WardrobeSectionService(db)
    await _run(
        db, service.update(current_user.id, section_id, enabled=body.enabled, name=body.name)
    )
    return await _sections(service, current_user, db)


@router.post("/collections", response_model=SectionOut, status_code=status.HTTP_201_CREATED)
async def create_collection(
    body: CollectionCreate, db: DbSession, current_user: CurrentUser
) -> SectionOut:
    service = WardrobeSectionService(db)
    created: list = []

    async def create() -> None:
        created.append(await service.create_collection(current_user.id, body.name, body.item_ids))

    await _run(db, create())
    sections = await service.list_out(current_user.id)
    return next(s for s in sections if s.id == created[0].id)


@router.delete("/collections/{section_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_collection(section_id: UUID, db: DbSession, current_user: CurrentUser) -> Response:
    await _run(db, WardrobeSectionService(db).delete_collection(current_user.id, section_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/collections/{section_id}/items", status_code=status.HTTP_204_NO_CONTENT)
async def add_items(
    section_id: UUID, body: ItemIdsIn, db: DbSession, current_user: CurrentUser
) -> Response:
    service = WardrobeSectionService(db)
    await _run(db, service.add_items(current_user.id, section_id, body.item_ids))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/collections/{section_id}/items/remove", status_code=status.HTTP_204_NO_CONTENT)
async def remove_items(
    section_id: UUID, body: ItemIdsIn, db: DbSession, current_user: CurrentUser
) -> Response:
    service = WardrobeSectionService(db)
    await _run(db, service.remove_items(current_user.id, section_id, body.item_ids))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
