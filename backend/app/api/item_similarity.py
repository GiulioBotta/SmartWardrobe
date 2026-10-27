"""The fork's similar-items endpoint, backed by CLIP embeddings in pgvector."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, computed_field

from app.database import DbSession
from app.models.user import User
from app.services.similarity_service import ItemNotEmbeddedError, similar_items
from app.utils.auth import get_current_user
from app.utils.signed_urls import sign_optional

router = APIRouter(prefix="/items", tags=["Items"])


class SimilarItemResponse(BaseModel):
    id: UUID
    type: str
    name: str | None = None
    primary_color: str | None = None
    thumbnail_path: str | None = None
    # Cosine similarity of the CLIP image embeddings, 1.0 for identical images.
    similarity: float

    @computed_field
    @property
    def thumbnail_url(self) -> str | None:
        return sign_optional(self.thumbnail_path)


@router.get("/{item_id}/similar", response_model=list[SimilarItemResponse])
async def get_similar_items(
    item_id: UUID,
    db: DbSession,
    current_user: Annotated[User, Depends(get_current_user)],
    limit: Annotated[int, Query(ge=1, le=50)] = 8,
) -> list[SimilarItemResponse]:
    try:
        rows = await similar_items(db, current_user.id, item_id, limit)
    except ItemNotEmbeddedError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Item has no embedding yet"
        ) from None
    except LookupError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Item not found"
        ) from None
    return [
        SimilarItemResponse(
            id=item.id,
            type=item.type,
            name=item.name,
            primary_color=item.primary_color,
            thumbnail_path=item.thumbnail_path,
            similarity=similarity,
        )
        for item, similarity in rows
    ]
