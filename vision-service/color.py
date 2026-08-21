"""
Dominant-color extraction via plain Pillow pixel quantization - deliberately NOT the CLIP model
(a pixel-based approach is simpler, faster, and more accurate for "what color is this" than asking
a text-image model to pick a color label). Mapped to the nearest color in a fixed palette matching
canix's src/fashion/taxonomy.ts COLORS list - if nothing dominates clearly, returns "multicolor"
instead of forcing a single (likely wrong) answer.
"""
from PIL import Image

# Fraction of the shorter side cropped away from each edge before quantizing - garment photos in
# this app are near-always centered close-ups (a phone photo of one item), so most of the frame's
# outer margin is background/table/hand, not the garment itself. Without this, a light wall or a
# wood table behind the garment can easily out-vote the actual garment color in the pixel count,
# which was a real source of "genérico"/wrong color reports - quantizing only the center crop
# strongly biases the count toward the garment instead. Not a substitute for real background
# removal/segmentation (out of scope for this plain-Pillow approach), just a cheap, dependency-free
# improvement on "the whole frame including background".
_CROP_MARGIN_FRACTION = 0.18

# Same taxonomy as src/fashion/taxonomy.ts's COLORS - keep these two lists in sync by hand (this
# service never sends a color group to the /analyze caller that Node didn't ask for, so a mismatch
# here would just mean an occasional slightly-off nearest-match, never an invented value).
PALETTE: dict[str, tuple[int, int, int]] = {
    "blanco": (245, 245, 245),
    "negro": (20, 20, 20),
    "gris": (128, 128, 128),
    "beige": (222, 203, 164),
    "café": (101, 67, 33),
    "azul": (30, 90, 200),
    "azul_claro": (120, 180, 230),
    "azul_marino": (20, 30, 80),
    "verde": (40, 150, 70),
    "verde_oliva": (110, 120, 50),
    "rojo": (200, 30, 30),
    "vino": (110, 20, 40),
    "rosado": (240, 150, 180),
    "morado": (120, 40, 150),
    "amarillo": (230, 210, 40),
    "naranja": (230, 120, 30),
    "dorado": (200, 160, 60),
    "plateado": (190, 190, 190),
}

_MAX_RGB_DISTANCE = (255 ** 2 * 3) ** 0.5


def _nearest_color_name(rgb: tuple[int, int, int]) -> tuple[str, float]:
    best_name, best_dist = min(
        ((name, sum((a - b) ** 2 for a, b in zip(rgb, ref)) ** 0.5) for name, ref in PALETTE.items()),
        key=lambda pair: pair[1],
    )
    confidence = max(0.0, 1 - (best_dist / _MAX_RGB_DISTANCE) * 1.6)
    return best_name, round(min(confidence, 0.99), 2)


def _center_crop(image: Image.Image) -> Image.Image:
    """Crops away the outer margin (see _CROP_MARGIN_FRACTION) - garment photos are near-always a
    centered close-up, so this keeps mostly garment pixels for quantization."""
    width, height = image.size
    margin_w = int(width * _CROP_MARGIN_FRACTION)
    margin_h = int(height * _CROP_MARGIN_FRACTION)
    if width - 2 * margin_w < 10 or height - 2 * margin_h < 10:
        return image  # pathologically small/thin image - cropping further would leave nothing useful
    return image.crop((margin_w, margin_h, width - margin_w, height - margin_h))


def dominant_colors(image: Image.Image, top_n: int = 2) -> list[tuple[str, float]]:
    """Returns up to `top_n` (color_name, confidence) pairs, most dominant first - the garment's
    primary color, plus a genuine secondary color ONLY if a second quantized cluster is actually
    substantial (>=15% of pixels, e.g. color-blocked jacket, jeans with a leather patch) - never
    forced onto a garment that's really just one color. "multicolor" replaces the primary (and is
    the only entry returned) when nothing dominates clearly, same as before."""
    cropped = _center_crop(image)
    small = cropped.convert("RGB").resize((64, 64))
    quantized = small.quantize(colors=6, method=Image.MEDIANCUT)
    palette = quantized.getpalette()
    color_counts = quantized.getcolors()
    if not palette or not color_counts:
        return [("multicolor", 0.3)]

    color_counts.sort(reverse=True)
    total = 64 * 64
    top_count, top_index = color_counts[0]
    dominance_ratio = top_count / total

    if dominance_ratio < 0.35:
        return [("multicolor", round(0.4 + dominance_ratio * 0.3, 2))]

    top_rgb = tuple(palette[top_index * 3 : top_index * 3 + 3])
    primary_name, primary_confidence = _nearest_color_name(top_rgb)  # type: ignore[arg-type]
    results = [(primary_name, primary_confidence)]

    for count, index in color_counts[1:]:
        if count / total < 0.15:
            break  # too small a sliver to count as a real second color
        rgb = tuple(palette[index * 3 : index * 3 + 3])
        secondary_name, secondary_confidence = _nearest_color_name(rgb)  # type: ignore[arg-type]
        if secondary_name != primary_name:
            results.append((secondary_name, secondary_confidence))
        break  # only ever a primary + at most ONE secondary

    return results[:top_n]


def dominant_color(image: Image.Image) -> tuple[str, float]:
    """Back-compat single-color wrapper - returns just the primary from dominant_colors()."""
    return dominant_colors(image, top_n=1)[0]
