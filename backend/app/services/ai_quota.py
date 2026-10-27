"""Request budgets for hosted AI providers with tight quotas (Gemini's free tier).

Two parts, both keyed by model because Gemini counts quota per project per model:
- quota_error_from_response reads a provider's 429 (Gemini's QuotaFailure / RetryInfo
  details, or a Retry-After header) and says whether it is a per-minute or a daily limit.
- acquire_ai_slot runs before every request: it fails fast while a daily quota is known
  to be used up, counts requests per day and per minute against AI_REQUESTS_PER_DAY /
  AI_REQUESTS_PER_MINUTE, and waits for the next minute when that is short enough.

Counters live in Redis so the API and both workers share one budget. Redis being down
never blocks a request: limiting is skipped and logged.
"""

import asyncio
import logging
import re
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
from redis.asyncio import Redis

from app.config import get_settings

logger = logging.getLogger(__name__)

KEY_PREFIX = "ai_quota"
# A retry delay this long can only be a daily (or longer) window, whatever the provider calls it.
DAILY_RETRY_THRESHOLD_S = 3600
_DURATION = re.compile(r"^\s*(\d+(?:\.\d+)?)s\s*$")


def _format_wait(seconds: int) -> str:
    if seconds < 90:
        return f"{seconds} s"
    if seconds < 5400:
        return f"{round(seconds / 60)} min"
    return f"{round(seconds / 3600)} h"


class AIQuotaExceededError(RuntimeError):
    """The provider's (or our own) request budget for a model is used up.

    The message is meant for the user, so callers pass it through instead of the generic
    "AI service is not available".
    """

    def __init__(self, model: str, *, daily: bool, retry_after_seconds: int | None):
        self.model = model
        self.daily = daily
        self.retry_after_seconds = retry_after_seconds
        wait = (
            f" Try again in about {_format_wait(retry_after_seconds)}."
            if retry_after_seconds
            else ""
        )
        if daily:
            message = f"The daily AI request quota for {model} is used up.{wait}"
        else:
            message = f"Too many AI requests per minute for {model}.{wait}"
        super().__init__(message)


def _parse_duration(value: object) -> int | None:
    if isinstance(value, str):
        match = _DURATION.match(value)
        if match:
            return max(1, round(float(match.group(1))))
    return None


def quota_error_from_response(response: httpx.Response, model: str) -> AIQuotaExceededError | None:
    if response.status_code != 429:
        return None

    retry_after = None
    header = response.headers.get("retry-after", "").strip()
    if header.isdigit():
        retry_after = int(header)

    daily = False
    try:
        data = response.json()
    except ValueError:
        data = None
    # Gemini's OpenAI endpoint wraps the error in a one-element list.
    for entry in data if isinstance(data, list) else [data]:
        error = entry.get("error") if isinstance(entry, dict) else None
        if not isinstance(error, dict):
            continue
        for detail in error.get("details") or []:
            if not isinstance(detail, dict):
                continue
            delay = _parse_duration(detail.get("retryDelay"))
            if delay is not None:
                retry_after = delay
            for violation in detail.get("violations") or []:
                quota_id = str(violation.get("quotaId", "")) if isinstance(violation, dict) else ""
                if "PerDay" in quota_id:
                    daily = True

    if retry_after is not None and retry_after >= DAILY_RETRY_THRESHOLD_S:
        daily = True
    return AIQuotaExceededError(model, daily=daily, retry_after_seconds=retry_after)


def seconds_until_daily_reset(now: datetime | None = None) -> int:
    tz = ZoneInfo(get_settings().ai_quota_reset_timezone)
    now = (now or datetime.now(tz)).astimezone(tz)
    midnight = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return max(1, int((midnight - now).total_seconds()))


def _day_stamp() -> str:
    return datetime.now(ZoneInfo(get_settings().ai_quota_reset_timezone)).strftime("%Y-%m-%d")


def _block_key(model: str) -> str:
    return f"{KEY_PREFIX}:{model}:blocked"


async def record_quota_exhausted(error: AIQuotaExceededError) -> None:
    """Remember a provider's daily refusal so later requests fail without calling it."""
    if not error.daily:
        return
    ttl = error.retry_after_seconds or seconds_until_daily_reset()
    redis = Redis.from_url(get_settings().redis_url)
    try:
        await redis.set(_block_key(error.model), "1", ex=ttl)
    except Exception as e:
        logger.warning(f"Could not record exhausted AI quota for {error.model}: {e}")
    finally:
        await redis.aclose()


async def acquire_ai_slot(model: str) -> None:
    """Wait for, or refuse, the next request to `model`. Raises AIQuotaExceededError."""
    settings = get_settings()
    redis = Redis.from_url(settings.redis_url)
    try:
        blocked = await redis.ttl(_block_key(model))
        if blocked and blocked > 0:
            raise AIQuotaExceededError(model, daily=True, retry_after_seconds=blocked)

        if settings.ai_requests_per_minute:
            waited = 0.0
            while True:
                now = time.time()
                key = f"{KEY_PREFIX}:{model}:minute:{int(now // 60)}"
                pipe = redis.pipeline()
                pipe.incr(key)
                pipe.expire(key, 120)
                count, _ = await pipe.execute()
                if count <= settings.ai_requests_per_minute:
                    break
                wait = 60 - (now % 60) + 0.1
                if waited + wait > settings.ai_rate_limit_max_wait_seconds:
                    raise AIQuotaExceededError(
                        model, daily=False, retry_after_seconds=max(1, round(wait))
                    )
                logger.info(f"AI per-minute budget for {model} reached, waiting {wait:.1f}s")
                await asyncio.sleep(wait)
                waited += wait

        if settings.ai_requests_per_day:
            key = f"{KEY_PREFIX}:{model}:day:{_day_stamp()}"
            pipe = redis.pipeline()
            pipe.incr(key)
            pipe.expire(key, 2 * 86400)
            count, _ = await pipe.execute()
            if count > settings.ai_requests_per_day:
                raise AIQuotaExceededError(
                    model, daily=True, retry_after_seconds=seconds_until_daily_reset()
                )
    except AIQuotaExceededError:
        raise
    except Exception as e:
        logger.warning(f"AI rate limiter unavailable, not limiting {model}: {e}")
    finally:
        await redis.aclose()
