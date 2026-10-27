from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.item import ClothingItem, ItemStatus, ProcessingKind
from app.services.ai_service import AIService, ClothingTags, clean_brand
from app.workers import auto_background, tagging
from app.workers.queues import IMAGE_QUEUE


async def _get_item(db_session: AsyncSession, item_id) -> ClothingItem:
    result = await db_session.execute(select(ClothingItem).where(ClothingItem.id == item_id))
    return result.scalar_one()


async def _make_item(db_session: AsyncSession, user, **fields) -> ClothingItem:
    item = ClothingItem(
        user_id=user.id,
        type="unknown",
        image_path=f"test/{fields.pop('name', 'item')}.jpg",
        status=ItemStatus.processing,
        **fields,
    )
    db_session.add(item)
    await db_session.commit()
    return item


def _stub_ai(tags: ClothingTags):
    class _StubAI:
        def __init__(self, *args, **kwargs):
            pass

        async def analyze_image(self, path, locale="en"):
            return tags

    return _StubAI


def _settings(enabled: bool, color: str = "#FFFFFF"):
    return SimpleNamespace(auto_remove_background=enabled, auto_remove_background_color=color)


class TestCleanBrand:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("Carhartt WIP", "Carhartt WIP"),
            ("  Levi's \n", "Levi's"),
            ("Ralph   Lauren", "Ralph Lauren"),
            (None, None),
            ("", None),
            ("null", None),
            ("Unknown", None),
            ("N/A", None),
            (42, None),
            ("x" * 150, "x" * 100),
        ],
    )
    def test_clean_brand(self, raw, expected):
        assert clean_brand(raw) == expected


class TestBrandParsing:
    def test_brand_is_read_from_the_tags_json(self):
        tags = AIService()._parse_tags_from_response(
            '{"type":"jacket","primary_color":"black","brand":"Carhartt WIP"}'
        )
        assert tags.brand == "Carhartt WIP"

    def test_missing_or_null_brand_is_none(self):
        service = AIService()
        assert service._parse_tags_from_response('{"type":"jacket"}').brand is None
        assert service._parse_tags_from_response('{"type":"jacket","brand":null}').brand is None


class TestBrandTagging:
    @pytest.mark.asyncio
    async def test_ai_brand_fills_an_empty_brand(
        self, db_session: AsyncSession, test_user, monkeypatch
    ):
        item = await _make_item(db_session, test_user, name="brand-empty")
        monkeypatch.setattr(
            tagging, "AIService", _stub_ai(ClothingTags(type="jacket", brand="Carhartt WIP"))
        )

        with (
            patch("app.workers.tagging.get_db_session", return_value=db_session),
            patch.object(db_session, "close", new_callable=AsyncMock),
        ):
            result = await tagging.tag_item_image({}, str(item.id), __file__)

        assert result["status"] == "success"
        assert (await _get_item(db_session, item.id)).brand == "Carhartt WIP"

    @pytest.mark.asyncio
    async def test_ai_brand_never_overwrites_the_users_brand(
        self, db_session: AsyncSession, test_user, monkeypatch
    ):
        item = await _make_item(db_session, test_user, name="brand-user", brand="Uniqlo")
        monkeypatch.setattr(
            tagging, "AIService", _stub_ai(ClothingTags(type="jacket", brand="Carhartt WIP"))
        )

        with (
            patch("app.workers.tagging.get_db_session", return_value=db_session),
            patch.object(db_session, "close", new_callable=AsyncMock),
        ):
            await tagging.tag_item_image({}, str(item.id), __file__)

        assert (await _get_item(db_session, item.id)).brand == "Uniqlo"


class TestAutoBackgroundRemoval:
    def _patches(self, db_session: AsyncSession, enabled: bool):
        return (
            patch("app.workers.tagging.get_db_session", return_value=db_session),
            patch("app.workers.auto_background.get_db_session", return_value=db_session),
            patch(
                "app.workers.auto_background.get_settings",
                return_value=_settings(enabled, "#EEEEEE"),
            ),
            patch.object(db_session, "close", new_callable=AsyncMock),
        )

    @pytest.mark.asyncio
    async def test_tagging_queues_background_removal_when_enabled(
        self, db_session: AsyncSession, test_user, monkeypatch
    ):
        item = await _make_item(db_session, test_user, name="auto-bg-on")
        monkeypatch.setattr(tagging, "AIService", _stub_ai(ClothingTags(type="jacket")))
        redis = SimpleNamespace(enqueue_job=AsyncMock(return_value=SimpleNamespace(job_id="j1")))

        p1, p2, p3, p4 = self._patches(db_session, enabled=True)
        with p1, p2, p3, p4:
            result = await tagging.tag_item_image({"redis": redis}, str(item.id), __file__)

        assert result["status"] == "success"
        redis.enqueue_job.assert_awaited_once_with(
            "remove_item_background_job", str(item.id), "#EEEEEE", _queue_name=IMAGE_QUEUE
        )
        refreshed = await _get_item(db_session, item.id)
        assert refreshed.type == "jacket"
        assert refreshed.status == ItemStatus.processing
        assert refreshed.processing_kind == ProcessingKind.background_removal
        assert refreshed.ai_job_id == "j1"

    @pytest.mark.asyncio
    async def test_tagging_leaves_the_background_alone_when_disabled(
        self, db_session: AsyncSession, test_user, monkeypatch
    ):
        item = await _make_item(db_session, test_user, name="auto-bg-off")
        monkeypatch.setattr(tagging, "AIService", _stub_ai(ClothingTags(type="jacket")))
        redis = SimpleNamespace(enqueue_job=AsyncMock())

        p1, p2, p3, p4 = self._patches(db_session, enabled=False)
        with p1, p2, p3, p4:
            await tagging.tag_item_image({"redis": redis}, str(item.id), __file__)

        redis.enqueue_job.assert_not_awaited()
        assert (await _get_item(db_session, item.id)).status == ItemStatus.ready

    @pytest.mark.asyncio
    async def test_an_item_already_flattened_is_not_queued_again(
        self, db_session: AsyncSession, test_user
    ):
        item = await _make_item(
            db_session,
            test_user,
            name="auto-bg-done",
            original_image_path="test/auto-bg-done-original.jpg",
        )
        item.status = ItemStatus.ready
        await db_session.commit()
        redis = SimpleNamespace(enqueue_job=AsyncMock())

        _, p2, p3, p4 = self._patches(db_session, enabled=True)
        with p2, p3, p4:
            queued = await auto_background.queue_auto_background_removal(
                {"redis": redis}, str(item.id)
            )

        assert queued is False
        redis.enqueue_job.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_a_failed_enqueue_leaves_the_item_ready_and_tagging_successful(
        self, db_session: AsyncSession, test_user, monkeypatch
    ):
        item = await _make_item(db_session, test_user, name="auto-bg-fail")
        monkeypatch.setattr(tagging, "AIService", _stub_ai(ClothingTags(type="jacket")))
        redis = SimpleNamespace(enqueue_job=AsyncMock(side_effect=ConnectionError("down")))

        p1, p2, p3, p4 = self._patches(db_session, enabled=True)
        with p1, p2, p3, p4:
            result = await tagging.tag_item_image({"redis": redis}, str(item.id), __file__)

        assert result["status"] == "success"
        refreshed = await _get_item(db_session, item.id)
        assert refreshed.status == ItemStatus.ready
        assert refreshed.processing_kind is None
