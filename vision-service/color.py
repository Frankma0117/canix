"""
Dominant-color extraction via plain Pillow pixel quantization - deliberately NOT the CLIP model
(a pixel-based approach is simpler, faster, and more accurate for "what color is this" than asking
a text-image model to pick a color label). Mapped to the nearest color in a fixed palette matching
canix's src/fashion/taxonomy.ts COLORS list - if nothing dominates clearly, returns "multicolor"
instead of forcing a single (likely wrong) answer.
"""
from PIL import Image

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


def dominant_color(image: Image.Image) -> tuple[str, float]:
    """Returns (color_name, confidence). "multicolor" (moderate confidence) if no single quantized
    color clearly dominates the photo, rather than forcing a likely-wrong single answer."""
    small = image.convert("RGB").resize((64, 64))
    quantized = small.quantize(colors=6, method=Image.MEDIANCUT)
    palette = quantized.getpalette()
    color_counts = quantized.getcolors()
    if not palette or not color_counts:
        return "multicolor", 0.3

    color_counts.sort(reverse=True)
    top_count, top_index = color_counts[0]
    rgb = tuple(palette[top_index * 3 : top_index * 3 + 3])
    dominance_ratio = top_count / (64 * 64)

    if dominance_ratio < 0.35:
        return "multicolor", round(0.4 + dominance_ratio * 0.3, 2)

    name, confidence = _nearest_color_name(rgb)  # type: ignore[arg-type]
    return name, confidence
