"""
Zero-shot garment classification via a CLIP-family model (transformers), CPU-only.

Loads patrickjohncyh/fashion-clip by default - falls back to plain openai/clip-vit-base-patch32 if
that fails to download/load (e.g. no internet on first run, or the repo name changes upstream).

The whole anti-hallucination mechanism lives here: classify_group() only ever compares the image
against the candidate label strings it's given (sent fresh from the Node side's taxonomy.ts on
every request, see app.py) and returns one of THOSE labels + a confidence score - it can never
invent a value outside the candidate list, by construction (this is what "zero-shot classification"
means: picking the best-matching text out of a fixed set, not generating free text).

PROMPT ENGINEERING (2026-08-29): the naive `value.replace('_', ' ')` text (e.g. the bare word
"bottom" for BOTTOM, or a Spanish-only word like "chaleco" for a category CLIP's English-heavy
vocabulary barely knows) was consistently under-confident - most visibly, "bottom" almost never won
against "top"/"full body" for actual pants/skirts/shorts, so BOTTOM garments failed the confidence
floor at pass 1 and never even got a category (see http-vision.service.ts, which only runs pass 2
once pass 1 confidently knows `type`). Two fixes, both zero extra cost (no API calls, same local
model):
  1. Node can now send an optional `prompts` array alongside `values` (see taxonomy.ts's
     VISION_PROMPTS / http-vision.service.ts) - a natural, descriptive ENGLISH phrase per candidate
     ("pants, jeans, shorts or a skirt" instead of the bare word "bottom") that CLIP's text encoder
     actually separates well. `values` stay the canonical Spanish taxonomy slugs either way - only
     the TEXT FED TO THE MODEL changes, the returned identifier never does.
  2. Prompt ensembling: each phrase is embedded under a couple of template variants and the
     resulting text embeddings are averaged before comparing to the image - the standard zero-shot
     CLIP trick (used in the original CLIP paper's own eval) for a sharper, less noisy distribution
     than any single fixed template.
"""
import os
import logging

import torch
from PIL import Image
from transformers import CLIPModel, CLIPProcessor

logger = logging.getLogger("vision-service")

MODEL_NAME = os.environ.get("VISION_MODEL_NAME", "patrickjohncyh/fashion-clip")
FALLBACK_MODEL_NAME = "openai/clip-vit-base-patch32"

# Averaged (in normalized embedding space, per the CLIP paper's own "prompt ensembling" recipe)
# rather than picking just one - a bare phrase alone is closest to how fashion-clip's own training
# captions read ("Black cotton t-shirt"), while "a photo of X" is the standard CLIP zero-shot frame;
# averaging both is a strict improvement over either alone and costs nothing extra (same one image
# encode, just a couple more cheap text encodes).
PROMPT_TEMPLATES = ("{}", "a photo of {}, a type of clothing")

_model: CLIPModel | None = None
_processor: CLIPProcessor | None = None
# Whichever name actually ended up loaded (primary or fallback) - see current_model_name() below,
# returned in every /analyze response so each garment's stored analysis_model is traceable to the
# real model that produced it (the user's own "versionado del análisis" requirement), not just
# whichever one MODEL_NAME nominally asked for.
_loaded_model_name: str | None = None


def load_model() -> None:
    """Loads the model once at process startup (not per-request) - called from app.py's startup
    event. Keeping it a module-level singleton, loaded exactly once, is what keeps steady-state
    RAM usage predictable (see README's "Uso de RAM" section for what to monitor)."""
    global _model, _processor, _loaded_model_name
    if _model is not None:
        return
    try:
        logger.info("Cargando modelo de visión: %s", MODEL_NAME)
        _model = CLIPModel.from_pretrained(MODEL_NAME)
        _processor = CLIPProcessor.from_pretrained(MODEL_NAME)
        _loaded_model_name = MODEL_NAME
    except Exception as err:  # noqa: BLE001 - any load failure falls back, never crashes the service
        logger.warning("No se pudo cargar %s (%s), usando %s en su lugar.", MODEL_NAME, err, FALLBACK_MODEL_NAME)
        _model = CLIPModel.from_pretrained(FALLBACK_MODEL_NAME)
        _processor = CLIPProcessor.from_pretrained(FALLBACK_MODEL_NAME)
        _loaded_model_name = FALLBACK_MODEL_NAME
    _model.eval()
    logger.info("Modelo de visión listo.")


def is_ready() -> bool:
    return _model is not None and _processor is not None


def current_model_name() -> str | None:
    return _loaded_model_name


def _encode_texts(texts: list[str]) -> torch.Tensor:
    inputs = _processor(text=texts, return_tensors="pt", padding=True)
    with torch.no_grad():
        feats = _model.get_text_features(**inputs)
    return feats / feats.norm(p=2, dim=-1, keepdim=True)


def _encode_image(image: Image.Image) -> torch.Tensor:
    inputs = _processor(images=image, return_tensors="pt")
    with torch.no_grad():
        feats = _model.get_image_features(**inputs)
    return feats / feats.norm(p=2, dim=-1, keepdim=True)


def classify_group(image: Image.Image, values: list[str], prompts: list[str] | None = None) -> list[tuple[str, float]]:
    """Returns every candidate value paired with its confidence (softmax probability), sorted
    descending - callers pick just the top one for single-value fields (type/category/color/
    pattern/formality) or the top few for multi-value fields (style, see app.py).

    `values` are the canonical identifiers returned back (never altered). `prompts`, when given and
    the same length as `values`, are the natural-language English phrases actually fed to the text
    encoder for a sharper match (see this module's docstring) - falls back to the old
    `value.replace('_', ' ')` behavior when omitted (an unrecognized/unmapped group)."""
    if not values or not is_ready():
        return []

    phrases = prompts if prompts and len(prompts) == len(values) else [v.replace("_", " ") for v in values]

    all_texts = [template.format(phrase) for phrase in phrases for template in PROMPT_TEMPLATES]
    text_feats = _encode_texts(all_texts)
    text_feats = text_feats.view(len(phrases), len(PROMPT_TEMPLATES), -1).mean(dim=1)
    text_feats = text_feats / text_feats.norm(p=2, dim=-1, keepdim=True)

    image_feats = _encode_image(image)
    logits = _model.logit_scale.exp() * image_feats @ text_feats.T
    probs = logits.softmax(dim=-1)[0].tolist()
    return sorted(zip(values, probs), key=lambda pair: pair[1], reverse=True)
