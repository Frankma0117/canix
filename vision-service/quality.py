"""
Cheap, dependency-free photo-quality gate (Pillow only, no numpy/opencv) - runs BEFORE
classification so a bad photo can be flagged instead of silently producing a low-confidence guess
with no explanation. These are heuristics, not a precise scientific measurement - the thresholds
below are empirical starting points, not calibrated against a labeled dataset, and may need
adjusting once real photos are seen in practice.
"""
from PIL import Image, ImageFilter, ImageStat

MIN_DIMENSION = 200  # px - below this a garment is almost never identifiable reliably
DARK_THRESHOLD = 35  # mean luminance 0-255
BRIGHT_THRESHOLD = 235
# Variance of a Laplacian-like edge filter - a sharp photo has lots of high-contrast edges (high
# variance), a blurry one is smooth (low variance). This exact threshold is a rough starting point;
# it's intentionally lenient (favors NOT flagging a borderline photo as blurry) since a false
# "blurry" flag is more annoying than a missed one - classification's own confidence score is the
# second line of defense either way.
BLUR_VARIANCE_THRESHOLD = 60

_EDGE_KERNEL = ImageFilter.Kernel((3, 3), [0, 1, 0, 1, -4, 1, 0, 1, 0], scale=1)


def assess_quality(image: Image.Image) -> dict:
    """Returns {"ok": bool, "issues": [str, ...]} - issues is empty when nothing looked off."""
    issues: list[str] = []
    width, height = image.size
    if width < MIN_DIMENSION or height < MIN_DIMENSION:
        issues.append("too_small")

    gray = image.convert("L")
    # Downsized before filtering - this is a rough global sharpness signal, not a precision
    # measurement, so full resolution buys nothing but slower processing on the small CPU server.
    small_gray = gray.resize((min(width, 400), min(height, 400)))
    edges = small_gray.filter(_EDGE_KERNEL)
    variance = ImageStat.Stat(edges).var[0]
    if variance < BLUR_VARIANCE_THRESHOLD:
        issues.append("blurry")

    brightness = ImageStat.Stat(gray).mean[0]
    if brightness < DARK_THRESHOLD:
        issues.append("too_dark")
    elif brightness > BRIGHT_THRESHOLD:
        issues.append("too_bright")

    return {"ok": len(issues) == 0, "issues": issues}
