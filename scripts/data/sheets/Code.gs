/**
 * RushPoint — Google Sheet write-back endpoint.
 *
 * Paste this into your spreadsheet's Apps Script editor and deploy it as a Web App.
 * It lets the app write tabs back into THIS sheet (it runs as you, the owner, so no
 * service-account key is needed). Full steps: scripts/data/sheets/APPS_SCRIPT_SETUP.md
 */
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);

    // Optional shared secret. If you set a Script Property RUSHPOINT_TOKEN, the app
    // must send the same value in RUSHPOINT_SHEETS_TOKEN.
    var expected = PropertiesService.getScriptProperties().getProperty('RUSHPOINT_TOKEN');
    if (expected && body.token !== expected) return out_({ ok: false, error: 'unauthorized' });

    var ss = SpreadsheetApp.getActiveSpreadsheet();

    if (body.op === 'replaceTab') {
      var sh = sheet_(ss, body.tab);
      sh.clearContents();
      var rows = body.rows || [];
      if (rows.length) sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
      return out_({ ok: true, wrote: rows.length });
    }

    if (body.op === 'append') {
      var sh2 = sheet_(ss, body.tab);
      (body.rows || []).forEach(function (r) { sh2.appendRow(r); });
      return out_({ ok: true });
    }

    return out_({ ok: false, error: 'unknown op: ' + body.op });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  }
}

function doGet() {
  return out_({ ok: true, service: 'rushpoint-sheet-writeback' });
}

function sheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
