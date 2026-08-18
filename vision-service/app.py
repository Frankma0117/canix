"""
Fashion Mode's local vision microservice - a single POST /analyze endpoint that classifies a
garment photo against a fixed candidate taxonomy sent from the Node bot (see
src/fashion/taxonomy.ts / src/fashion/vision/http-vision.service.ts). Free, self-hosted, CPU-only -
no external API, no cost per call. If this process isn't running (or errors/times out), the Node
side falls back to asking the user to tag the garment manually - this service is an enhancement,
never a hard dependency for adding a garment.

Run with:  uvicorn app:app --host 127.0.0.1 --port 8008
See README.md for full setup (venv, RAM monitoring on a small server).
"""
import base64
import io
import json
import logging

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image

import model
from color import dominant_color
from pdf_extract import extract_images

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("vision-service")

app = FastAPI(title="canix-fashion-vision")

# Multi-value groups return the top few candidates instead of just one (see taxonomy.ts's "style"
# being a JSON array on the garment record) - single-value groups return only the best match.
MULTI_VALUE_GROUPS = {"style"}
TOP_K_MULTI = 3
MIN_KEEP_CONFIDENCE = 0.05  # drop near-zero candidates even for multi-value groups

MAX_PDF_IMAGES_DEFAULT = 15
MIN_PDF_IMAGE_DIMENSION = 150  # px - filters out tiny icons/logos/decorative rasters embedded in the PDF


@app.on_event("startup")
def _startup() -> None:
    model.load_model()


@app.get("/health")
def health() -> dict:
    return {"ok": True, "model_ready": model.is_ready()}


@app.post("/analyze")
async def analyze(image: UploadFile = File(...), labels: str = Form(...)) -> JSONResponse:
    try:
        groups = json.loads(labels)
    except json.JSONDecodeError:
        return JSONResponse(status_code=400, content={"error": "labels debe ser JSON válido"})

    try:
        raw = await image.read()
        pil_image = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as err:  # noqa: BLE001
        logger.warning("Imagen inválida recibida: %s", err)
        return JSONResponse(status_code=400, content={"error": "imagen inválida"})

    result: dict = {}
    for group_def in groups:
        group = group_def.get("group")
        values = group_def.get("values") or []
        if not group or not values:
            continue

        if group == "color":
            # Pixel-based, not the CLIP model (see color.py's docstring for why).
            name, confidence = dominant_color(pil_image)
            result["color"] = {"value": name, "confidence": confidence}
            continue

        scored = model.classify_group(pil_image, values)
        if not scored:
            continue

        if group in MULTI_VALUE_GROUPS:
            result[group] = [
                {"value": v, "confidence": round(c, 4)} for v, c in scored[:TOP_K_MULTI] if c >= MIN_KEEP_CONFIDENCE
            ]
        else:
            top_value, top_conf = scored[0]
            result[group] = {"value": top_value, "confidence": round(top_conf, 4)}

    return JSONResponse(content=result)


@app.post("/extract-pdf")
async def extract_pdf(file: UploadFile = File(...), max_images: int = Form(MAX_PDF_IMAGES_DEFAULT)) -> JSONResponse:
    """Pulls embedded garment photos out of a PDF (Fashion Mode's bulk-import-by-PDF flow) - does
    NOT run classification itself, just returns the extracted images as base64 JPEGs so the Node
    side can feed each one through the normal resize/upload/analyze pipeline (see /analyze above)."""
    try:
        raw = await file.read()
    except Exception as err:  # noqa: BLE001
        logger.warning("Error leyendo el PDF subido: %s", err)
        return JSONResponse(status_code=400, content={"error": "no pude leer el archivo"})

    try:
        found, images = extract_images(raw, max_images=max_images, min_dimension=MIN_PDF_IMAGE_DIMENSION)
    except Exception as err:  # noqa: BLE001 - covers a corrupt/non-PDF upload (fitz.open raising)
        logger.warning("PDF inválido o no se pudo procesar: %s", err)
        return JSONResponse(status_code=400, content={"error": "PDF inválido o dañado"})

    encoded = [base64.b64encode(img).decode("ascii") for img in images]
    return JSONResponse(content={"images": encoded, "totalFound": found})
