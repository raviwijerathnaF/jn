#!/usr/bin/env python3
"""
OmniFlow Digital — WCAG 2.1 AA contrast verifier
=================================================

Parses the CSS theme tokens from `index.html` and `assets/pages.css` and
verifies text, link, badge, chip, error message, button, and every `.gt`
gradient color stop against both page surfaces in each theme, meeting the WCAG 2.1 AA 4.5:1 contrast ratio in both
dark (`:root`) and light (`[data-theme="light"]`) themes.

Usage (from the repository root):

    python3 tools/check-contrast.py
"""

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIN_AA = 4.5


def srgb_channel(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_rgb(h):
    h = h.strip().lstrip("#")
    if len(h) == 3:
        h = "".join(ch * 2 for ch in h)
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def rgb_to_hex(rgb):
    return "#{:02x}{:02x}{:02x}".format(*rgb)


def luminance(hex_color):
    r, g, b = hex_to_rgb(hex_color)
    return 0.2126 * srgb_channel(r) + 0.7152 * srgb_channel(g) + 0.0722 * srgb_channel(b)


def contrast_ratio(fg_hex, bg_hex):
    l1, l2 = luminance(fg_hex), luminance(bg_hex)
    bright, dark = max(l1, l2), min(l1, l2)
    return (bright + 0.05) / (dark + 0.05)


def blend_rgba_on_hex(rgba, bg_hex):
    r, g, b, a = rgba
    br, bg, bb = hex_to_rgb(bg_hex)
    return rgb_to_hex((
        round(r * a + br * (1.0 - a)),
        round(g * a + bg * (1.0 - a)),
        round(b * a + bb * (1.0 - a)),
    ))


def parse_css_vars(text, selector):
    pattern = re.escape(selector) + r"\s*\{([^}]+)\}"
    m = re.search(pattern, text, re.S)
    if not m:
        raise ValueError(f"Selector {selector!r} not found")
    block = m.group(1)
    out = {}
    for k, v in re.findall(r"--([\w-]+)\s*:\s*([^;]+);", block):
        out[k.strip()] = v.strip()
    return out


def extract_hex_colors(val):
    return re.findall(r"#[0-9a-fA-F]{3,6}", val)


def resolve_card_bg(card_val, base_bg):
    m = re.match(r"rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)", card_val)
    if m:
        rgba = (int(m.group(1)), int(m.group(2)), int(m.group(3)), float(m.group(4)))
        return blend_rgba_on_hex(rgba, base_bg)
    return card_val


def check_theme_vars(file_label, theme_name, v):
    bg = v["bg"]
    bg2 = v["bg-2"]
    card_on_bg = resolve_card_bg(v["card"], bg)
    card_on_bg2 = resolve_card_bg(v["card"], bg2)

    tag_cyan_bg = blend_rgba_on_hex((34, 198, 232, 0.10), card_on_bg2)
    tag_green_bg = blend_rgba_on_hex((155, 212, 74, 0.10), card_on_bg2)
    fail_bg = blend_rgba_on_hex((255, 107, 107, 0.10), bg2)

    pairs = []
    for tok in ("ink", "text", "muted", "cyan", "green", "err"):
        fg = v[tok]
        pairs.append((f"--{tok} on --bg", fg, bg))
        pairs.append((f"--{tok} on --bg-2", fg, bg2))
        pairs.append((f"--{tok} on --card(--bg)", fg, card_on_bg))
        pairs.append((f"--{tok} on --card(--bg-2)", fg, card_on_bg2))

    pairs.append((".tag (--cyan on chip)", v["cyan"], tag_cyan_bg))
    pairs.append((".tag.g / .vchip (--green on chip)", v["green"], tag_green_bg))
    pairs.append((".form-fail (--err on alert bg)", v["err"], fail_bg))

    # Gradient text (.gt) must remain legible at every configured color stop
    # against both page surfaces in each theme; browsers interpolate between stops.
    for idx, stop in enumerate(extract_hex_colors(v["grad"]), 1):
        pairs.append((f".gt gradient stop #{idx} ({stop}) on --bg", stop, bg))
        pairs.append((f".gt gradient stop #{idx} ({stop}) on --bg-2", stop, bg2))

    btn_fg = v["btn-fg"]
    for idx, stop in enumerate(extract_hex_colors(v["btn-bg"]), 1):
        pairs.append((f".btn-primary stop #{idx} ({stop})", btn_fg, stop))

    results = []
    for desc, fg, bg_col in pairs:
        ratio = contrast_ratio(fg, bg_col)
        results.append((f"[{file_label} · {theme_name}] {desc}", fg, bg_col, ratio))
    return results


def main():
    files = ["index.html", os.path.join("assets", "pages.css")]
    all_results = []

    for rel in files:
        path = os.path.join(ROOT, rel)
        with open(path, "r", encoding="utf-8") as fh:
            content = fh.read()
        dark_vars = parse_css_vars(content, ":root")
        light_vars = dict(dark_vars)
        light_vars.update(parse_css_vars(content, '[data-theme="light"]'))

        all_results.extend(check_theme_vars(rel, "dark", dark_vars))
        all_results.extend(check_theme_vars(rel, "light", light_vars))

    # Component-specific fixed stops in index.html
    component_pairs = [
        ("[index.html · both] .chat-head #fff on #095c4d", "#ffffff", "#095c4d"),
        ("[index.html · both] .chat-head #fff on #0d6e5a", "#ffffff", "#0d6e5a"),
        ("[index.html · both] .msg.out #fff on #0b6950", "#ffffff", "#0b6950"),
        ("[index.html · both] .msg.out #fff on #0f785c", "#ffffff", "#0f785c"),
        ("[index.html · dark] .row.low b (#ffa94d on #071f36)", "#ffa94d", "#071f36"),
        ("[index.html · light] .row.low b (#9a4d00 on #ffffff)", "#9a4d00", "#ffffff"),
    ]
    for desc, fg, bg_col in component_pairs:
        all_results.append((desc, fg, bg_col, contrast_ratio(fg, bg_col)))

    failures = [r for r in all_results if r[3] < MIN_AA]

    for desc, fg, bg_col, ratio in all_results:
        mark = "PASS" if ratio >= MIN_AA else "FAIL"
        print(f"  {mark}  {ratio:5.2f}:1  ({fg:7s} on {bg_col:7s})  {desc}")

    print("-" * 78)
    print(f"Checked {len(all_results)} colour pairs (WCAG 2.1 AA threshold >= {MIN_AA}:1) — "
          f"{len(all_results) - len(failures)} passed, {len(failures)} failed.")

    if failures:
        sys.exit(1)


if __name__ == "__main__":
    main()
