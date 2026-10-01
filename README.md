# OmniFlow Digital — වෙබ් අඩවිය

**Innovating. Integrating. Accelerating.**
Single-page marketing site — HTML + CSS + JavaScript (build step එකක් නැහැ, framework එකක් නැහැ). ඕනෑම static host එකකට (Netlify, Vercel, Cloudflare Pages, GitHub Pages, cPanel) කෙලින්ම upload කරන්න පුළුවන්.

---

## 1. ගොනු ව්‍යුහය (Files)

| ගොනුව | කුමක්ද |
|---|---|
| `index.html` | ප්‍රධාන වෙබ් අඩවිය — HTML, CSS (`<style>`), JavaScript (`<script>`) එකම ගොනුවක |
| `legal.html` | Privacy Policy (`#privacy`), Terms of Service (`#terms`), සහ Cookie Policy (`#cookies`) පිටුව |
| `404.html` | Custom 404 "Page Not Found" පිටුව (`noindex`) |
| `assets/pages.css` | `legal.html` සහ `404.html` සඳහා පොදු stylesheet එක (dark/light themes + WCAG AA) |
| `_headers` | Netlify / Cloudflare Pages සඳහා HTTP security සහ cache headers |
| `logo.svg` / `logo.png` | Header + Footer logo (auto-generated) |
| `favicon.ico`, `favicon-16.png`, `favicon-32.png` | Browser tab icons |
| `apple-touch-icon.png` | iPhone / iPad home-screen icon |
| `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | Android / PWA icons |
| `og-banner.png` | WhatsApp / Facebook / LinkedIn share කරන විට පෙනෙන 1200×630 banner එක |
| `site.webmanifest` | PWA / "Add to Home Screen" settings |
| `robots.txt`, `sitemap.xml` | Google සඳහා SEO ගොනු |
| `tools/make-assets.py` | ඉහත images **හැම එකක්ම** එකම brand mark එකෙන් නැවත generate කරන script එක |
| `tools/check-contrast.py` | Dark සහ Light themes දෙකේම WCAG 2.1 AA (4.5:1) contrast පරීක්ෂා කරන script එක |
| `tools/test-site.js` | මුළු වෙබ් අඩවියේම links, SEO, JSON-LD, a11y සහ contrast පරීක්ෂා කරන test suite එක |

> **වැදගත්:** `logo.png`, favicons, `og-banner.png` — මේ හැම එකක්ම එකම mark එකෙන් හදලා තියෙන්නේ. එකක් වෙනස් කරන්න ඕන නම් `tools/make-assets.py` එකේ වර්ණ/හැඩ හදලා නැවත run කරන්න:
>
> ```bash
> pip install pillow
> python3 tools/make-assets.py
> ```

---

## 2. 🚀 Launch කරන්න කලින් කරන්න ඕන දේවල් (Checklist)

මේ අගයන් **සියල්ල** `index.html` එකේ Find & Replace කරන්න (හෝ script එකේ `SITE` config එක වෙනස් කරන්න — පහළ බලන්න).

| සොයන්න (Find) | ලියන්න (Replace) | කොහෙද තියෙන්නේ |
|---|---|---|
| `https://yourdomain.com` | ඔබේ සැබෑ domain එක | canonical, OG, Twitter, JSON-LD, sitemap, robots |
| `hello@yourdomain.com` | ඔබේ email | Contact card, footer |
| `94000000000` | WhatsApp number (රට කේතය + number, `+` හෝ spaces නැතුව) | WhatsApp FAB, contact card, footer |
| `+94 00 000 0000` | එම number එකම කියවෙන ආකාරයට | Contact card, footer |
| `[City, Country]` | ඔබේ location එක | Contact card, footer |
| `[1 business day]` | ඇත්ත reply time එක | Form යටින් |
| `href="#"` (social + legal) | LinkedIn / Facebook / Instagram සහ Privacy / Terms / Cookie pages | Footer |
| `YOUR_STREET_ADDRESS`, `YOUR_CITY`, `YOUR_PAGE` | JSON-LD structured data | `<head>` |

### WhatsApp / email / Booking Calendar / Testimonials / Analytics එකම තැනකින් වෙනස් කිරීම

`index.html` එකේ පහළ ඇති `<script>` block එකේ මුලින්ම මෙය තියෙනවා:

```js
const SITE = {
  whatsapp     : '94000000000',        // country code + number, digits only
  waLabel      : '+94 00 000 0000',    // screen එකේ පෙන්වන ආකාරය
  email        : 'hello@yourdomain.com',
  bookingUrl   : '',                   // Direct calendar link (උදා: 'https://calendly.com/your-handle/30min')
  testimonials : false,                // සැබෑ client quotes දැමූ පසු true කරන්න
  gaId         : '',                   // Google Analytics 4 ID (උදා: 'G-XXXXXXXXXX')
  clarityId    : ''                    // Microsoft Clarity project ID
};
```

මෙතන වෙනස් කළොත් පිටුවේ ඇති **හැම** WhatsApp link/email/calendar link එකක්ම ඉබේම update වෙනවා. (`legal.html` සහ `404.html` වලත් එම `SITE` block එකම තියෙනවා.)

* **Direct Calendar (`bookingUrl`):** Calendly හෝ Cal.com link එකක් දැම්මොත් `#contact` හි ඇති Direct Calendar card එකෙන් කෙලින්ම slot එකක් book කරන්න පුළුවන්.
* **Testimonials section එක (දැනට OFF):** `index.html` එකේ `#testimonials` section එකේ placeholder quotes ඔබේ සැබෑ පාරිභෝගික අදහස් වලින් වෙනස් කරලා `testimonials: true` කරන්න (හෝ `<section id="testimonials" hidden>` හි `hidden` ඉවත් කරන්න).
* **Analytics (`gaId` & `clarityId`):** `gaId: 'G-XXXXXXXXXX'` දැම්මොත් Google Analytics 4 ද, `clarityId` දැම්මොත් Microsoft Clarity ද ඉබේම load වෙනවා සහ WhatsApp click / blueprint download / estimator / form lead events track වෙනවා.

---

## 3. Contact Form එක වැඩ කරන ආකාරය

Form friction අඩු කිරීම සඳහා **Required fields 3කට** (`name`, `phone`, `service` + `consent`) සීමා කර ඇති අතර `business`, `email`, `budget`, සහ `message` optional ලෙස තබා ඇත.

දැනට form එකේ **fallback mode** එක ක්‍රියාත්මකයි: Submit කළාම WhatsApp එකට ගිහින් සියලු විස්තර සහිත pre-filled message එකක් විවෘත වෙනවා. Server එකක් අවශ්‍ය නැහැ.

Email එකට submissions ලබාගන්න ඕන නම්, `index.html` එකේ `/* ---- SETTINGS ---- */` ළඟ මෙසේ endpoint එක දාන්න:

```js
const FORM_ENDPOINT = 'https://formspree.io/f/xxxxxxx';   // Formspree
```

* **Formspree** → account එකක් හදලා form URL එක මෙතන දාන්න. ✅ ready
* **Web3Forms** → `https://api.web3forms.com/submit` දාලා form එකට `access_key` input එකක් එකතු කරන්න.
* **EmailJS** → `fetch()` වෙනුවට `emailjs.sendForm(...)` use කරන්න.

Form එකේ දැනටමත් client-side validation, honeypot spam protection, success/error states, සහ accessibility attributes තියෙනවා.

---

## 4. Built-in Features (දැනටමත් කරලා තියෙන දේවල්)

**Design & UX**
* Dark / Light theme toggle — localStorage එකේ මතක තබාගන්නවා, flash එකක් නැහැ
* පළමු බැලීමේදී පරිශීලකගේ OS theme එක (prefers-color-scheme) අනුගමනය කරනවා — හැම විටම dark වලින් පටන් ගන්න ඕන නම් `index.html` එකේ `<head>` ඇති script එකේ `matchMedia` පේළිය මකන්න
* Theme එකට අනුව mobile browser UI colour එක (`theme-color`) මාරු වෙනවා
* Responsive: 1100px / 1024px / 960px / 900px / 700px breakpoints
* Glassmorphism header, mega menu, bento grid, 3D tilt, marquee, animated counters, live WhatsApp chat simulation

**Conversion & CRO**
* Hero Risk-Reversal Guarantee Strip (`.guarantees`: 100% Ownership & Docs, Milestone Payments, Free 30-Day Support, Transparent Scope)
* `#problem` "Before OmniFlow vs. With OmniFlow Digital" comparison (`.vs-grid`)
* `#why` Free Lead Magnet (`#blueprint` — 25-Point SME Digital Growth & Automation Blueprint instant `.txt` checklist download)
* `#work` ("Proof of Work") section: 3 Problem → Solution Architecture → Outcome case studies (Clinic & Service Booking, Retail & Multi-Branch POS, Restaurant & Local Brand) + interactive "Try Live WhatsApp Demo" bar (`.demo-bar`)
* `#pricing` section: `Starter / MVP` (Focused Scope), `Growth / Professional` (Most Popular - Best Value Bundle), `Custom / Enterprise` (Custom Architecture) + Feature Comparison Table (`.comp-table`) + Interactive Bundle & Timeline Estimator (`#estimator`)
* Low-friction `#contact` form (3 required fields: `name`, `phone`, `service` + `consent`), Direct Calendar (`SITE.bookingUrl`) card, `SITE.clarityId` support, සහ Mobile Sticky Bottom CTA Bar (`.m-bar`)

**SEO & Social**
* Open Graph + X/Twitter card tags (WhatsApp/Facebook/LinkedIn share preview)
* Schema.org JSON-LD: Organization / ProfessionalService, WebSite, WebPage, FAQPage (+ service catalog)
* `canonical`, `robots`, `sitemap.xml`, `robots.txt`
* SVG + PNG + `.ico` favicons, Apple touch icon, PWA manifest

**Accessibility**
* Skip-to-content link (`Skip to main content`)
* Scroll-spy — දැනට කියවන section එකට අනුරූප nav link එක highlight වෙනවා (`aria-current`)
* `:focus-visible` styles, ARIA states (`aria-expanded`, `aria-pressed`, `aria-current`, `aria-invalid`, `aria-describedby`)
* Escape key / outside-click වලින් mobile menu එක වැහෙනවා; focus එක නැවත button එකට එනවා
* `prefers-reduced-motion` සහ JavaScript off කරලා තිබුණත් content එක පෙනෙනවා (`<noscript>` fallback)
* Form success/error messages `role="status"` / `role="alert"` live regions

**Performance**
* Google Fonts `display=swap`, `preconnect`
* External dependencies බින්දුවක් නැහැ (framework, jQuery, icon library නැහැ) — SVG sprite එක inline
* Images සියල්ලම optimize කරලා

---

## 5. Local එකේ බලන්න සහ Test කරන්න

```bash
# Local server එක run කරන්න:
python3 -m http.server 8000
# ඉන්පසු http://localhost:8000 විවෘත කරන්න

# Automated site + contrast tests:
node tools/test-site.js
python3 tools/check-contrast.py
```

## 6. Deploy කරන්න

* **Netlify / Vercel / Cloudflare Pages** → repo එක connect කරන්න, build command එකක් නැහැ, publish directory = `.`
* **GitHub Pages** → Settings → Pages → branch එක select කරන්න
* **cPanel / shared hosting** → සියලු ගොනු `public_html` එකට upload කරන්න

Deploy කළ පසු:
1. `https://yourdomain.com/robots.txt` සහ `/sitemap.xml` open වෙනවද බලන්න
2. Google Search Console එකට sitemap එක submit කරන්න
3. Facebook Sharing Debugger / LinkedIn Post Inspector එකෙන් OG preview එක refresh කරන්න
4. [Rich Results Test](https://search.google.com/test/rich-results) එකෙන් JSON-LD එක validate කරන්න
