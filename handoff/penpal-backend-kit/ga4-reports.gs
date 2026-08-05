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
  // Firebase-linked "dafcgoc" property. Every page is dual-tagged, so this
  // property receives all site + penpal hits; the project owner
  // (nationalcgoc@gmail.com) has access automatically.
  { label: 'DAF CGOC (Firebase property)', id: '548474741' }
  // Optionally also report on the original sitewide property (owns
  // G-74QCBZFVWH) — needs Viewer access granted in that GA account:
  // , { label: 'DAF CGOC (sitewide)', id: 'NUMERIC_ID_FROM_GA_ADMIN' }
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

    var tile = function (label, value) {
      return '<td style="border:1px solid #e3e6ec;border-radius:6px;padding:10px 14px 8px;background:#ffffff">' +
        '<div style="font-size:20px;font-weight:700;color:#0E1116;font-family:Helvetica,Arial,sans-serif">' + value + '</div>' +
        '<div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#8a93a5">' + label + '</div></td>' +
        '<td style="width:6px"></td>';
    };
    var htmlSection = function (title, report, cols, fmt) {
      var rows = (report.rows || []).map(function (r) {
        return '<tr>' + fmt(r).map(function (c, i) {
          return '<td style="padding:5px 10px;border-top:1px solid #eef0f5;font-size:13px;color:#1a2233;' +
                 (i > 0 ? 'text-align:right;color:#4a5468;white-space:nowrap' : '') + '">' + c + '</td>';
        }).join('') + '</tr>';
      }).join('');
      if (!rows) rows = '<tr><td style="padding:6px 10px;color:#9aa3b5;font-size:13px">(no data)</td></tr>';
      return '<div style="margin:18px 0 0">' +
        '<div style="font-size:13px;font-weight:700;color:#0E1116;border-bottom:1px solid #e3e6ec;padding-bottom:3px">' + title + '</div>' +
        '<table style="border-collapse:collapse;width:100%"><tr>' +
        cols.map(function (c, i) {
          return '<th style="padding:6px 10px;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#8a93a5;text-align:' + (i > 0 ? 'right' : 'left') + '">' + c + '</th>';
        }).join('') + '</tr>' + rows + '</table></div>';
    };
    var htmlBody =
      '<div style="background:#f2f4f8;padding:26px 12px;font-family:Helvetica,Arial,sans-serif">' +
      '<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e3e6ec">' +
        '<div style="background:#0E1116;padding:18px 26px">' +
          '<div style="color:#DBB65E;font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:700">DAF CGOC &middot; Website Analytics</div>' +
          '<div style="color:#ffffff;font-size:19px;font-weight:700;margin-top:4px">' + kind + ' report</div>' +
          '<div style="color:#8592AC;font-size:12px;margin-top:2px">' + prop.label + ' &middot; ' + startDate + ' &rarr; ' + endDate + '</div>' +
        '</div>' +
        '<div style="padding:18px 26px 24px">' +
          '<table style="border-collapse:separate;width:100%"><tr>' +
            tile('Users', val(0)) + tile('New', val(1)) + tile('Sessions', val(2)) +
            tile('Views', val(3)) + tile('Avg session', Math.round(val(4)) + 's').replace('<td style="width:6px"></td>', '') +
          '</tr></table>' +
          htmlSection('Top pages', pages, ['Page', 'Views', 'Users', 'Engaged'], function (r) {
            return [r.dimensionValues[0].value, r.metricValues[0].value, r.metricValues[1].value,
                    Math.round(Number(r.metricValues[2].value)) + 's'];
          }) +
          htmlSection('Countries', countries, ['Country', 'Users'], function (r) {
            return [r.dimensionValues[0].value, r.metricValues[0].value];
          }) +
          htmlSection('Devices', devices, ['Device / OS', 'Users'], function (r) {
            return [r.dimensionValues[0].value + ' / ' + r.dimensionValues[1].value, r.metricValues[0].value];
          }) +
          htmlSection('File downloads', downloads, ['File', 'Downloads'], function (r) {
            return [r.dimensionValues[0].value || '(unknown file)', r.metricValues[0].value];
          }) +
          htmlSection('Events', events, ['Event', 'Count'], function (r) {
            return [r.dimensionValues[0].value, r.metricValues[0].value];
          }) +
        '</div>' +
        '<div style="border-top:3px solid #DBB65E;background:#fbfbfd;padding:12px 26px">' +
          '<a href="https://analytics.google.com/" style="color:#8a7433;font-size:13px;font-weight:700;text-decoration:none">Open Google Analytics &rarr;</a>' +
        '</div>' +
      '</div></div>';

    MailApp.sendEmail({
      to: REPORT_EMAIL,
      bcc: REPORT_BCC, // TEMPORARY — remove after testing
      subject: '[DAF CGOC] ' + kind + ' analytics report — ' + prop.label,
      body: body,
      htmlBody: htmlBody
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
