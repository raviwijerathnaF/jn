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
    """Collect --tokens from every `selector { ... }` block; later blocks override
    earlier ones, exactly like the cascade (index.html re-declares the light
    tokens in its LIGHT-THEME COLOUR block at the end of <style>)."""
    pattern = re.escape(selector) + r"\s*\{([^}]+)\}"
    blocks = re.findall(pattern, text, re.S)
    if not blocks:
        raise ValueError(f"Selector {selector!r} not found")
    out = {}
    for block in blocks:
        for k, v in re.findall(r"--([\w-]+)\s*:\s*([^;]+);", block):
            out[k.strip()] = v.strip()
    return out


def css_pick(text, pattern, what):
    """Return the first capture group of `pattern` in the CSS, or fail loudly so
    the verifier can never silently drift away from the stylesheet."""
    m = re.search(pattern, text, re.S)
    if not m:
        raise ValueError(f"index.html is missing the CSS for {what}")
    return m.groups() if len(m.groups()) > 1 else m.group(1)


def rgba_of(val):
    m = re.match(r"rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)", val.strip())
    if not m:
        raise ValueError(f"not an rgba() value: {val!r}")
    return (int(m.group(1)), int(m.group(2)), int(m.group(3)), float(m.group(4)))


def extract_hex_colors(val):
    return re.findall(r"#[0-9a-fA-F]{3,6}", val)


def resolve_card_bg(card_val, base_bg):
    m = re.match(r"rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)", card_val)
    if m:
        rgba = (int(m.group(1)), int(m.group(2)), int(m.group(3)), float(m.group(4)))
        return blend_rgba_on_hex(rgba, base_bg)
    return card_val


def light_tint_pairs(v, css):
    """Contrast pairs for the light-theme colour layer in index.html."""
    pairs = []
    ink, text, muted = v["ink"], v["text"], v["muted"]
    cyan, green, blue, navy = v["cyan"], v["green"], v["blue"], v["navy"]
    cyan_ink = v["cyan-ink"]   # light-only darker cyan for text on tinted pills / chips
    body = (("ink", ink), ("text", text), ("muted", muted))
    stops = extract_hex_colors(v["grad"])

    # card tint: linear-gradient(180deg,#ffffff,#f1f8ff)
    card_top, card_bot = css_pick(
        css, r'\[data-theme="light"\] \.p-tier:not\(\.featured\)\{background:linear-gradient\(180deg,(#[0-9a-fA-F]{6}),(#[0-9a-fA-F]{6})\)\}', "light card gradient")
    for surf in (card_top, card_bot):
        for name, fg in body + (("cyan", cyan), ("green", green), ("err", v["err"])):
            pairs.append((f"light card tint: --{name} on {surf}", fg, surf))
        for idx, stop in enumerate(stops, 1):
            pairs.append((f"light card tint: .gt stop #{idx} ({stop}) on {surf}", stop, surf))
        pairs.append((f"light card tint: .tag (--cyan on chip over {surf})", cyan, blend_rgba_on_hex((34, 198, 232, .10), surf)))
        pairs.append((f"light card tint: .tag.g (--green on chip over {surf})", green, blend_rgba_on_hex((155, 212, 74, .10), surf)))

    # section washes (#seo, #pricing): linear-gradient(180deg,<tint>,var(--bg-2) 45%)
    for sec in ("seo", "pricing"):
        tint = css_pick(css, r'\[data-theme="light"\] #%s\.sec\.bg2\{background:linear-gradient\(180deg,(#[0-9a-fA-F]{6})' % sec, f"#{sec} band")
        for name, fg in body + (("cyan", cyan), ("green", green)):
            pairs.append((f"#{sec} wash {tint}: --{name} on band start", fg, tint))
        for idx, stop in enumerate(stops, 1):
            pairs.append((f"#{sec} wash {tint}: .gt stop #{idx} ({stop})", stop, tint))
        # white-ish card sitting on the band, and the kicker pill on the band
        pairs.append((f"#{sec} wash {tint}: .kicker pill (--cyan-ink)", cyan_ink, blend_rgba_on_hex(rgba_of("rgba(14,107,168,.09)"), tint)))

    # kicker pill: rgba(14,107,168,.09) on every surface a .section-head can sit on
    pill = rgba_of(css_pick(css, r'\[data-theme="light"\] \.kicker\{color:var\(--cyan-ink\);background:(rgba\([^)]*\))', ".kicker pill"))
    for sname in ("bg", "bg-2", "wash"):
        surf = v[sname]
        pairs.append((f".kicker pill (--cyan-ink on pill over --{sname})", cyan_ink, blend_rgba_on_hex(pill, surf)))
    pairs.append((".kicker pill (--cyan-ink on pill over card tint)", cyan_ink, blend_rgba_on_hex(pill, card_bot)))

    # .cta-in band: linear-gradient(135deg,#eaf3fb,#e8f5e4)
    cta = css_pick(css, r'\[data-theme="light"\] \.cta-in\{background:linear-gradient\(135deg,(#[0-9a-fA-F]{6}),(#[0-9a-fA-F]{6})\)', ".cta-in tint")
    for surf in cta:
        for name, fg in body + (("cyan", cyan), ("green", green)):
            pairs.append((f".cta-in tint: --{name} on {surf}", fg, surf))
        for idx, stop in enumerate(stops, 1):
            pairs.append((f".cta-in tint: .gt stop #{idx} ({stop}) on {surf}", stop, surf))

    # comp-table header + idle pill
    th = css_pick(css, r'\[data-theme="light"\] \.comp-table thead th\{background:(#[0-9a-fA-F]{6})', ".comp-table thead th")
    pairs.append((".comp-table thead th (--ink on tint)", ink, th))
    pill_bg = css_pick(css, r'\[data-theme="light"\] \.pill:not\(\.on\)\{background:(#[0-9a-fA-F]{6})', ".pill:not(.on)")
    pairs.append((".pill:not(.on) (--text on tint)", text, pill_bg))
    pairs.append((".pill:not(.on) (--ink on tint, hover)", ink, pill_bg))

    # per-service palette -> .card-icon chip and .vis panel, over the card tint
    palette = {"web": blue, "social": green, "whatsapp": cyan_ink, "pos": navy, "gbp": green}
    for svc, fg in palette.items():
        a_fg, a_soft = css_pick(
            css, r'\[data-theme="light"\] #%s\{--a:var\(--([\w-]+)\);--a-soft:(rgba\([^)]*\))' % svc, f"#{svc} palette")
        assert v[a_fg] == fg, f"#{svc} palette drifted from the expected --{a_fg} token"
        chip = blend_rgba_on_hex(rgba_of(a_soft), card_bot)
        pairs.append((f".card-icon #{svc} (--{a_fg} on chip over card tint)", v[a_fg], chip))
        for name, tok in body:
            pairs.append((f".vis #{svc} tint: --{name} on panel", tok, chip))
        pairs.append((f".card-num stroke #{svc} (--{a_fg} on card tint, 3:1 large-graphic)", v[a_fg], card_bot))

    # guarantee-strip icon chips and the SEO icon chip over the lower card tint
    for i, (fg_tok, rgba) in enumerate(((blue, (14, 107, 168, .10)), (green, (58, 118, 8, .10)),
                                        (cyan_ink, (10, 114, 150, .10)), (navy, (8, 58, 99, .09))), 1):
        pairs.append((f".g-ico {i} chip ({fg_tok} on chip over card tint)", fg_tok, blend_rgba_on_hex(rgba, card_bot)))
    pairs.append((".seo-ico (--cyan-ink on chip over card tint)", cyan_ink, blend_rgba_on_hex((34, 198, 232, .10), card_bot)))
    return pairs


def check_theme_vars(file_label, theme_name, v, css=""):
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

    # Round 2: sections use a --wash -> --bg-2 gradient (.sec.bg2). Text must stay
    # legible on the wash end (darkest/most-tinted) as well as on --bg-2.
    if "wash" in v:
        wash = v["wash"]
        card_on_wash = resolve_card_bg(v["card"], wash)
        for tok in ("ink", "text", "muted", "cyan", "green", "err"):
            pairs.append((f"--{tok} on --wash (.sec.bg2 gradient start)", v[tok], wash))
            pairs.append((f"--{tok} on --card(--wash)", v[tok], card_on_wash))
        pairs.append((".tag (--cyan on chip over --wash)", v["cyan"], blend_rgba_on_hex((34, 198, 232, 0.10), card_on_wash)))
        pairs.append((".tag.g / .vchip (--green on chip over --wash)", v["green"], blend_rgba_on_hex((155, 212, 74, 0.10), card_on_wash)))

        # Every .gt gradient stop must also clear AA on the --wash band (.sec.bg2 start).
        for idx, stop in enumerate(extract_hex_colors(v["grad"]), 1):
            pairs.append((f".gt gradient stop #{idx} ({stop}) on --wash", stop, wash))

    # Round 2 LIGHT-THEME COLOUR layer (index.html only): every tint introduced by the
    # [data-theme="light"] block is read back out of the CSS and checked here.
    if file_label == "index.html" and theme_name == "light":
        pairs.extend(light_tint_pairs(v, css))

    # .fw-num outlined numerals: stroke is var(--text) (was var(--line) = 1.26:1 in light theme),
    # with a var(--muted) solid-colour fallback under @supports not (-webkit-text-stroke).
    if "wash" in v:
        for surf_name, surf in (("--card(--bg-2)", card_on_bg2), ("--card(--wash)", card_on_wash)):
            pairs.append((f".fw-num stroke (--text on {surf_name})", v["text"], surf))
            pairs.append((f".fw-num @supports fallback (--muted on {surf_name})", v["muted"], surf))

        # Round 2 tinted icon chips (.g-ico 1-4 in the guarantee strip, .seo-ico) over the card surface.
        # Colours mirror the CSS in index.html; the tint alpha is blended on --card(--bg).
        if v["bg"].lower() == "#04172a":      # dark theme
            ico = [("blue", "#5eb3ea", (14, 107, 168, .22)), ("green", v["green"], (155, 212, 74, .12)),
                   ("cyan", v["cyan"], (34, 198, 232, .12)), ("navy", "#8fb8dc", (8, 58, 99, .45))]
        else:                                  # light theme
            ico = [("blue", v["blue"], (14, 107, 168, .10)), ("green", v["green"], (58, 118, 8, .10)),
                   ("cyan", v["cyan"], (10, 114, 150, .10)), ("navy", v["navy"], (8, 58, 99, .09))]
        for name, fg, rgba in ico:
            pairs.append((f".g-ico {name} tint ({fg} on chip over --card(--bg))", fg, blend_rgba_on_hex(rgba, card_on_bg)))
        pairs.append((".seo-ico (--cyan on chip over --card(--bg-2))", v["cyan"], tag_cyan_bg))

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

        all_results.extend(check_theme_vars(rel, "dark", dark_vars, content))
        all_results.extend(check_theme_vars(rel, "light", light_vars, content))

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
