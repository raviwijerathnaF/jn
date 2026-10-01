#!/usr/bin/env python3
"""
OmniFlow Digital - brand asset generator
=========================================

Creates every image/icon file the site expects, from ONE source of truth
(the swirl mark below), so the logo, favicons, PWA icons and the social
share (Open Graph) banner can never drift out of sync.

Usage (from the repository root):

    python3 tools/make-assets.py

Requires: Pillow  ->  pip install pillow

Files written to the repository root:
    logo.svg                 crisp vector logo used as the header/footer logo
    logo.png                 512px raster fallback (same mark, transparent bg)
    favicon.ico              16 / 32 / 48 multi-size browser icon
    favicon-16.png
    favicon-32.png
    apple-touch-icon.png     180px, iOS home screen (full-bleed, iOS masks it)
    icon-192.png             PWA / Android
    icon-512.png             PWA / Android
    icon-maskable-512.png    PWA maskable (extra safe-zone padding)
    og-banner.png            1200x630 social share card (WhatsApp/FB/X/LinkedIn)
"""

import math
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

# --------------------------------------------------------------------------
# Brand
# --------------------------------------------------------------------------
BLUE = "#0e6ba8"
CYAN = "#22c6e8"
GREEN = "#9bd44a"
NAVY = "#04172a"          # page background (dark theme)
NAVY_2 = "#071f36"
INK = "#f1f7fb"
TEXT = "#a7bccc"
MUTED = "#7f97aa"

# gradient used for the outer ring of the mark
RING_STOPS = [("#0b4f8a", 0.0), ("#19b4d8", 0.5), ("#8cc63f", 1.0)]

FONT_DIR = "/usr/share/fonts/truetype/dejavu"
FONT_BOLD = os.path.join(FONT_DIR, "DejaVuSans-Bold.ttf")
FONT_REG = os.path.join(FONT_DIR, "DejaVuSans.ttf")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------


def hex2rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def lerp_stops(stops, t):
    """stops: [(hex, position), ...] sorted by position."""
    t = max(0.0, min(1.0, t))
    for i in range(len(stops) - 1):
        c0, p0 = stops[i]
        c1, p1 = stops[i + 1]
        if p0 <= t <= p1:
            f = 0.0 if p1 == p0 else (t - p0) / (p1 - p0)
            a, b = hex2rgb(c0), hex2rgb(c1)
            return tuple(round(a[j] + (b[j] - a[j]) * f) for j in range(3))
    return hex2rgb(stops[-1][0])


def lookup(size, stops, angle=45.0):
    """Build a diagonal (or any-angle) gradient image by resizing a tiny ramp."""
    n = 256
    ramp = Image.new("RGB", (n, n))
    px = ramp.load()
    rad = math.radians(angle)
    dx, dy = math.cos(rad), math.sin(rad)
    for y in range(n):
        for x in range(n):
            t = ((x / (n - 1)) * dx + (y / (n - 1)) * dy) / (abs(dx) + abs(dy) or 1)
            px[x, y] = lerp_stops(stops, t)
    return ramp.resize(size, Image.BILINEAR)


def font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except OSError:                                     # pragma: no cover
        return ImageFont.load_default()


def text_wh(draw, txt, f, tracking=0):
    box = draw.textbbox((0, 0), txt, font=f)
    w = box[2] - box[0]
    if tracking:
        w += tracking * (len(txt) - 1)
    return w, box[3] - box[1]


def draw_tracked(draw, xy, txt, f, fill, tracking=0):
    """Draw text with letter-spacing (Pillow has no native tracking)."""
    x, y = xy
    if not tracking:
        draw.text((x, y), txt, font=f, fill=fill)
        return
    for ch in txt:
        draw.text((x, y), ch, font=f, fill=fill)
        x += draw.textlength(ch, font=f) + tracking


# --------------------------------------------------------------------------
# The mark  (same geometry as <symbol id="mark"> in index.html)
# --------------------------------------------------------------------------
# Every element lives in a 100x100 box; it is scaled to whatever we need.
MARK_ELEMENTS = [
    # (kind, points, stroke width, colour or "grad" for the brand gradient)
    ("ellipse", (50, 50, 45), 5, "grad"),
    ("curve", [(22, 70), (10, 50), (22, 22), (50, 20)], 5, "#1b87c9"),
    ("curve", [(32, 78), (48, 86), (70, 76), (74, 54)], 5, "#19b4d8"),
    ("curve", [(32, 62), (26, 46), (36, 30), (54, 30)], 5, "#19b4d8"),
    ("curve", [(52, 38), (68, 36), (82, 46), (80, 64), (79, 72), (74, 80), (66, 84)], 6, "#8cc63f"),
    ("poly", [(52, 20), (64, 30), (50, 38)], 0, "#19b4d8"),
]

MARK_VIEWBOX = (2.0, 2.0, 96.0)      # x, y, size  (tight crop of the artwork)


def _bezier(p0, p1, p2, p3, n=24):
    out = []
    for i in range(n + 1):
        t = i / n
        mt = 1 - t
        out.append((
            mt ** 3 * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t ** 3 * p3[0],
            mt ** 3 * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t ** 3 * p3[1],
        ))
    return out


def _curve_points(pts, target_len=6.0):
    """Turn a chain of cubic control points into a polyline.

    Sampling is kept deliberately sparse: Pillow's thick-line renderer produces
    scanline artifacts when consecutive points are much closer than the stroke
    width, so we aim for roughly one vertex every `target_len` units.
    """
    poly = [pts[0]]
    for i in range(1, len(pts), 3):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        approx = (math.dist(p0, p1) + math.dist(p1, p2) + math.dist(p2, p3)) * 0.6
        n = max(6, min(48, round(approx / target_len)))
        seg = _bezier(p0, p1, p2, p3, n)
        poly.extend(seg[1:])
    return poly


def render_mark(px, ss=4):
    """Return an RGBA image of the mark, px * px, transparent background."""
    s = px * ss
    vx, vy, vs = MARK_VIEWBOX
    k = s / vs

    def t(p):
        return ((p[0] - vx) * k, (p[1] - vy) * k)

    grad = lookup((s, s), RING_STOPS, angle=45.0)
    canvas = Image.new("RGBA", (s, s), (0, 0, 0, 0))

    for kind, pts, width, colour in MARK_ELEMENTS:
        mask = Image.new("L", (s, s), 0)
        d = ImageDraw.Draw(mask)
        w = max(1, round(width * k))

        if kind == "ellipse":
            cx, cy, r = pts
            x, y = t((cx, cy))
            rr = r * k
            d.ellipse([x - rr - w / 2, y - rr - w / 2, x + rr + w / 2, y + rr + w / 2],
                      outline=255, width=w)
        elif kind == "curve":
            poly = [t(p) for p in _curve_points(pts)]
            d.line(poly, fill=255, width=w, joint="curve")
            for end in (poly[0], poly[-1]):                     # round caps
                d.ellipse([end[0] - w / 2, end[1] - w / 2, end[0] + w / 2, end[1] + w / 2], fill=255)
        elif kind == "poly":
            d.polygon([t(p) for p in pts], fill=255)

        layer = grad.copy() if colour == "grad" else Image.new("RGB", (s, s), hex2rgb(colour))
        layer = layer.convert("RGBA")
        layer.putalpha(mask)
        canvas.alpha_composite(layer)

    return canvas.resize((px, px), Image.LANCZOS)


# --------------------------------------------------------------------------
# SVG (single source of truth for the vector logo)
# --------------------------------------------------------------------------
SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="2 2 96 96" width="96" height="96" role="img" aria-labelledby="omniflowLogoTitle">
  <title id="omniflowLogoTitle">OmniFlow Digital</title>
  <defs>
    <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0b4f8a"/><stop offset=".5" stop-color="#19b4d8"/><stop offset="1" stop-color="#8cc63f"/>
    </linearGradient>
  </defs>
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="50" cy="50" r="45" stroke="url(#lg)" stroke-width="5"/>
    <path d="M22 70C10 50 22 22 50 20" stroke="#1b87c9" stroke-width="5"/>
    <path d="M32 78C48 86 70 76 74 54" stroke="#19b4d8" stroke-width="5"/>
    <path d="M32 62C26 46 36 30 54 30" stroke="#19b4d8" stroke-width="5"/>
    <path d="M52 38C68 36 82 46 80 64C79 72 74 80 66 84" stroke="#8cc63f" stroke-width="6"/>
  </g>
  <polygon points="52,20 64,30 50,38" fill="#19b4d8"/>
</svg>
"""


# --------------------------------------------------------------------------
# Icon builders
# --------------------------------------------------------------------------
def app_icon(px, pad=0.17, radius=0.22, full_bleed=False):
    """Rounded-square app icon with the mark centred on a navy ground."""
    s = px * 4
    bg = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(bg)
    if full_bleed:
        ground = lookup((s, s), [("#04172a", 0.0), ("#0a3355", 1.0)], angle=60.0).convert("RGBA")
        bg.alpha_composite(ground)
    else:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * radius), fill=hex2rgb(NAVY) + (255,))
        glow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        gd = ImageDraw.Draw(glow)
        gd.ellipse([s * 0.10, s * 0.12, s * 0.95, s * 0.95], fill=hex2rgb(CYAN) + (60,))
        glow = glow.filter(ImageFilter.GaussianBlur(s * 0.09))
        mask = Image.new("L", (s, s), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * radius), fill=255)
        glow.putalpha(Image.composite(glow.getchannel("A"), Image.new("L", (s, s), 0), mask))
        bg.alpha_composite(glow)

    inner = max(1, round(s * (1 - 2 * pad)))
    mark = render_mark(inner, ss=1)
    bg.alpha_composite(mark, (round((s - inner) / 2), round((s - inner) / 2)))
    return bg.resize((px, px), Image.LANCZOS)


def og_banner(w=1200, h=630):
    """1200x630 social share card."""
    ss = 2
    W, H = w * ss, h * ss
    card = lookup((W, H), [("#04172a", 0.0), ("#071f36", 0.65), ("#03101e", 1.0)], angle=105.0)

    # aurora blobs
    for (cx, cy, r, col, alpha) in [
        (0.86, 0.10, 0.42, BLUE, 130),
        (0.05, 0.95, 0.40, GREEN, 70),
        (0.55, 0.50, 0.30, CYAN, 45),
    ]:
        glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(glow).ellipse(
            [(cx - r) * W, (cy - r) * H, (cx + r) * W, (cy + r) * H], fill=hex2rgb(col) + (alpha,))
        card = Image.alpha_composite(card.convert("RGBA"), glow.filter(ImageFilter.GaussianBlur(W * 0.06)))

    d = ImageDraw.Draw(card, "RGBA")

    # mark, optically centred on the left
    mark_px = int(H * 0.44)
    mark = render_mark(mark_px, ss=2)
    card.alpha_composite(mark, (int(W * 0.072), int((H - mark_px) / 2)))

    # headline
    f_brand = font(FONT_BOLD, int(H * 0.118))
    f_tag = font(FONT_BOLD, int(H * 0.050))
    f_body = font(FONT_REG, int(H * 0.040))
    f_chip = font(FONT_BOLD, int(H * 0.030))

    x = int(W * 0.315)
    y = int(H * 0.225)
    d.text((x, y), "OmniFlow Digital", font=f_brand, fill=hex2rgb(INK) + (255,))

    tag = "Innovating. Integrating. Accelerating."
    draw_tracked(d, (x + 2 * ss, y + int(H * 0.150)), tag, f_tag, hex2rgb("#2fd0e8") + (255,), tracking=ss)

    body = "Websites · Social & Ads · WhatsApp Automation"
    body2 = "POS & Inventory · Google Business Profile"
    d.text((x + 2 * ss, y + int(H * 0.232)), body, font=f_body, fill=hex2rgb(TEXT) + (255,))
    d.text((x + 2 * ss, y + int(H * 0.232) + int(H * 0.058)), body2, font=f_body, fill=hex2rgb(TEXT) + (255,))

    # service chips (drawn on their own layer so the translucent glass
    # fill/outline genuinely blends with the background)
    chips = ["Web", "Social & Ads", "WhatsApp", "POS", "Google"]
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    cx = x + 2 * ss
    cy = y + int(H * 0.375)
    pad_x, pad_y = int(H * 0.026), int(H * 0.014)
    for chip in chips:
        tw = od.textlength(chip, font=f_chip)
        box = [cx, cy, cx + tw + pad_x * 2, cy + int(H * 0.032) + pad_y * 2]
        od.rounded_rectangle(box, radius=int((box[3] - box[1]) / 2),
                             fill=(255, 255, 255, 22), outline=(255, 255, 255, 70), width=max(1, ss))
        od.text((cx + pad_x, cy + pad_y - ss), chip, font=f_chip, fill=hex2rgb(INK) + (240,))
        cx = box[2] + int(H * 0.018)
    card.alpha_composite(overlay)

    # bottom brand gradient line
    bar = lookup((W, int(8 * ss)), [("#2aa5e8", 0.0), ("#22d3ee", 0.45), ("#9bdc4a", 1.0)], angle=0.0)
    card.alpha_composite(bar.convert("RGBA"), (0, H - int(8 * ss)))

    return card.convert("RGB").resize((w, h), Image.LANCZOS)


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------
def main():
    def out(name):
        return os.path.join(ROOT, name)

    # --- vector logo -------------------------------------------------------
    with open(out("logo.svg"), "w", encoding="utf-8") as fh:
        fh.write(SVG)
    print("wrote logo.svg")

    # --- transparent raster logo (header + footer <img>) -------------------
    render_mark(512, ss=4).save(out("logo.png"))
    print("wrote logo.png  (512x512, transparent, tightly cropped)")

    # --- browser / OS icons ------------------------------------------------
    ico = app_icon(256)
    ico.save(out("favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48)])
    print("wrote favicon.ico  (16/32/48)")

    app_icon(16).save(out("favicon-16.png"))
    app_icon(32).save(out("favicon-32.png"))
    print("wrote favicon-16.png, favicon-32.png")

    app_icon(180, pad=0.20, radius=0.0, full_bleed=True).save(out("apple-touch-icon.png"))
    print("wrote apple-touch-icon.png  (180x180)")

    app_icon(192).save(out("icon-192.png"))
    app_icon(512).save(out("icon-512.png"))
    app_icon(512, pad=0.28, radius=0.0, full_bleed=True).save(out("icon-maskable-512.png"))
    print("wrote icon-192.png, icon-512.png, icon-maskable-512.png")

    # --- social share card -------------------------------------------------
    og_banner(1200, 630).save(out("og-banner.png"), optimize=True)
    print("wrote og-banner.png  (1200x630)")


if __name__ == "__main__":
    main()
