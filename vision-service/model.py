"""
Zero-shot garment classification via a CLIP-family model (transformers), CPU-only.

Loads patrickjohncyh/fashion-clip (CLIP ViT-B/32 fine-tuned on ~800K Farfetch fashion image-text
pairs) by default - falls back to plain openai/clip-vit-base-patch32 if that fails to download/
load (e.g. no internet on first run, or the repo name changes upstream).

The whole anti-hallucination mechanism lives here: classify_group() only ever compares the image
against the candidate label strings it's given (sent fresh from the Node side's taxonomy.ts on
every request, see app.py) and returns one of THOSE labels + a confidence score - it can never
invent a value outside the candidate list, by construction (this is what "zero-shot classification"
means: picking the best-matching text out of a fixed set, not generating free text).
"""
import os
import logging

import torch
from PIL import Image
from transformers import CLIPModel, CLIPProcessor

logger = logging.getLogger("vision-service")

MODEL_NAME = os.environ.get("VISION_MODEL_NAME", "patrickjohncyh/fashion-clip")
FALLBACK_MODEL_NAME = "openai/clip-vit-base-patch32"

_model: CLIPModel | None = None
_processor: CLIPProcessor | None = None


def load_model() -> None:
    """Loads the model once at process startup (not per-request) - called from app.py's startup
    event. Keeping it a module-level singleton, loaded exactly once, is what keeps steady-state
    RAM usage predictable (see README's "Uso de RAM" section for what to monitor)."""
    global _model, _processor
    if _model is not None:
        return
    try:
        logger.info("Cargando modelo de visión: %s", MODEL_NAME)
        _model = CLIPModel.from_pretrained(MODEL_NAME)
        _processor = CLIPProcessor.from_pretrained(MODEL_NAME)
    except Exception as err:  # noqa: BLE001 - any load failure falls back, never crashes the service
        logger.warning("No se pudo cargar %s (%s), usando %s en su lugar.", MODEL_NAME, err, FALLBACK_MODEL_NAME)
        _model = CLIPModel.from_pretrained(FALLBACK_MODEL_NAME)
        _processor = CLIPProcessor.from_pretrained(FALLBACK_MODEL_NAME)
    _model.eval()
    logger.info("Modelo de visión listo.")


def is_ready() -> bool:
    return _model is not None and _processor is not None


def classify_group(image: Image.Image, values: list[str]) -> list[tuple[str, float]]:
    """Returns every candidate value paired with its confidence (softmax probability), sorted
    descending - callers pick just the top one for single-value fields (type/category/color/
    pattern/formality) or the top few for multi-value fields (style, see app.py)."""
    if not values or not is_ready():
        return []

    texts = [v.replace("_", " ") for v in values]
    inputs = _processor(text=texts, images=image, return_tensors="pt", padding=True)
    with torch.no_grad():
        outputs = _model(**inputs)
    probs = outputs.logits_per_image.softmax(dim=1)[0].tolist()
    return sorted(zip(values, probs), key=lambda pair: pair[1], reverse=True)
