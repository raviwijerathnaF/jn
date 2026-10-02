#!/usr/bin/env node
/**
 * OmniFlow Digital — Automated Site Verification Suite
 * ====================================================
 *
 * Zero-dependency Node.js test runner that validates:
 *   1. File & asset presence + PNG dimensions
 *   2. HTML head metadata, Open Graph, Twitter cards, favicons & PWA manifest
 *   3. Schema.org JSON-LD graph & FAQ parity with the DOM
 *   4. Internal links, in-page #anchors, legal.html#anchors & SVG <use> symbols
 *   5. Accessibility landmarks, ARIA wiring, form controls & noscript fallback
 *   6. Testimonials section (present and OFF by default) + analytics placeholder
 *   7. _headers security & caching rules, robots.txt & sitemap.xml
 *   8. JavaScript syntax compilation for every inline <script> block
 *   9. WCAG 2.1 AA colour contrast across dark & light themes (check-contrast.py)
 *
 * Usage (from repository root):
 *   node tools/test-site.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}\n        -> ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function pngSize(rel) {
  const buf = fs.readFileSync(path.join(ROOT, rel));
  assert(buf.slice(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${rel} is not a valid PNG`);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/** Merge every `selector{...}` token block, later blocks override earlier ones (cascade order). */
function cssTokens(html, selector) {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'g');
  const out = {};
  let m;
  while ((m = re.exec(html)) !== null) {
    for (const t of m[1].matchAll(/--([\w-]+)\s*:\s*([^;}]+)/g)) out[t[1]] = t[2].trim();
  }
  return out;
}

/** WCAG relative luminance (0 = black, 1 = white) of a #rgb / #rrggbb colour. */
function luminance(hex) {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  assert(/^[0-9a-f]{6}$/i.test(h), `"${hex}" is not a hex colour`);
  const [r, g, b] = [0, 2, 4].map(i => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function collectIds(html) {
  const ids = new Set();
  const re = /\bid\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) ids.add(m[1]);
  return ids;
}

const indexHtml = read('index.html');
const legalHtml = read('legal.html');
const err404Html = read('404.html');
const caseStudiesHtml = read('case-studies.html');
const pagesCss = read('assets/pages.css');
const servicesHtml = read('services.html');
const headersTxt = read('_headers');
const sitemapXml = read('sitemap.xml');
const robotsTxt = read('robots.txt');
const manifestJson = JSON.parse(read('site.webmanifest'));

console.log('OmniFlow Digital — running verification checks...\n');

/* 1. Files & image dimensions */
const REQUIRED_FILES = [
  'index.html', 'legal.html', '404.html', 'case-studies.html', 'services.html', 'assets/pages.css', '_headers',
  'README.md', 'robots.txt', 'sitemap.xml', 'site.webmanifest',
  'logo.svg', 'logo.png', 'favicon.ico', 'favicon-16.png', 'favicon-32.png',
  'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png',
  'og-banner.png', 'tools/make-assets.py', 'tools/check-contrast.py', 'tools/test-site.js',
  'tools/palette-preview.html'
];

check('All required repository files exist and are non-empty', () => {
  for (const f of REQUIRED_FILES) {
    const p = path.join(ROOT, f);
    assert(fs.existsSync(p), `Missing file: ${f}`);
    assert(fs.statSync(p).size > 0, `Empty file: ${f}`);
  }
});

const EXPECTED_PNGS = {
  'logo.png': [512, 512],
  'favicon-16.png': [16, 16],
  'favicon-32.png': [32, 32],
  'apple-touch-icon.png': [180, 180],
  'icon-192.png': [192, 192],
  'icon-512.png': [512, 512],
  'icon-maskable-512.png': [512, 512],
  'og-banner.png': [1200, 630]
};

check('Generated PNG icons and OG banner have exact dimensions', () => {
  for (const [file, [ew, eh]] of Object.entries(EXPECTED_PNGS)) {
    const { w, h } = pngSize(file);
    assert(w === ew && h === eh, `${file} expected ${ew}x${eh}, got ${w}x${h}`);
  }
});

/* 2. Head metadata, SEO, Open Graph & PWA */
check('index.html has complete SEO, Open Graph, Twitter card and theme-color tags', () => {
  assert(/<!DOCTYPE html>/i.test(indexHtml), 'Missing DOCTYPE');
  assert(/<html[^>]+lang="en"/i.test(indexHtml), 'Missing lang="en"');
  assert(/<link rel="canonical" href="https:\/\/yourdomain\.com\/"/.test(indexHtml), 'Missing canonical link');
  assert(/<meta property="og:image" content="https:\/\/yourdomain\.com\/og-banner\.png"/.test(indexHtml), 'Missing og:image');
  assert(/<meta property="og:image:width" content="1200"/.test(indexHtml), 'Missing og:image:width');
  assert(/<meta property="og:image:height" content="630"/.test(indexHtml), 'Missing og:image:height');
  assert(/<meta name="twitter:card" content="summary_large_image"/.test(indexHtml), 'Missing twitter:card');
  const tc = indexHtml.match(/<meta name="theme-color"[^>]+>/g) || [];
  assert(tc.length === 2, `Expected 2 theme-color metas, found ${tc.length}`);
});

check('site.webmanifest is valid JSON and all referenced icons exist', () => {
  assert(manifestJson.name === 'OmniFlow Digital', 'Unexpected manifest name');
  assert(Array.isArray(manifestJson.icons) && manifestJson.icons.length >= 4, 'Missing manifest icons');
  for (const ic of manifestJson.icons) {
    assert(fs.existsSync(path.join(ROOT, ic.src)), `Manifest icon missing: ${ic.src}`);
  }
});

check('robots.txt and sitemap.xml are properly configured', () => {
  assert(/Sitemap:\s*https:\/\/yourdomain\.com\/sitemap\.xml/.test(robotsTxt), 'robots.txt missing Sitemap');
  assert(sitemapXml.includes('<loc>https://yourdomain.com/</loc>'), 'sitemap.xml missing root URL');
  assert(sitemapXml.includes('<loc>https://yourdomain.com/legal.html</loc>'), 'sitemap.xml missing legal.html');
  assert(sitemapXml.includes('<loc>https://yourdomain.com/case-studies.html</loc>'), 'sitemap.xml missing case-studies.html');
  assert(/<loc>https:\/\/yourdomain\.com\/case-studies\.html<\/loc>[\s\S]*?<priority>0\.8<\/priority>/.test(sitemapXml), 'case-studies.html should have sitemap priority 0.8');
  assert(!sitemapXml.includes('404.html'), 'sitemap.xml should not list 404.html');
});

/* 3. JSON-LD structured data */
check('index.html JSON-LD parses cleanly and FAQPage matches the DOM FAQs (count and order)', () => {
  const m = indexHtml.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/);
  assert(m, 'Missing JSON-LD script block');
  const data = JSON.parse(m[1]);
  assert(Array.isArray(data['@graph']) && data['@graph'].length === 4, 'Expected 4 nodes in @graph');
  const faqNode = data['@graph'].find(n => n['@type'] === 'FAQPage');
  assert(faqNode && Array.isArray(faqNode.mainEntity), 'FAQPage node with mainEntity array is missing');
  const domSummaries = [...indexHtml.matchAll(/<summary>([^<]+)<span/g)].map(x => x[1].trim());
  assert(domSummaries.length > 0, 'No <summary> FAQ elements found in index.html');
  assert(faqNode.mainEntity.length === domSummaries.length,
    `FAQPage schema has ${faqNode.mainEntity.length} questions but the DOM has ${domSummaries.length} <summary> elements`);
  faqNode.mainEntity.forEach((q, idx) => {
    assert(q.name === domSummaries[idx], `FAQ #${idx + 1} mismatch: "${q.name}" vs "${domSummaries[idx]}"`);
  });
  // Answers must match too (schema text vs. visible answer)
  const domAnswers = [...indexHtml.matchAll(/<div class="ans">([\s\S]*?)<\/div>/g)].map(x => x[1].trim().replace(/&amp;/g, '&'));
  assert(domAnswers.length === domSummaries.length, 'Each FAQ <summary> needs exactly one .ans answer');
  faqNode.mainEntity.forEach((q, idx) => {
    assert(q.acceptedAnswer.text.replace(/&amp;/g, '&') === domAnswers[idx], `FAQ #${idx + 1} answer differs between JSON-LD and DOM`);
  });
});

check('FAQ #6 answers "Will my website show up on Google?" honestly (no #1 promise) and contracts is #7', () => {
  const domSummaries = [...indexHtml.matchAll(/<summary>([^<]+)<span/g)].map(x => x[1].trim());
  assert(domSummaries[5] === 'Will my website show up on Google?', 'FAQ #6 should be "Will my website show up on Google?"');
  assert(domSummaries[6] === 'Are there long-term contracts?', 'FAQ #7 should be "Are there long-term contracts?"');
  assert(/Nobody honest can promise a #1 position/.test(indexHtml), 'FAQ #6 answer must disclaim any #1 promise');
});

check('Local SEO section #seo sits between #services and #work with 3 cards and a preselecting CTA', () => {
  const iServices = indexHtml.indexOf('id="services"');
  const iSeo = indexHtml.indexOf('<section class="sec bg2 glow" id="seo">');
  const iWork = indexHtml.indexOf('id="work"');
  assert(iServices > -1 && iSeo > iServices && iWork > iSeo, '#seo must come after #services and before #work');
  const block = indexHtml.slice(iSeo, indexHtml.indexOf('</section>', iSeo));
  assert((block.match(/<article class="seo-card/g) || []).length === 3, '#seo needs exactly 3 .seo-card articles');
  assert(block.includes('class="seo-grid"'), '#seo needs a .seo-grid');
  assert(/<a href="#contact"[^>]*data-interest="Google Business Profile Optimization"[^>]*>Check My Google Visibility/.test(block), '#seo CTA must point to #contact with the GBP data-interest');
  const mega = indexHtml.slice(indexHtml.indexOf('class="mega"'), indexHtml.indexOf('</div>', indexHtml.indexOf('class="mega"')));
  assert(/<a href="#seo">[\s\S]*Local SEO[\s\S]*Get found on Google/.test(mega), 'Services dropdown needs a Local SEO / "Get found on Google" link to #seo');
  assert(!/#1 on Google|number one|guarantee(d)? (rank|top)|top of google/i.test(block), '#seo must not promise rankings');
  assert(!/\d+\s*%/.test(block), '#seo must not contain percentages');
  assert(/@media \(max-width:900px\)\{\.seo-grid\{grid-template-columns:1fr\}\}/.test(indexHtml), 'Missing 900px single-column rule for .seo-grid');
});

/* The services grid must show one card per service offered, and the
   headline count must match (6 services = 6 cards = 3 + 3 on desktop). */
check('Services grid shows six cards (Local SEO included) in a uniform 3 + 3 desktop layout', () => {
  const svcBlock = indexHtml.slice(indexHtml.indexOf('<div class="bento">'), indexHtml.indexOf('<!-- Audit banner -->'));
  const svcCards = [...svcBlock.matchAll(/<article class="card[^"]*" id="([a-z-]+)"/g)].map(m => m[1]);
  assert(svcCards.length === 6, `Expected 6 service cards, found ${svcCards.length} (${svcCards.join(', ')})`);
  assert(svcCards.includes('localseo'), 'Missing the Local SEO service card');
  assert(/@media \(min-width:1101px\)\{\s*\.bento \.card/.test(indexHtml),
    'Desktop services grid rule is missing — cards would fall back to the 7/5 mosaic');
  assert(indexHtml.includes('<h2>Six Services.'), 'Services heading still says Five Services');
  for (const id of svcCards) {
    assert(indexHtml.includes(`href="services.html#${id}"`), `Card #${id} does not link to its own services.html#${id} page`);
    assert(new RegExp(`href="services.html#${id}"[^>]*>|href="services.html#${id}"`).test(indexHtml), `Card #${id} detail link missing`);
  }
});

/* Each service must be explained on its own page section, with an honest scope
   note and a call to action — the "what is the benefit" promise from the cards. */
check('services.html explains all six services with scope, deliverables and CTAs', () => {
  const canonical = servicesHtml.match(/<link rel="canonical" href="https:\/\/yourdomain\.com\/services\.html">/);
  assert(canonical, 'services.html needs its own canonical URL');
  const svcIds = collectIds(servicesHtml);   // hoisted helper — this check runs before section 4
  for (const id of ['web', 'social', 'whatsapp', 'pos', 'gbp', 'localseo']) {
    assert(svcIds.has(id), `services.html is missing the #${id} section`);
    const card = servicesHtml.match(new RegExp(`<article[^>]+id="${id}"[\\s\\S]*?<\\/article>`));
    assert(card, `services.html #${id} is not an <article>`);
    for (const part of ['What is slowing you down', 'What we build', 'What you get', 'What gets built', 'blueprint-note']) {
      assert(card[0].includes(part), `services.html #${id} is missing "${part}"`);
    }
    assert((card[0].match(/<li>/g) || []).length === 6, `services.html #${id} must list exactly six deliverables`);
    assert(/href="index\.html\?interest=[^"]+#contact"/.test(card[0]), `services.html #${id} needs a quote CTA that prefills the form`);
    assert(/href="https:\/\/wa\.me\/\d+\?text=/.test(card[0]), `services.html #${id} needs a pre-filled WhatsApp CTA`);
    assert(!/#1 on Google|guarantee(d)? (rank|top)|top of google/i.test(card[0]), `services.html #${id} must not promise rankings`);
  }
  assert(servicesHtml.includes('href="assets/pages.css"'), 'services.html must reuse assets/pages.css');
  assert(servicesHtml.includes('<h1>') && servicesHtml.includes('class="subnav"'), 'services.html needs an h1 and the service subnav');
  const ld = servicesHtml.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>\s*<\/body>/);
  assert(ld, 'services.html needs its BreadcrumbList JSON-LD before </body>');
  const d = JSON.parse(ld[1]);
  assert(d['@type'] === 'BreadcrumbList' && d.itemListElement.length === 3, 'services.html BreadcrumbList needs 3 items');
  assert(d.itemListElement[1].item === 'https://yourdomain.com/services.html', 'Breadcrumb #2 should be services.html');
  assert(sitemapXml.includes('<loc>https://yourdomain.com/services.html</loc>'), 'sitemap.xml is missing services.html');

  /* The quote CTAs hop back to index.html?interest=<service>#contact — every one of
     those targets must exist as an <option> in the real contact form (decoded). */
  const decode = v => v.replace(/&amp;/g, '&').replace(/&#38;/g, '&');
  const formOptions = [...indexHtml.matchAll(/<option value="([^"]+)"/g)].map(m => decode(m[1]));
  const prefills = [...servicesHtml.matchAll(/index\.html\?interest=([^"#]+)#contact/g)].map(m => decodeURIComponent(m[1]));
  assert(prefills.length === 6, `expected 6 prefill CTAs on services.html, found ${prefills.length}`);
  for (const wanted of prefills) {
    assert(formOptions.includes(wanted), `services.html CTA prefills "${wanted}", which is not an option in the contact form`);
  }
});

check('Light-theme depth tokens, brand bars and readable .fw-num stroke are present', () => {
  assert(/:root\{[^}]*--wash:#0a2740;/.test(indexHtml), 'Dark --wash token missing');
  assert(/\[data-theme="light"\]\{[^}]*--wash:#[0-9a-f]{6};/i.test(indexHtml), 'Light --wash token missing');
  assert(indexHtml.includes('.sec.bg2{background:linear-gradient(180deg,var(--wash),var(--bg-2) 42%)}'), '.sec.bg2 wash gradient missing');
  assert(indexHtml.includes('.section-head h2::after{'), '.section-head h2::after accent missing');
  assert(/\.fw-card::before\{[^}]*height:4px[^}]*opacity:\.55/.test(indexHtml), '.fw-card::before 4px bar missing');
  assert(/\.p-tier::before\{[^}]*height:4px[^}]*opacity:\.55/.test(indexHtml), '.p-tier::before 4px bar missing');
  assert(/\.fw-num\{[^}]*-webkit-text-stroke:1\.6px var\(--text\)/.test(indexHtml), '.fw-num stroke must be 1.6px var(--text)');
  assert(indexHtml.includes('@supports not (-webkit-text-stroke:1px #000){.fw-num{color:var(--muted)}}'), '.fw-num @supports fallback missing');
  assert(indexHtml.includes('.step .num{border-color:rgba(14,107,168,.32)}'), '.step .num border tint missing');
  for (let i = 1; i <= 4; i++) assert(indexHtml.includes(`.g-item:nth-child(${i}) .g-ico`), `.g-item:nth-child(${i}) .g-ico tint missing`);
});

check('Light-theme colour layer: luminance-checked tokens, light-only rules, tinted cards, bands, pills and per-service palette', () => {
  const light = cssTokens(indexHtml, '[data-theme="light"]');
  const dark = cssTokens(indexHtml, ':root');
  // Tokens are judged by measured luminance, not by their hex prefix: any deep tint passes, an inverted (dark) theme fails.
  for (const tok of ['bg', 'bg-2', 'wash']) {
    assert(light[tok], `Light --${tok} token missing`);
    const L = luminance(light[tok]);
    assert(L >= 0.6, `Light --${tok} (${light[tok]}) has luminance ${L.toFixed(2)} — a light theme needs >= 0.6`);
  }
  assert(luminance(dark.bg) < 0.1, `Dark --bg (${dark.bg}) must stay dark`);
  assert(light.line && light.aurora !== undefined, 'Light --line / --aurora tokens missing');

  // The block itself: present, last in <style>, and every selector is [data-theme="light"]-prefixed.
  const marker = indexHtml.indexOf('LIGHT-THEME COLOUR');
  assert(marker > -1, 'LIGHT-THEME COLOUR block is missing');
  const start = indexHtml.lastIndexOf('/*', marker);
  const end = indexHtml.indexOf('</style>', start);
  assert(end > -1 && !indexHtml.slice(start, end).includes('@media'), 'LIGHT-THEME COLOUR must be the last block in <style>');
  const css = indexHtml.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '');
  const body = css;
  let rules = 0;
  for (const rule of body.split('}')) {
    if (!rule.includes('{')) continue;
    for (const sel of rule.slice(0, rule.indexOf('{')).split(',')) {
      assert(sel.trim().startsWith('[data-theme="light"]'), `Unscoped rule in the light colour block (would leak into dark): "${sel.trim()}"`);
    }
    rules++;
  }
  assert(rules >= 20, `Light colour block looks truncated (${rules} rules)`);

  for (const sel of ['.card', '.case-card', '.vs-card', '.fw-card', '.seo-card', '.next-step', '.g-item', '.kpi', '.c-card', '.form-card', '.p-tier:not(.featured)']) {
    assert(css.includes(`[data-theme="light"] ${sel}`), `Light card tint missing for ${sel}`);
  }
  assert(css.includes('background:linear-gradient(180deg,#ffffff,#f1f8ff)') && css.includes('border-color:#d5e6f6'), 'Card tint gradient / border-color missing');
  assert(css.includes('#seo.sec.bg2{background:linear-gradient(180deg,#e3f4fb,var(--bg-2) 45%)}'), '#seo band missing');
  assert(css.includes('#pricing.sec.bg2{background:linear-gradient(180deg,#e8f5e4,var(--bg-2) 45%)}'), '#pricing band missing');
  assert(/\.kicker\{[^}]*background:rgba\(14,107,168,\.09\);border:1px solid rgba\(14,107,168,\.18\);padding:\.38rem \.9rem;border-radius:999px/.test(css), 'Kicker pill missing');
  assert(/\.kicker::before,\s*\[data-theme="light"\] \.kicker::after\{display:none\}/.test(css), 'Kicker ::before/::after must be hidden in light');
  const palette = { web: 'blue', social: 'green', whatsapp: 'cyan-ink', pos: 'navy', gbp: 'green' };
  for (const [id, tok] of Object.entries(palette)) {
    assert(new RegExp(`\\[data-theme="light"\\] #${id}\\{--a:var\\(--${tok}\\);--a-soft:[^;]+;--a-line:[^}]+\\}`).test(css), `#${id} palette (--a/--a-soft/--a-line → ${tok}) missing`);
  }
  assert(/\.card-icon\{[^}]*var\(--a/.test(css) && /\.card-num\{-webkit-text-stroke:1\.6px var\(--a/.test(css) && /\.vis\{[^}]*var\(--a-soft/.test(css), '.card-icon/.card-num/.vis must consume the --a palette');
  assert(/\[data-theme="light"\] #localseo\{--a:#8a4b00;--a-soft:rgba\(138,75,0,\.20\);--a-line:rgba\(138,75,0,\.5\)\}/.test(css), '#localseo amber palette (--a/--a-soft/--a-line) missing');
  assert(css.includes('[data-theme="light"] .sres .ic{color:var(--cyan-ink)}') && css.includes('[data-theme="light"] .sbar::before{border-color:var(--cyan-ink)}'),
    'Local-search mock glyphs must switch to --cyan-ink in the light theme');
  assert(/\.comp-table thead th\{background:#/.test(css) && /\.cta-in\{background:/.test(css) && /\.pill:not\(\.on\)\{background:/.test(css), 'comp-table head, .cta-in and .pill:not(.on) tints missing');
  // Dark theme must not have picked up any of the new light tokens.
  assert(!dark['cyan-ink'] && !dark.a, 'Dark :root must not receive the light-only colour tokens');
  assert(dark.bg.toLowerCase() === '#04172a' && dark['bg-2'].toLowerCase() === '#071f36' && dark.wash.toLowerCase() === '#0a2740', 'Dark tokens must be unchanged');
});

check('case-studies.html has a BreadcrumbList JSON-LD (Home → Solution Blueprints) before </body>', () => {
  const m = caseStudiesHtml.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>\s*<\/body>/);
  assert(m, 'BreadcrumbList JSON-LD must sit right before </body>');
  const d = JSON.parse(m[1]);
  assert(d['@type'] === 'BreadcrumbList' && d.itemListElement.length === 2, 'BreadcrumbList needs 2 items');
  assert(d.itemListElement[0].name === 'Home' && d.itemListElement[0].item === 'https://yourdomain.com/', 'Breadcrumb #1 should be Home');
  assert(d.itemListElement[1].name === 'Solution Blueprints' && d.itemListElement[1].item === 'https://yourdomain.com/case-studies.html', 'Breadcrumb #2 should be Solution Blueprints');
});

/* 4. Internal links, anchors & SVG symbols */
const indexIds = collectIds(indexHtml);
const legalIds = collectIds(legalHtml);
const errIds = collectIds(err404Html);
const caseStudiesIds = collectIds(caseStudiesHtml);
const servicesIds = collectIds(servicesHtml);

check('All in-page #anchor links and cross-page links resolve to real targets', () => {
  const pages = [
    { name: 'index.html', html: indexHtml, ids: indexIds },
    { name: 'legal.html', html: legalHtml, ids: legalIds },
    { name: '404.html', html: err404Html, ids: errIds },
    { name: 'case-studies.html', html: caseStudiesHtml, ids: caseStudiesIds },
    { name: 'services.html', html: servicesHtml, ids: servicesIds }
  ];
  for (const p of pages) {
    const hrefs = [...p.html.matchAll(/\bhref="([^"]+)"/g)].map(x => x[1]);
    for (const h of hrefs) {
      if (h === '#' || h.startsWith('http://') || h.startsWith('https://') || h.startsWith('mailto:') || h.startsWith('tel:')) continue;
      if (h.startsWith('#')) {
        const id = h.slice(1);
        assert(p.ids.has(id), `${p.name} has broken anchor ${h}`);
      } else {
        const [filePart, hashPart] = h.split('?')[0].split('#');
        assert(fs.existsSync(path.join(ROOT, filePart)), `${p.name} links to missing file ${filePart}`);
        if (hashPart) {
          const targetIds = filePart === 'index.html' ? indexIds
            : filePart === 'legal.html' ? legalIds
            : filePart === 'services.html' ? servicesIds
            : collectIds(read(filePart));
          assert(targetIds.has(hashPart), `${p.name} links to missing hash #${hashPart} in ${filePart}`);
        }
      }
    }
  }
});

check('All SVG <use href="#..."> icons reference defined <symbol> IDs', () => {
  for (const [name, html, ids] of [['index.html', indexHtml, indexIds], ['legal.html', legalHtml, legalIds], ['404.html', err404Html, errIds], ['services.html', servicesHtml, servicesIds]]) {
    const uses = [...html.matchAll(/<use href="#([^"]+)"/g)].map(x => x[1]);
    assert(uses.length > 0, `${name} has no SVG <use> references`);
    for (const u of uses) {
      assert(ids.has(u), `${name} references missing SVG symbol #${u}`);
    }
  }
});

/* 5. Secondary pages: legal.html, 404.html, assets/pages.css, _headers */
check('legal.html contains #privacy, #terms and #cookies sections and uses assets/pages.css', () => {
  assert(legalHtml.includes('href="assets/pages.css"'), 'legal.html missing assets/pages.css link');
  for (const id of ['privacy', 'terms', 'cookies']) {
    assert(legalIds.has(id), `legal.html missing #${id} section`);
  }
  assert(indexHtml.includes('href="legal.html#privacy"'), 'index.html footer missing legal.html#privacy');
  assert(indexHtml.includes('href="legal.html#terms"'), 'index.html footer missing legal.html#terms');
  assert(indexHtml.includes('href="legal.html#cookies"'), 'index.html footer missing legal.html#cookies');
});

check('404.html is marked noindex, uses assets/pages.css, and links back to home & contact', () => {
  assert(/<meta name="robots" content="noindex, follow">/i.test(err404Html), '404.html missing noindex meta');
  assert(err404Html.includes('href="assets/pages.css"'), '404.html missing assets/pages.css link');
  assert(err404Html.includes('href="index.html"'), '404.html missing link to index.html');
  assert(err404Html.includes('href="index.html#contact"'), '404.html missing link to index.html#contact');
});

check('_headers defines security headers and static cache rules', () => {
  for (const hdr of ['X-Frame-Options:', 'X-Content-Type-Options:', 'Referrer-Policy:', 'Permissions-Policy:', 'Strict-Transport-Security:', 'Content-Security-Policy:', 'Cache-Control:']) {
    assert(headersTxt.includes(hdr), `_headers missing ${hdr}`);
  }
});

/* 6. No fabricated social proof, Analytics placeholder, Accessibility & Form */
check('No fabricated testimonials, ratings, or client-result claims are shipped', () => {
  assert(!indexIds.has('testimonials'), 'Remove the placeholder testimonial section until verified quotes exist');
  assert(!/class="stars"|★★★★★|\b5 out of 5 stars\b|\[Client Name\]|Replace with real client quote/i.test(indexHtml + caseStudiesHtml), 'Found placeholder ratings or client quotes');
});

check('Analytics placeholder, Clarity & Booking config, and trackEvent helper are present in index.html', () => {
  assert(indexHtml.includes('googletagmanager.com/gtag/js'), 'Missing GA4 placeholder in index.html');
  assert(/gaId\s*:\s*['"]['"]/.test(indexHtml), 'Missing SITE.gaId config key');
  assert(/clarityId\s*:\s*['"]['"]/.test(indexHtml), 'Missing SITE.clarityId config key');
  assert(/bookingUrl\s*:\s*['"]['"]/.test(indexHtml), 'Missing SITE.bookingUrl config key');
  assert(/booking\s*:\s*\{/.test(indexHtml) && indexHtml.includes('starter') && indexHtml.includes('growth') && indexHtml.includes('enterprise') && indexHtml.includes('estimator'), 'Missing tiered SITE.booking config (starter/growth/enterprise/estimator)');
  assert(indexHtml.includes('function trackEvent('), 'Missing trackEvent helper');
});

check('CRO sections (.guarantees, .vs-grid, #blueprint, #work, .demo-bar, #pricing, .comp-table, #estimator, .m-bar) exist', () => {
  for (const g of ['100% Ownership &amp; Docs', 'Milestone Payments', 'Free 30-Day Support', 'Transparent Scope']) {
    assert(indexHtml.includes(g), `Missing guarantee item: ${g}`);
  }
  assert(indexHtml.includes('class="guarantees'), 'Missing .guarantees strip');
  assert(indexHtml.includes('class="vs-grid'), 'Missing .vs-grid comparison in #problem');
  assert(indexHtml.includes('Before OmniFlow') && indexHtml.includes('With OmniFlow Digital'), 'Missing Before/With OmniFlow headings');
  assert(indexIds.has('blueprint') && indexIds.has('downloadBlueprint'), 'Missing #blueprint lead magnet card or download button');
  assert(indexIds.has('work') && indexHtml.includes('class="demo-bar'), 'Missing #work section or .demo-bar');
  for (const c of ['Clinic &amp; Service Booking', 'Retail &amp; Multi-Branch POS', 'Restaurant &amp; Local Brand']) {
    assert(indexHtml.includes(c), `Missing #work case study: ${c}`);
  }
  for (const href of ['case-studies.html#clinic', 'case-studies.html#retail', 'case-studies.html#hospitality']) {
    assert(indexHtml.includes(`href="${href}"`), `Missing case-study link ${href}`);
  }
  assert(indexIds.has('pricing'), 'Missing #pricing section');
  for (const t of ['Starter / MVP', 'Focused Scope', 'Growth / Professional', 'Most Popular - Best Value Bundle', 'Custom / Enterprise', 'Custom Architecture']) {
    assert(indexHtml.includes(t), `Missing #pricing tier label: ${t}`);
  }
  assert(!/currencySwitch|data-currency/i.test(indexHtml), '#pricing should not have an LKR/USD currency switcher');
  assert(indexHtml.includes('class="comp-table"'), 'Missing .comp-table in #pricing');
  assert(indexIds.has('estimator'), 'Missing #estimator in #pricing');
  assert(indexIds.has('bookingCard') && indexHtml.includes('data-booking-link'), 'Missing Direct Calendar booking card in #contact');
  assert(/<a class="c-card" href="#calendarPanel" id="bookingCard" data-booking-link>/.test(indexHtml),
    'Direct Calendar card must point at #calendarPanel (the booking panel), not the contact form');
  assert(indexHtml.includes('class="m-bar"'), 'Missing mobile sticky bottom CTA bar (.m-bar)');
});

check('Calendly / Cal.com widget embed (#calendarPanel, lazy-loaded) + CSP frame-src', () => {
  assert(indexIds.has('calendarPanel'), 'Missing #calendarPanel section');
  assert(indexHtml.includes('id="calIframe"') && indexHtml.includes('data-src'), 'Missing lazy-loaded iframe with data-src in #calendarPanel');
  assert(indexHtml.includes('id="loadCalendarBtn"'), 'Missing Load Calendar button for lazy-load');
  assert(indexHtml.includes('calendly.com') && indexHtml.includes('cal.com'), 'Missing Calendly / Cal.com references in #calendarPanel');
  assert(headersTxt.includes('frame-src') && headersTxt.includes('calendly.com') && headersTxt.includes('cal.com'), '_headers CSP must include frame-src with calendly.com and cal.com');
  assert(indexHtml.includes('IntersectionObserver'), 'Missing IntersectionObserver for lazy-loading calendar');
  assert(indexHtml.includes('showNoCalendar()') && !indexHtml.includes('No calendar URL configured. Set'),
    'Calendar panel needs the visitor-facing fallback (and no developer-facing error text) when SITE.booking is empty');
});

check('Trust layer: empty config-driven proof bar, ROI removal, #nextSteps and placeholder cleanup', () => {
  assert(indexIds.has('proof') && indexIds.has('proofList'), 'Missing #proof / #proofList');
  assert(/class="proof-bar"[^>]*hidden[^>]*>[\s\S]*?<ul id="proofList"><\/ul>/.test(indexHtml), 'Empty proof bar should ship hidden with an empty list');
  assert(/proof\s*:\s*\{\s*enabled:\s*true,\s*items:\s*\[\s*\]/.test(indexHtml), 'SITE.proof must ship with an empty items array');
  assert(indexHtml.includes('function renderProofBar()') && indexHtml.includes('renderProofBar();'), 'Proof should render only from SITE.proof');
  assert(!/roiCalc|data-roi|id=["']roi["']|\.roi-|#roi/i.test(indexHtml), 'ROI calculator markup, styles, or script must be removed');
  assert(indexIds.has('nextSteps') && (indexHtml.match(/id="nextSteps"/g) || []).length === 1, 'Missing unique #nextSteps block');
  assert(indexHtml.includes('data-reply-promise2'), 'Missing reply promise on the first #nextSteps item');
  let visibleHtml = indexHtml.replace(/<!--[\s\S]*?-->/g, '');
  assert(!visibleHtml.includes('[City, Country]'), 'Placeholder [City, Country] should be cleaned up from visible HTML');
  assert(!visibleHtml.includes('[1 business day]'), 'Placeholder [1 business day] should be cleaned up');
  assert(visibleHtml.includes('Colombo, Sri Lanka') || visibleHtml.includes('data-location'), 'Missing cleaned location or data-location');
});

check('Optional price publishing (SITE.pricing) + How pricing works note, Form WhatsApp number label + reply promise + SITE.form flags, Booking tiered + estimator channel, palette-preview tool', () => {
  assert(/SITE\.pricing/.test(indexHtml) || /pricing\s*:\s*\{/.test(indexHtml), 'Missing SITE.pricing config for optional price publishing');
  assert(indexIds.has('pricingNote') || indexHtml.includes('How pricing works'), 'Missing How pricing works note in #pricing');
  assert(indexHtml.includes('data-pricing'), 'Missing data-pricing attributes for optional price publishing');
  assert(indexHtml.includes('WhatsApp number') && indexHtml.includes('id="waLabel"'), 'Missing WhatsApp number label in form (should be WhatsApp number)');
  assert(indexHtml.includes('id="replyPromise"') && indexHtml.includes('data-response-time'), 'Missing configurable response-time promise');
  assert(/form\s*:\s*\{[\s\S]*?showPhone:\s*true,[\s\S]*?phoneRequired:\s*true,[\s\S]*?showEmail:\s*true,[\s\S]*?emailRequired:\s*false,[\s\S]*?replyChannel:\s*'WhatsApp',[\s\S]*?replyTime:\s*'1 business day'/.test(indexHtml), 'SITE.form policy defaults do not match requirements');
  assert((indexHtml.match(/formPolicy/g) || []).length >= 2, 'formPolicy must be defined and called');
  assert(indexHtml.includes('data-reply-promise2') && indexHtml.includes('WhatsApp number'), 'Missing dynamic reply promise or WhatsApp label');
  assert(indexHtml.includes('data-booking-tier'), 'Missing data-booking-tier for tiered booking integration');
  assert(indexHtml.includes('estimator') && indexHtml.includes('channel'), 'Missing estimator channel integration');
  assert(fs.existsSync(path.join(ROOT, 'tools', 'palette-preview.html')), 'Missing tools/palette-preview.html');
  const paletteHtml = read('tools/palette-preview.html');
  assert(paletteHtml.includes('Palette Preview') && paletteHtml.includes('--bg'), 'tools/palette-preview.html should contain palette preview and CSS variables');
});

check('Accessibility landmarks, skip-links, form ARIA wiring and noscript fallback exist', () => {
  for (const [name, html] of [['index.html', indexHtml], ['legal.html', legalHtml], ['404.html', err404Html]]) {
    assert(html.includes('<a class="skip-link" href="#main-content">'), `${name} missing skip-link`);
    assert(/<main id="main-content" tabindex="-1"/.test(html), `${name} missing focusable <main id="main-content">`);
  }
  assert(indexHtml.includes('<noscript>'), 'index.html missing <noscript> fallback');
  assert(indexHtml.includes('id="formOk" role="status" aria-live="polite"'), 'Missing formOk live region');
  assert(indexHtml.includes('id="formFail" role="alert"'), 'Missing formFail alert region');
  for (const field of ['name', 'business', 'email', 'phone', 'service', 'budget', 'consent']) {
    assert(new RegExp(`name="${field}"`).test(indexHtml), `Missing form input name="${field}"`);
  }
});

check('Light theme default and no-JavaScript fallback are explicit on every page', () => {
  for (const [name, html] of [['index.html', indexHtml], ['legal.html', legalHtml], ['404.html', err404Html], ['case-studies.html', caseStudiesHtml], ['services.html', servicesHtml]]) {
    const root = html.match(/<html[^>]*>/i);
    assert(root && /data-theme="light"/.test(root[0]) && /data-default-theme="light"/.test(root[0]), `${name} should default to light without JavaScript`);
    const boot = html.indexOf("var def=h.getAttribute('data-default-theme')||'system'");
    assert(boot >= 0 && boot < html.indexOf('</head>'), `${name} missing the early theme bootstrap`);
    assert(html.includes("localStorage.getItem('omni-theme')"), `${name} theme bootstrap must respect the saved preference`);
  }
});

check('Solution Blueprints page has three honest, scoped blueprints and sitemap entry', () => {
  for (const [id, timeline, tier] of [
    ['clinic', '2–4 weeks', 'Growth or Professional'],
    ['retail', '3–6 weeks', 'Growth or Custom/Enterprise'],
    ['hospitality', '2–4 weeks', 'Starter/MVP or Growth']
  ]) {
    assert(caseStudiesIds.has(id), `Missing case-studies.html#${id}`);
    const card = caseStudiesHtml.match(new RegExp(`<article[^>]+id="${id}"[\\s\\S]*?<\\/article>`));
    assert(card, `Missing ${id} blueprint article`);
    for (const section of ['Problem', 'Solution Architecture', 'Outcome', 'What gets built', timeline, tier, 'Ownership']) {
      assert(card[0].includes(section), `${id} blueprint missing ${section}`);
    }
    assert((card[0].match(/<li>/g) || []).length === 6, `${id} blueprint must list exactly six build items`);
    assert(card[0].includes('we will publish this once live'), `${id} blueprint missing honest publication note`);
  }
  assert(sitemapXml.includes('<priority>0.8</priority>'), 'Case-studies sitemap priority should be 0.8');
});

check('Hero honesty guard blocks unsupported percentages/client counts and caps trust strips', () => {
  const hero = indexHtml.match(/<section[^>]*class="hero"[^>]*id="home"[\s\S]*?<\/section>/i);
  assert(hero, 'Missing #home hero block');
  const gStart = hero[0].indexOf('<div class="guarantees');
  const proofStart = hero[0].indexOf('<div class="proof-bar', gStart);
  assert(gStart >= 0 && proofStart > gStart, 'Could not isolate the guarantees block for the honesty guard');
  let outsideGuarantees = hero[0].slice(0, gStart) + hero[0].slice(proofStart);
  outsideGuarantees = outsideGuarantees
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  assert(!/\b\d{2,}\s*%/.test(outsideGuarantees), 'Unsupported percentage claim found outside .guarantees in the hero');
  assert(!/\b\d{2,}\+?\s+(?:projects?|clients?|customers?|businesses|reviews?|ratings?)\b/i.test(outsideGuarantees), 'Unsupported client count found outside .guarantees in the hero');
  const visibleStrips = (hero[0].match(/class="(?:[^"]*\s)?(?:trust|stats|guarantees)(?:\s[^"]*)?"/g) || []).length;
  assert(visibleStrips <= 3, `Expected no more than 3 hero trust strips, found ${visibleStrips}`);
  assert(/<div class="proof-bar"[^>]*hidden/.test(indexHtml), 'Empty proof bar must not display as a trust strip');
});

/* 7. JavaScript syntax check across all HTML files */
check('All inline <script> blocks in index.html, legal.html, 404.html, and case-studies.html compile without syntax errors', () => {
  for (const [name, html] of [['index.html', indexHtml], ['legal.html', legalHtml], ['404.html', err404Html], ['case-studies.html', caseStudiesHtml], ['services.html', servicesHtml]]) {
    const scripts = [...html.matchAll(/<script(?![^>]*type="application\/ld\+json")[^>]*>([\s\S]*?)<\/script>/gi)];
    assert(scripts.length >= 2, `${name} expected at least 2 script blocks`);
    scripts.forEach((s, idx) => {
      new vm.Script(s[1], { filename: `${name}#script-${idx + 1}` });
    });
  }
});

/* 8. WCAG 2.1 AA contrast check */
check('WCAG 2.1 AA colour contrast passes across dark and light themes (tools/check-contrast.py)', () => {
  const out = execFileSync('python3', [path.join(ROOT, 'tools', 'check-contrast.py')], { encoding: 'utf8' });
  assert(out.includes('0 failed.'), 'Contrast check reported failures');
});

console.log('\n' + '-'.repeat(68));
console.log(`Completed ${passed + failed} checks — ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
