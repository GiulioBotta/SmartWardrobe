"""Quota handling for hosted AI providers: 429 parsing, request budgets, clear errors."""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4
from zoneinfo import ZoneInfo

import httpx
import pytest
from arq import Retry
from redis.asyncio import Redis
from sqlalchemy import select

from app.config import get_settings
from app.models.item import ClothingItem, ItemStatus
from app.models.outfit import TimeOfDay
from app.services import ai_quota
from app.services.ai_quota import (
    AIQuotaExceededError,
    acquire_ai_slot,
    quota_error_from_response,
    quota_scope,
    record_quota_exhausted,
    seconds_until_daily_reset,
)
from app.services.ai_service import AIService
from app.services.recommendation_service import AIRecommendationError, RecommendationService
from app.services.weather_service import WeatherData
from app.workers import tagging

URL = "https://ai.test/v1"
REQUEST = httpx.Request("POST", "http://ai.test/v1/chat/completions")


def _gemini_429(quota_id: str, retry_delay: str) -> httpx.Response:
    # The shape Gemini's OpenAI-compatible endpoint returns, a one-element list.
    body = [
        {
            "error": {
                "code": 429,
                "message": "You exceeded your current quota.",
                "status": "RESOURCE_EXHAUSTED",
                "details": [
                    {
                        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
                        "violations": [{"quotaId": quota_id, "quotaValue": "20"}],
                    },
                    {
                        "@type": "type.googleapis.com/google.rpc.RetryInfo",
                        "retryDelay": retry_delay,
                    },
                ],
            }
        }
    ]
    return httpx.Response(429, json=body, request=REQUEST)


DAILY = "GenerateRequestsPerDayPerProjectPerModel-FreeTier"
PER_MINUTE = "GenerateRequestsPerMinutePerProjectPerModel-FreeTier"


def _ok(content: str = "ok") -> httpx.Response:
    return httpx.Response(
        200, json={"model": "m", "choices": [{"message": {"content": content}}]}, request=REQUEST
    )


def _limits(**overrides):
    values = {
        "redis_url": get_settings().redis_url,
        "ai_requests_per_minute": None,
        "ai_requests_per_day": None,
        "ai_rate_limit_max_wait_seconds": 30,
        "ai_quota_reset_timezone": "America/Los_Angeles",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


class TestQuotaErrorFromResponse:
    def test_gemini_daily_quota(self):
        error = quota_error_from_response(_gemini_429(DAILY, "71752s"), "gemini-x", URL)
        assert error.daily and error.retry_after_seconds == 71752
        assert "daily" in str(error) and "20 h" in str(error)

    def test_gemini_per_minute_quota(self):
        error = quota_error_from_response(_gemini_429(PER_MINUTE, "17.4s"), "gemini-x", URL)
        assert not error.daily and error.retry_after_seconds == 17
        assert "per minute" in str(error)

    def test_retry_after_header_without_details(self):
        response = httpx.Response(429, headers={"Retry-After": "12"}, text="slow", request=REQUEST)
        error = quota_error_from_response(response, "m", URL)
        assert not error.daily and error.retry_after_seconds == 12

    def test_a_long_delay_counts_as_daily(self):
        response = httpx.Response(429, headers={"Retry-After": "7200"}, request=REQUEST)
        assert quota_error_from_response(response, "m", URL).daily

    def test_other_statuses_are_not_quota_errors(self):
        assert quota_error_from_response(httpx.Response(500, request=REQUEST), "m", URL) is None


def test_daily_reset_is_midnight_pacific():
    at = datetime(2026, 10, 27, 23, 0, tzinfo=ZoneInfo("America/Los_Angeles"))
    assert seconds_until_daily_reset(at) == 3600


@pytest.mark.asyncio
class TestAcquireSlot:
    async def test_per_minute_budget_fails_when_waiting_is_not_allowed(self):
        model = f"m-{uuid4()}"
        settings = _limits(ai_requests_per_minute=2, ai_rate_limit_max_wait_seconds=0)
        with (
            patch.object(ai_quota, "get_settings", return_value=settings),
            patch.object(ai_quota.time, "time", return_value=1_800_000_010.0),
        ):
            await acquire_ai_slot(model, URL)
            await acquire_ai_slot(model, URL)
            with pytest.raises(AIQuotaExceededError) as exc:
                await acquire_ai_slot(model, URL)
        assert not exc.value.daily and exc.value.retry_after_seconds == 50

    async def test_per_minute_budget_waits_for_the_next_minute(self):
        model = f"m-{uuid4()}"
        settings = _limits(ai_requests_per_minute=1, ai_rate_limit_max_wait_seconds=60)
        start = 1_800_000_040.0
        sleep = AsyncMock()
        with (
            patch.object(ai_quota, "get_settings", return_value=settings),
            patch.object(ai_quota.time, "time", side_effect=[start, start, start + 21]),
            patch.object(ai_quota.asyncio, "sleep", sleep),
        ):
            await acquire_ai_slot(model, URL)
            await acquire_ai_slot(model, URL)
        assert sleep.await_count == 1
        assert 20 <= sleep.await_args.args[0] <= 21

    async def test_daily_budget_fails_until_reset(self):
        model = f"m-{uuid4()}"
        settings = _limits(ai_requests_per_day=1)
        with patch.object(ai_quota, "get_settings", return_value=settings):
            await acquire_ai_slot(model, URL)
            with pytest.raises(AIQuotaExceededError) as exc:
                await acquire_ai_slot(model, URL)
        assert exc.value.daily and exc.value.retry_after_seconds > 0

    async def test_a_recorded_daily_refusal_blocks_without_limits(self):
        model = f"m-{uuid4()}"
        with patch.object(ai_quota, "get_settings", return_value=_limits()):
            await acquire_ai_slot(model, URL)
            await record_quota_exhausted(
                AIQuotaExceededError(
                    model, daily=True, retry_after_seconds=600, scope=quota_scope(URL, model)
                )
            )
            with pytest.raises(AIQuotaExceededError) as exc:
                await acquire_ai_slot(model, URL)
        assert exc.value.daily and 590 <= exc.value.retry_after_seconds <= 600

    async def test_a_block_from_another_endpoint_leaves_the_default_alone(self):
        # A user-configured endpoint answering with a forged daily 429 for the system's model
        # name must not block the built-in endpoint.
        model = f"m-{uuid4()}"
        forged = quota_error_from_response(
            _gemini_429(DAILY, "999999999s"), model, "https://evil.test/v1"
        )
        with patch.object(ai_quota, "get_settings", return_value=_limits()):
            await record_quota_exhausted(forged)
            await acquire_ai_slot(model, URL)
            with pytest.raises(AIQuotaExceededError):
                await acquire_ai_slot(model, "https://evil.test/v1/")

    async def test_provider_delays_are_capped_at_one_day(self):
        model = f"m-{uuid4()}"
        error = quota_error_from_response(_gemini_429(DAILY, "999999999s"), model, URL)
        assert error.retry_after_seconds == ai_quota.MAX_RETRY_AFTER_S
        with patch.object(ai_quota, "get_settings", return_value=_limits()):
            await record_quota_exhausted(error)
            redis = Redis.from_url(get_settings().redis_url)
            try:
                ttl = await redis.ttl(f"ai_quota:{quota_scope(URL, model)}:blocked")
            finally:
                await redis.aclose()
        assert 0 < ttl <= ai_quota.MAX_RETRY_AFTER_S

    async def test_redis_down_does_not_block_requests(self):
        settings = _limits(redis_url="redis://127.0.0.1:1/0", ai_requests_per_day=1)
        with patch.object(ai_quota, "get_settings", return_value=settings):
            await acquire_ai_slot("m", URL)
            await acquire_ai_slot("m", URL)


@pytest.mark.asyncio
class TestAIServiceQuota:
    def _service(self, **settings) -> AIService:
        service = AIService()
        service.settings = service.settings.model_copy(update=settings)
        return service

    async def test_a_daily_429_is_not_retried_and_blocks_later_calls(self):
        service = self._service()
        with (
            patch("httpx.AsyncClient.post", side_effect=[_gemini_429(DAILY, "71752s")]) as post,
            patch("app.services.ai_service.asyncio.sleep", AsyncMock()),
        ):
            content, error, _ = await service._call_with_fallback(
                [{"role": "user", "content": "tag"}], "tags"
            )
            assert content is None and isinstance(error, AIQuotaExceededError) and error.daily
            assert post.call_count == 1
            with pytest.raises(AIQuotaExceededError):
                await service.generate_text("suggest")
            assert post.call_count == 1

    async def test_a_short_per_minute_429_waits_the_providers_delay(self):
        service = self._service()
        sleep = AsyncMock()
        with (
            patch("httpx.AsyncClient.post", side_effect=[_gemini_429(PER_MINUTE, "5s"), _ok()]),
            patch("app.services.ai_service.asyncio.sleep", sleep),
        ):
            content, error, _ = await service._call_with_fallback(
                [{"role": "user", "content": "tag"}], "tags"
            )
        assert error is None and content == "ok"
        assert sleep.await_args.args[0] == 5

    async def test_a_long_per_minute_429_gives_up_without_blocking(self):
        service = self._service(ai_rate_limit_max_wait_seconds=30)
        with (
            patch(
                "httpx.AsyncClient.post",
                side_effect=[_gemini_429(PER_MINUTE, "45s"), _ok("later")],
            ) as post,
            patch("app.services.ai_service.asyncio.sleep", AsyncMock()),
        ):
            with pytest.raises(AIQuotaExceededError) as exc:
                await service.generate_text("suggest")
            assert not exc.value.daily and post.call_count == 1
            assert await service.generate_text("suggest") == "later"

    async def test_text_generation_retries_a_short_per_minute_429(self):
        service = self._service()
        sleep = AsyncMock()
        with (
            patch("httpx.AsyncClient.post", side_effect=[_gemini_429(PER_MINUTE, "3s"), _ok()]),
            patch("app.services.ai_service.asyncio.sleep", sleep),
        ):
            assert await service.generate_text("suggest") == "ok"
        sleep.assert_awaited_once_with(3)

    async def test_logprobs_can_be_switched_off(self):
        service = self._service(ai_logprobs_enabled=False)
        with patch("httpx.AsyncClient.post", side_effect=[_ok()]) as post:
            await service._call_with_fallback(
                [{"role": "user", "content": "tag"}], "tags", request_logprobs=True
            )
        assert "logprobs" not in post.call_args.kwargs["json"]


@pytest.mark.asyncio
class TestQuotaReachesTheUser:
    async def _item(self, db_session, user, kind="shirt"):
        item = ClothingItem(
            user_id=user.id,
            type=kind,
            image_path=f"test/{uuid4()}.jpg",
            status=ItemStatus.processing,
            primary_color="black",
        )
        db_session.add(item)
        await db_session.commit()
        return item

    def _failing_ai(self, error):
        class _AI:
            def __init__(self, *args, **kwargs):
                pass

            async def analyze_image(self, path, locale="en"):
                raise error

        return _AI

    async def test_daily_quota_fails_the_item_with_the_reason(
        self, db_session, test_user, monkeypatch
    ):
        item = await self._item(db_session, test_user)
        error = AIQuotaExceededError("gemini-x", daily=True, retry_after_seconds=3600)
        monkeypatch.setattr(tagging, "AIService", self._failing_ai(error))
        with (
            patch("app.workers.tagging.get_db_session", return_value=db_session),
            patch.object(db_session, "close", new_callable=AsyncMock),
        ):
            with pytest.raises(AIQuotaExceededError):
                await tagging.tag_item_image({"job_try": 1}, str(item.id), __file__)
        refreshed = (
            await db_session.execute(select(ClothingItem).where(ClothingItem.id == item.id))
        ).scalar_one()
        assert refreshed.status == ItemStatus.error

    async def test_per_minute_quota_retries_after_the_delay(
        self, db_session, test_user, monkeypatch
    ):
        item = await self._item(db_session, test_user)
        error = AIQuotaExceededError("gemini-x", daily=False, retry_after_seconds=50)
        monkeypatch.setattr(tagging, "AIService", self._failing_ai(error))
        with (
            patch("app.workers.tagging.get_db_session", return_value=db_session),
            patch.object(db_session, "close", new_callable=AsyncMock),
        ):
            with pytest.raises(Retry) as exc:
                await tagging.tag_item_image({"job_try": 1}, str(item.id), __file__)
        assert exc.value.defer_score == 50_000

    async def test_suggestions_report_the_quota_instead_of_a_generic_error(
        self, db_session, test_user
    ):
        for kind in ("t-shirt", "jeans", "sneakers"):
            item = await self._item(db_session, test_user, kind)
            item.status = ItemStatus.ready
        await db_session.commit()
        test_user.preferences = None
        ai = MagicMock()
        ai.generate_text = AsyncMock(
            side_effect=AIQuotaExceededError("gemini-x", daily=True, retry_after_seconds=7200)
        )
        service = RecommendationService(db_session)
        weather = WeatherData(
            temperature=20,
            feels_like=20,
            humidity=50,
            precipitation_chance=0,
            precipitation_mm=0,
            wind_speed=5,
            condition="clear",
            condition_code=0,
            is_day=True,
            uv_index=3,
            timestamp=datetime(2026, 10, 27, 12),
        )
        with (
            patch("app.services.recommendation_service.AIService", return_value=ai),
            patch(
                "app.services.recommendation_service.pop_suggestion", AsyncMock(return_value=None)
            ),
        ):
            with pytest.raises(AIRecommendationError, match="daily AI request quota"):
                await service.generate_recommendations(
                    user=test_user,
                    occasion="casual",
                    weather_override=weather,
                    time_of_day=TimeOfDay.afternoon,
                )
