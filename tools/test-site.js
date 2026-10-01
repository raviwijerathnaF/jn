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
const pagesCss = read('assets/pages.css');
const headersTxt = read('_headers');
const sitemapXml = read('sitemap.xml');
const robotsTxt = read('robots.txt');
const manifestJson = JSON.parse(read('site.webmanifest'));

console.log('OmniFlow Digital — running verification checks...\n');

/* 1. Files & image dimensions */
const REQUIRED_FILES = [
  'index.html', 'legal.html', '404.html', 'assets/pages.css', '_headers',
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
  assert(!sitemapXml.includes('404.html'), 'sitemap.xml should not list 404.html');
});

/* 3. JSON-LD structured data */
check('index.html JSON-LD parses cleanly and FAQPage matches the 6 DOM FAQs', () => {
  const m = indexHtml.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/);
  assert(m, 'Missing JSON-LD script block');
  const data = JSON.parse(m[1]);
  assert(Array.isArray(data['@graph']) && data['@graph'].length === 4, 'Expected 4 nodes in @graph');
  const faqNode = data['@graph'].find(n => n['@type'] === 'FAQPage');
  assert(faqNode && faqNode.mainEntity.length === 6, 'Expected 6 questions in FAQPage JSON-LD');
  const domSummaries = [...indexHtml.matchAll(/<summary>([^<]+)<span/g)].map(x => x[1].trim());
  assert(domSummaries.length === 6, `Expected 6 <summary> elements, got ${domSummaries.length}`);
  faqNode.mainEntity.forEach((q, idx) => {
    assert(q.name === domSummaries[idx], `FAQ #${idx + 1} mismatch: "${q.name}" vs "${domSummaries[idx]}"`);
  });
});

/* 4. Internal links, anchors & SVG symbols */
const indexIds = collectIds(indexHtml);
const legalIds = collectIds(legalHtml);
const errIds = collectIds(err404Html);

check('All in-page #anchor links and cross-page links resolve to real targets', () => {
  const pages = [
    { name: 'index.html', html: indexHtml, ids: indexIds },
    { name: 'legal.html', html: legalHtml, ids: legalIds },
    { name: '404.html', html: err404Html, ids: errIds }
  ];
  for (const p of pages) {
    const hrefs = [...p.html.matchAll(/\bhref="([^"]+)"/g)].map(x => x[1]);
    for (const h of hrefs) {
      if (h === '#' || h.startsWith('http://') || h.startsWith('https://') || h.startsWith('mailto:') || h.startsWith('tel:')) continue;
      if (h.startsWith('#')) {
        const id = h.slice(1);
        assert(p.ids.has(id), `${p.name} has broken anchor ${h}`);
      } else {
        const [filePart, hashPart] = h.split('#');
        assert(fs.existsSync(path.join(ROOT, filePart)), `${p.name} links to missing file ${filePart}`);
        if (hashPart) {
          const targetIds = filePart === 'index.html' ? indexIds : filePart === 'legal.html' ? legalIds : collectIds(read(filePart));
          assert(targetIds.has(hashPart), `${p.name} links to missing hash #${hashPart} in ${filePart}`);
        }
      }
    }
  }
});

check('All SVG <use href="#..."> icons reference defined <symbol> IDs', () => {
  for (const [name, html, ids] of [['index.html', indexHtml, indexIds], ['legal.html', legalHtml, legalIds], ['404.html', err404Html, errIds]]) {
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

/* 6. Testimonials (OFF by default), Analytics placeholder, Accessibility & Form */
check('Testimonial section (#testimonials) exists and is OFF by default', () => {
  assert(indexIds.has('testimonials'), 'Missing #testimonials section');
  assert(/<section[^>]+id="testimonials"[^>]*\bhidden\b/i.test(indexHtml), '#testimonials must have the `hidden` attribute by default');
  assert(/testimonials\s*:\s*false/.test(indexHtml), 'SITE.testimonials should default to false');
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
  assert(indexIds.has('pricing'), 'Missing #pricing section');
  for (const t of ['Starter / MVP', 'Focused Scope', 'Growth / Professional', 'Most Popular - Best Value Bundle', 'Custom / Enterprise', 'Custom Architecture']) {
    assert(indexHtml.includes(t), `Missing #pricing tier label: ${t}`);
  }
  assert(!/currencySwitch|data-currency/i.test(indexHtml), '#pricing should not have an LKR/USD currency switcher');
  assert(indexHtml.includes('class="comp-table"'), 'Missing .comp-table in #pricing');
  assert(indexIds.has('estimator'), 'Missing #estimator in #pricing');
  assert(indexIds.has('bookingCard') && indexHtml.includes('data-booking-link'), 'Missing Direct Calendar booking card in #contact');
  assert(indexHtml.includes('class="m-bar"'), 'Missing mobile sticky bottom CTA bar (.m-bar)');
});

check('Calendly / Cal.com widget embed (#calendarPanel, lazy-loaded) + CSP frame-src', () => {
  assert(indexIds.has('calendarPanel'), 'Missing #calendarPanel section');
  assert(indexHtml.includes('id="calIframe"') && indexHtml.includes('data-src'), 'Missing lazy-loaded iframe with data-src in #calendarPanel');
  assert(indexHtml.includes('id="loadCalendarBtn"'), 'Missing Load Calendar button for lazy-load');
  assert(indexHtml.includes('calendly.com') && indexHtml.includes('cal.com'), 'Missing Calendly / Cal.com references in #calendarPanel');
  assert(headersTxt.includes('frame-src') && headersTxt.includes('calendly.com') && headersTxt.includes('cal.com'), '_headers CSP must include frame-src with calendly.com and cal.com');
  assert(indexHtml.includes('IntersectionObserver'), 'Missing IntersectionObserver for lazy-loading calendar');
});

check('Trust layer: proof bar (#proof, SITE.proof), ROI calculator (#roi), placeholder cleanup', () => {
  assert(indexIds.has('proof'), 'Missing #proof bar section');
  assert(indexHtml.includes('class="proof-bar"') || indexHtml.includes('proof-bar'), 'Missing .proof-bar styling');
  assert(/SITE\.proof/.test(indexHtml) || /proof\s*:\s*\{/.test(indexHtml), 'Missing SITE.proof config');
  assert(indexIds.has('roi'), 'Missing #roi ROI calculator section');
  assert(indexHtml.includes('id="roiLeads"') && indexHtml.includes('id="roiRate"') && indexHtml.includes('id="roiValue"'), 'Missing ROI calculator inputs');
  assert(indexHtml.includes('id="roiCurrent"') && indexHtml.includes('id="roiProjected"'), 'Missing ROI result outputs');
  // placeholder cleanup: no [City, Country] or [1 business day] in visible text (except hidden testimonials which may contain brackets, and launch checklist comment)
  let visibleHtml = indexHtml.replace(/<section[^>]+id="testimonials"[\s\S]*?<\/section>/i, '');
  // strip HTML comments to ignore launch checklist
  visibleHtml = visibleHtml.replace(/<!--[\s\S]*?-->/g, '');
  assert(!visibleHtml.includes('[City, Country]'), 'Placeholder [City, Country] should be cleaned up from visible HTML');
  assert(!visibleHtml.includes('[1 business day]'), 'Placeholder [1 business day] should be cleaned up');
  assert(visibleHtml.includes('Colombo, Sri Lanka') || visibleHtml.includes('data-location'), 'Missing cleaned location (Colombo, Sri Lanka) or data-location');
});

check('Optional price publishing (SITE.pricing) + How pricing works note, Form WhatsApp number label + reply promise + SITE.form flags, Booking tiered + estimator channel, palette-preview tool', () => {
  assert(/SITE\.pricing/.test(indexHtml) || /pricing\s*:\s*\{/.test(indexHtml), 'Missing SITE.pricing config for optional price publishing');
  assert(indexIds.has('pricingNote') || indexHtml.includes('How pricing works'), 'Missing How pricing works note in #pricing');
  assert(indexHtml.includes('data-pricing'), 'Missing data-pricing attributes for optional price publishing');
  assert(indexHtml.includes('WhatsApp number') && indexHtml.includes('id="waLabel"'), 'Missing WhatsApp number label in form (should be WhatsApp number)');
  assert(indexHtml.includes('id="replyPromise"') && indexHtml.includes('We reply within'), 'Missing reply promise with id="replyPromise"');
  assert(/SITE\.form/.test(indexHtml) || /form\s*:\s*\{/.test(indexHtml), 'Missing SITE.form configurable flags');
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

/* 7. JavaScript syntax check across all HTML files */
check('All inline <script> blocks in index.html, legal.html and 404.html compile without syntax errors', () => {
  for (const [name, html] of [['index.html', indexHtml], ['legal.html', legalHtml], ['404.html', err404Html]]) {
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
