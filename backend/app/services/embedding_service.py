"""CLIP ViT-B/32 image embeddings with onnxruntime (already in the image for rembg; no torch).

The image encoder outputs CLIP's projected 512-d embedding, L2-normalised here so pgvector's
cosine distance and a plain dot product agree. Used to find near-duplicates and to group the
photos of one garment (front, back, label) in the batch upload.
"""

import hashlib
import logging
import os
import threading
from pathlib import Path

import httpx
import numpy as np
from PIL import Image, ImageOps

from app.config import get_settings

logger = logging.getLogger(__name__)

INPUT_SIZE = 224
# CLIP's preprocessing constants (openai/clip-vit-base-patch32 preprocessor_config.json).
CLIP_MEAN = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
CLIP_STD = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)


class EmbeddingModelError(RuntimeError):
    pass


def model_path() -> Path:
    settings = get_settings()
    return Path(settings.storage_path) / "models" / f"{settings.embedding_model_name}.onnx"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ensure_model() -> Path:
    """The verified model file, downloading it on first use."""
    settings = get_settings()
    path = model_path()
    if path.exists():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    # Per-process name, so the cron and a manual backfill never write the same file.
    tmp = path.with_suffix(f".{os.getpid()}.part")
    logger.info(f"Downloading embedding model {settings.embedding_model_name}")
    with httpx.stream("GET", settings.embedding_model_url, follow_redirects=True, timeout=300) as r:
        r.raise_for_status()
        with tmp.open("wb") as f:
            for chunk in r.iter_bytes(1 << 20):
                f.write(chunk)
    actual = _sha256(tmp)
    if actual != settings.embedding_model_sha256:
        tmp.unlink(missing_ok=True)
        raise EmbeddingModelError(
            f"Embedding model checksum mismatch: expected {settings.embedding_model_sha256}, "
            f"got {actual}"
        )
    tmp.replace(path)
    return path


def preprocess(image: Image.Image) -> np.ndarray:
    """CLIP preprocessing: shortest side to 224 (bicubic), centre crop, normalise, CHW."""
    image = ImageOps.exif_transpose(image).convert("RGB")
    width, height = image.size
    scale = INPUT_SIZE / min(width, height)
    image = image.resize(
        (max(INPUT_SIZE, round(width * scale)), max(INPUT_SIZE, round(height * scale))),
        Image.Resampling.BICUBIC,
    )
    left = (image.width - INPUT_SIZE) // 2
    top = (image.height - INPUT_SIZE) // 2
    image = image.crop((left, top, left + INPUT_SIZE, top + INPUT_SIZE))
    pixels = np.asarray(image, dtype=np.float32) / 255.0
    pixels = (pixels - CLIP_MEAN) / CLIP_STD
    return pixels.transpose(2, 0, 1)


def load_image(path: Path) -> Image.Image:
    image = Image.open(path)
    # A JPEG decodes at a fraction of its size when only 224px are needed.
    image.draft("RGB", (INPUT_SIZE * 2, INPUT_SIZE * 2))
    return image


class ClipImageEncoder:
    _instance: "ClipImageEncoder | None" = None
    _lock = threading.Lock()

    def __init__(self, session):
        self.session = session
        self.input_name = session.get_inputs()[0].name
        outputs = [o.name for o in session.get_outputs()]
        self.output_name = "image_embeds" if "image_embeds" in outputs else outputs[0]

    @classmethod
    def get(cls) -> "ClipImageEncoder":
        with cls._lock:
            if cls._instance is None:
                import onnxruntime as ort

                options = ort.SessionOptions()
                options.intra_op_num_threads = get_settings().embedding_threads
                options.inter_op_num_threads = 1
                session = ort.InferenceSession(
                    str(ensure_model()), options, providers=["CPUExecutionProvider"]
                )
                cls._instance = cls(session)
            return cls._instance

    def embed(self, images: list[Image.Image]) -> np.ndarray:
        if not images:
            return np.zeros((0, 512), dtype=np.float32)
        # One image per run: the int8 model quantises activations dynamically over the whole
        # input, so in a batch an image's vector would depend on the images next to it, and the
        # same photo would not match itself exactly. ~30 ms per image on the M1.
        vectors = np.concatenate(
            [
                self.session.run(
                    [self.output_name], {self.input_name: preprocess(image)[np.newaxis]}
                )[0]
                for image in images
            ]
        ).astype(np.float32)
        norms = np.linalg.norm(vectors, axis=1, keepdims=True)
        return vectors / np.maximum(norms, 1e-12)
