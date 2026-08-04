# Penpal — one-time setup checklist (Firebase console + Google Sheet)

Everything in this list is done signed in as **nationalcgoc@gmail.com** (turn on
2-Step Verification for this account if it isn't already). No paid plan is
needed — everything below stays on the free Spark tier, no credit card.

## 1. Create the Firestore database (project `dafcgoc`)

1. [Firebase console](https://console.firebase.google.com/) → project **DAFCGOC** → Build → **Firestore Database** → *Create database*.
2. Location: **nam5 (United States)**. Mode: **production mode** (locked). The location is permanent.

## 2. Publish the security rules

1. Firestore → **Rules** tab.
2. Replace the contents with the full text of [`firestore.rules`](firestore.rules) from this repo → **Publish**.
3. Sanity-check in the **Rules Playground**: a `get` on `/penpalIntake/x` must be **denied**; an unauthenticated `create` is allowed only when the document matches the intake shape.

Until this step is done, form submissions are rejected (the page then falls
back to opening the visitor's email app addressed to nationalcgoc@gmail.com).

## 3. Response sheet + email notifications (Apps Script)

1. In Google Drive, create a spreadsheet named e.g. **Penpal Intakes**.
2. Extensions → **Apps Script**. In the editor:
   - Project Settings → check *Show "appsscript.json" manifest file*, then replace its contents with [`apps-script/appsscript.json`](apps-script/appsscript.json).
   - Replace `Code.gs` with [`apps-script/poller.gs`](apps-script/poller.gs).
3. Run `syncIntakes` once from the editor → grant the authorization prompts (Firestore access + email + this sheet).
4. Triggers (clock icon) → *Add trigger*: function `syncIntakes`, time-driven, **every 15 minutes**.
5. New submissions now appear as rows in the **Intakes** tab and as an email to nationalcgoc@gmail.com within 15 minutes.

> The scripts currently BCC `arkady232@gmail.com` — **temporary, for launch
> testing only**. Delete the `TEST_BCC` / `REPORT_BCC` values after verifying.

## 4. Weekly/monthly analytics report emails

1. In the same Apps Script project, add a file with [`apps-script/ga4-reports.gs`](apps-script/ga4-reports.gs).
2. Services (+) → enable **Google Analytics Data API** (service name `AnalyticsData`).
3. In [GA Admin](https://analytics.google.com/) → Property → *Property details*, copy the **numeric property ID** of the property that owns `G-74QCBZFVWH` and paste it into `GA4_PROPERTIES` in the script. (nationalcgoc@gmail.com needs at least Viewer access on that property — ask whoever owns the "nationalcgoc" GA account to add it if a permissions error appears.)
4. Run `weeklyReport` once manually to authorize and verify the email arrives.
5. Add two triggers: `weeklyReport` (week timer, Mondays) and `monthlyReport` (month timer, 1st).

## 5. GA4 Enhanced Measurement (file downloads, scroll, outbound clicks)

In GA Admin → Data streams → the web stream for each property → **Enhanced
measurement**: confirm it is ON with *File downloads*, *Scrolls*, and
*Outbound clicks* enabled (they are on by default). This is what restores the
old "files downloaded" tracking for the PDFs on the main site — no code needed.

## Escalation (only if spam shows up)

Honeypot + strict rules handle casual bots. If junk submissions appear:
create a score-based **reCAPTCHA Enterprise** key for `penpal.dafcgoc.org`
(free ≤10k assessments/month, no billing) → Firebase console → **App Check**
→ register the penpal web app → enable enforcement for Firestore.
