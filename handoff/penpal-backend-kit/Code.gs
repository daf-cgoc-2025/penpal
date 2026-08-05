/**
 * DAF CGOC Penpal — Firestore intake poller  (v2 — formatted emails)
 * ------------------------------------------------------------------
 * Runs inside a Google Apps Script BOUND TO A GOOGLE SHEET owned by
 * nationalcgoc@gmail.com (the Firebase project owner). Every run it:
 *   1. Queries Firestore (project "dafcgoc", collection "penpalIntake")
 *      for documents newer than the last-seen watermark.
 *   2. Appends one row per new submission to the "Intakes" sheet tab.
 *   3. Emails a formatted notification per submission to NOTIFY_EMAIL.
 *
 * Setup: see SETUP.md / README-FIRST.pdf. Trigger: time-driven, every
 * 15 min, function `syncIntakes` (created by `setup`).
 */

/**
 * ONE-TIME SETUP — run this once from the editor (Run ▸ setup). It grants
 * the auth prompts and creates all triggers: intake sync every 15 min,
 * weekly analytics report (Mondays), monthly report (1st).
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
var DASHBOARD_URL = 'https://daf-cgoc-2025.github.io/penpal/admin/';

// TEMPORARY — testing only. Remove (set to '') after launch verification.
var TEST_BCC = 'arkady232@gmail.com';

// Friendly labels for form values (mirrors the site's admin dashboard)
var VALUE_LABELS = {
  usafa: 'USAFA', afrotc: 'AFROTC', ots: 'OTS', direct: 'Direct commission', other: 'Other',
  'afsc-progression': 'AFSC career progression', networking: 'Networking',
  'lead-enlisted': 'Leading enlisted Airmen', transition: 'Cadet-to-operational transition',
  'work-life': 'Work-life balance & tempo', 'future-roles': 'Flight/CC & Exec prep',
  'exact-afsc': 'Exact AFSC', 'broad-field': 'Broader career field', 'any-leader': 'Any strong leader',
  'afsc-tactical': 'AFSC tactical knowledge', enlisted: 'Enlisted force mgmt',
  staff: 'Staff / admin navigation', assignments: 'Assignments / deployments'
};
function pretty(v) {
  if (v == null || v === '') return '';
  if (Array.isArray(v)) return v.map(pretty).join(', ');
  return VALUE_LABELS[v] || String(v);
}

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
    var docSnap = r.document;
    var data = unwrap({ mapValue: { fields: docSnap.fields } });
    var name = data.name || {};
    var branch = data.role === 'mentee' ? (data.mentee || {}) : (data.mentor || {});
    var createdAt = data.createdAt || '';
    var fullName = [name.rank, name.first, name.last].filter(Boolean).join(' ');

    sheet.appendRow([
      createdAt, data.role, name.rank || '', name.first || '', name.last || '',
      data.email || '',
      branch.afsc || branch.afscTitle || '',
      branch.firstDutyLocation || branch.dutyLocation || '',
      JSON.stringify(branch),
      docSnap.name.split('/').pop()
    ]);

    MailApp.sendEmail({
      to: NOTIFY_EMAIL,
      bcc: TEST_BCC, // TEMPORARY — remove after testing
      subject: '[Penpal] New ' + data.role + ' intake — ' + fullName,
      body: plainBody(data, name, branch, ss),          // fallback for text-only clients
      htmlBody: htmlBody(data, name, branch, ss)
    });

    if (createdAt > lastTs) lastTs = createdAt;
  });

  props.setProperty('lastCreatedAt', lastTs);
}

/* ---------- formatted notification email ---------- */

function intakeRows(data, name, branch) {
  var rows = [
    ['Name', [name.rank, name.first, name.last].filter(Boolean).join(' ')],
    ['Role', data.role === 'mentee' ? 'Mentee (cadet / new Lt)' : 'Mentor (CGO)'],
    ['Email', data.email || '']
  ];
  if (data.role === 'mentee') {
    rows.push(
      ['Commissioning source', pretty(branch.commissioningSource)],
      ['AFROTC detachment', pretty(branch.afrotcDetachment)],
      ['Expected commissioning', pretty(branch.commissioningDateExpected)],
      ['Projected AFSC', pretty(branch.afsc)],
      ['First duty location', pretty(branch.firstDutyLocation)],
      ['Goals', pretty(branch.goals)],
      ['Match preference', pretty(branch.matchPreference)]);
  } else {
    rows.push(
      ['Rank & time in service', pretty(branch.rankTimeInService)],
      ['AFSC & duty title', pretty(branch.afscTitle)],
      ['Duty location', pretty(branch.dutyLocation)],
      ['Commissioned', pretty(branch.commissioningDateActual)],
      ['Experiences', pretty(branch.experiences)],
      ['Mentoring areas', pretty(branch.mentoringAreas)],
      ['Mentee capacity', pretty(branch.menteeCapacity)]);
  }
  if (data.ask) rows.push(['Anything else', data.ask]);
  rows.push(['Submitted', (data.createdAt || '').replace('T', ' ').replace(/\..*$/, ' UTC')]);
  return rows.filter(function (r) { return r[1]; });
}

function htmlBody(data, name, branch, ss) {
  var esc = function (s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };
  var trs = intakeRows(data, name, branch).map(function (r) {
    return '<tr>' +
      '<td style="padding:7px 14px 7px 0;color:#8a93a5;font-size:13px;white-space:nowrap;vertical-align:top">' + esc(r[0]) + '</td>' +
      '<td style="padding:7px 0;color:#1a2233;font-size:14px">' + esc(r[1]) + '</td></tr>';
  }).join('');
  var roleColor = data.role === 'mentee' ? '#B08A3E' : '#3E7BD6';
  return '' +
  '<div style="background:#f2f4f8;padding:26px 12px;font-family:Helvetica,Arial,sans-serif">' +
    '<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e3e6ec">' +
      '<div style="background:#0E1116;padding:18px 26px">' +
        '<div style="color:#DBB65E;font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:700">DAF CGOC &middot; Mentorship Program</div>' +
        '<div style="color:#ffffff;font-size:19px;font-weight:700;margin-top:4px">New ' + esc(data.role) + ' signup</div>' +
      '</div>' +
      '<div style="padding:10px 26px 4px">' +
        '<span style="display:inline-block;background:' + roleColor + '1f;color:' + roleColor + ';border-radius:999px;padding:3px 14px;font-size:12px;font-weight:700;letter-spacing:.5px;text-transform:uppercase">' + esc(data.role) + '</span>' +
      '</div>' +
      '<div style="padding:8px 26px 22px">' +
        '<table style="border-collapse:collapse;width:100%">' + trs + '</table>' +
      '</div>' +
      '<div style="border-top:3px solid #DBB65E;background:#fbfbfd;padding:14px 26px">' +
        '<a href="' + DASHBOARD_URL + '" style="color:#8a7433;font-size:13px;font-weight:700;text-decoration:none">Open the program dashboard &rarr;</a>' +
        '<span style="color:#c3c9d6;font-size:13px"> &nbsp;&middot;&nbsp; </span>' +
        '<a href="' + ss.getUrl() + '" style="color:#8a7433;font-size:13px;font-weight:700;text-decoration:none">Open the response sheet &rarr;</a>' +
      '</div>' +
    '</div>' +
    '<div style="max-width:560px;margin:10px auto 0;color:#9aa3b5;font-size:11px;text-align:center">' +
      'Automated notification &middot; contains member PII, handle accordingly.</div>' +
  '</div>';
}

function plainBody(data, name, branch, ss) {
  return 'New DAF CGOC mentorship signup\n\n' +
    intakeRows(data, name, branch).map(function (r) { return r[0] + ': ' + r[1]; }).join('\n') +
    '\n\nDashboard: ' + DASHBOARD_URL + '\nSheet: ' + ss.getUrl();
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
