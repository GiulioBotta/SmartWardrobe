"""CLIP embeddings: preprocessing, model download check, the backfill job, similar items."""

import hashlib
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import numpy as np
import pytest
from PIL import Image
from sqlalchemy import select

from app.config import get_settings
from app.models.embedding import ItemEmbedding, Vector
from app.models.item import ClothingItem, ItemStatus
from app.services import embedding_service
from app.services.embedding_service import (
    CLIP_MEAN,
    CLIP_STD,
    ClipImageEncoder,
    EmbeddingModelError,
    preprocess,
)
from app.workers import embeddings as embedding_jobs


class TestPreprocess:
    def test_output_is_a_normalised_224_crop(self):
        out = preprocess(Image.new("RGB", (640, 480), "white"))
        assert out.shape == (3, 224, 224)
        np.testing.assert_allclose(out[:, 0, 0], (1.0 - CLIP_MEAN) / CLIP_STD, rtol=1e-5)

    def test_transparency_and_tiny_images_are_handled(self):
        assert preprocess(Image.new("RGBA", (10, 300), (0, 0, 0, 0))).shape == (3, 224, 224)


class TestVectorType:
    def test_round_trip_through_text(self):
        vector = Vector(3)
        bound = vector.bind_processor(None)([0.1, -2, 3.5])
        assert bound == "[0.1,-2,3.5]"
        assert vector.result_processor(None, None)(bound) == [0.1, -2.0, 3.5]


class _FakeSession:
    def __init__(self, dim=512):
        self.dim = dim
        self.calls = []

    def get_inputs(self):
        return [SimpleNamespace(name="pixel_values")]

    def get_outputs(self):
        return [SimpleNamespace(name="image_embeds"), SimpleNamespace(name="last_hidden_state")]

    def run(self, names, feeds):
        batch = feeds["pixel_values"]
        self.calls.append(batch.shape[0])
        # Deterministic, image-dependent output: mean pixel value spread over the dimensions.
        return [
            np.tile(batch.reshape(batch.shape[0], -1).mean(axis=1, keepdims=True) + 2, self.dim)
        ]


class TestEncoder:
    def test_vectors_are_unit_length_and_computed_one_image_at_a_time(self):
        session = _FakeSession()
        encoder = ClipImageEncoder(session)
        vectors = encoder.embed([Image.new("RGB", (50, 50), c) for c in ("white", "black", "red")])
        assert vectors.shape == (3, 512)
        np.testing.assert_allclose(np.linalg.norm(vectors, axis=1), 1.0, rtol=1e-5)
        assert session.calls == [1, 1, 1]
        assert encoder.output_name == "image_embeds"


class TestEnsureModel:
    def _stream(self, payload: bytes):
        response = MagicMock()
        response.__enter__.return_value = response
        response.iter_bytes.return_value = [payload]
        return response

    def test_a_checksum_mismatch_is_refused_and_cleaned_up(self, tmp_path):
        settings = get_settings().model_copy(
            update={"storage_path": str(tmp_path), "embedding_model_sha256": "0" * 64}
        )
        with (
            patch.object(embedding_service, "get_settings", return_value=settings),
            patch.object(embedding_service.httpx, "stream", return_value=self._stream(b"bad")),
        ):
            with pytest.raises(EmbeddingModelError, match="checksum"):
                embedding_service.ensure_model()
        assert list((tmp_path / "models").iterdir()) == []

    def test_a_verified_download_is_kept(self, tmp_path):
        payload = b"onnx-bytes"
        settings = get_settings().model_copy(
            update={
                "storage_path": str(tmp_path),
                "embedding_model_sha256": hashlib.sha256(payload).hexdigest(),
            }
        )
        with (
            patch.object(embedding_service, "get_settings", return_value=settings),
            patch.object(embedding_service.httpx, "stream", return_value=self._stream(payload)),
        ):
            path = embedding_service.ensure_model()
            assert path.read_bytes() == payload
            # Present now, so no second download.
            with patch.object(embedding_service.httpx, "stream", side_effect=AssertionError):
                assert embedding_service.ensure_model() == path


def _write_image(root: Path, color: str) -> str:
    relative = f"embeddings-test/{uuid4()}.jpg"
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (64, 64), color).save(path)
    return relative


@pytest.mark.asyncio
class TestEmbeddingJob:
    async def _items(self, db_session, user, colors):
        root = Path(get_settings().storage_path)
        items = [
            ClothingItem(
                user_id=user.id,
                type="t-shirt",
                image_path=_write_image(root, color),
                status=ItemStatus.ready,
            )
            for color in colors
        ]
        db_session.add_all(items)
        await db_session.commit()
        return items

    def _patches(self, db_session):
        settings = get_settings().model_copy(update={"embeddings_enabled": True})
        return (
            patch.object(embedding_jobs, "get_settings", return_value=settings),
            patch.object(embedding_jobs, "get_db_session", return_value=db_session),
            patch.object(db_session, "close", new=_noop),
            patch.object(ClipImageEncoder, "get", return_value=ClipImageEncoder(_FakeSession())),
        )

    async def test_pending_items_are_embedded_once(self, db_session, test_user):
        items = await self._items(db_session, test_user, ["white", "black"])
        ids = {i.id for i in items}
        _, _, p3, p4 = self._patches(db_session)
        with p3, p4:
            assert ids <= {
                i.id
                for i in await embedding_jobs.pending_items(db_session, 100, user_id=test_user.id)
            }
            stored, failed = await embedding_jobs.embed_items(db_session, items)
            assert stored == 2 and not failed
            assert not ids & {
                i.id
                for i in await embedding_jobs.pending_items(db_session, 100, user_id=test_user.id)
            }
        rows = (
            (await db_session.execute(select(ItemEmbedding).where(ItemEmbedding.item_id.in_(ids))))
            .scalars()
            .all()
        )
        assert len(rows) == 2 and all(len(r.embedding) == 512 for r in rows)
        assert {r.source_path for r in rows} == {i.image_path for i in items}

    async def test_unreadable_images_do_not_block_the_job(self, db_session, test_user):
        broken = ClothingItem(
            user_id=test_user.id,
            type="t-shirt",
            image_path="embeddings-test/missing.jpg",
            status=ItemStatus.ready,
        )
        db_session.add(broken)
        await db_session.commit()
        (good,) = await self._items(db_session, test_user, ["green"])
        ctx: dict = {}
        p1, p2, p3, p4 = self._patches(db_session)
        with p1, p2, p3, p4:
            # Newest first, so one run reaches both of this test's items.
            await embedding_jobs.embed_pending_items_job(ctx, limit=100)
            assert broken.id in ctx["embedding_failed"]
            assert await db_session.get(ItemEmbedding, good.id) is not None
            again = await embedding_jobs.pending_items(
                db_session, 100, exclude=ctx["embedding_failed"], user_id=test_user.id
            )
            assert broken.id not in {i.id for i in again}

    async def test_a_changed_image_or_model_is_embedded_again(self, db_session, test_user):
        (item,) = await self._items(db_session, test_user, ["red"])
        _, _, p3, p4 = self._patches(db_session)

        async def pending_ids():
            return {
                i.id
                for i in await embedding_jobs.pending_items(db_session, 100, user_id=test_user.id)
            }

        with p3, p4:
            await embedding_jobs.embed_items(db_session, [item])
            assert item.id not in await pending_ids()
            item.image_path = _write_image(Path(get_settings().storage_path), "blue")
            await db_session.commit()
            assert item.id in await pending_ids()
            await embedding_jobs.embed_items(db_session, [item])
            assert item.id not in await pending_ids()

        other_model = get_settings().model_copy(update={"embedding_model_name": "another-model"})
        with patch.object(embedding_jobs, "get_settings", return_value=other_model):
            assert item.id in await pending_ids()

    async def test_disabled_does_nothing(self, db_session):
        settings = get_settings().model_copy(update={"embeddings_enabled": False})
        with patch.object(embedding_jobs, "get_settings", return_value=settings):
            assert await embedding_jobs.embed_pending_items_job({}) == {"status": "disabled"}


async def _noop():
    return None


def _unit(*values: float) -> list[float]:
    vector = np.zeros(512, dtype=np.float32)
    vector[: len(values)] = values
    return (vector / np.linalg.norm(vector)).tolist()


@pytest.mark.asyncio
class TestSimilarItems:
    async def test_nearest_first_within_the_users_wardrobe(
        self, client, db_session, test_user, auth_headers
    ):
        target, near, far, unembedded = (
            ClothingItem(
                user_id=test_user.id,
                type="jacket",
                name=name,
                image_path=f"test/{uuid4()}.jpg",
                status=ItemStatus.ready,
            )
            for name in ("target", "near", "far", "unembedded")
        )
        db_session.add_all([target, near, far, unembedded])
        await db_session.flush()
        model = get_settings().embedding_model_name
        db_session.add_all(
            [
                ItemEmbedding(item_id=target.id, model=model, embedding=_unit(1, 0)),
                ItemEmbedding(item_id=near.id, model=model, embedding=_unit(1, 0.1)),
                ItemEmbedding(item_id=far.id, model=model, embedding=_unit(0, 1)),
            ]
        )
        await db_session.commit()

        response = await client.get(f"/api/v1/items/{target.id}/similar", headers=auth_headers)
        assert response.status_code == 200
        body = response.json()
        assert [x["name"] for x in body] == ["near", "far"]
        assert body[0]["similarity"] > 0.99 and abs(body[1]["similarity"]) < 0.01

        pending = await client.get(f"/api/v1/items/{unembedded.id}/similar", headers=auth_headers)
        assert pending.status_code == 409
        missing = await client.get(f"/api/v1/items/{uuid4()}/similar", headers=auth_headers)
        assert missing.status_code == 404
