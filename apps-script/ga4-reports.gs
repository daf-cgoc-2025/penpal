/**
 * DAF CGOC — GA4 weekly/monthly analytics report emails
 * ------------------------------------------------------------------
 * Runs in the SAME Apps Script project as poller.gs (or its own).
 * Uses the "AnalyticsData" ADVANCED SERVICE (Google Analytics Data API
 * v1) — enable it in the Apps Script editor under Services (+) →
 * "Google Analytics Data API" before running.
 *
 * The account running this (nationalcgoc@gmail.com) must have at least
 * Viewer access on the GA4 properties below.
 *
 * Triggers (time-driven):
 *   weeklyReport  — Week timer, every Monday, 6–7am
 *   monthlyReport — Month timer, 1st of the month, 6–7am
 *
 * PROPERTY IDS are the NUMERIC GA4 property ids (GA Admin → Property →
 * Property details), NOT the G-XXXX measurement ids. Fill them in:
 *   - "Sitewide" = the property that owns G-74QCBZFVWH
 *   - "Firebase" = the property that owns G-WT36BHRC7X (optional —
 *     dual-tagging sends the same hits to both, so one is usually enough)
 */

var GA4_PROPERTIES = [
  { label: 'DAF CGOC (sitewide)', id: 'REPLACE_WITH_NUMERIC_PROPERTY_ID' }
  // , { label: 'DAF CGOC (Firebase)', id: 'REPLACE_IF_WANTED' }
];

var REPORT_EMAIL = 'nationalcgoc@gmail.com';

// TEMPORARY — testing only. Remove (set to '') after launch verification.
var REPORT_BCC = 'arkady232@gmail.com';

function weeklyReport()  { sendReport('Weekly',  '7daysAgo',  'yesterday'); }
function monthlyReport() { sendReport('Monthly', '30daysAgo', 'yesterday'); }

function sendReport(kind, startDate, endDate) {
  GA4_PROPERTIES.forEach(function (prop) {
    if (String(prop.id).indexOf('REPLACE') === 0) {
      throw new Error('Set the numeric GA4 property id for "' + prop.label + '" in ga4-reports.gs');
    }
    var p = 'properties/' + prop.id;
    var range = [{ startDate: startDate, endDate: endDate }];

    var totals = run(p, {
      dateRanges: range,
      metrics: mets(['activeUsers', 'newUsers', 'sessions', 'screenPageViews', 'averageSessionDuration'])
    });

    var pages = run(p, {
      dateRanges: range,
      dimensions: dims(['pagePath']),
      metrics: mets(['screenPageViews', 'activeUsers', 'userEngagementDuration']),
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
      limit: 10
    });

    var countries = run(p, {
      dateRanges: range,
      dimensions: dims(['country']),
      metrics: mets(['activeUsers']),
      orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
      limit: 10
    });

    var devices = run(p, {
      dateRanges: range,
      dimensions: dims(['deviceCategory', 'operatingSystem']),
      metrics: mets(['activeUsers']),
      orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
      limit: 10
    });

    var downloads = run(p, {
      dateRanges: range,
      dimensions: dims(['fileName']),
      metrics: mets(['eventCount']),
      dimensionFilter: {
        filter: { fieldName: 'eventName', stringFilter: { value: 'file_download' } }
      },
      orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
      limit: 15
    });

    var events = run(p, {
      dateRanges: range,
      dimensions: dims(['eventName']),
      metrics: mets(['eventCount']),
      orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
      limit: 15
    });

    var t = (totals.rows && totals.rows[0]) ? totals.rows[0].metricValues : [];
    var val = function (i) { return t[i] ? Number(t[i].value) : 0; };

    var body =
      kind + ' analytics — ' + prop.label + ' (' + startDate + ' → ' + endDate + ')\n' +
      '====================================================\n\n' +
      'Active users:        ' + val(0) + '\n' +
      'New users:           ' + val(1) + '\n' +
      'Sessions:            ' + val(2) + '\n' +
      'Page views:          ' + val(3) + '\n' +
      'Avg session length:  ' + Math.round(val(4)) + 's\n\n' +
      section('Top pages (views · users · total engaged seconds)', pages, function (r) {
        return r.dimensionValues[0].value + '  —  ' + r.metricValues[0].value +
               ' · ' + r.metricValues[1].value + ' · ' + Math.round(Number(r.metricValues[2].value)) + 's';
      }) +
      section('Countries (active users)', countries, function (r) {
        return r.dimensionValues[0].value + '  —  ' + r.metricValues[0].value;
      }) +
      section('Devices (active users)', devices, function (r) {
        return r.dimensionValues[0].value + ' / ' + r.dimensionValues[1].value + '  —  ' + r.metricValues[0].value;
      }) +
      section('File downloads', downloads, function (r) {
        return (r.dimensionValues[0].value || '(unknown file)') + '  —  ' + r.metricValues[0].value;
      }) +
      section('All events', events, function (r) {
        return r.dimensionValues[0].value + '  —  ' + r.metricValues[0].value;
      });

    MailApp.sendEmail({
      to: REPORT_EMAIL,
      bcc: REPORT_BCC, // TEMPORARY — remove after testing
      subject: '[DAF CGOC] ' + kind + ' analytics report — ' + prop.label,
      body: body
    });
  });
}

function run(property, request) {
  return AnalyticsData.Properties.runReport(request, property);
}
function dims(names) { return names.map(function (n) { return { name: n }; }); }
function mets(names) { return names.map(function (n) { return { name: n }; }); }
function section(title, report, fmt) {
  var lines = (report.rows || []).map(function (r) { return '  ' + fmt(r); });
  return title + '\n' + (lines.length ? lines.join('\n') : '  (no data)') + '\n\n';
}
