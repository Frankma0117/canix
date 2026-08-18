"""
Extracts embedded raster images (garment photos) from a PDF, for Fashion Mode's "send a PDF full
of garment photos" flow (see src/fashion/flows/add-garment-pdf.flow.ts on the Node side). Uses
PyMuPDF (fitz) to pull the actual embedded image objects straight out of the PDF's internal
structure - it does NOT rasterize/render whole pages (which would need a much heavier pipeline and
more RAM for no benefit here, since the garment photos are already raster images embedded in the
PDF, not vector drawings that would need rendering to become an image at all).
"""
import hashlib
import io
import logging

import pymupdf as fitz  # "fitz" is PyMuPDF's old (now deprecated) import name
from PIL import Image

logger = logging.getLogger("vision-service")

# Below this, an extracted image is treated as a logo/icon/decoration, not a garment photo.
MIN_DIMENSION_DEFAULT = 150


def extract_images(pdf_bytes: bytes, max_images: int, min_dimension: int = MIN_DIMENSION_DEFAULT) -> tuple[int, list[bytes]]:
    """Returns (total_found, images) - total_found is BEFORE the max_images cap (so the caller can
    tell the user "found N, processed the first M"), images are JPEG-re-encoded bytes ready to feed
    straight into the same resize/upload/analyze pipeline as a normal WhatsApp photo. Dedupes
    identical embedded images (a repeated header/logo/background reused on every page) by content
    hash, and skips anything under min_dimension in either axis."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        seen_hashes: set[str] = set()
        found = 0
        images: list[bytes] = []

        for page in doc:
            for img_info in page.get_images(full=True):
                xref = img_info[0]
                try:
                    extracted = doc.extract_image(xref)
                except Exception as err:  # noqa: BLE001 - one corrupt image object shouldn't abort the whole PDF
                    logger.warning("No se pudo extraer xref %s: %s", xref, err)
                    continue

                raw = extracted["image"]
                if extracted.get("width", 0) < min_dimension or extracted.get("height", 0) < min_dimension:
                    continue

                digest = hashlib.md5(raw).hexdigest()
                if digest in seen_hashes:
                    continue

                try:
                    pil_image = Image.open(io.BytesIO(raw)).convert("RGB")
                except Exception:  # noqa: BLE001 - not a real raster image (e.g. a mask/pattern), skip it
                    continue

                seen_hashes.add(digest)
                found += 1
                if len(images) < max_images:
                    buf = io.BytesIO()
                    pil_image.save(buf, format="JPEG", quality=90)
                    images.append(buf.getvalue())

        return found, images
    finally:
        doc.close()
