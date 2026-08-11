# DAF CGOC Mentorship Program — penpal site

Standalone landing page + signup intake for the DAF CGOC Mentorship (Penpal)
Program. Dev repo: `daf-cgoc-2025/penpal` (tests at
https://daf-cgoc-2025.github.io/penpal/). Production repo:
`dafcogc-penpal/penpal`, served at https://penpal.dafcgoc.org.

## How it works

```
visitor ──► index.html (static, GitHub Pages)
              │  gtag.js: G-74QCBZFVWH (sitewide GA) + G-WT36BHRC7X (Firebase "analytics" app)
              │
              └─ intake form ──► Firestore `penpalIntake` (project "dafcgoc", create-only)
                                    │            rules: firestore.rules
                                    ▼
                     Apps Script poller (runs as nationalcgoc@gmail.com, every 15 min)
                        ├─► Google Sheet "Penpal Intakes" (one row per submission)
                        └─► email notification → nationalcgoc@gmail.com
```

- **No build system.** Plain HTML/CSS/JS, deployed by pushing to `main`.
- **Form backend**: the browser writes directly to Firestore with the
  Firebase JS SDK (v12.17.0, `firestore-lite` build, loaded from Google's CDN
  in `index.html`). The committed Firebase config is public by design;
  security lives entirely in `firestore.rules` (create-only, strict field
  validation, nothing readable from the client). If Firestore is unreachable,
  the page falls back to opening a pre-filled email.
- **Free tier**: everything runs on Firebase Spark + consumer Google — no
  Cloud Functions, no billing account.
- **Analytics**: every page is dual-tagged so hits land in both the sitewide
  GA property and the Firebase console dashboards. `js/analytics.js` (shared
  with dafcgoc.org) tracks interactions; `js/penpal.js` adds intake-specific
  events. Never any PII. Weekly/monthly summary emails come from
  `apps-script/ga4-reports.gs`. See "Analytics events" below.
- **MOAA partnership**: after a successful intake the success panel offers a
  free MOAA basic membership (`moaa.org/dafcgoc`, the council's own landing
  page), with a matching FAQ entry. Every MOAA touchpoint fires a
  `partner_click` event so the council can report referral volume at renewal.
  Note the MOAA vanity URL 302-redirects to `pages.moaa.org` and **drops query
  parameters**, so UTM tags on it are lost; attribution relies on the landing
  page being council-specific.

## Files

| Path | What it is |
|---|---|
| `index.html` | The whole page: head (gtag, meta), all sections, Firebase init at the bottom |
| `css/penpal.css` | All page styling (design tokens at the top: colors, spacing) |
| `css/fonts.css` + `fonts/` | Self-hosted Raleway/Merriweather |
| `js/penpal.js` | Interactivity: audience toggle, form branching/validation, submission, intake events |
| `js/analytics.js` | Shared engagement tracking (identical copy lives in the main site repo) |
| `admin/` | Program dashboard: Google sign-in, responses, charts, PDF report |
| `firestore.rules` | Source of truth for the Firestore rules published in the console |
| `apps-script/` | Poller (Sheet + email), GA4 report emails, manifest — pasted into script.google.com per `SETUP.md` |
| `SETUP.md` | One-time console setup checklist |

## Analytics events

`js/analytics.js` is a drop-in shared module: the same file sits in this repo
and in the main site repo, and every page already loads it. It sends these,
all PII-free (labels and destinations only, never form contents):

| Event | When | Key parameters |
|---|---|---|
| `click_element` | any button, link, or `<summary>` click | `element_text`, `element_id`, `link_url`, `link_domain`, `link_type` (internal/outbound/download/email/phone/anchor), `page_area` (nav/hero/card/form/footer/body), `section_id` |
| `partner_click` | MOAA / USAA / DEFO links, outbound **and** internal partner pages | `partner`, `placement`, `link_url` |
| `penpal_referral` | any click heading to penpal.dafcgoc.org | `placement`, `element_text` |
| `file_download` | PDF/doc/spreadsheet links | `file_name`, `file_extension` |
| `section_view` | first time a section or card is half seen | `section_id` |
| `section_time` | on exit: seconds actually spent per section | `section_id`, `seconds` |
| `scroll_depth` | 25 / 50 / 75 / 90 / 100 percent | `percent_scrolled` |
| `page_engagement` | on exit: active seconds (idle over 30s not counted) | `seconds`, `percent_scrolled` |

Intake-specific events from `js/penpal.js`: `audience_toggle`, `sign_up`
(param `method` = mentee/mentor), `intake_duplicate`, `intake_fallback`.

Sections and cards without an `id` are labelled by their heading text, so each
opportunity card and each FAQ item reports individually.

**To see the detail in GA4**, register these as custom dimensions (GA Admin →
Custom definitions → Create custom dimension, scope Event): `element_text`,
`section_id`, `page_area`, `link_url`, `placement`, `partner`. Until then GA
records the events but only shows counts, not the labels. A cap of 250 events
per page view guards the free-tier quota.

## Making changes

- **Copy/sections**: edit `index.html` directly; push to `main` here (dev),
  verify at the Pages URL, then carry to prod (below).
- **Deploying dev → prod**: the two repos share history, so a plain merge
  works. **Always confirm `CNAME` still contains `penpal.dafcgoc.org` in the
  prod tree before pushing** — dev deliberately has no CNAME (only one Pages
  site may claim a domain), and that deletion will otherwise ride along and
  take the custom domain down:
  ```
  git clone https://github.com/dafcogc-penpal/penpal prod && cd prod
  git remote add dev <path-or-url-of-dev-repo> && git fetch dev main
  git merge dev/main
  echo penpal.dafcgoc.org > CNAME && git add CNAME && git commit -m "Restore CNAME"
  git push origin main
  ```
- **Analytics changes**: edit `js/analytics.js` here, then copy the identical
  file into the main site repo (`js/analytics.js`) so both stay in sync.
- **Form fields**: three places must stay in sync — the field in
  `index.html`, `buildPayload()` in `js/penpal.js`, and the matching
  validation line in `firestore.rules` (re-publish rules in the console after
  changing them). Optionally add a column mapping in `apps-script/poller.gs`.
- **Notification email / recipients**: `NOTIFY_EMAIL` in
  `apps-script/poller.gs` (console-side; also mirrored in `CONFIG` in
  `js/penpal.js` for the mailto fallback).
- **Analytics events**: use the `track(name, params)` helper in
  `js/penpal.js`. No PII in event parameters, ever.
- **Going to prod**: remove `<meta name="robots" content="noindex, nofollow">`
  in `index.html` when the page is approved for search, and delete the
  temporary `TEST_BCC`/`REPORT_BCC` values in the Apps Script files.

The page carries a `noindex` meta and a "preview build" notice until launch
approval — see `SETUP.md` for the go-live checklist.
