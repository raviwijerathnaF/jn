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
    """Merge every bare `selector { --x: y; }` block, in source order.

    A theme may be declared more than once: the Round 2 LIGHT-THEME COLOUR
    layer appends a second `[data-theme="light"]` block at the end of the
    stylesheet, and with equal specificity the later declaration wins. Reading
    only the first match would silently verify tokens the browser never uses.
    """
    pattern = re.escape(selector) + r"\s*\{([^}]*)\}"
    blocks = re.findall(pattern, text, re.S)
    if not blocks:
        raise ValueError(f"Selector {selector!r} not found")
    out = {}
    for block in blocks:
        for k, v in re.findall(r"--([\w-]+)\s*:\s*([^;}]+)", block):
            out[k.strip()] = v.strip()
    return out


def strip_css_comments(text):
    return re.sub(r"/\*.*?\*/", "", text, flags=re.S)


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

    # In the light theme .vchip sits on a tinted .vis (and steps to --green-d),
    # so it is verified by the light colour-layer pass instead of here.
    chip = ".tag.g / .vchip" if theme_name == "dark" else ".tag.g"
    pairs.append((".tag (--cyan on chip)", v["cyan"], tag_cyan_bg))
    pairs.append((f"{chip} (--green on chip)", v["green"], tag_green_bg))
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
        # Gradient headings (.gt) sit on the wash end of .sec.bg2 too, so every
        # colour stop has to clear AA there — not only on --bg / --bg-2.
        for idx, stop in enumerate(extract_hex_colors(v["grad"]), 1):
            pairs.append((f".gt gradient stop #{idx} ({stop}) on --wash", stop, wash))
            pairs.append((f".gt gradient stop #{idx} ({stop}) on --card(--wash)", stop, card_on_wash))
        pairs.append((".tag (--cyan on chip over --wash)", v["cyan"], blend_rgba_on_hex((34, 198, 232, 0.10), card_on_wash)))
        pairs.append((f"{chip} (--green on chip over --wash)", v["green"], blend_rgba_on_hex((155, 212, 74, 0.10), card_on_wash)))

    # .fw-num outlined numerals: stroke is var(--text) (was var(--line) = 1.26:1 in light theme),
    # with a var(--muted) solid-colour fallback under @supports not (-webkit-text-stroke).
    if "wash" in v:
        for surf_name, surf in (("--card(--bg-2)", card_on_bg2), ("--card(--wash)", card_on_wash)):
            pairs.append((f".fw-num stroke (--text on {surf_name})", v["text"], surf))
            pairs.append((f".fw-num @supports fallback (--muted on {surf_name})", v["muted"], surf))

        # Round 2 tinted icon chips (.g-ico 1-4 in the guarantee strip, .seo-ico) over the card surface.
        # Colours mirror the CSS in index.html; the tint alpha is blended on --card(--bg).
        if theme_name == "dark":
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


# ---------------------------------------------------------------------------
# Round 2 — LIGHT-THEME COLOUR layer
# ---------------------------------------------------------------------------
# index.html ends with a `[data-theme="light"]`-scoped colour layer that deepens
# the page and tints cards, bands, kickers, chips, the comparison table and each
# service card. Those tints are real text-bearing surfaces, so they are measured
# here — and the values are parsed out of the CSS rather than duplicated, so the
# check follows the stylesheet instead of drifting away from it.

LIGHT_LAYER_MARKER = "LIGHT-THEME COLOUR"


def light_bodies(sheet, selector):
    """Declaration bodies of every `[data-theme="light"] <selector> { ... }` rule.

    Grouped selectors are handled (the needle may be followed by a comma or a
    newline), and longer class names such as `.card-icon` are not mistaken for
    `.card`. Bodies are returned in source order so the caller can apply the
    cascade (last declaration wins).
    """
    needle = '[data-theme="light"] ' + selector
    out = []
    for m in re.finditer(re.escape(needle), sheet):
        nxt = m.end()
        ch = sheet[nxt] if nxt < len(sheet) else ""
        if ch not in (",", "{", " ", "\n", "\t", "\r"):
            continue
        brace = sheet.find("{", nxt)
        close = sheet.find("}", brace) if brace != -1 else -1
        if brace == -1 or close == -1:
            continue
        out.append(sheet[brace + 1:close])
    return out


def light_prop(sheet, selector, prop):
    """Last declared value of `prop` on `[data-theme="light"] <selector>`.

    The property name is anchored to the start of a declaration so that a search
    for `color` cannot match inside `border-color`, and `background` cannot match
    inside `background-color`.
    """
    pattern = r"(?:^|[;{])\s*" + re.escape(prop) + r"\s*:\s*([^;}]+)"
    val = None
    for body in light_bodies(sheet, selector):
        m = re.search(pattern, body)
        if m:
            val = m.group(1).strip()
    return val


def gradient_stops(value):
    return re.findall(r"#[0-9a-fA-F]{3,6}|rgba?\([^)]*\)", value)


def surface_hex(raw, base_hex):
    """Flatten a colour / rgba() / gradient to its darkest resulting surface.

    Gradients are modelled at their worst (least contrast for dark foreground)
    stop, which is the conservative end for text sitting across the element.
    """
    stops = gradient_stops(raw)
    if not stops:
        raise ValueError(f"cannot flatten colour value {raw!r} over {base_hex}")
    flat = []
    for stop in stops:
        m = re.match(r"rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)", stop)
        if m:
            alpha = 1.0 if m.group(4) is None else float(m.group(4))
            rgba = (int(float(m.group(1))), int(float(m.group(2))), int(float(m.group(3))), alpha)
            flat.append(blend_rgba_on_hex(rgba, base_hex))
        else:
            flat.append(rgb_to_hex(hex_to_rgb(stop)))
    return min(flat, key=luminance)


def check_light_colour_layer(file_label, content, v):
    """Contrast pairs for the light-only tinted surfaces introduced in Round 2."""
    if LIGHT_LAYER_MARKER not in content:
        return []

    sheet = strip_css_comments(content)

    def need(selector, prop):
        val = light_prop(sheet, selector, prop)
        if val is None:
            raise ValueError(
                f'{LIGHT_LAYER_MARKER}: [data-theme="light"] {selector} declares no {prop}')
        return val

    def resolve(val, base, scope=None):
        val = val.strip()
        m = re.fullmatch(r"var\(--([\w-]+)\)", val)
        if m:
            name = m.group(1)
            val = (scope or {}).get(name) or v.get(name)
            if val is None:
                raise ValueError(f"cannot resolve var(--{name})")
        return surface_hex(val.strip(), base)

    page, wash, bg2 = v["bg"], v["wash"], v["bg-2"]
    text_toks = ("ink", "text", "muted", "blue", "cyan", "green", "navy", "err")
    pairs = []

    # --- 1. card surface tint (#ffffff -> #f1f8ff) ---------------------------
    # The top stop is where .card-head (icon + numeral) sits, the bottom stop is
    # where body copy sits, so both are measured.
    card_stops = gradient_stops(need(".card", "background"))
    if len(card_stops) < 2:
        raise ValueError("light card surface must be a two-stop gradient")
    card_top = surface_hex(card_stops[0], page)
    card_bottom = surface_hex(card_stops[-1], page)
    for tok in text_toks:
        pairs.append((f"card tint top ({v[tok]} on {card_top})", v[tok], card_top))
        pairs.append((f"card tint bottom ({v[tok]} on {card_bottom})", v[tok], card_bottom))
    for idx, stop in enumerate(extract_hex_colors(v["grad"]), 1):
        pairs.append((f"card tint .gt stop #{idx} ({stop} on {card_bottom})", stop, card_bottom))

    # --- 2. kicker pill -----------------------------------------------------
    # The pill is translucent, so it is measured over every band a .kicker can
    # sit on: the page, the wash band, both feature bands and the card tint.
    kicker_fg = resolve(need(".kicker", "color"), page)
    kicker_tint = need(".kicker", "background")
    band_seo = resolve(need("#seo.sec.bg2", "background"), page)
    band_pricing = resolve(need("#pricing.sec.bg2", "background"), page)
    for name, base in (("--wash", wash), ("--bg", page), ("--bg-2", bg2),
                       ("#seo band", band_seo), ("#pricing band", band_pricing),
                       ("card tint", card_bottom)):
        pairs.append((f"kicker pill ({kicker_fg} on tint over {name})",
                      kicker_fg, surface_hex(kicker_tint, base)))

    # --- 3. feature bands (#seo / #pricing) ---------------------------------
    for name, band in (("#seo", band_seo), ("#pricing", band_pricing)):
        for tok in ("ink", "text", "muted"):
            pairs.append((f"{name} band ({v[tok]} on {band})", v[tok], band))
        for idx, stop in enumerate(extract_hex_colors(v["grad"]), 1):
            pairs.append((f"{name} band .gt stop #{idx} ({stop} on {band})", stop, band))

    # --- 4. inner CTA panel + comparison table head -------------------------
    cta_in = resolve(need(".cta-in", "background"), page)
    for tok in ("ink", "text", "muted"):
        pairs.append((f".cta-in ({v[tok]} on {cta_in})", v[tok], cta_in))
    head_bg = surface_hex(need(".comp-table thead th", "background"), card_bottom)
    head_fg = resolve(need(".comp-table thead th", "color"), head_bg)
    pairs.append((f".comp-table thead th ({head_fg} on {head_bg})", head_fg, head_bg))

    # --- 5. inactive filter pills -------------------------------------------
    pill_tint = need(".pill:not(.on)", "background")
    pill_hover_fg = resolve(need(".pill:not(.on):hover", "color"), page)
    for name, base in (("--wash", wash), ("--bg", page)):
        pairs.append((f".pill:not(.on) ({v['text']} on tint over {name})",
                      v["text"], surface_hex(pill_tint, base)))
        pairs.append((f".pill:not(.on):hover ({pill_hover_fg} on tint over {name})",
                      pill_hover_fg, surface_hex(pill_tint, base)))

    # --- 6. per-service accent palette --------------------------------------
    # #web blue · #social green · #whatsapp cyan · #pos navy · #gbp green.
    # Each accent drives the icon chip and the outlined numeral; --a-soft tints
    # the .vis panel that the in-panel chips sit on.
    chip_fg = {"green": resolve(need(".vchip", "color"), page),
               "blue": resolve(need(".vchip.l", "color"), page)}
    chip_tint = {"green": need(".vchip", "background"),
                 "blue": need(".vchip.l", "background")}
    vis_on = {"#web": ("green", ".speed"), "#social": ("green", ".vchip"), "#pos": ("blue", ".vchip.l")}

    for card_id in ("#web", "#social", "#whatsapp", "#pos", "#gbp"):
        body = " ".join(light_bodies(sheet, card_id))
        scope = {}
        for var in ("a", "a-soft", "a-line"):
            m = re.search(r"(?:^|[;{])\s*--" + var + r"\s*:\s*([^;}]+)", body)
            if not m:
                raise ValueError(f'{LIGHT_LAYER_MARKER}: {card_id} declares no --{var}')
            scope[var] = m.group(1).strip()

        accent = resolve("var(--a)", card_top, scope)
        soft_over_top = resolve("var(--a-soft)", card_top, scope)
        soft_over_bottom = resolve("var(--a-soft)", card_bottom, scope)

        pairs.append((f"{card_id} .card-icon ({accent} on {soft_over_top})", accent, soft_over_top))

        stroke = need(".card-num", "-webkit-text-stroke")
        m = re.match(r"([\d.]+)px\s+(.+)$", stroke.strip())
        if not m:
            raise ValueError(f".card-num stroke is not parseable: {stroke!r}")
        if m.group(1) != "1.6":
            raise ValueError(f".card-num stroke should be 1.6px, got {m.group(1)}px")
        num_colour = resolve(m.group(2), card_top, scope)
        for name, base in (("card tint top", card_top), ("card tint bottom", card_bottom)):
            pairs.append((f"{card_id} .card-num stroke ({num_colour} on {name})", num_colour, base))

        # Only the cards that put text/chips straight on the .vis wash are
        # measured there; the others give their content its own background.
        if card_id == "#pos":
            pairs.append((f"{card_id} .vis (.row {v['ink']} on {soft_over_bottom})", v["ink"], soft_over_bottom))
            pairs.append((f"{card_id} .vis (.row.low b #9a4d00 on {soft_over_bottom})", "#9a4d00", soft_over_bottom))
        if card_id in vis_on:
            kind, chip_sel = vis_on[card_id]
            chip_bg = surface_hex(chip_tint[kind], soft_over_bottom)
            pairs.append((f"{card_id} .vis {chip_sel} ({chip_fg[kind]} on {chip_bg})", chip_fg[kind], chip_bg))

    # --- 7. tinted icon chips over the new card gradient --------------------
    # .g-ico 1-4 and .seo-ico were previously blended on --card; the card
    # surface is now a gradient, so re-measure them on its deepest stop. The
    # label colour is read out of the stylesheet (a light-scoped override may
    # deepen it), falling back to the theme token when there is no override.
    chip_rules = (
        (".g-ico blue", ".g-item:nth-child(1) .g-ico", "blue", (14, 107, 168, .10)),
        (".g-ico green", ".g-item:nth-child(2) .g-ico", "green", (58, 118, 8, .10)),
        (".g-ico cyan", ".g-item:nth-child(3) .g-ico", "cyan", (10, 114, 150, .10)),
        (".g-ico navy", ".g-item:nth-child(4) .g-ico", "navy", (8, 58, 99, .09)),
        (".seo-ico cyan", ".seo-ico", "cyan", (34, 198, 232, .10)),
    )
    for name, sel, tok, rgba in chip_rules:
        raw = light_prop(sheet, sel, "color")
        fg = resolve(raw, card_bottom) if raw else v[tok]
        chip = blend_rgba_on_hex(rgba, card_bottom)
        pairs.append((f"{name} tint on card gradient ({fg} on {chip})", fg, chip))

    return [(f"[{file_label} · light-tint] {desc}", fg, bg, contrast_ratio(fg, bg))
            for desc, fg, bg in pairs]


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
        all_results.extend(check_light_colour_layer(rel, content, light_vars))

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
