/**
 * DAF CGOC Penpal — Firestore intake poller
 * ------------------------------------------------------------------
 * Runs inside a Google Apps Script BOUND TO A GOOGLE SHEET owned by
 * nationalcgoc@gmail.com (the Firebase project owner). Every run it:
 *   1. Queries Firestore (project "dafcgoc", collection "penpalIntake")
 *      for documents newer than the last-seen watermark.
 *   2. Appends one row per new submission to the "Intakes" sheet tab.
 *   3. Emails a notification per submission to NOTIFY_EMAIL.
 *
 * Because this runs as the project owner, its OAuth token has IAM
 * access to Firestore — no service-account key needed, and the
 * deny-all read rules do not apply (rules only gate untrusted clients).
 *
 * Setup: see SETUP.md in this repo. Trigger: time-driven, every 15 min,
 * function `syncIntakes`.
 */

/**
 * ONE-TIME SETUP — run this once from the editor (Run ▸ setup). It grants
 * the auth prompts and creates all triggers: intake sync every 15 min,
 * weekly analytics report (Mondays), monthly analytics report (1st).
 */
function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncIntakes').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('weeklyReport').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(6).create();
  ScriptApp.newTrigger('monthlyReport').timeBased().onMonthDay(1).atHour(6).create();
  syncIntakes(); // first sync now — also surfaces any permission problem immediately
}

var PROJECT_ID = 'dafcgoc';
var COLLECTION = 'penpalIntake';
var NOTIFY_EMAIL = 'nationalcgoc@gmail.com';

// TEMPORARY — testing only. Remove (set to '') after launch verification.
var TEST_BCC = 'arkady232@gmail.com';

function syncIntakes() {
  var props = PropertiesService.getScriptProperties();
  var watermark = props.getProperty('lastCreatedAt') || '1970-01-01T00:00:00Z';

  var url = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID +
            '/databases/(default)/documents:runQuery';
  var query = {
    structuredQuery: {
      from: [{ collectionId: COLLECTION }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'createdAt' },
          op: 'GREATER_THAN',
          value: { timestampValue: watermark }
        }
      },
      orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'ASCENDING' }],
      limit: 200
    }
  };

  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify(query),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('Firestore query failed (' + res.getResponseCode() + '): ' + res.getContentText());
  }

  var results = JSON.parse(res.getContentText()).filter(function (r) { return r.document; });
  if (!results.length) return;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Intakes') || ss.insertSheet('Intakes');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'Submitted (UTC)', 'Role', 'Rank', 'First name', 'Last name', 'Email',
      'AFSC', 'Duty location', 'Details (JSON)', 'Doc ID'
    ]);
    sheet.setFrozenRows(1);
  }

  var lastTs = watermark;
  results.forEach(function (r) {
    var doc = r.document;
    var data = unwrap({ mapValue: { fields: doc.fields } });
    var name = data.name || {};
    var branch = data.role === 'mentee' ? (data.mentee || {}) : (data.mentor || {});
    var createdAt = data.createdAt || '';

    sheet.appendRow([
      createdAt, data.role, name.rank || '', name.first || '', name.last || '',
      data.email || '',
      branch.afsc || branch.afscTitle || '',
      branch.firstDutyLocation || branch.dutyLocation || '',
      JSON.stringify(branch),
      doc.name.split('/').pop()
    ]);

    MailApp.sendEmail({
      to: NOTIFY_EMAIL,
      bcc: TEST_BCC, // TEMPORARY — remove after testing
      subject: '[Penpal] New ' + data.role + ' intake — ' + (name.first || '') + ' ' + (name.last || ''),
      body:
        'A new DAF CGOC mentorship intake was submitted.\n\n' +
        'Role: ' + data.role + '\n' +
        'Name: ' + [name.rank, name.first, name.last].filter(Boolean).join(' ') + '\n' +
        'Email: ' + (data.email || '') + '\n\n' +
        'Details:\n' + JSON.stringify(branch, null, 2) + '\n\n' +
        (data.ask ? 'Anything else: ' + data.ask + '\n\n' : '') +
        'All submissions: ' + ss.getUrl()
    });

    if (createdAt > lastTs) lastTs = createdAt;
  });

  props.setProperty('lastCreatedAt', lastTs);
}

/** Convert a Firestore REST typed value into a plain JS value. */
function unwrap(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(unwrap);
  if ('mapValue' in v) {
    var out = {}, fields = v.mapValue.fields || {};
    Object.keys(fields).forEach(function (k) { out[k] = unwrap(fields[k]); });
    return out;
  }
  return null;
}
