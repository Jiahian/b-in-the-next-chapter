/**
 * BNext(B in the Next Chapter)! — Apps Script backend
 * ------------------------------------------------
 * Bound to a Google Sheet. Deploy as a Web App (Extensions > Apps Script,
 * then Deploy > New deployment > Web app, "Execute as: Me",
 * "Who has access: Anyone with the link"). See SETUP_GUIDE.md.
 *
 * Data model deliberately mirrors what a future Firestore migration would
 * look like (see PRD §12.3): a stable UUID entryId per row, ISO timestamps,
 * and media referenced by plain fileId/URL rather than anything
 * Sheets-specific — so Phase 2 can lift this straight into Firestore
 * documents with no rework.
 */

var SHEET_NAME = 'Entries';
var DRIVE_FOLDER_NAME = 'BNext - Media';
var CATEGORIES = ['Spiritual', 'Relationship', 'Others'];
var UNITS = ['km', 'hours'];

// Column order — also the row-write order. Keep in sync with index.html.
var HEADERS = [
  'entryId', 'name', 'category', 'activity', 'date', 'amount', 'units',
  'driveFileId', 'mediaUrl', 'mediaType', 'createdAt', 'updatedAt', 'deleted'
];

// ---------------------------------------------------------------------
// One-time setup — run this once from the Apps Script editor
// (select `setup` in the function dropdown, click Run).
// ---------------------------------------------------------------------
function setup() {
  var sheet = getSheet_();
  var folder = getFolder_();
  Logger.log('Sheet ready: ' + sheet.getParent().getUrl());
  Logger.log('Drive folder ready: ' + folder.getUrl());
  Logger.log('Drive folder ID (only needed if you ever want it manually): ' + folder.getId());
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getFolder_() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('DRIVE_FOLDER_ID');
  if (folderId) {
    try {
      return DriveApp.getFolderById(folderId);
    } catch (err) {
      // stored id no longer valid — fall through and recreate
    }
  }
  var folder = DriveApp.createFolder(DRIVE_FOLDER_NAME);
  props.setProperty('DRIVE_FOLDER_ID', folder.getId());
  return folder;
}

function indexOf_(field) {
  return HEADERS.indexOf(field);
}

// ---------------------------------------------------------------------
// Web app entry points
// ---------------------------------------------------------------------
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'list';
  try {
    if (action === 'ping') {
      return jsonOutput_({ ok: true, message: 'BNext backend is live.' });
    }
    if (action === 'list') {
      return jsonOutput_({ ok: true, entries: listEntries_() });
    }
    if (action === 'media') {
      return serveMedia_(e.parameter.fileId);
    }
    return jsonOutput_({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonOutput_({ ok: false, error: String(err) });
  }
}

/**
 * Re-serves a Drive file's bytes directly from our own domain, for the
 * image-resize/crop feature: Drive's own hotlink URLs don't reliably send
 * CORS headers permissive enough for <canvas> to read pixels back out
 * without tainting, which silently breaks export. Routing through our own
 * Web App gives us a response we control.
 */
function serveMedia_(fileId) {
  if (!fileId) return jsonOutput_({ ok: false, error: 'Missing fileId' });
  var file = DriveApp.getFileById(fileId);
  return file.getBlob();
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOutput_({ ok: false, error: 'Invalid JSON body' });
  }

  // Serialize writes so two near-simultaneous submissions from different
  // friends can't corrupt each other (Sheets isn't transactional).
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var action = body.action;
    if (action === 'create') return jsonOutput_(createEntry_(body));
    if (action === 'update') return jsonOutput_(updateEntry_(body));
    if (action === 'delete') return jsonOutput_(deleteEntry_(body));
    return jsonOutput_({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonOutput_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------
function listEntries_() {
  var sheet = getSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  var entries = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var entry = rowToEntry_(row);
    if (entry.entryId && !entry.deleted) entries.push(entry);
  }
  return entries;
}

function rowToEntry_(row) {
  var entry = {};
  HEADERS.forEach(function (field, idx) {
    entry[field] = row[idx];
  });
  entry.amount = Number(entry.amount) || 0;
  entry.deleted = entry.deleted === true || entry.deleted === 'TRUE';
  return entry;
}

// ---------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------
function createEntry_(body) {
  var validation = validateEntryFields_(body, /*requireMedia*/ true);
  if (validation.error) return { ok: false, error: validation.error };

  var media = saveMedia_(body.media);
  var sheet = getSheet_();
  var now = new Date().toISOString();
  var entryId = Utilities.getUuid();

  var row = HEADERS.map(function (field) {
    switch (field) {
      case 'entryId': return entryId;
      case 'name': return validation.value.name;
      case 'category': return validation.value.category;
      case 'activity': return validation.value.activity;
      case 'date': return validation.value.date;
      case 'amount': return validation.value.amount;
      case 'units': return validation.value.units;
      case 'driveFileId': return media.fileId;
      case 'mediaUrl': return media.mediaUrl;
      case 'mediaType': return media.mediaType;
      case 'createdAt': return now;
      case 'updatedAt': return now;
      case 'deleted': return false;
      default: return '';
    }
  });
  sheet.appendRow(row);
  return { ok: true, entry: rowToEntry_(row) };
}

function updateEntry_(body) {
  if (!body.entryId) return { ok: false, error: 'Missing entryId' };
  var sheet = getSheet_();
  var rowIndex = findRowByEntryId_(sheet, body.entryId);
  if (rowIndex === -1) return { ok: false, error: 'Entry not found' };

  var validation = validateEntryFields_(body, /*requireMedia*/ false);
  if (validation.error) return { ok: false, error: validation.error };

  var range = sheet.getRange(rowIndex, 1, 1, HEADERS.length);
  var existing = rowToEntry_(range.getValues()[0]);

  var updated = {
    name: validation.value.name,
    category: validation.value.category,
    activity: validation.value.activity,
    date: validation.value.date,
    amount: validation.value.amount,
    units: validation.value.units,
    driveFileId: existing.driveFileId,
    mediaUrl: existing.mediaUrl,
    mediaType: existing.mediaType
  };

  if (body.media) {
    var media = saveMedia_(body.media);
    // Best-effort delete of the old file — don't fail the whole update if this errors.
    try {
      if (existing.driveFileId) DriveApp.getFileById(existing.driveFileId).setTrashed(true);
    } catch (err) {
      // ignore — old file may already be gone
    }
    updated.driveFileId = media.fileId;
    updated.mediaUrl = media.mediaUrl;
    updated.mediaType = media.mediaType;
  }

  var now = new Date().toISOString();
  var row = HEADERS.map(function (field) {
    if (field === 'entryId') return existing.entryId;
    if (field === 'createdAt') return existing.createdAt;
    if (field === 'updatedAt') return now;
    if (field === 'deleted') return false;
    return updated[field];
  });
  range.setValues([row]);
  return { ok: true, entry: rowToEntry_(row) };
}

function deleteEntry_(body) {
  if (!body.entryId) return { ok: false, error: 'Missing entryId' };
  var sheet = getSheet_();
  var rowIndex = findRowByEntryId_(sheet, body.entryId);
  if (rowIndex === -1) return { ok: false, error: 'Entry not found' };

  var range = sheet.getRange(rowIndex, 1, 1, HEADERS.length);
  var existing = rowToEntry_(range.getValues()[0]);

  try {
    if (existing.driveFileId) DriveApp.getFileById(existing.driveFileId).setTrashed(true);
  } catch (err) {
    // ignore — file may already be gone
  }

  var now = new Date().toISOString();
  sheet.getRange(rowIndex, indexOf_('deleted') + 1).setValue(true);
  sheet.getRange(rowIndex, indexOf_('updatedAt') + 1).setValue(now);
  return { ok: true, entryId: existing.entryId };
}

function findRowByEntryId_(sheet, entryId) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var ids = sheet.getRange(2, indexOf_('entryId') + 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === entryId) return i + 2; // +2: header row + 1-based index
  }
  return -1;
}

// ---------------------------------------------------------------------
// Validation & media handling
// ---------------------------------------------------------------------
function validateEntryFields_(body, requireMedia) {
  var name = String(body.name || '').trim();
  var category = String(body.category || '').trim();
  var activity = String(body.activity || '').trim();
  var date = String(body.date || '').trim();
  var amount = Math.round(Number(body.amount) * 10) / 10;
  var units = String(body.units || '').trim();

  if (!name) return { error: 'Name is required' };
  if (CATEGORIES.indexOf(category) === -1) return { error: 'Invalid category' };
  if (!activity) return { error: 'Activity name is required' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Invalid date format' };
  if (date > todayString_()) return { error: 'Date cannot be in the future' };
  if (!(amount > 0)) return { error: 'Amount must be greater than 0' };
  if (UNITS.indexOf(units) === -1) return { error: 'Invalid units' };
  if (requireMedia && !body.media) return { error: 'Photo/video is required' };

  return { value: { name: name, category: category, activity: activity, date: date, amount: amount, units: units } };
}

function todayString_() {
  return Utilities.formatDate(new Date(), 'Asia/Singapore', 'yyyy-MM-dd');
}

/**
 * body.media = { data: <base64 string, no data: prefix>, filename: string, mimeType: string }
 */
function saveMedia_(media) {
  if (!media || !media.data || !media.mimeType) {
    throw new Error('Malformed media payload');
  }
  var bytes = Utilities.base64Decode(media.data);
  var blob = Utilities.newBlob(bytes, media.mimeType, media.filename || 'upload');
  var folder = getFolder_();
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var fileId = file.getId();
  var mediaType = media.mimeType.indexOf('video') === 0 ? 'video' : 'image';
  return {
    fileId: fileId,
    mediaType: mediaType,
    // Convenience field for spreadsheet readability — the front-end builds
    // the correct embed URL itself (image vs. video need different Drive
    // URL patterns), it doesn't rely on this string alone.
    mediaUrl: 'https://drive.google.com/file/d/' + fileId + '/view'
  };
}
