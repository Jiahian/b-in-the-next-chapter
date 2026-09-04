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
 *
 * Requires one Script Property (Project Settings > Script Properties in
 * the Apps Script editor): GOOGLE_CLIENT_ID (the OAuth client ID the
 * front-end signs in with). The email allowlist itself lives in the
 * "Allowlist" sheet tab (one person per row: name, email) — see
 * isAllowedEmail_() below; add/remove people by editing that tab
 * directly, no script edit needed.
 */

var SHEET_NAME = 'Entries';
var USERS_SHEET_NAME = 'Users';
var ALLOWLIST_SHEET_NAME = 'Allowlist';
var DRIVE_FOLDER_NAME = 'BNext - Media';
var CATEGORIES = ['Spiritual', 'Relationship', 'Others'];
var UNITS = ['km', 'hours'];

// Column order — also the row-write order. Keep in sync with index.html.
// 'userId' (Google's stable 'sub' claim) was added after launch — legacy
// rows predating it are left blank, which updateEntry_/deleteEntry_ treat
// as "no owner, anyone may edit" rather than orphaning them.
// 'participants' is a comma-separated list of OTHER users' userIds tagged
// as having done the activity together — the logger (userId) is always
// the sole owner/editor; participants are along for the record, not
// co-owners. Stored denormalized (not a join-table sheet) since the set
// is small and bounded per entry — mirrors how this'd be a plain array
// field on a Firestore document (see PRD §12.3).
var HEADERS = [
  'entryId', 'name', 'category', 'activity', 'date', 'amount', 'units',
  'driveFileId', 'mediaUrl', 'mediaType', 'createdAt', 'updatedAt', 'deleted',
  'userId', 'participants'
];

var USER_HEADERS = ['userId', 'email', 'username', 'createdAt', 'updatedAt'];

// 'name' here is just an admin-facing label for tracking who's who in the
// Allowlist tab — unrelated to the display name a user picks for their own
// profile (USER_HEADERS' 'username'). Only 'email' is actually checked.
var ALLOWLIST_HEADERS = ['name', 'email'];

// ---------------------------------------------------------------------
// One-time setup — run this once from the Apps Script editor
// (select `setup` in the function dropdown, click Run).
// ---------------------------------------------------------------------
function setup() {
  var sheet = getSheet_();
  var usersSheet = getUsersSheet_();
  var allowlistSheet = getAllowlistSheet_();
  var folder = getFolder_();
  Logger.log('Sheet ready: ' + sheet.getParent().getUrl());
  Logger.log('Users sheet ready (tab: ' + usersSheet.getName() + ').');
  Logger.log('Allowlist sheet ready (tab: ' + allowlistSheet.getName() + ') — add one approved person per row (name, email), under the header.');
  Logger.log('Drive folder ready: ' + folder.getUrl());
  Logger.log('Drive folder ID (only needed if you ever want it manually): ' + folder.getId());
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  ensureHeaders_(sheet, HEADERS);
  return sheet;
}

function getUsersSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(USERS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(USERS_SHEET_NAME);
  }
  ensureHeaders_(sheet, USER_HEADERS);
  return sheet;
}

function getAllowlistSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(ALLOWLIST_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(ALLOWLIST_SHEET_NAME);
  }
  ensureHeaders_(sheet, ALLOWLIST_HEADERS);
  return sheet;
}

// Keeps row 1 in sync with the current headers array, so growing the
// schema (e.g. adding a column) on an already-populated sheet doesn't
// need a manual migration step — it just self-heals on next access.
function ensureHeaders_(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    return;
  }
  var existing = sheet.getRange(1, 1, 1, Math.max(sheet.getMaxColumns(), headers.length)).getValues()[0];
  var existingCount = 0;
  for (var i = 0; i < existing.length; i++) {
    if (existing[i] !== '') existingCount = i + 1;
  }
  if (existingCount < headers.length) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
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

function userIndexOf_(field) {
  return USER_HEADERS.indexOf(field);
}

// ---------------------------------------------------------------------
// Auth — Google Sign-In + email allowlist (PRD §8.3 option B).
//
// Verification uses Google's `tokeninfo` convenience endpoint rather than a
// full JWKS/RS256 signature check: Apps Script has no built-in RSA verify
// and pulling in a library is overkill for a $0, ~30-person friend app.
// `tokeninfo` still validates the signature and expiry server-side on
// Google's end — it's just not meant for high-volume production traffic,
// which this app will never see.
// ---------------------------------------------------------------------
var GOOGLE_CLIENT_ID_PROP = 'GOOGLE_CLIENT_ID';

/**
 * Verifies a Google ID token and checks the resulting email against the
 * Allowlist sheet tab. Returns { ok: true, email, name, userId }
 * or { ok: false, code: 'AUTH_REQUIRED' | 'FORBIDDEN', error }.
 * AUTH_REQUIRED means "sign in (again)"; FORBIDDEN means "signed in, but
 * that account isn't on the list" — the front-end treats these differently.
 * userId is Google's 'sub' claim — stable per Google account, used to key
 * entries/profiles rather than email (which a user could technically change).
 */
function requireAuth_(idToken) {
  if (!idToken) return { ok: false, code: 'AUTH_REQUIRED', error: 'Sign-in required' };

  var props = PropertiesService.getScriptProperties();
  var clientId = props.getProperty(GOOGLE_CLIENT_ID_PROP);

  var resp;
  try {
    resp = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
      { muteHttpExceptions: true }
    );
  } catch (err) {
    return { ok: false, code: 'AUTH_REQUIRED', error: 'Could not verify sign-in' };
  }
  if (resp.getResponseCode() !== 200) {
    return { ok: false, code: 'AUTH_REQUIRED', error: 'Session expired — please sign in again' };
  }

  var payload;
  try {
    payload = JSON.parse(resp.getContentText());
  } catch (err) {
    return { ok: false, code: 'AUTH_REQUIRED', error: 'Could not verify sign-in' };
  }

  if (!clientId || payload.aud !== clientId) {
    return { ok: false, code: 'AUTH_REQUIRED', error: 'Sign-in not valid for this app' };
  }
  if (payload.email_verified !== 'true' && payload.email_verified !== true) {
    return { ok: false, code: 'AUTH_REQUIRED', error: 'Email not verified' };
  }

  var email = String(payload.email || '').toLowerCase().trim();
  if (!isAllowedEmail_(email)) {
    return { ok: false, code: 'FORBIDDEN', error: "This Google account isn't on the group list" };
  }

  return { ok: true, email: email, name: payload.name || email, userId: payload.sub };
}

function isAllowedEmail_(email) {
  var sheet = getAllowlistSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  var emailCol = ALLOWLIST_HEADERS.indexOf('email');
  var values = sheet.getRange(2, 1, lastRow - 1, ALLOWLIST_HEADERS.length).getValues();
  for (var i = 0; i < values.length; i++) {
    var cell = String(values[i][emailCol] || '').trim().toLowerCase();
    if (cell && cell === email) return true;
  }
  return false;
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
      var auth = requireAuth_(e.parameter.idToken);
      if (!auth.ok) return jsonOutput_({ ok: false, code: auth.code, error: auth.error });
      return jsonOutput_({ ok: true, entries: listEntries_(), users: listUsers_() });
    }
    if (action === 'profile') {
      var authP = requireAuth_(e.parameter.idToken);
      if (!authP.ok) return jsonOutput_({ ok: false, code: authP.code, error: authP.error });
      return jsonOutput_({ ok: true, profile: getUserProfile_(authP.userId), email: authP.email });
    }
    return jsonOutput_({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonOutput_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOutput_({ ok: false, error: 'Invalid JSON body' });
  }

  var auth = requireAuth_(body.idToken);
  if (!auth.ok) return jsonOutput_({ ok: false, code: auth.code, error: auth.error });

  // Serialize writes so two near-simultaneous submissions from different
  // friends can't corrupt each other (Sheets isn't transactional).
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var action = body.action;
    if (action === 'create') return jsonOutput_(createEntry_(body, auth));
    if (action === 'update') return jsonOutput_(updateEntry_(body, auth));
    if (action === 'delete') return jsonOutput_(deleteEntry_(body, auth));
    if (action === 'setUsername') return jsonOutput_(upsertUserProfile_(auth, body.username));
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
  entry.participants = String(entry.participants || '')
    .split(',')
    .map(function (s) { return s.trim(); })
    .filter(Boolean);
  return entry;
}

// Cleans a client-supplied participants list down to valid, deduplicated
// userIds: strings only, the logger's own id stripped out (they're the
// owner already, not a "participant"), duplicates and unknowns removed.
function sanitizeParticipants_(rawList, ownerUserId) {
  if (!Array.isArray(rawList)) return [];
  var knownIds = listUsers_().map(function (u) { return u.userId; });
  var seen = {};
  var result = [];
  rawList.forEach(function (id) {
    id = String(id || '').trim();
    if (!id || id === ownerUserId || seen[id] || knownIds.indexOf(id) === -1) return;
    seen[id] = true;
    result.push(id);
  });
  return result;
}

function listUsers_() {
  var sheet = getUsersSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, USER_HEADERS.length).getValues();
  return values.map(rowToUser_).filter(function (u) { return u.userId; });
}

function rowToUser_(row) {
  var user = {};
  USER_HEADERS.forEach(function (field, idx) {
    user[field] = row[idx];
  });
  return user;
}

function getUserProfile_(userId) {
  var sheet = getUsersSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var values = sheet.getRange(2, 1, lastRow - 1, USER_HEADERS.length).getValues();
  for (var i = 0; i < values.length; i++) {
    if (values[i][userIndexOf_('userId')] === userId) return rowToUser_(values[i]);
  }
  return null;
}

// ---------------------------------------------------------------------
// Profile writes
// ---------------------------------------------------------------------
/**
 * Creates the caller's profile row on first sign-in. Display names are
 * intentionally immutable after selection, keyed by the verified userId
 * (Google's 'sub' claim), never client-supplied.
 */
function upsertUserProfile_(auth, username) {
  username = String(username || '').trim();
  if (!username) return { ok: false, error: 'Username is required' };
  if (username.length > 24) return { ok: false, error: 'Username is too long (max 24 characters)' };

  var sheet = getUsersSheet_();
  var lastRow = sheet.getLastRow();
  var now = new Date().toISOString();

  if (lastRow >= 2) {
    var values = sheet.getRange(2, 1, lastRow - 1, USER_HEADERS.length).getValues();
    for (var i = 0; i < values.length; i++) {
      if (values[i][userIndexOf_('userId')] === auth.userId) {
        return { ok: false, error: 'Display name has already been selected' };
      }
    }
  }

  var row = USER_HEADERS.map(function (field) {
    switch (field) {
      case 'userId': return auth.userId;
      case 'email': return auth.email;
      case 'username': return username;
      case 'createdAt': return now;
      case 'updatedAt': return now;
      default: return '';
    }
  });
  sheet.appendRow(row);
  return { ok: true, user: { userId: auth.userId, email: auth.email, username: username } };
}

// ---------------------------------------------------------------------
// Entry writes
// ---------------------------------------------------------------------
function createEntry_(body, auth) {
  var validation = validateEntryFields_(body, /*requireMedia*/ true);
  if (validation.error) return { ok: false, error: validation.error };

  var media = saveMedia_(body.media);
  var sheet = getSheet_();
  var now = new Date().toISOString();
  var entryId = Utilities.getUuid();
  var participants = sanitizeParticipants_(body.participants, auth.userId);

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
      case 'userId': return auth.userId;
      case 'participants': return participants.join(',');
      default: return '';
    }
  });
  sheet.appendRow(row);
  return { ok: true, entry: rowToEntry_(row) };
}

function updateEntry_(body, auth) {
  if (!body.entryId) return { ok: false, error: 'Missing entryId' };
  var sheet = getSheet_();
  var rowIndex = findRowByEntryId_(sheet, body.entryId);
  if (rowIndex === -1) return { ok: false, error: 'Entry not found' };

  var range = sheet.getRange(rowIndex, 1, 1, HEADERS.length);
  var existing = rowToEntry_(range.getValues()[0]);

  // Legacy entries (logged before userId existed) have no owner and stay
  // editable by anyone, matching the original trust-based design. Entries
  // with a real owner can only be edited by that owner.
  if (existing.userId && existing.userId !== auth.userId) {
    return { ok: false, error: 'You can only edit your own entries' };
  }

  var validation = validateEntryFields_(body, /*requireMedia*/ false);
  if (validation.error) return { ok: false, error: validation.error };

  var participants = (body.participants !== undefined)
    ? sanitizeParticipants_(body.participants, existing.userId || auth.userId)
    : existing.participants;

  var updated = {
    name: validation.value.name,
    category: validation.value.category,
    activity: validation.value.activity,
    date: validation.value.date,
    amount: validation.value.amount,
    units: validation.value.units,
    driveFileId: existing.driveFileId,
    mediaUrl: existing.mediaUrl,
    mediaType: existing.mediaType,
    userId: existing.userId, // never reassigned by an edit
    participants: participants.join(',')
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

function deleteEntry_(body, auth) {
  if (!body.entryId) return { ok: false, error: 'Missing entryId' };
  var sheet = getSheet_();
  var rowIndex = findRowByEntryId_(sheet, body.entryId);
  if (rowIndex === -1) return { ok: false, error: 'Entry not found' };

  var range = sheet.getRange(rowIndex, 1, 1, HEADERS.length);
  var existing = rowToEntry_(range.getValues()[0]);

  if (existing.userId && existing.userId !== auth.userId) {
    return { ok: false, error: 'You can only delete your own entries' };
  }

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

  if (!name) return { error: 'Please describe what went on' };
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
