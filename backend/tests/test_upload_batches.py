"""Batch upload inbox: grouping, upload API, prepare/group/tag jobs, quota pause, recovery."""

import io
from contextlib import ExitStack
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import numpy as np
import pytest
from PIL import Image
from sqlalchemy import select, update

from app.api import upload_batches as batch_api
from app.config import get_settings
from app.models.embedding import ItemEmbedding
from app.models.item import ClothingItem, ItemImage, ItemStatus
from app.models.upload_batch import BatchStatus, PhotoStatus, UploadBatch, UploadPhoto
from app.services.ai_quota import AIQuotaExceededError
from app.services.ai_service import ClothingTags
from app.services.image_service import ImageService
from app.services.upload_batch_service import group_consecutive
from app.workers import upload_batches as batch_jobs


def _unit(*values: float) -> list[float]:
    vector = np.zeros(512, dtype=np.float32)
    vector[: len(values)] = values
    return (vector / np.linalg.norm(vector)).tolist()


def _jpeg(color=(100, 150, 200)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (64, 64), color).save(buf, format="JPEG")
    return buf.getvalue()


def _settings(**overrides):
    return get_settings().model_copy(
        update={"batch_upload_enabled": True, "embeddings_enabled": True, **overrides}
    )


async def _noop():
    return None


class TestGroupConsecutive:
    def test_similar_neighbours_chain_into_one_garment(self):
        a, a2, b = _unit(1, 0.1), _unit(1, 0.2), _unit(0, 1)
        assert group_consecutive([a, a2, b], 0.9) == [[0, 1], [2]]

    def test_a_similar_photo_later_in_the_batch_is_not_pulled_back(self):
        a, b = _unit(1, 0), _unit(0, 1)
        assert group_consecutive([a, b, a], 0.9) == [[0], [1], [2]]

    def test_a_photo_joins_when_it_matches_any_photo_of_the_run(self):
        # front, close-up (like the front, not the back), back
        front, back, detail = _unit(1, 0.45), _unit(1, -0.1), _unit(1, 0.2)
        assert group_consecutive([front, detail, back], 0.9) == [[0, 1, 2]]

    def test_photos_without_vector_stand_alone(self):
        a = _unit(1, 0)
        assert group_consecutive([a, None, a, a], 0.9) == [[0], [1], [2, 3]]
        assert group_consecutive([], 0.9) == []


@pytest.fixture
def enabled():
    with patch.object(batch_api, "get_settings", return_value=_settings()):
        yield


class TestUploadApi:
    async def test_disabled_by_default(self, client, auth_headers):
        response = await client.post("/api/v1/upload-batches", headers=auth_headers)
        assert response.status_code == 404

    async def test_upload_seal_and_read_back(self, client, auth_headers, enabled):
        batch = (await client.post("/api/v1/upload-batches", headers=auth_headers)).json()
        assert batch["status"] == "uploading"
        url = f"/api/v1/upload-batches/{batch['id']}"

        with patch.object(batch_api, "_enqueue_prepare", new=AsyncMock()) as enqueue:
            files = [
                ("images", ("front.jpg", _jpeg((10, 20, 30)), "image/jpeg")),
                ("images", ("back.jpg", _jpeg((200, 20, 30)), "image/jpeg")),
                ("images", ("notes.txt", b"hello", "text/plain")),
            ]
            response = await client.post(
                f"{url}/photos",
                files=files,
                data={"upload_keys": ["k1", "k2", "k3"]},
                headers=auth_headers,
            )
            assert response.status_code == 201
            body = response.json()
            assert (body["successful"], body["failed"]) == (2, 1)
            assert body["results"][2]["error_code"] == "unsupported_format"
            assert len(enqueue.await_args.args[0]) == 2

            # A retried chunk does not store the same photo twice.
            retry = await client.post(
                f"{url}/photos",
                files=[("images", ("front.jpg", _jpeg((10, 20, 30)), "image/jpeg"))],
                data={"upload_keys": ["k1"]},
                headers=auth_headers,
            )
            assert retry.json()["results"][0]["duplicate"] is True
            assert retry.json()["results"][0]["photo_id"] == body["results"][0]["photo_id"]

        with patch.object(batch_api, "create_pool", new=AsyncMock(side_effect=OSError)):
            sealed = await client.post(f"{url}/seal", headers=auth_headers)
        assert sealed.json()["status"] == "processing"
        assert sealed.json()["total_photos"] == 2

        late = await client.post(
            f"{url}/photos",
            files=[("images", ("x.jpg", _jpeg(), "image/jpeg"))],
            headers=auth_headers,
        )
        assert late.status_code == 409

        detail = (await client.get(url, headers=auth_headers)).json()
        assert [p["filename"] for p in detail["ungrouped"]] == ["front.jpg", "back.jpg"]
        assert [p["position"] for p in detail["ungrouped"]] == [0, 1]
        assert detail["ungrouped"][0]["thumbnail_url"]
        assert detail["counts"] == {"queued": 2}

        listed = (await client.get("/api/v1/upload-batches", headers=auth_headers)).json()
        assert [b["id"] for b in listed] == [batch["id"]]

    async def test_empty_batch_cannot_be_sealed(self, client, auth_headers, enabled):
        batch = (await client.post("/api/v1/upload-batches", headers=auth_headers)).json()
        response = await client.post(
            f"/api/v1/upload-batches/{batch['id']}/seal", headers=auth_headers
        )
        assert response.status_code == 400

    async def test_other_users_batch_is_not_found(self, client, auth_headers, enabled, db_session):
        from app.models.user import User

        other = User(
            id=uuid4(),
            external_id=f"other-{uuid4()}",
            email=f"o-{uuid4()}@x.com",
            display_name="Other",
            timezone="UTC",
        )
        db_session.add(other)
        await db_session.flush()
        batch = UploadBatch(user_id=other.id)
        db_session.add(batch)
        await db_session.commit()
        response = await client.get(f"/api/v1/upload-batches/{batch.id}", headers=auth_headers)
        assert response.status_code == 404


class _Jobs:
    """Patches the job module onto the test session and records enqueued jobs."""

    def __init__(self, db_session, **settings):
        self.db = db_session
        self.redis = AsyncMock()
        self.ctx = {"redis": self.redis, "job_try": 1}
        self.settings = _settings(**settings)
        self.stack = ExitStack()

    def __enter__(self):
        self.stack.enter_context(patch.object(batch_jobs, "get_db_session", return_value=self.db))
        self.stack.enter_context(patch.object(self.db, "close", new=_noop))
        self.stack.enter_context(
            patch.object(batch_jobs, "get_settings", return_value=self.settings)
        )
        return self

    def __exit__(self, *exc):
        self.stack.close()

    def enqueued(self, name):
        return [c for c in self.redis.enqueue_job.await_args_list if c.args[0] == name]


async def _batch(db_session, user, n, *, sealed=True, status=PhotoStatus.queued, vectors=None):
    batch = UploadBatch(
        user_id=user.id,
        status=BatchStatus.processing if sealed else BatchStatus.uploading,
        sealed_at=datetime.now(UTC) if sealed else None,
    )
    db_session.add(batch)
    await db_session.flush()
    image_service = ImageService()
    photos = []
    for i in range(n):
        paths = await image_service.process_and_store(user.id, _jpeg((i * 40, 0, 0)), f"p{i}.jpg")
        photo = UploadPhoto(
            batch_id=batch.id,
            user_id=user.id,
            position=i,
            image_path=paths["image_path"],
            thumbnail_path=paths["thumbnail_path"],
            status=status,
            embedding=vectors[i] if vectors else None,
            embedding_model="clip-vit-b32-int8" if vectors and vectors[i] else None,
        )
        db_session.add(photo)
        photos.append(photo)
    await db_session.commit()
    return batch, photos


class TestPrepareAndGroup:
    async def test_prepare_embeds_then_queues_grouping_after_the_last_photo(
        self, db_session, test_user
    ):
        batch, photos = await _batch(db_session, test_user, 2)
        with (
            _Jobs(db_session) as jobs,
            patch.object(batch_jobs, "_embed", return_value=_unit(1, 0)),
        ):
            await batch_jobs.prepare_upload_photo_job(jobs.ctx, str(photos[0].id))
            assert jobs.enqueued("group_upload_batch_job") == []
            await batch_jobs.prepare_upload_photo_job(jobs.ctx, str(photos[1].id))
            assert len(jobs.enqueued("group_upload_batch_job")) == 1
            # A second run of a prepared photo is a no-op.
            result = await batch_jobs.prepare_upload_photo_job(jobs.ctx, str(photos[1].id))
            assert result == {"status": "skipped"}
        await db_session.refresh(photos[0])
        assert photos[0].status == PhotoStatus.prepared
        assert photos[0].embedding[:2] == pytest.approx([1.0, 0.0])

    async def test_a_failed_embedding_still_prepares_the_photo(self, db_session, test_user):
        batch, (photo,) = await _batch(db_session, test_user, 1, sealed=False)
        with (
            _Jobs(db_session) as jobs,
            patch.object(batch_jobs, "_embed", side_effect=RuntimeError("model missing")),
        ):
            await batch_jobs.prepare_upload_photo_job(jobs.ctx, str(photo.id))
            # Not sealed yet: grouping waits.
            assert jobs.enqueued("group_upload_batch_job") == []
        await db_session.refresh(photo)
        assert (photo.status, photo.embedding) == (PhotoStatus.prepared, None)

    async def test_grouping_tags_one_photo_per_garment(self, db_session, test_user):
        front, back, other = _unit(1, 0.1), _unit(1, 0.2), _unit(0, 1)
        batch, photos = await _batch(
            db_session, test_user, 3, status=PhotoStatus.prepared, vectors=[front, back, other]
        )
        with _Jobs(db_session) as jobs:
            result = await batch_jobs.group_upload_batch_job(jobs.ctx, str(batch.id))
            tag_jobs = jobs.enqueued("tag_upload_group_job")
        assert result["groups"] == 2
        for photo in photos:
            await db_session.refresh(photo)
        assert photos[0].group_id == photos[1].group_id != photos[2].group_id
        assert [p.is_primary for p in photos] == [True, False, True]
        assert [p.status for p in photos] == ["tagging", "ready", "tagging"]
        assert sorted(c.args[1] for c in tag_jobs) == sorted([str(photos[0].id), str(photos[2].id)])

    async def test_a_wardrobe_duplicate_is_flagged_and_not_tagged(self, db_session, test_user):
        item = ClothingItem(
            user_id=test_user.id, type="shirt", image_path="x.jpg", status=ItemStatus.ready
        )
        db_session.add(item)
        await db_session.flush()
        db_session.add(
            ItemEmbedding(item_id=item.id, model="clip-vit-b32-int8", embedding=_unit(1, 0.01))
        )
        await db_session.commit()
        batch, (photo,) = await _batch(
            db_session, test_user, 1, status=PhotoStatus.prepared, vectors=[_unit(1, 0)]
        )
        with _Jobs(db_session) as jobs:
            await batch_jobs.group_upload_batch_job(jobs.ctx, str(batch.id))
            assert jobs.enqueued("tag_upload_group_job") == []
        await db_session.refresh(photo)
        await db_session.refresh(batch)
        assert photo.duplicate_of_item_id == item.id
        assert photo.duplicate_score >= 0.95
        assert photo.status == PhotoStatus.ready
        assert batch.status == BatchStatus.review


class TestTagging:
    async def _tagging_photo(self, db_session, user):
        batch, (photo,) = await _batch(db_session, user, 1, status=PhotoStatus.tagging)
        photo.group_id, photo.is_primary = uuid4(), True
        await db_session.commit()
        return batch, photo

    async def test_tags_land_on_the_photo_and_the_batch_moves_to_review(
        self, db_session, test_user
    ):
        batch, photo = await self._tagging_photo(db_session, test_user)
        tags = ClothingTags(type="shirt", primary_color="white", description="A shirt")
        with (
            _Jobs(db_session) as jobs,
            patch.object(batch_jobs.AIService, "analyze_image", new=AsyncMock(return_value=tags)),
        ):
            result = await batch_jobs.tag_upload_group_job(jobs.ctx, str(photo.id))
        assert result["status"] == "success"
        await db_session.refresh(photo)
        await db_session.refresh(batch)
        assert photo.tags["type"] == "shirt"
        assert "raw_response" not in photo.tags
        assert (photo.status, batch.status) == (PhotoStatus.ready, BatchStatus.review)

    async def test_daily_quota_pauses_the_batch_and_comes_back_after_reset(
        self, db_session, test_user
    ):
        batch, photo = await self._tagging_photo(db_session, test_user)
        error = AIQuotaExceededError("gemini-x", daily=True, retry_after_seconds=3600)
        analyze = AsyncMock(side_effect=error)
        with (
            _Jobs(db_session) as jobs,
            patch.object(batch_jobs.AIService, "analyze_image", new=analyze),
        ):
            result = await batch_jobs.tag_upload_group_job(jobs.ctx, str(photo.id))
            (deferred,) = jobs.enqueued("tag_upload_group_job")
            assert result["status"] == "paused"
            assert deferred.kwargs["_defer_until"] > datetime.now(UTC) + timedelta(minutes=59)

            # The next garment of the batch waits without spending a request.
            analyze.reset_mock()
            await db_session.refresh(batch)
            assert "daily AI request quota" in batch.pause_reason
            await batch_jobs.tag_upload_group_job(jobs.ctx, str(photo.id))
            analyze.assert_not_awaited()
        await db_session.refresh(photo)
        assert photo.status == PhotoStatus.tagging

    async def test_a_per_minute_limit_is_retried(self, db_session, test_user):
        _, photo = await self._tagging_photo(db_session, test_user)
        error = AIQuotaExceededError("gemini-x", daily=False, retry_after_seconds=50)
        with (
            _Jobs(db_session) as jobs,
            patch.object(batch_jobs.AIService, "analyze_image", new=AsyncMock(side_effect=error)),
        ):
            with pytest.raises(batch_jobs.Retry):
                await batch_jobs.tag_upload_group_job(jobs.ctx, str(photo.id))
            jobs.ctx["job_try"] = batch_jobs.TAGGING_MAX_TRIES
            assert (await batch_jobs.tag_upload_group_job(jobs.ctx, str(photo.id)))[
                "status"
            ] == "deferred"
        await db_session.refresh(photo)
        assert photo.status == PhotoStatus.tagging

    async def test_a_failure_on_the_last_try_marks_the_photo(self, db_session, test_user):
        batch, photo = await self._tagging_photo(db_session, test_user)
        with (
            _Jobs(db_session) as jobs,
            patch.object(
                batch_jobs.AIService,
                "analyze_image",
                new=AsyncMock(side_effect=RuntimeError("bad answer")),
            ),
        ):
            jobs.ctx["job_try"] = batch_jobs.TAGGING_MAX_TRIES
            await batch_jobs.tag_upload_group_job(jobs.ctx, str(photo.id))
        await db_session.refresh(photo)
        await db_session.refresh(batch)
        assert (photo.status, photo.error) == (PhotoStatus.error, "bad answer")
        assert batch.status == BatchStatus.review


class TestRecovery:
    async def test_lost_jobs_are_queued_again(self, db_session, test_user):
        _, (queued,) = await _batch(db_session, test_user, 1)
        batch, (prepared,) = await _batch(
            db_session, test_user, 1, status=PhotoStatus.prepared, vectors=[_unit(1, 0)]
        )
        old = datetime.now(UTC) - timedelta(hours=2)
        await db_session.execute(
            update(UploadPhoto)
            .where(UploadPhoto.id.in_([queued.id, prepared.id]))
            .values(updated_at=old)
        )
        await db_session.execute(
            update(UploadBatch).where(UploadBatch.id == batch.id).values(updated_at=old)
        )
        await db_session.commit()
        with _Jobs(db_session) as jobs:
            result = await batch_jobs.recover_upload_batches(jobs.ctx)
            prepare_ids = [c.args[1] for c in jobs.enqueued("prepare_upload_photo_job")]
            group_ids = [c.args[1] for c in jobs.enqueued("group_upload_batch_job")]
        assert result["status"] == "success"
        assert str(queued.id) in prepare_ids
        assert str(batch.id) in group_ids
        assert str(prepared.id) not in prepare_ids

    async def test_disabled_does_nothing(self, db_session):
        settings = get_settings().model_copy(update={"batch_upload_enabled": False})
        with patch.object(batch_jobs, "get_settings", return_value=settings):
            assert await batch_jobs.recover_upload_batches({"redis": AsyncMock()}) == {
                "status": "disabled"
            }


async def test_photos_go_with_their_batch(db_session, test_user):
    batch, _ = await _batch(db_session, test_user, 2)
    await db_session.delete(batch)
    await db_session.commit()
    remaining = await db_session.execute(
        select(UploadPhoto).where(UploadPhoto.batch_id == batch.id)
    )
    assert remaining.first() is None


async def _garments(db_session, user, layout, *, tags=None):
    """A sealed batch in review; layout is photos per garment, e.g. [2, 1]."""
    batch, photos = await _batch(
        db_session,
        user,
        sum(layout),
        status=PhotoStatus.ready,
        vectors=[_unit(1, i) for i in range(sum(layout))],
    )
    groups, index = [], 0
    for size in layout:
        group_id = uuid4()
        members = photos[index : index + size]
        for photo in members:
            photo.group_id = group_id
        members[0].is_primary = True
        members[0].tags = dict(tags or {"type": "shirt", "primary_color": "white"})
        groups.append(members)
        index += size
    batch.status = BatchStatus.review
    await db_session.commit()
    return batch, groups


def _gid(members):
    return str(members[0].group_id)


class TestInboxActions:
    @pytest.fixture(autouse=True)
    def _no_redis(self):
        with patch.object(batch_api, "_enqueue_tagging", new=AsyncMock()) as enqueue:
            self.enqueue = enqueue
            yield

    def _url(self, batch, tail=""):
        return f"/api/v1/upload-batches/{batch.id}{tail}"

    async def test_confirm_makes_items_with_extra_photos_and_embedding(
        self, client, auth_headers, enabled, db_session, test_user
    ):
        batch, (shirt, solo) = await _garments(
            db_session,
            test_user,
            [2, 1],
            tags={"type": "shirt", "primary_color": "white", "brand": "Uniqlo", "name": "Oxford"},
        )
        response = await client.post(
            self._url(batch, "/confirm"), json={"group_ids": [_gid(shirt)]}, headers=auth_headers
        )
        assert response.status_code == 200
        body = response.json()
        (item_id,) = body["created_item_ids"]
        assert [g["group_id"] for g in body["groups"]] == [_gid(solo)]
        assert body["status"] == "review"

        item = (
            await db_session.execute(
                select(ClothingItem)
                .where(ClothingItem.id == item_id)
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        assert (item.type, item.primary_color, item.brand, item.name) == (
            "shirt",
            "white",
            "Uniqlo",
            "Oxford",
        )
        assert item.status == ItemStatus.ready
        assert item.image_path == shirt[0].image_path
        extra = (
            (await db_session.execute(select(ItemImage).where(ItemImage.item_id == item.id)))
            .scalars()
            .all()
        )
        assert [e.image_path for e in extra] == [shirt[1].image_path]
        assert await db_session.get(ItemEmbedding, item.id) is not None

        # Confirming the rest closes the batch.
        rest = await client.post(self._url(batch, "/confirm"), json={}, headers=auth_headers)
        assert len(rest.json()["created_item_ids"]) == 1
        assert rest.json()["status"] == "closed"

    async def test_unready_garments_are_skipped_with_a_reason(
        self, client, auth_headers, enabled, db_session, test_user
    ):
        batch, (dup, untyped) = await _garments(db_session, test_user, [1, 1])
        item = ClothingItem(user_id=test_user.id, type="shirt", image_path="x.jpg")
        db_session.add(item)
        await db_session.flush()
        dup[0].duplicate_of_item_id = item.id
        untyped[0].tags = {"type": "unknown"}
        await db_session.commit()
        body = (
            await client.post(
                self._url(batch, "/confirm"),
                json={"group_ids": [_gid(dup), _gid(untyped)]},
                headers=auth_headers,
            )
        ).json()
        assert body["created_item_ids"] == []
        assert body["skipped"] == {
            _gid(dup): "possible duplicate to resolve",
            _gid(untyped): "type missing",
        }
        groups = {g["group_id"]: g for g in body["groups"]}
        assert groups[_gid(dup)]["duplicate_item"]["id"] == str(item.id)

    async def test_bulk_edit_and_rescue_of_a_failed_analysis(
        self, client, auth_headers, enabled, db_session, test_user
    ):
        batch, (a, b) = await _garments(db_session, test_user, [1, 1])
        b[0].status, b[0].tags, b[0].error = PhotoStatus.error, None, "bad answer"
        await db_session.commit()
        response = await client.patch(
            self._url(batch, "/groups"),
            json={
                "group_ids": [_gid(a), _gid(b)],
                "changes": {"type": "jeans", "season": ["winter"]},
            },
            headers=auth_headers,
        )
        groups = {g["group_id"]: g for g in response.json()["groups"]}
        assert groups[_gid(a)]["photos"][0]["tags"] == {
            "type": "jeans",
            "primary_color": "white",
            "season": ["winter"],
        }
        rescued = groups[_gid(b)]["photos"][0]
        assert (rescued["status"], rescued["error"]) == ("ready", None)
        assert groups[_gid(b)]["blocked_reason"] is None

    async def test_merge_keeps_the_earliest_garment(
        self, client, auth_headers, enabled, db_session, test_user
    ):
        batch, (first, label) = await _garments(db_session, test_user, [2, 1])
        body = (
            await client.post(
                self._url(batch, "/merge"),
                json={"group_ids": [_gid(label), _gid(first)]},
                headers=auth_headers,
            )
        ).json()
        (group,) = body["groups"]
        assert group["group_id"] == _gid(first)
        assert [p["id"] for p in group["photos"]] == [str(p.id) for p in first + label]
        assert [p["is_primary"] for p in group["photos"]] == [True, False, False]

        single = await client.post(
            self._url(batch, "/merge"), json={"group_ids": [_gid(first)]}, headers=auth_headers
        )
        assert single.status_code == 409

    async def test_split_of_the_primary_leaves_the_tags_with_the_rest(
        self, client, auth_headers, enabled, db_session, test_user
    ):
        batch, (pair,) = await _garments(db_session, test_user, [2])
        front, back = pair
        body = (
            await client.post(self._url(batch, f"/photos/{front.id}/split"), headers=auth_headers)
        ).json()
        groups = {g["primary_photo_id"]: g for g in body["groups"]}
        assert groups[str(back.id)]["photos"][0]["tags"]["type"] == "shirt"
        assert groups[str(front.id)]["photos"][0]["status"] == "tagging"
        assert body["status"] == "processing"
        self.enqueue.assert_awaited_once_with([front.id])

        alone = await client.post(
            self._url(batch, f"/photos/{back.id}/split"), headers=auth_headers
        )
        assert alone.status_code == 409

    async def test_discard_deletes_files(
        self, client, auth_headers, enabled, db_session, test_user
    ):
        batch, (pair, keep) = await _garments(db_session, test_user, [2, 1])
        files = [ImageService().get_image_path(p.image_path) for p in pair]
        assert all(f.exists() for f in files)
        body = (
            await client.post(
                self._url(batch, "/discard"), json={"group_ids": [_gid(pair)]}, headers=auth_headers
            )
        ).json()
        assert [g["group_id"] for g in body["groups"]] == [_gid(keep)]
        assert body["counts"]["discarded"] == 2
        assert not any(f.exists() for f in files)

        missing = await client.post(
            self._url(batch, "/discard"), json={"group_ids": [str(uuid4())]}, headers=auth_headers
        )
        assert missing.status_code == 404

    async def test_duplicate_resolved_either_way(
        self, client, auth_headers, enabled, db_session, test_user
    ):
        item = ClothingItem(user_id=test_user.id, type="jeans", image_path="x.jpg")
        db_session.add(item)
        await db_session.flush()
        batch, (copy, new) = await _garments(db_session, test_user, [2, 1])
        for members in (copy, new):
            members[0].duplicate_of_item_id = item.id
            members[0].tags = None
        await db_session.commit()

        attached = await client.post(
            self._url(batch, f"/groups/{_gid(copy)}/attach"), json={}, headers=auth_headers
        )
        assert [g["group_id"] for g in attached.json()["groups"]] == [_gid(new)]
        images = (
            (await db_session.execute(select(ItemImage).where(ItemImage.item_id == item.id)))
            .scalars()
            .all()
        )
        assert sorted(i.image_path for i in images) == sorted(p.image_path for p in copy)

        body = (
            await client.post(
                self._url(batch, f"/groups/{_gid(new)}/not-duplicate"), headers=auth_headers
            )
        ).json()
        (group,) = body["groups"]
        assert group["duplicate_item"] is None
        assert group["photos"][0]["status"] == "tagging"
        self.enqueue.assert_awaited_once_with([new[0].id])

    async def test_retag_only_after_a_failure(
        self, client, auth_headers, enabled, db_session, test_user
    ):
        batch, (ok, failed) = await _garments(db_session, test_user, [1, 1])
        failed[0].status, failed[0].error = PhotoStatus.error, "timeout"
        await db_session.commit()
        # Plain values: the 409 below rolls the shared session back and expires the rows.
        ok_gid, failed_gid, failed_id = _gid(ok), _gid(failed), failed[0].id
        url = self._url(batch, "/groups/{}/retag")
        assert (await client.post(url.format(ok_gid), headers=auth_headers)).status_code == 409
        body = (await client.post(url.format(failed_gid), headers=auth_headers)).json()
        statuses = {g["group_id"]: g["photos"][0]["status"] for g in body["groups"]}
        assert statuses[failed_gid] == "tagging"
        self.enqueue.assert_awaited_once_with([failed_id])

    async def test_abandon_removes_unconfirmed_photos_only(
        self, client, auth_headers, enabled, db_session, test_user
    ):
        batch, (kept, dropped) = await _garments(db_session, test_user, [1, 1])
        await client.post(
            self._url(batch, "/confirm"), json={"group_ids": [_gid(kept)]}, headers=auth_headers
        )
        kept_file = ImageService().get_image_path(kept[0].image_path)
        dropped_file = ImageService().get_image_path(dropped[0].image_path)
        response = await client.delete(self._url(batch), headers=auth_headers)
        assert response.status_code == 204
        assert kept_file.exists() and not dropped_file.exists()
        assert (await client.get(self._url(batch), headers=auth_headers)).status_code == 404
