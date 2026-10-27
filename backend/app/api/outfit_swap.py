"""The fork's swap-a-single-item endpoint; the swap itself is PATCH /outfits/{id}."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.outfits import OutfitItemResponse
from app.database import DbSession
from app.models.user import User
from app.services.swap_service import (
    DEFAULT_SWAP_OPTIONS,
    SwapItemNotInOutfitError,
    swap_options,
)
from app.utils.auth import get_current_user
from app.utils.rate_limit import rate_limit_by_user

router = APIRouter(prefix="/outfits", tags=["Outfits"])


@router.get("/{outfit_id}/swap-options", response_model=list[OutfitItemResponse])
async def get_swap_options(
    outfit_id: UUID,
    db: DbSession,
    current_user: Annotated[User, Depends(get_current_user)],
    item_id: Annotated[UUID, Query(description="The piece to replace")],
    limit: Annotated[int, Query(ge=1, le=20)] = DEFAULT_SWAP_OPTIONS,
) -> list[OutfitItemResponse]:
    await rate_limit_by_user(
        str(current_user.id), "swap_options", max_requests=60, window_seconds=60
    )
    try:
        options = await swap_options(db, current_user, outfit_id, item_id, limit)
    except SwapItemNotInOutfitError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Item is not part of this outfit"
        ) from None
    except LookupError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Outfit not found"
        ) from None
    return [
        OutfitItemResponse(
            id=item.id,
            type=item.type,
            subtype=item.subtype,
            name=item.name,
            primary_color=item.primary_color,
            colors=item.colors or [],
            image_path=item.image_path,
            thumbnail_path=item.thumbnail_path,
            position=position,
        )
        for position, item in enumerate(options)
    ]
