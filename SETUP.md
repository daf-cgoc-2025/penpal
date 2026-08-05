# Penpal — one-time setup checklist (Firebase console + Google Sheet)

> **Update 4 Aug 2026 (v2 scripts):** `poller.gs` and `ga4-reports.gs` now send
> formatted HTML emails instead of raw JSON. If the Apps Script project is
> already set up, just replace the contents of both files in the editor with
> the new versions and Save — no re-run of `setup` needed, triggers keep working.

Everything in this list is done signed in as **nationalcgoc@gmail.com** (turn on
2-Step Verification for this account if it isn't already). No paid plan is
needed — everything below stays on the free Spark tier, no credit card.

## 1. Create the Firestore database — ✅ DONE (2026-08-04)

Database `(default)` created in **nam5 (United States)**, production mode.

## 2. Publish the security rules — ✅ DONE (2026-08-04)

[`firestore.rules`](firestore.rules) is published and verified end-to-end:
a live submission from the dev site landed in `penpalIntake`; unauthenticated
reads and malformed creates are rejected. To change rules later, edit the file
here and re-publish (Firestore → Rules tab, or `firebase deploy --only
firestore:rules` with sufficient IAM).

## 3. Response sheet + email notifications (Apps Script)

1. In Google Drive, create a spreadsheet named e.g. **Penpal Intakes**.
2. Extensions → **Apps Script**. In the editor:
   - Project Settings → check *Show "appsscript.json" manifest file*, then replace its contents with [`apps-script/appsscript.json`](apps-script/appsscript.json).
   - Replace `Code.gs` with [`apps-script/poller.gs`](apps-script/poller.gs).
3. Also add [`apps-script/ga4-reports.gs`](apps-script/ga4-reports.gs) as a second file (see §4).
4. Run **`setup`** once from the editor → grant the authorization prompts. This creates all three triggers (intake sync every 15 min, weekly report, monthly report) and runs the first sync immediately.
5. New submissions now appear as rows in the **Intakes** tab and as an email to nationalcgoc@gmail.com within 15 minutes. A test submission ("EndToEnd Test", marked *delete me*) is already sitting in Firestore — the first sync should pick it up; delete its row and the Firestore doc after confirming.

> The scripts currently BCC `arkady232@gmail.com` — **temporary, for launch
> testing only**. Delete the `TEST_BCC` / `REPORT_BCC` values after verifying.

## 4. Weekly/monthly analytics report emails

1. In the same Apps Script project, add a file with [`apps-script/ga4-reports.gs`](apps-script/ga4-reports.gs).
2. Services (+) → enable **Google Analytics Data API** (service name `AnalyticsData`).
3. The GA4 property ID is already filled in (`548474741`, the Firebase-linked
   property — it receives all hits because every page is dual-tagged, and the
   project owner has access automatically). Optionally add the original
   sitewide property too; see the comment in the script.
4. Run `weeklyReport` once manually to verify the email arrives.
5. Triggers are created by the `setup()` function in step 3 above — nothing
   more to add.

## 5. GA4 Enhanced Measurement (file downloads, scroll, outbound clicks)

In GA Admin → Data streams → the web stream for each property → **Enhanced
measurement**: confirm it is ON with *File downloads*, *Scrolls*, and
*Outbound clicks* enabled (they are on by default). This is what restores the
old "files downloaded" tracking for the PDFs on the main site — no code needed.

## 6. Invisible spam protection (App Check) — activate when ready

Layers already live: honeypot, strict validation rules, and **one submission
per email+role enforced by the database** (duplicate writes are impossible).
The final layer is Firebase **App Check** with score-based reCAPTCHA
Enterprise — completely invisible to users (no puzzles, no clicks), free up
to 10k checks/month, no billing account needed. To activate:

1. [Cloud console → reCAPTCHA](https://console.cloud.google.com/security/recaptcha?project=dafcgoc)
   → *Create key* → type **Website**, score-based (do NOT tick "checkbox
   challenge") → domains: `daf-cgoc-2025.github.io` and `penpal.dafcgoc.org`
   → create, copy the site key. (Enable the reCAPTCHA Enterprise API if
   prompted.)
2. Firebase console → **App Check → Apps** → register the **penpal** web app
   with that site key (reCAPTCHA Enterprise provider).
3. Paste the site key into `APP_CHECK_SITE_KEY` in `index.html` (both dev
   and, at launch, prod) and push.
4. Watch App Check metrics for a day or two (requests should show as
   "verified"), then App Check → **APIs → Cloud Firestore → Enforce**.

Do step 4 only after steps 1–3 are confirmed working, or the form will
reject everyone. If the dashboard is in use, register the same site key for
it too (it shares the penpal app).
