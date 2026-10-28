from unittest.mock import patch
from uuid import uuid4

import pytest

import app.api.wardrobe_sections as sections_api
from app.config import get_settings
from app.models.item import ClothingItem, ItemStatus
from app.models.user import User

URL = "/api/v1/wardrobe-sections"


@pytest.fixture
def enabled():
    settings = get_settings().model_copy(update={"wardrobe_sections_enabled": True})
    with patch.object(sections_api, "get_settings", return_value=settings):
        yield


async def _items(db, user_id, *types, archived=False):
    items = [
        ClothingItem(
            user_id=user_id,
            type=t,
            image_path=f"test/{uuid4()}.jpg",
            status=ItemStatus.ready,
            is_archived=archived,
        )
        for t in types
    ]
    db.add_all(items)
    await db.commit()
    return items


async def _sections(client, headers):
    response = await client.get(URL, headers=headers)
    assert response.status_code == 200
    return response.json()["sections"]


def _by_key(sections):
    return {s["key"]: s for s in sections if s["kind"] == "category"}


async def test_disabled_flag_404(client, auth_headers):
    assert (await client.get(URL, headers=auth_headers)).status_code == 404


@pytest.mark.usefixtures("enabled")
class TestSections:
    async def test_defaults_created_once(self, client, auth_headers):
        first = await _sections(client, auth_headers)
        second = await _sections(client, auth_headers)
        assert [s["id"] for s in first] == [s["id"] for s in second]
        assert [s["key"] for s in first] == [
            "tops",
            "knitwear",
            "outerwear",
            "trousers",
            "footwear",
            "accessories",
            "skirts",
            "dresses",
            "suits",
            "bags",
            "hosiery",
        ]
        assert [s["enabled"] for s in first] == [True] * 6 + [False] * 5

    async def test_reorder_requires_all_ids(self, client, auth_headers):
        ids = [s["id"] for s in await _sections(client, auth_headers)]
        bad = await client.post(f"{URL}/order", json={"ids": ids[:-1]}, headers=auth_headers)
        assert bad.status_code == 422
        new = [ids[1], ids[0], *ids[2:]]
        ok = await client.post(f"{URL}/order", json={"ids": new}, headers=auth_headers)
        assert ok.status_code == 200
        assert [s["id"] for s in await _sections(client, auth_headers)] == new

    async def test_standard_cannot_be_disabled(self, client, auth_headers):
        tops = _by_key(await _sections(client, auth_headers))["tops"]
        response = await client.patch(
            f"{URL}/{tops['id']}", json={"enabled": False}, headers=auth_headers
        )
        assert response.status_code == 422

    async def test_enable_hidden_moves_to_end_of_enabled(self, client, auth_headers):
        skirts = _by_key(await _sections(client, auth_headers))["skirts"]
        response = await client.patch(
            f"{URL}/{skirts['id']}", json={"enabled": True}, headers=auth_headers
        )
        assert response.status_code == 200
        keys = [s["key"] for s in await _sections(client, auth_headers) if s["enabled"]]
        assert keys[-1] == "skirts"

    async def test_reset_order(self, client, auth_headers):
        sections = await _sections(client, auth_headers)
        ids = [s["id"] for s in sections]
        await client.post(f"{URL}/order", json={"ids": ids[::-1]}, headers=auth_headers)
        await client.post(f"{URL}/collections", json={"name": "Festa"}, headers=auth_headers)
        assert (await client.post(f"{URL}/reset-order", headers=auth_headers)).status_code == 200
        after = await _sections(client, auth_headers)
        assert [s["key"] for s in after[:6]] == [
            "tops",
            "knitwear",
            "outerwear",
            "trousers",
            "footwear",
            "accessories",
        ]
        visible = [s for s in after if s["kind"] == "collection" or s["enabled"]]
        assert visible[-1]["name"] == "Festa"
        # Switched-off categories wait after everything the user sees.
        assert [s["enabled"] for s in after[len(visible) :]] == [False] * 5

    @pytest.mark.parametrize("name", ["", "   ", "x" * 51])
    async def test_collection_name_invalid(self, client, auth_headers, name):
        response = await client.post(
            f"{URL}/collections", json={"name": name}, headers=auth_headers
        )
        assert response.status_code == 422

    async def test_collection_name_unique_ignoring_case(self, client, auth_headers):
        first = await client.post(
            f"{URL}/collections", json={"name": "Festa"}, headers=auth_headers
        )
        assert first.status_code == 201
        again = await client.post(
            f"{URL}/collections", json={"name": " festa "}, headers=auth_headers
        )
        assert again.status_code == 422
        # A stable code, so the app can say it in the user's language.
        assert again.json()["detail"]["code"] == "name_taken"
        assert again.json()["detail"]["message"]
        other = await client.post(
            f"{URL}/collections", json={"name": "Ufficio"}, headers=auth_headers
        )
        renamed = await client.patch(
            f"{URL}/{other.json()['id']}", json={"name": "FESTA"}, headers=auth_headers
        )
        assert renamed.status_code == 422

    async def test_collection_items_add_remove_idempotent(
        self, client, auth_headers, db_session, test_user
    ):
        a, b = await _items(db_session, test_user.id, "sweater", "pants")
        created = await client.post(
            f"{URL}/collections",
            json={"name": "Festa", "item_ids": [str(a.id)]},
            headers=auth_headers,
        )
        cid = created.json()["id"]
        assert created.json()["item_ids"] == [str(a.id)]
        for _ in range(2):
            await client.post(
                f"{URL}/collections/{cid}/items",
                json={"item_ids": [str(a.id), str(b.id)]},
                headers=auth_headers,
            )
        await client.post(
            f"{URL}/collections/{cid}/items/remove",
            json={"item_ids": [str(a.id)]},
            headers=auth_headers,
        )
        festa = next(s for s in await _sections(client, auth_headers) if s["name"] == "Festa")
        assert festa["item_ids"] == [str(b.id)]

    async def test_other_users_items_ignored(self, client, auth_headers, db_session):
        other = User(external_id=f"o-{uuid4()}", email=f"{uuid4()}@x.test", display_name="O")
        db_session.add(other)
        await db_session.commit()
        (foreign,) = await _items(db_session, other.id, "sweater")
        created = await client.post(
            f"{URL}/collections",
            json={"name": "Festa", "item_ids": [str(foreign.id)]},
            headers=auth_headers,
        )
        assert created.json()["item_ids"] == []

    async def test_archived_items_hidden_but_kept(
        self, client, auth_headers, db_session, test_user
    ):
        (item,) = await _items(db_session, test_user.id, "sweater")
        await client.post(
            f"{URL}/collections",
            json={"name": "Festa", "item_ids": [str(item.id)]},
            headers=auth_headers,
        )
        item.is_archived = True
        await db_session.commit()
        festa = next(s for s in await _sections(client, auth_headers) if s["name"] == "Festa")
        assert festa["item_ids"] == []
        item.is_archived = False
        await db_session.commit()
        festa = next(s for s in await _sections(client, auth_headers) if s["name"] == "Festa")
        assert festa["item_ids"] == [str(item.id)]

    async def test_delete_collection(self, client, auth_headers):
        created = await client.post(
            f"{URL}/collections", json={"name": "Festa"}, headers=auth_headers
        )
        cid = created.json()["id"]
        assert (
            await client.delete(f"{URL}/collections/{cid}", headers=auth_headers)
        ).status_code == 204
        assert all(s["name"] != "Festa" for s in await _sections(client, auth_headers))

    async def test_hidden_counts(self, client, auth_headers, db_session, test_user):
        await _items(db_session, test_user.id, "skirt", "skirt", "bag", "sweater")
        await _items(db_session, test_user.id, "skirt", archived=True)
        response = await client.get(f"{URL}/hidden-counts", headers=auth_headers)
        assert response.json() == {"skirts": 2, "dresses": 0, "suits": 0, "bags": 1, "hosiery": 0}
