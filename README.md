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
  GA property and the Firebase console dashboards. `js/penpal.js` also sends
  custom events (`section_view`, `audience_toggle`, `sign_up`,
  `intake_fallback`) — never any PII. Weekly/monthly summary emails come from
  `apps-script/ga4-reports.gs`.

## Files

| Path | What it is |
|---|---|
| `index.html` | The whole page: head (gtag, meta), all sections, Firebase init at the bottom |
| `css/penpal.css` | All page styling (design tokens at the top: colors, spacing) |
| `css/fonts.css` + `fonts/` | Self-hosted Raleway/Merriweather |
| `js/penpal.js` | Interactivity: audience toggle, form branching/validation, submission, analytics events |
| `firestore.rules` | Source of truth for the Firestore rules published in the console |
| `apps-script/` | Poller (Sheet + email), GA4 report emails, manifest — pasted into script.google.com per `SETUP.md` |
| `SETUP.md` | One-time console setup checklist |

## Making changes

- **Copy/sections**: edit `index.html` directly; push to `main` here (dev),
  verify at the Pages URL, then push the same commit to the prod repo.
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
