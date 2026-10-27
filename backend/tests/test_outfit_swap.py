"""The fork's swap-a-single-item alternatives (GET /outfits/{id}/swap-options)."""

from uuid import uuid4

import pytest

from app.models.item import ClothingItem, ItemStatus
from app.models.outfit import Outfit, OutfitItem, OutfitSource, OutfitStatus
from app.services.swap_service import SwapItemNotInOutfitError, swap_options


def _item(user, kind, color="black", formality="casual", **fields) -> ClothingItem:
    return ClothingItem(
        user_id=user.id,
        type=kind,
        primary_color=color,
        colors=[color],
        formality=formality,
        pattern=fields.pop("pattern", "solid"),
        image_path=f"test/{uuid4()}.jpg",
        status=fields.pop("status", ItemStatus.ready),
        **fields,
    )


async def _outfit(db_session, user, pieces) -> Outfit:
    outfit = Outfit(
        user_id=user.id,
        occasion="casual",
        source=OutfitSource.on_demand,
        status=OutfitStatus.pending,
        weather_data={"temperature": 20, "precipitation_chance": 0, "condition": "clear"},
    )
    db_session.add(outfit)
    await db_session.flush()
    for position, piece in enumerate(pieces):
        db_session.add(OutfitItem(outfit_id=outfit.id, item_id=piece.id, position=position))
    await db_session.commit()
    return outfit


@pytest.mark.asyncio
class TestSwapOptions:
    async def test_only_same_slot_pieces_not_in_the_outfit(self, db_session, test_user):
        tee, jeans, shoes = (
            _item(test_user, "t-shirt"),
            _item(test_user, "jeans", "blue"),
            _item(test_user, "sneakers", "white"),
        )
        chinos, trousers = _item(test_user, "pants", "beige"), _item(test_user, "pants", "gray")
        washing = _item(test_user, "shorts", needs_wash=True)
        archived = _item(test_user, "pants", is_archived=True)
        other_top = _item(test_user, "shirt", "white")
        db_session.add_all([tee, jeans, shoes, chinos, trousers, washing, archived, other_top])
        await db_session.commit()
        outfit = await _outfit(db_session, test_user, [tee, jeans, shoes])

        options = await swap_options(db_session, test_user, outfit.id, jeans.id)

        assert {o.id for o in options} == {chinos.id, trousers.id}

    async def test_alternatives_that_clash_with_the_rest_rank_last(self, db_session, test_user):
        tee = _item(test_user, "t-shirt", "white")
        jeans = _item(test_user, "jeans", "blue")
        shoes = _item(test_user, "sneakers", "white")
        neutral = _item(test_user, "pants", "beige")
        loud = _item(test_user, "pants", "orange", pattern="plaid")
        formal = _item(test_user, "pants", "beige", formality="very-formal")
        db_session.add_all([tee, jeans, shoes, neutral, loud, formal])
        await db_session.commit()
        outfit = await _outfit(db_session, test_user, [tee, jeans, shoes])

        options = await swap_options(db_session, test_user, outfit.id, jeans.id)

        assert options[0].id == neutral.id

    async def test_an_item_outside_the_outfit_is_refused(self, db_session, test_user):
        tee, jeans = _item(test_user, "t-shirt"), _item(test_user, "jeans")
        db_session.add_all([tee, jeans])
        await db_session.commit()
        outfit = await _outfit(db_session, test_user, [tee])
        with pytest.raises(SwapItemNotInOutfitError):
            await swap_options(db_session, test_user, outfit.id, jeans.id)

    async def test_endpoint_returns_items_and_hides_other_users_outfits(
        self, client, db_session, test_user, auth_headers
    ):
        tee, jeans, chinos = (
            _item(test_user, "t-shirt"),
            _item(test_user, "jeans", "blue"),
            _item(test_user, "pants", "beige", name="Chino"),
        )
        db_session.add_all([tee, jeans, chinos])
        await db_session.commit()
        outfit = await _outfit(db_session, test_user, [tee, jeans])

        response = await client.get(
            f"/api/v1/outfits/{outfit.id}/swap-options",
            params={"item_id": str(jeans.id)},
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert [o["name"] for o in response.json()] == ["Chino"]

        missing = await client.get(
            f"/api/v1/outfits/{uuid4()}/swap-options",
            params={"item_id": str(jeans.id)},
            headers=auth_headers,
        )
        assert missing.status_code == 404
