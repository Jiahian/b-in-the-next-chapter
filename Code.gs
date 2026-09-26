/**
 * BNext(B in the Next Chapter)! — Apps Script backend
 * ------------------------------------------------
 * Bound to a Google Sheet. Deploy as a Web App (Extensions > Apps Script,
 * then Deploy > New deployment > Web app, "Execute as: Me",
 * "Who has access: Anyone with the link"). See docs/SETUP.md.
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

// Bump this on every deploy so you can confirm which code is actually LIVE:
// open <WEB_APP_URL>?action=ping in a browser — the JSON echoes this string.
// If it doesn't match what you just pasted, the deployment didn't update.
var BACKEND_VERSION = '2026-09-26-namemaplog-removed';

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
// 'tagged_friends' is a comma-separated list of OTHER users' userIds
// tagged as having done the activity together — the logger (userId) is
// always the sole owner/editor; tagged friends are along for the
// record, not co-owners. Stored denormalized (not a join-table sheet)
// since the set is small and bounded per entry — mirrors how this'd be
// a plain array field on a Firestore document (see PRD §12.3).
// 'highlightOfWeek' (admin-ticked) / 'highlightAnnouncedAt' (script-stamped)
// were appended after the notifications feature — appended at the END so
// existing rows' column positions are untouched. Keep in sync with index.html.
var HEADERS = [
  'entryId', 'activityDesc', 'category', 'activityTitle', 'date', 'amount', 'units',
  'driveFileId', 'mediaUrl', 'mediaType', 'createdAt', 'updatedAt', 'deleted',
  'userId', 'tagged_friends', 'highlightOfWeek', 'highlightAnnouncedAt'
];

// Counter columns (postCount onward) were appended for the notifications
// feature — first-post detection, streaks, and Phase 2 achievement badges.
// Populated by recomputeUserCounters_/backfillUserCounters, not on signup.
var USER_HEADERS = [
  'userId', 'email', 'username', 'createdAt', 'updatedAt',
  'postCount', 'spiritualPostCount', 'relationshipPostCount', 'othersPostCount',
  'currentDailyStreak', 'longestDailyStreak', 'lastEntryDate',
  'currentWeeklyStreak', 'longestWeeklyStreak', 'lastEntryWeek',
  'taggedInCount', 'groupActivityPostCount'
];

// 'name' here is just an admin-facing label for tracking who's who in the
// Allowlist tab — unrelated to the display name a user picks for their own
// profile (USER_HEADERS' 'username'). Only 'email' is actually checked.
var ALLOWLIST_HEADERS = ['name', 'email'];

// ---------------------------------------------------------------------
// Notifications feature — sheet tabs, style-guide Doc, phone-editable
// Settings. See NOTES_notification_plan.md for the full design.
// ---------------------------------------------------------------------
var SETTINGS_SHEET_NAME = 'Settings';
var NOTIFICATIONS_SHEET_NAME = 'Notifications';
var STYLE_GUIDE_DOC_NAME = 'BNext — Notification Style Guide';

// Curated name-scrub map (phone-editable) so nicknames/shortforms and specific
// non-member/sensitive words never reach Gemini. One row per variant:
//  - mapsToUserId filled  → a member's alias; restores to that member's username
//  - mapsToUserId blank    → an extra word (non-member name, sensitive term);
//                            restores to NEUTRAL_NAME since there's no real name
var NAMESCRUB_SHEET_NAME = 'NameScrub';
var NAMESCRUB_HEADERS = ['variant', 'mapsToUserId', 'note'];
var NEUTRAL_NAME = 'a friend';

// Phone-editable key/value tunables — parsed by getSettings_() with safe
// fallbacks. Same "edit a sheet tab, no redeploy" idiom as the Allowlist.
var SETTINGS_HEADERS = ['key', 'value'];

// Seed rows written on first setup(). seedSettingsDefaults_ only ADDS keys
// that are missing, so re-running setup() never clobbers admin edits.
var SETTINGS_DEFAULTS = [
  ['ENTRY_ANNOUNCEMENTS_ENABLED', 'true'],
  ['MILESTONES', '100,250,500,750,900,1000'],
  ['LAST_MILESTONE_ANNOUNCED', '0'],
  ['MILESTONE_ANNOUNCEMENTS_ENABLED', 'true'],
  ['FIRST_POST_MENTION_ENABLED', 'true'],
  ['GROUP_ACTIVITY_MENTION_ENABLED', 'true'],
  ['HIGHLIGHT_ANNOUNCEMENT_ENABLED', 'true'],
  ['POINTS_UPDATE_MODE', 'weekly'],
  ['POINTS_UPDATE_DAY_OF_WEEK', 'Sunday'],
  ['POINTS_UPDATE_HOUR', '20'],
  ['POINTS_UPDATE_SPECIFIC_DATES', ''],
  ['POINTS_UPDATE_LAST_SENT_DATE', ''],
  ['HIGHLIGHT_LAST_SENT_WEEK', ''],
  ['MAX_NOTIFICATION_RETRIES', '5'],
  ['STYLE_GUIDE_DOC_ID', ''],
  ['GEMINI_MODEL', 'gemini-2.0-flash'],
  ['FRONTEND_URL', '']
];

// Notifications tab doubles as the send queue (status column drives it).
// notificationId/entryId are UUIDs; contextJson/messageContent are text —
// none are the bare all-digit strings that trigger the Sheets number
// coercion gotcha, except telegramMessageId (guarded plain-text on write).
var NOTIFICATION_HEADERS = [
  'notificationId', 'type', 'entryId', 'contextJson', 'messageContent',
  'mediaUrl', 'mediaType', 'status', 'retryCount', 'telegramMessageId',
  'createdAt', 'sentAt', 'lastError'
];

// ---------------------------------------------------------------------
// One-time setup — run this once from the Apps Script editor
// (select `setup` in the function dropdown, click Run).
// ---------------------------------------------------------------------
function setup() {
  var sheet = getSheet_();
  var usersSheet = getUsersSheet_();
  var allowlistSheet = getAllowlistSheet_();
  var settingsSheet = getSettingsSheet_();
  var notificationsSheet = getNotificationsSheet_();
  var nameScrubSheet = getNameScrubSheet_();
  var folder = getFolder_();
  forcePlainTextColumns_(sheet, ['userId', 'tagged_friends', 'date'], HEADERS);
  forcePlainTextColumns_(usersSheet, ['userId', 'lastEntryDate'], USER_HEADERS);
  forcePlainTextColumns_(notificationsSheet, ['telegramMessageId'], NOTIFICATION_HEADERS);
  // userId column here is a member's ~21-digit id — keep it plain text so it
  // can be matched against Users, and 'variant' too (a variant could be digits).
  forcePlainTextColumns_(nameScrubSheet, ['variant', 'mapsToUserId'], NAMESCRUB_HEADERS);
  var doc = getOrCreateStyleGuideDoc_();
  Logger.log('Sheet ready: ' + sheet.getParent().getUrl());
  Logger.log('Users sheet ready (tab: ' + usersSheet.getName() + ').');
  Logger.log('Allowlist sheet ready (tab: ' + allowlistSheet.getName() + ') — add one approved person per row (name, email), under the header.');
  Logger.log('Settings sheet ready (tab: ' + settingsSheet.getName() + ') — phone-editable tunables, defaults seeded.');
  Logger.log('Notifications sheet ready (tab: ' + notificationsSheet.getName() + ') — send queue + delivery log.');
  Logger.log('NameScrub sheet ready (tab: ' + nameScrubSheet.getName() + ') — add name variants / sensitive words to hide from Gemini.');
  Logger.log('Style-guide Doc ready: ' + doc.getUrl());
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

function getSettingsSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SETTINGS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SETTINGS_SHEET_NAME);
  }
  ensureHeaders_(sheet, SETTINGS_HEADERS);
  // The value column holds comma lists (MILESTONES, dates) that Sheets would
  // otherwise coerce to a single Number — force the whole column to plain text.
  forcePlainTextColumns_(sheet, ['value'], SETTINGS_HEADERS);
  seedSettingsDefaults_(sheet);
  return sheet;
}

// Adds any SETTINGS_DEFAULTS key not already present. Never overwrites an
// existing value, so re-running setup() is safe and preserves admin edits.
function seedSettingsDefaults_(sheet) {
  var lastRow = sheet.getLastRow();
  var existing = {};
  if (lastRow >= 2) {
    var values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < values.length; i++) {
      existing[String(values[i][0]).trim()] = true;
    }
  }
  SETTINGS_DEFAULTS.forEach(function (pair) {
    if (existing[pair[0]]) return;
    var row = sheet.getLastRow() + 1;
    sheet.getRange(row, 1, 1, 2).setValues([[pair[0], pair[1]]]);
  });
}

function getNotificationsSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(NOTIFICATIONS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(NOTIFICATIONS_SHEET_NAME);
  }
  ensureHeaders_(sheet, NOTIFICATION_HEADERS);
  return sheet;
}

function getNameScrubSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(NAMESCRUB_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(NAMESCRUB_SHEET_NAME);
  }
  ensureHeaders_(sheet, NAMESCRUB_HEADERS);
  return sheet;
}

// Reads the NameScrub tab as [{ variant, mapsToUserId }] (blank/whitespace
// variants skipped). Kept separate from buildNameScrubMap_ so it's easy to test.
function listNameScrubRows_() {
  var sheet = getNameScrubSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, NAMESCRUB_HEADERS.length).getValues();
  var variantCol = NAMESCRUB_HEADERS.indexOf('variant');
  var userCol = NAMESCRUB_HEADERS.indexOf('mapsToUserId');
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    var variant = String(values[i][variantCol] == null ? '' : values[i][variantCol]).trim();
    if (!variant) continue;
    rows.push({ variant: variant, mapsToUserId: String(values[i][userCol] == null ? '' : values[i][userCol]).trim() });
  }
  return rows;
}

// Creates the style-guide Doc once and records its id in Settings
// (STYLE_GUIDE_DOC_ID). Idempotent: reuses the stored id if the Doc still
// exists, recreates only if it was deleted. Seeds a starter tone guide the
// admin can freely edit later.
function getOrCreateStyleGuideDoc_() {
  var settingsSheet = getSettingsSheet_();
  var docId = getSettingValue_(settingsSheet, 'STYLE_GUIDE_DOC_ID');
  if (docId) {
    try {
      return DocumentApp.openById(docId);
    } catch (err) {
      // stored id no longer valid — fall through and recreate
    }
  }
  var doc = DocumentApp.create(STYLE_GUIDE_DOC_NAME);
  doc.getBody().setText(STYLE_GUIDE_STARTER_TEXT);
  doc.saveAndClose();
  setSettingValue_(settingsSheet, 'STYLE_GUIDE_DOC_ID', doc.getId());
  return DocumentApp.openById(doc.getId());
}

// Reads one Settings value by key straight off the sheet. Returns '' if
// absent. (getSettings_() — the cached, typed accessor — arrives in a later
// phase; this bare helper is all setup()/style-guide wiring needs.)
function getSettingValue_(sheet, key) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return '';
  var values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim() === key) return String(values[i][1]);
  }
  return '';
}

function setSettingValue_(sheet, key, value) {
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i][0]).trim() === key) {
        sheet.getRange(i + 2, 2).setValue(value);
        return;
      }
    }
  }
  var row = sheet.getLastRow() + 1;
  sheet.getRange(row, 1, 1, 2).setValues([[key, value]]);
}

// Starter content for a NEWLY created style-guide Doc. Everything here is
// human-editable from the phone — the whole text (except the Fallback lines,
// which are parsed out) is sent to Gemini as the tone + instructions. Editing
// this Doc changes how messages read, with no code change. (Two things are
// NOT here and can't be edited away: the placeholder-code rule and the facts,
// which the backend always appends — see buildGeminiPrompt_.)
var STYLE_GUIDE_STARTER_TEXT = [
  'BNext — Notification Style Guide',
  '',
  'You are the friendly announcer for a private friend-group activity tracker working toward a shared points goal by 31 Dec 2026.',
  '',
  'How to write each announcement:',
  '- ONE short line, max ~200 characters.',
  '- Warm, hype, encouraging — like a friend cheering the group on.',
  '- At most 1-2 emoji. No hashtags.',
  '- Vary the wording so repeated announcements never feel templated.',
  '- Output only the message text, nothing else.',
  '',
  'This Doc is edited from your phone; the backend fetches it (cached ~10 min) to steer the AI-written announcements. Add example messages and adjust tone freely — just keep the Fallback lines at the bottom in the same "type: sentence" format.',
  '',
  'Fallback sentences (used verbatim if the AI is unavailable — one per type):',
  'entry: {name} just logged a new activity — go check it out! 🎉',
  'milestone: We just hit {milestone} points together! 🚀',
  'highlight: Highlight of the week 🌟 — {name} nailed it.',
  'points_update: Points update 📊 — keep it going, team!'
].join('\n');

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
  // Also rewrite when a label differs (e.g. a renamed column): every read and
  // write here is positional, so aligning row 1 with HEADERS is always safe and
  // is what makes a column rename show up in the sheet without a manual edit.
  var labelsDiffer = false;
  for (var j = 0; j < headers.length; j++) {
    if (existing[j] !== headers[j]) { labelsDiffer = true; break; }
  }
  if (existingCount < headers.length || labelsDiffer) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
}

// Google Sheets auto-detects numeric-looking strings on write and
// silently converts them to Number cells. A Google account's 'sub'
// claim (userId) is a long all-digit string, so without this it
// quietly loses precision past float64's ~15-17 significant digits;
// worse, a comma-joined 'tagged_friends' list gets read back as ONE
// number with the commas treated as thousands separators, merging
// several tagged friends' ids into a single garbled value. Formatting
// these columns as plain text up front stops Sheets from ever
// reinterpreting them, for both existing and future rows in range.
function forcePlainTextColumns_(sheet, fieldNames, headers) {
  var rows = Math.max(sheet.getMaxRows() - 1, 5000);
  fieldNames.forEach(function (field) {
    var col = headers.indexOf(field) + 1;
    if (col > 0) sheet.getRange(2, col, rows, 1).setNumberFormat('@');
  });
}

// Same protection as forcePlainTextColumns_, but scoped to a single row —
// call this right before writing to a fresh/updated row so it's safe even
// if setup() was never (re-)run after a numeric-ish column like
// tagged_friends was added. Must run BEFORE the value is written: once
// Sheets auto-detects a cell as a Number, the original text (and any
// commas in it) are already gone — setting '@' afterward only changes how
// the now-corrupted value displays, not what it is.
function forcePlainTextRow_(sheet, rowIndex, fieldNames, headers) {
  fieldNames.forEach(function (field) {
    var col = headers.indexOf(field) + 1;
    if (col > 0) sheet.getRange(rowIndex, col, 1, 1).setNumberFormat('@');
  });
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
      return jsonOutput_({ ok: true, message: 'BNext backend is live.', version: BACKEND_VERSION });
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

  var action = body.action;

  // Serialize writes so two near-simultaneous submissions from different
  // friends can't corrupt each other (Sheets isn't transactional). Only the
  // write itself is inside the lock — counter recompute below runs AFTER the
  // lock releases so a slower bookkeeping scan never blocks a concurrent save.
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var result;
  try {
    if (action === 'create') result = createEntry_(body, auth);
    else if (action === 'update') result = updateEntry_(body, auth);
    else if (action === 'delete') result = deleteEntry_(body, auth);
    else if (action === 'setUsername') result = upsertUserProfile_(auth, body.username);
    else result = { ok: false, error: 'Unknown action: ' + action };
  } catch (err) {
    result = { ok: false, error: String(err) };
  } finally {
    lock.releaseLock();
  }

  // Post-lock bookkeeping: recompute achievement counters for everyone the
  // write touched, then (on create) queue the entry announcement. Pure Sheets
  // work (no external HTTP), best-effort — a failure here must never change the
  // save's own success response. Counters feed the entry context (first-post
  // detection), so they're computed here together.
  try {
    if (result.ok && (action === 'create' || action === 'update' || action === 'delete')) {
      var entries = listEntries_();
      var affected = (action === 'create')
        ? [auth.userId].concat(result.entry.tagged_friends || [])
        : (result.affectedUserIds || []);
      recomputeUserCounters_(entries, affected);

      if (action === 'create' &&
          String(getSettingValue_(getSettingsSheet_(), 'ENTRY_ANNOUNCEMENTS_ENABLED') || '').toLowerCase() !== 'false') {
        var e = result.entry;
        var context = {
          entryId: e.entryId, userId: e.userId, activityDesc: e.activityDesc,
          activityTitle: e.activityTitle, category: e.category, amount: e.amount, units: e.units
        };
        queueNotification_('entry', e.entryId, context, e.mediaUrl, e.mediaType);
      }
    }
  } catch (err) {
    Logger.log('Counter recompute / entry queueing failed: ' + err);
  }

  // A milestone crossing is a SEPARATE, additional message (any write path can
  // cross one — e.g. editing an amount up). No media on a milestone post.
  // Independent of counters so a counters failure above can't suppress it.
  try {
    if (result.ok && result.milestoneCrossed) {
      var mEntryId = result.entry ? result.entry.entryId : (result.entryId || '');
      queueNotification_('milestone', mEntryId,
        { milestone: result.milestoneCrossed, total: result.newTotal }, null, null);
    }
  } catch (err) {
    Logger.log('Milestone queueing failed: ' + err);
  }

  return jsonOutput_(result);
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
  // Text fields can come back as a Number when Sheets auto-detects an
  // all-digit cell (e.g. a description of just "1" → the number 1). The
  // front-end calls string methods like (entry.activityDesc || '').trim(), which
  // throws on a number and crashes the whole gallery render — so force every
  // text field to a String here, the same defensive coercion used for userId.
  ['activityDesc', 'activityTitle', 'category', 'units', 'mediaType', 'driveFileId', 'mediaUrl'].forEach(function (f) {
    entry[f] = (entry[f] == null) ? '' : String(entry[f]);
  });
  // 'date' can come back as a Date object if Sheets auto-coerced the cell
  // (the same number/date auto-detection that bites userId) — normalize to a
  // plain 'YYYY-MM-DD' string so all date math (streaks) and the front-end
  // get a consistent, timezone-stable value regardless of how the cell landed.
  entry.date = normalizeDateString_(entry.date);
  // userId can come back as a Number if the cell was ever auto-formatted
  // (see forcePlainTextRow_) — coerce so string comparisons elsewhere
  // (ownership checks, tag matching) don't silently fail on type alone.
  entry.userId = entry.userId ? String(entry.userId) : '';
  entry.tagged_friends = String(entry.tagged_friends || '')
    .split(',')
    .map(function (s) { return s.trim(); })
    .filter(Boolean);
  return entry;
}

// Cleans a client-supplied tagged_friends list down to valid, deduplicated
// userIds: strings only, the logger's own id stripped out (they're the
// owner already, not a tagged friend), duplicates and unknowns removed.
function sanitizeTaggedFriends_(rawList, ownerUserId) {
  if (!Array.isArray(rawList)) return [];
  var knownIds = listUsers_().map(function (u) { return String(u.userId); });
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
  // See rowToEntry_ — guard against a userId cell read back as a Number.
  user.userId = user.userId ? String(user.userId) : '';
  return user;
}

function getUserProfile_(userId) {
  var sheet = getUsersSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var values = sheet.getRange(2, 1, lastRow - 1, USER_HEADERS.length).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][userIndexOf_('userId')]) === userId) return rowToUser_(values[i]);
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
      if (String(values[i][userIndexOf_('userId')]) === auth.userId) {
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
  // See createEntry_ — write to the exact row we formatted rather than
  // letting appendRow() resolve its own target row.
  var newUserRow = sheet.getLastRow() + 1;
  forcePlainTextRow_(sheet, newUserRow, ['userId'], USER_HEADERS);
  sheet.getRange(newUserRow, 1, 1, row.length).setValues([row]);
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
  var taggedFriends = sanitizeTaggedFriends_(body.tagged_friends, auth.userId);

  var row = HEADERS.map(function (field) {
    switch (field) {
      case 'entryId': return entryId;
      case 'activityDesc': return validation.value.activityDesc;
      case 'category': return validation.value.category;
      case 'activityTitle': return validation.value.activityTitle;
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
      case 'tagged_friends': return taggedFriends.join(',');
      default: return '';
    }
  });
  // appendRow() resolves its own target row internally, independently of
  // whatever row we just pre-formatted — on a brand new row that can race
  // against (or simply disagree with) our own getLastRow() lookup, so the
  // format silently doesn't apply before the value lands. Writing via
  // getRange().setValues() on the exact row we formatted removes that
  // ambiguity — same mechanism updateEntry_ already uses reliably below.
  var newRow = sheet.getLastRow() + 1;
  forcePlainTextRow_(sheet, newRow, ['userId', 'tagged_friends', 'date'], HEADERS);
  sheet.getRange(newRow, 1, 1, row.length).setValues([row]);
  var newTotal = computeTotals_();
  return { ok: true, entry: rowToEntry_(row), newTotal: newTotal, milestoneCrossed: checkAndAdvanceMilestone_(newTotal) };
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

  var taggedFriends = (body.tagged_friends !== undefined)
    ? sanitizeTaggedFriends_(body.tagged_friends, existing.userId || auth.userId)
    : existing.tagged_friends;

  var updated = {
    activityDesc: validation.value.activityDesc,
    category: validation.value.category,
    activityTitle: validation.value.activityTitle,
    date: validation.value.date,
    amount: validation.value.amount,
    units: validation.value.units,
    driveFileId: existing.driveFileId,
    mediaUrl: existing.mediaUrl,
    mediaType: existing.mediaType,
    userId: existing.userId, // never reassigned by an edit
    tagged_friends: taggedFriends.join(',')
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
  // Must run before setValues — see forcePlainTextRow_.
  forcePlainTextRow_(sheet, rowIndex, ['userId', 'tagged_friends', 'date'], HEADERS);
  range.setValues([row]);
  // Affected users for counter recompute: owner + everyone tagged before AND
  // after the edit (tags added or removed both shift someone's taggedInCount).
  var affectedUserIds = [existing.userId || auth.userId]
    .concat(existing.tagged_friends || [])
    .concat(taggedFriends || []);
  var newTotal = computeTotals_();
  return {
    ok: true, entry: rowToEntry_(row), affectedUserIds: affectedUserIds,
    newTotal: newTotal, milestoneCrossed: checkAndAdvanceMilestone_(newTotal)
  };
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
  // Captured before the soft-delete so recompute (which reads the now-deleted
  // entry out of listEntries_) correctly drops its contribution for everyone.
  var affectedUserIds = [existing.userId || auth.userId].concat(existing.tagged_friends || []);
  // A delete lowers the total, so it never crosses a new milestone — but call
  // through for consistency (returns null) so the watermark stays authoritative.
  var newTotal = computeTotals_();
  return {
    ok: true, entryId: existing.entryId, affectedUserIds: affectedUserIds,
    newTotal: newTotal, milestoneCrossed: checkAndAdvanceMilestone_(newTotal)
  };
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
// Points total & milestones (notifications feature)
// ---------------------------------------------------------------------
// Group total = plain sum of every non-deleted entry's amount (km and hours
// both count 1:1 as points) — matches the front-end's computeTotals().
function computeTotals_() {
  var entries = listEntries_();
  var total = 0;
  for (var i = 0; i < entries.length; i++) total += Number(entries[i].amount) || 0;
  return total;
}

function parseMilestones_(str) {
  return String(str || '').split(',')
    .map(function (s) { return Number(String(s).trim()); })
    .filter(function (n) { return !isNaN(n) && n > 0; })
    .sort(function (a, b) { return a - b; });
}

// Returns the highest milestone now reached that hasn't been announced yet, and
// advances the LAST_MILESTONE_ANNOUNCED watermark to it; null if none. The
// watermark makes this idempotent and monotonic — each milestone announces
// exactly once, and a later dip-below-and-recross never re-fires it. MUST be
// called inside doPost's lock so two concurrent writes can't both advance past
// the same milestone (only the first sees it un-announced).
function checkAndAdvanceMilestone_(newTotal) {
  var settingsSheet = getSettingsSheet_();
  if (String(getSettingValue_(settingsSheet, 'MILESTONE_ANNOUNCEMENTS_ENABLED') || '').toLowerCase() === 'false') {
    return null;
  }
  var milestones = parseMilestones_(getSettingValue_(settingsSheet, 'MILESTONES'));
  if (!milestones.length) return null;
  var watermark = Number(getSettingValue_(settingsSheet, 'LAST_MILESTONE_ANNOUNCED')) || 0;
  var crossed = null;
  for (var i = 0; i < milestones.length; i++) {
    if (milestones[i] > watermark && milestones[i] <= newTotal) crossed = milestones[i];
  }
  if (crossed !== null) setSettingValue_(settingsSheet, 'LAST_MILESTONE_ANNOUNCED', crossed);
  return crossed;
}

// ---------------------------------------------------------------------
// Achievement counters (notifications feature — see NOTES_notification_plan.md)
//
// All counters are always recomputed from scratch off the full entries array,
// never incremented in place — that keeps them correct through edits, deletes,
// and backdated entries (sheet/creation order != chronological order). Owned
// vs. tagged-in are deliberately separate: postCount is OWNED-only so a user
// tagged before ever posting still has their first own post detected as such.
// ---------------------------------------------------------------------
var COUNTER_FIELDS = [
  'postCount', 'spiritualPostCount', 'relationshipPostCount', 'othersPostCount',
  'currentDailyStreak', 'longestDailyStreak', 'lastEntryDate',
  'currentWeeklyStreak', 'longestWeeklyStreak', 'lastEntryWeek',
  'taggedInCount', 'groupActivityPostCount'
];

// Days since the Unix epoch for a plain 'YYYY-MM-DD' calendar date. Parsed
// from the integer parts (not Date.parse) so it's a pure calendar-day number
// with no timezone drift — the stored date is already the local day the user
// picked, and must not be reinterpreted.
function dateToDayNumber_(dateStr) {
  var p = normalizeDateString_(dateStr).split('-');
  return Math.floor(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])) / 86400000);
}

// Week bucket for a date, weeks starting Monday. 1970-01-01 was a Thursday
// (day 0), so +3 shifts Monday to a multiple of 7.
function weekIndexSinceEpoch_(dateStr) {
  return Math.floor((dateToDayNumber_(dateStr) + 3) / 7);
}

// Given an ascending, de-duplicated integer sequence (day numbers or week
// indices), returns the longest consecutive run anywhere, and the run ending
// at the final (most recent) element.
function runStreaks_(nums) {
  if (!nums.length) return { longest: 0, current: 0 };
  var longest = 1, run = 1;
  for (var i = 1; i < nums.length; i++) {
    run = (nums[i] === nums[i - 1] + 1) ? run + 1 : 1;
    if (run > longest) longest = run;
  }
  return { longest: longest, current: run };
}

function computeCountersForUser_(entries, userId) {
  var owned = 0, spiritual = 0, relationship = 0, others = 0;
  var taggedInCount = 0, groupActivityPostCount = 0;
  var daySet = {};
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    var isOwner = e.userId && String(e.userId) === userId;
    var isTagged = !isOwner && (e.tagged_friends || []).indexOf(userId) !== -1;
    if (!isOwner && !isTagged) continue;
    // Only well-formed calendar dates feed the streak math — a stray
    // malformed value can never poison it into NaN/#NUM! again.
    if (/^\d{4}-\d{2}-\d{2}$/.test(e.date)) daySet[e.date] = true;
    if (isOwner) {
      owned++;
      var cat = String(e.category || '').toLowerCase();
      if (cat === 'spiritual') spiritual++;
      else if (cat === 'relationship') relationship++;
      else others++;
      if ((e.tagged_friends || []).length > 0) groupActivityPostCount++;
    } else {
      taggedInCount++;
    }
  }
  var days = Object.keys(daySet).sort(); // 'YYYY-MM-DD' sorts chronologically
  var dayNums = days.map(dateToDayNumber_);
  var weekSet = {};
  days.forEach(function (d) { weekSet[weekIndexSinceEpoch_(d)] = true; });
  var weekNums = Object.keys(weekSet).map(Number).sort(function (a, b) { return a - b; });
  var daily = runStreaks_(dayNums);
  var weekly = runStreaks_(weekNums);
  var lastDate = days.length ? days[days.length - 1] : '';

  // A "current" streak is only alive if the most recent activity is today or
  // yesterday (this week or last week for the weekly one) — otherwise a day
  // was missed and it resets to 0. longest* keeps the historical record.
  // NOTE: this is evaluated at recompute time (on a create/edit/delete or a
  // backfill/scheduled run), not continuously — so a stored currentDailyStreak
  // only flips to 0 the next time a recompute runs, not the instant midnight
  // passes. A daily scheduled recompute (Phase 8) keeps it fresh between posts.
  var todayNum = dateToDayNumber_(todayString_());
  var thisWeek = weekIndexSinceEpoch_(todayString_());
  var lastDayNum = dayNums.length ? dayNums[dayNums.length - 1] : null;
  var lastWeekNum = weekNums.length ? weekNums[weekNums.length - 1] : null;
  var currentDaily = (lastDayNum !== null && (todayNum - lastDayNum) <= 1) ? daily.current : 0;
  var currentWeekly = (lastWeekNum !== null && (thisWeek - lastWeekNum) <= 1) ? weekly.current : 0;

  return {
    postCount: owned,
    spiritualPostCount: spiritual,
    relationshipPostCount: relationship,
    othersPostCount: others,
    currentDailyStreak: currentDaily,
    longestDailyStreak: daily.longest,
    lastEntryDate: lastDate,
    currentWeeklyStreak: currentWeekly,
    longestWeeklyStreak: weekly.longest,
    lastEntryWeek: lastDate ? weekIndexSinceEpoch_(lastDate) : '',
    taggedInCount: taggedInCount,
    groupActivityPostCount: groupActivityPostCount
  };
}

function findUserRowByUserId_(sheet, userId) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var ids = sheet.getRange(2, userIndexOf_('userId') + 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === userId) return i + 2;
  }
  return -1;
}

// Writes the 12 counter columns (contiguous at the tail of USER_HEADERS) in
// one setValues call.
function writeUserCounters_(sheet, rowIndex, counters) {
  var startCol = userIndexOf_('postCount') + 1;
  // Keep lastEntryDate a plain-text 'YYYY-MM-DD' — without this Sheets
  // re-detects the string as a Date on write, which is what produced the
  // inconsistent "Tue Jul 07 2026 …" cells.
  var dateCol = userIndexOf_('lastEntryDate') + 1;
  sheet.getRange(rowIndex, dateCol, 1, 1).setNumberFormat('@');
  var rowVals = COUNTER_FIELDS.map(function (f) { return counters[f]; });
  sheet.getRange(rowIndex, startCol, 1, COUNTER_FIELDS.length).setValues([rowVals]);
}

// Recomputes counters for the given userIds from one shared entries scan
// (not one listEntries_ per user). Returns a { userId -> counters } map so
// callers can read a fresh result directly (e.g. first-post detection) rather
// than re-reading the sheet. Users without a profile row are computed but not
// written (nowhere to write yet).
function recomputeUserCounters_(entries, userIds) {
  var sheet = getUsersSheet_();
  var seen = {}, result = {};
  (userIds || []).forEach(function (raw) {
    var uid = raw ? String(raw) : '';
    if (!uid || seen[uid]) return;
    seen[uid] = true;
    var counters = computeCountersForUser_(entries, uid);
    result[uid] = counters;
    var rowIndex = findUserRowByUserId_(sheet, uid);
    if (rowIndex !== -1) writeUserCounters_(sheet, rowIndex, counters);
  });
  return result;
}

// One-time (and safe-to-rerun) recompute of every existing user's counters.
// MUST be run once after deploying this version, before real traffic — new
// columns default blank (=0), which would otherwise make an existing friend's
// next post look like their first-ever post.
function backfillUserCounters() {
  var entries = listEntries_();
  var ids = listUsers_().map(function (u) { return u.userId; });
  recomputeUserCounters_(entries, ids);
  Logger.log('Backfilled counters for ' + ids.length + ' user(s).');
}

// ---------------------------------------------------------------------
// Notification queue & delivery (notifications feature)
//
// The Notifications sheet doubles as a send queue: a row is written PENDING
// on create, and a one-time trigger fires ~2s later in a SEPARATE execution
// to process it — so the poster's own request never waits on Gemini/Telegram.
//
// PHASE 3: delivery is STUBBED. processOneNotification_ just flips rows to
// SENT with placeholder text — no Gemini, no Telegram yet. This validates the
// queue wiring, the near-instant trigger, and the concurrency guards in
// isolation before external-API risk is added in Phases 4-5.
// ---------------------------------------------------------------------
function notificationIndexOf_(field) {
  return NOTIFICATION_HEADERS.indexOf(field);
}

// Writes one PENDING queue row. No Gemini/Telegram here — just a Sheets write.
function queueNotification_(type, entryId, context, mediaUrl, mediaType) {
  var sheet = getNotificationsSheet_();
  var now = new Date().toISOString();
  var row = NOTIFICATION_HEADERS.map(function (field) {
    switch (field) {
      case 'notificationId': return Utilities.getUuid();
      case 'type': return type;
      case 'entryId': return entryId || '';
      case 'contextJson': return JSON.stringify(context || {});
      case 'mediaUrl': return mediaUrl || '';
      case 'mediaType': return mediaType || '';
      case 'status': return 'PENDING';
      case 'retryCount': return 0;
      case 'createdAt': return now;
      default: return '';
    }
  });
  var newRow = sheet.getLastRow() + 1;
  forcePlainTextRow_(sheet, newRow, ['telegramMessageId'], NOTIFICATION_HEADERS);
  sheet.getRange(newRow, 1, 1, row.length).setValues([row]);
}

// Run ONCE from the editor after deploying. Installs a single recurring
// trigger that drains the queue every minute, and clears out any stale queue
// triggers first (including leftover one-time triggers, which Apps Script does
// NOT reliably auto-delete). Running it interactively also grants the
// script.scriptapp permission the trigger needs.
//
// Why a recurring poll instead of a one-time trigger per post: one-time
// `.after()` triggers proved unreliable here — they fire minutes late, linger
// on the Triggers page after firing, and a just-queued row can be written
// moments after a drain starts and then starve (no fresh trigger gets made).
// A single every-minute trigger removes all of that: bounded ≤1 min latency,
// no per-post trigger creation, no pile-up, no race. The idle cost (a no-op
// drain each minute) is trivial for a friend-group app.
function setupNotificationTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'processNotificationQueue') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('processNotificationQueue').timeBased().everyMinutes(1).create();
  Logger.log('Queue-processing trigger installed — drains the queue every minute.');
}

// Trigger target (also runnable by hand from the editor to drain on demand).
// No trailing underscore: installable-trigger targets and manual-run helpers
// stay dropdown-visible. Guarded by the DOCUMENT lock (not the script lock)
// so queue processing serializes against itself WITHOUT ever contending with
// doPost's save-path script lock.
function processNotificationQueue() {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) return; // another drain already in progress — skip
  try {
    drainNotificationQueue_();
  } finally {
    lock.releaseLock();
  }
}

// The actual loop, factored out with NO locking of its own so hourlyChecks
// (Phase 8) can call it while already holding the same document lock.
function drainNotificationQueue_() {
  var sheet = getNotificationsSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  var values = sheet.getRange(2, 1, lastRow - 1, NOTIFICATION_HEADERS.length).getValues();
  var statusCol = notificationIndexOf_('status');
  var start = Date.now();
  var processed = 0;
  for (var i = 0; i < values.length; i++) {
    if (processed >= 25) break;                    // batch cap
    if (Date.now() - start > 240000) break;        // ~4 min, under the 6 min cap
    var status = String(values[i][statusCol] || '');
    if (status !== 'PENDING' && status !== 'PENDING_RESEND') continue;
    processOneNotification_(sheet, i + 2, values[i]);
    processed++;
  }
}

// PHASE 4: generates real message text via Gemini. Telegram delivery is still
// STUBBED (Phase 5 adds the real send) — once text exists the row is marked
// SENT. messageContent is written as soon as generation succeeds so a future
// send-retry never re-calls Gemini (Phase 5 relies on this).
function processOneNotification_(sheet, rowIndex, row) {
  var status = String(row[notificationIndexOf_('status')] || 'PENDING');
  var type = String(row[notificationIndexOf_('type')] || 'entry');
  var content = String(row[notificationIndexOf_('messageContent')] || '');
  var settings = getSettings_();

  // 1) Ensure message text exists. Generated exactly once, on the first
  //    attempt — a resend (PENDING_RESEND, messageContent already set) skips
  //    this entirely and never re-calls Gemini.
  if (!content) {
    var context = {};
    try { context = JSON.parse(row[notificationIndexOf_('contextJson')] || '{}'); } catch (e) { context = {}; }
    try {
      content = generateMessageText_(context, type);
    } catch (err) {
      // Genuine generation failure (network/HTTP/parse) — retryable. A safety
      // block or empty candidate does NOT reach here: generateMessageText_
      // returns the fallback sentence for those, so they never burn a retry.
      bumpRetryOrFail_(sheet, rowIndex, row, settings, err);
      return;
    }
    // Persist the text immediately, before any send attempt, so a later
    // send-retry replays it verbatim rather than regenerating.
    updateNotificationStatus_(sheet, rowIndex, status, { messageContent: content });
  }

  // 2) Deliver to Telegram (media as bytes; falls back to text if the file
  //    can't be fetched). A send failure is the common, retryable case.
  var entryId = String(row[notificationIndexOf_('entryId')] || '');
  var driveFileId = extractDriveFileId_(row[notificationIndexOf_('mediaUrl')]);
  var mediaType = String(row[notificationIndexOf_('mediaType')] || '');
  // Only post-specific announcements link back to a post. A milestone (and a
  // points_update) is about the group total, not one entry — no link.
  var deepLink = (type === 'entry' || type === 'highlight') ? buildDeepLink_(entryId, settings.FRONTEND_URL) : '';
  try {
    var telegramMessageId = sendTelegramMessage_(content, driveFileId, mediaType, deepLink);
    updateNotificationStatus_(sheet, rowIndex, 'SENT', {
      telegramMessageId: telegramMessageId, sentAt: new Date().toISOString(), lastError: ''
    });
  } catch (err) {
    bumpRetryOrFail_(sheet, rowIndex, row, settings, err);
  }
}

// Increments retryCount and re-queues as PENDING, or marks FAILED once the max
// is reached. A PENDING_RESEND row gets a fresh budget: its current retryCount
// is treated as 0 for this attempt (an admin flipping it to PENDING_RESEND is
// asking for another full round of tries with the stored content).
function bumpRetryOrFail_(sheet, rowIndex, row, settings, err) {
  var status = String(row[notificationIndexOf_('status')] || '');
  var current = (status === 'PENDING_RESEND') ? 0 : Number(row[notificationIndexOf_('retryCount')] || 0);
  var next = current + 1;
  updateNotificationStatus_(sheet, rowIndex, (next < settings.MAX_NOTIFICATION_RETRIES) ? 'PENDING' : 'FAILED', {
    retryCount: next, lastError: String(err)
  });
}

// Sets a row's status plus any of the other columns passed in `extra`
// ({ messageContent, retryCount, telegramMessageId, sentAt, lastError }).
function updateNotificationStatus_(sheet, rowIndex, status, extra) {
  sheet.getRange(rowIndex, notificationIndexOf_('status') + 1).setValue(status);
  if (extra) {
    Object.keys(extra).forEach(function (k) {
      var col = notificationIndexOf_(k);
      if (col !== -1) sheet.getRange(rowIndex, col + 1).setValue(extra[k]);
    });
  }
}

// ---------------------------------------------------------------------
// Settings accessor + style guide (notifications feature)
// ---------------------------------------------------------------------
// Typed read of the Settings tab. Small sheet, read fresh each time (the
// queue drains at most once a minute, so this is cheap) — only the style
// guide Doc is cached, since fetching a Doc is the expensive part.
function getSettings_() {
  var sheet = getSettingsSheet_();
  var lastRow = sheet.getLastRow();
  var map = {};
  if (lastRow >= 2) {
    var values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    for (var i = 0; i < values.length; i++) {
      var k = String(values[i][0]).trim();
      if (k) map[k] = String(values[i][1]);
    }
  }
  return {
    raw: map,
    GEMINI_MODEL: map.GEMINI_MODEL || 'gemini-2.0-flash',
    MAX_NOTIFICATION_RETRIES: Number(map.MAX_NOTIFICATION_RETRIES) || 5,
    STYLE_GUIDE_DOC_ID: map.STYLE_GUIDE_DOC_ID || '',
    FRONTEND_URL: map.FRONTEND_URL || ''
  };
}

// Fetches + parses the style-guide Doc, cached 10 min (CacheService). Never
// throws — on any failure it returns an empty guide so generation still works
// off the built-in default fallbacks.
function getStyleGuide_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('styleGuide');
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* fall through and refetch */ }
  }
  var parsed = { guide: '', fallbacks: {} };
  try {
    var docId = getSettings_().STYLE_GUIDE_DOC_ID;
    if (docId) parsed = parseStyleGuide_(DocumentApp.openById(docId).getBody().getText());
  } catch (err) {
    Logger.log('Style guide fetch failed: ' + err);
  }
  try { cache.put('styleGuide', JSON.stringify(parsed), 600); } catch (e) { /* cache best-effort */ }
  return parsed;
}

// The whole Doc text is the tone/style instruction; lines like
// "entry: {name} just logged …" are extracted as per-type fallback sentences.
function parseStyleGuide_(text) {
  var fallbacks = {};
  String(text || '').split('\n').forEach(function (line) {
    var m = line.match(/^\s*(entry|milestone|highlight|points_update)\s*:\s*(.+)$/);
    if (m) fallbacks[m[1]] = m[2].trim();
  });
  return { guide: String(text || ''), fallbacks: fallbacks };
}

// ---------------------------------------------------------------------
// Message generation (Gemini)
// ---------------------------------------------------------------------
// Returns generated message text. Returns the fallback sentence (NOT an error)
// for a safety-block / empty candidate / missing API key — those are handled
// paths that must not burn a retry. THROWS only for a genuine network / HTTP /
// parse failure, which the caller treats as retryable.
function generateMessageText_(context, type) {
  var settings = getSettings_();
  var styleGuide = getStyleGuide_();
  var fallback = fillTemplate_(styleGuide.fallbacks[type] || defaultFallback_(type), context);

  var apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) return fallback; // not configured — handled path, not a failure

  // PRIVACY: no real names ever leave the backend. Every known display name is
  // swapped for a placeholder code ([[P1]], [[P2]], …) in everything sent to
  // Gemini — the person field AND the free-text activity/description (which may
  // mention other friends). Gemini writes using the codes; we swap the real
  // names back in afterwards. The map is built fresh per call (local variable),
  // so concurrent generations can never mix up whose name is whose.
  var nameMap = buildNameScrubMap_();

  // DEBUG (owner-only Executions log) — verify the scrub/restore flow.
  Logger.log('[GEMINI 1/4 before scrub] activityTitle=' + JSON.stringify(context.activityTitle || '') +
    ' | activityDesc=' + JSON.stringify(context.activityDesc || ''));

  var prompt = buildGeminiPrompt_(styleGuide.guide, context, type, nameMap);
  Logger.log('[GEMINI 2/4 after scrub — full prompt sent to Gemini]\n' + prompt);

  var url ='https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(settings.GEMINI_MODEL) + ':generateContent?key=' + encodeURIComponent(apiKey);
  var payload = { contents: [{ parts: [{ text: prompt }] }] };

  var resp;
  try {
    resp = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify(payload), muteHttpExceptions: true
    });
  } catch (err) {
    throw new Error('Gemini network error: ' + err); // retryable
  }
  var code = resp.getResponseCode();
  var bodyText = resp.getContentText();
  // 429 = rate limit / quota exhausted. Retrying just burns more of the (often
  // daily) budget and the row would eventually FAIL anyway, so instead use the
  // offline fallback sentence: the notification still sends with generic
  // wording + the photo + link, and no retry is consumed. (Fallback is built
  // locally with real names and is never sent to Gemini.)
  if (code === 429) {
    Logger.log('[GEMINI] 429 quota/rate limit — using offline fallback sentence. ' + bodyText);
    return fallback;
  }
  if (code !== 200) throw new Error('Gemini HTTP ' + code + ': ' + bodyText); // retryable

  var data;
  try { data = JSON.parse(bodyText); } catch (err) {
    throw new Error('Gemini parse error: ' + err); // retryable
  }
  var text = extractGeminiText_(data);
  Logger.log('[GEMINI 3/4 raw response] ' + JSON.stringify(text));
  if (!text) {
    Logger.log('[GEMINI] empty/blocked response — using fallback sentence');
    return fallback; // safety-block/empty → fallback (handled)
  }
  var restored = restoreText_(text.trim(), nameMap); // swap real names back in
  Logger.log('[GEMINI 4/4 after restore] ' + JSON.stringify(restored));
  return restored;
}

function extractGeminiText_(data) {
  try {
    var c = data && data.candidates && data.candidates[0];
    if (!c || c.finishReason === 'SAFETY') return '';
    var parts = c.content && c.content.parts;
    if (!parts || !parts.length) return '';
    return parts.map(function (p) { return p.text || ''; }).join('').trim();
  } catch (e) {
    return '';
  }
}

// The tone/role/format instructions all come from the human-editable style
// guide Doc (`guide`). Only two things stay in code: the facts, and the
// placeholder-code rule — a TECHNICAL requirement that must survive even if
// someone edits the Doc, since name-scrubbing breaks if the codes aren't kept.
function buildGeminiPrompt_(guide, context, type, nameMap) {
  var facts = [];
  if (context.userId) facts.push('Person: ' + tokenForName_(context.userId, nameMap));
  if (context.activityTitle) facts.push('Activity title: ' + scrubText_(context.activityTitle, nameMap));
  if (context.activityDesc) facts.push('What they did: ' + scrubText_(context.activityDesc, nameMap));
  if (context.category) facts.push('Category: ' + context.category);
  if (context.amount && context.units) facts.push('Amount: ' + context.amount + ' ' + context.units);
  if (context.milestone) facts.push('Milestone reached: ' + context.milestone + ' points');
  // The style guide is human-edited and may contain member names in its example
  // messages — scrub it too so those names never reach Gemini (and can't be
  // echoed into an unrelated message, e.g. naming someone in a milestone post).
  var safeGuide = scrubText_(guide || 'You are the friendly announcer for a private friend-group activity tracker. Write ONE short, upbeat group-chat announcement (max ~200 characters, at most 1-2 emoji, no hashtags). Vary the wording. Output only the message text.', nameMap);
  return [
    safeGuide,
    '',
    'Message type: ' + type,
    'Facts:', facts.join('\n'),
    '',
    'IMPORTANT: People are given placeholder codes like [[P1]]. Refer to people ONLY by their exact code, and keep every code verbatim. Only mention a person who appears in the Facts above — if no Person is listed in the Facts, do NOT name, invent, or refer to any individual (examples in the style guide are for tone only, never to be reused as names).'
  ].join('\n');
}

// Display name for a userId, from the Users tab. 'Someone' if unknown.
function getDisplayName_(userId) {
  var u = getUserProfile_(String(userId));
  return (u && (u.username || u.email)) || 'Someone';
}

// ---------------------------------------------------------------------
// Name scrubbing — keep real names out of anything sent to Gemini.
// ---------------------------------------------------------------------
// Builds a list of { text, token, restore, userId? } entries used to swap
// names → placeholder codes before Gemini and back again after:
//   - every member's username                     → their [[Pn]] code
//   - curated member variants (NameScrub tab)     → the SAME member's [[Pn]]
//   - extra/non-member words (NameScrub, no id)   → an [[Rn]] code
// A member's username and all their variants share ONE token, and members are
// keyed by userId so tokenForName_ can resolve the poster reliably. Everything
// restores to the member's username (or NEUTRAL_NAME for [[Rn]]). Sorted
// longest text first so "Alice Chan" is replaced before "Alice". Built fresh
// per generation (local), so nothing crosses between concurrent messages.
function buildNameScrubMap_() {
  var entries = [];
  var tokenByUserId = {};

  // 1) Members → one stable token each, keyed by userId.
  listUsers_().forEach(function (u, idx) {
    var uid = String(u.userId || '');
    var username = String(u.username || '').trim();
    if (!uid || !username || tokenByUserId[uid]) return;
    var token = '[[P' + (idx + 1) + ']]';
    tokenByUserId[uid] = token;
    entries.push({ text: username, token: token, restore: username, userId: uid });
  });

  // 2) Curated rows: member variants reuse the member's token; extra words get
  //    their own [[Rn]] redaction token restoring to a neutral placeholder.
  var redactionCount = 0;
  listNameScrubRows_().forEach(function (row) {
    if (row.mapsToUserId && tokenByUserId[row.mapsToUserId]) {
      entries.push({
        text: row.variant, token: tokenByUserId[row.mapsToUserId],
        restore: restoreForToken_(entries, tokenByUserId[row.mapsToUserId]), userId: row.mapsToUserId
      });
    } else {
      redactionCount++;
      entries.push({ text: row.variant, token: '[[R' + redactionCount + ']]', restore: NEUTRAL_NAME });
    }
  });

  entries.sort(function (a, b) { return b.text.length - a.text.length; });
  return entries;
}

// The member username a token restores to (for attaching to a variant row).
function restoreForToken_(entries, token) {
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].token === token) return entries[i].restore;
  }
  return NEUTRAL_NAME;
}

function tokenForName_(userId, nameMap) {
  var uid = String(userId || '');
  for (var i = 0; i < nameMap.length; i++) {
    if (nameMap[i].userId && nameMap[i].userId === uid) return nameMap[i].token;
  }
  return '[[P0]]'; // unknown person — still never leaks a real name
}

// Replaces each entry's text with its token, matching only on word boundaries
// (case-insensitive) so a short variant like "Al" can't match inside "always".
// The leading delimiter is preserved; the trailing one is a lookahead so
// back-to-back names still both match.
function scrubText_(text, nameMap) {
  var out = String(text || '');
  nameMap.forEach(function (m) {
    var re = new RegExp('(^|\\W)(' + escapeRegExp_(m.text) + ')(?=\\W|$)', 'gi');
    out = out.replace(re, function (whole, lead) { return lead + m.token; });
  });
  return out;
}

// Swaps every [[Pn]]/[[Rn]] code back to its restore value in one pass, so
// prefix collisions ([[P1]] vs [[P10]]) can't corrupt anything. Unknown codes
// (e.g. the [[P0]] fallback) become "someone".
function restoreText_(text, nameMap) {
  var byToken = {};
  nameMap.forEach(function (m) { byToken[m.token] = m.restore; });
  return String(text || '').replace(/\[\[[PR]\d+\]\]/g, function (code) {
    return (byToken[code] != null) ? byToken[code] : 'someone';
  });
}

function escapeRegExp_(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fillTemplate_(tpl, context) {
  return String(tpl || '')
    .replace(/\{name\}/g, (context && context.userId) ? getDisplayName_(context.userId) : 'Someone')
    .replace(/\{activity\}/g, (context && context.activityTitle) || 'an activity')
    .replace(/\{milestone\}/g, (context && context.milestone) || '');
}

function defaultFallback_(type) {
  switch (type) {
    case 'milestone': return 'We just hit a new milestone together! 🚀';
    case 'highlight': return 'Highlight of the week 🌟';
    case 'points_update': return 'Points update 📊 — keep it going!';
    default: return 'A new activity was just logged — check it out! 🎉';
  }
}

// ---------------------------------------------------------------------
// Telegram delivery
// ---------------------------------------------------------------------
// Sends the announcement to the configured group topic. Media is uploaded as
// BYTES (the Drive file's blob), NOT as the stored viewer URL — Telegram
// fetching that URL would get an HTML page, not image/video bytes, and fail on
// essentially every message. Falls back to a plain text message only when the
// file itself can't be fetched (missing/invalid id). On a non-200 Telegram
// response it throws with Telegram's own `description`, so the retry path and
// the lastError column are actually diagnostic. Returns the sent message id.
function sendTelegramMessage_(text, driveFileId, mediaType, deepLink) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('TELEGRAM_BOT_TOKEN');
  var chatId = props.getProperty('TELEGRAM_CHAT_ID');
  var topicId = props.getProperty('TELEGRAM_TOPIC_ID');
  if (!token || !chatId) {
    throw new Error('Telegram not configured (need TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID script properties)');
  }

  var caption = String(text || '') + (deepLink ? '\n\n' + deepLink : '');
  var apiBase = 'https://api.telegram.org/bot' + token + '/';

  // Try to fetch the media as a blob. Only a genuine "can't get the file"
  // failure downgrades to a text-only message — a Telegram send error below is
  // thrown (retryable) so we don't silently drop the photo.
  var blob = null;
  if (driveFileId) {
    try { blob = DriveApp.getFileById(driveFileId).getBlob(); }
    catch (err) { Logger.log('[TELEGRAM] media blob unavailable (' + driveFileId + '), sending text only: ' + err); }
  }

  if (blob) {
    // GIFs (uploaded videos are converted to an animated GIF client-side) come
    // back as image/gif but are stored with mediaType 'image'. sendPhoto would
    // freeze them to a single frame — Telegram needs sendAnimation to animate.
    var contentType = String(blob.getContentType() || '');
    var method, field;
    if (mediaType === 'video') { method = 'sendVideo'; field = 'video'; }
    else if (mediaType === 'gif' || contentType === 'image/gif') { method = 'sendAnimation'; field = 'animation'; }
    else { method = 'sendPhoto'; field = 'photo'; }
    var payload = { chat_id: chatId, caption: caption };
    if (topicId) payload.message_thread_id = topicId;
    payload[field] = blob;
    var resp = UrlFetchApp.fetch(apiBase + method, { method: 'post', payload: payload, muteHttpExceptions: true });
    return parseTelegramResponse_(resp);
  }

  var textPayload = { chat_id: chatId, text: caption };
  if (topicId) textPayload.message_thread_id = topicId;
  var resp2 = UrlFetchApp.fetch(apiBase + 'sendMessage', { method: 'post', payload: textPayload, muteHttpExceptions: true });
  return parseTelegramResponse_(resp2);
}

// Returns the sent message id on success; throws with Telegram's description on
// any non-200 / not-ok response so the failure is retryable and legible.
function parseTelegramResponse_(resp) {
  var code = resp.getResponseCode();
  var body = resp.getContentText();
  var data = null;
  try { data = JSON.parse(body); } catch (e) { /* leave data null */ }
  if (code === 200 && data && data.ok) {
    return (data.result && data.result.message_id != null) ? String(data.result.message_id) : '';
  }
  var desc = (data && data.description) ? data.description : body;
  throw new Error('Telegram HTTP ' + code + ': ' + desc);
}

// Drive viewer URLs look like https://drive.google.com/file/d/<id>/view —
// pull the file id back out so we can load the blob for upload.
function extractDriveFileId_(mediaUrl) {
  var m = String(mediaUrl || '').match(/\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : '';
}

// Deep link back to the specific post: <FRONTEND_URL>?entry=<id>. Empty when
// FRONTEND_URL isn't configured (Settings tab) or there's no entry.
function buildDeepLink_(entryId, frontendUrl) {
  if (!frontendUrl || !entryId) return '';
  var sep = (frontendUrl.indexOf('?') === -1) ? '?' : '&';
  return frontendUrl + sep + 'entry=' + encodeURIComponent(entryId);
}

// ---------------------------------------------------------------------
// Validation & media handling
// ---------------------------------------------------------------------
function validateEntryFields_(body, requireMedia) {
  var activityDesc = String(body.activityDesc || '').trim();
  var category = String(body.category || '').trim();
  var activityTitle = String(body.activityTitle || '').trim();
  var date = String(body.date || '').trim();
  var amount = Math.round(Number(body.amount) * 10) / 10;
  var units = String(body.units || '').trim();

  if (!activityDesc) return { error: 'Please describe what went on' };
  if (CATEGORIES.indexOf(category) === -1) return { error: 'Invalid category' };
  if (!activityTitle) return { error: 'Activity title is required' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Invalid date format' };
  if (date > todayString_()) return { error: 'Date cannot be in the future' };
  if (!(amount > 0)) return { error: 'Amount must be greater than 0' };
  if (UNITS.indexOf(units) === -1) return { error: 'Invalid units' };
  if (requireMedia && !body.media) return { error: 'Photo/video is required' };

  return { value: { activityDesc: activityDesc, category: category, activityTitle: activityTitle, date: date, amount: amount, units: units } };
}

function todayString_() {
  return Utilities.formatDate(new Date(), 'Asia/Singapore', 'yyyy-MM-dd');
}

// Coerces a date cell value to a plain 'YYYY-MM-DD' string. A cell Sheets
// auto-detected as a date comes back as a Date object; format it in the
// spreadsheet's own timezone (the one Sheets used to interpret the typed
// date) so we recover the exact calendar day, with no UTC drift. A value
// already stored as text is returned trimmed as-is.
function normalizeDateString_(value) {
  if (value instanceof Date) {
    var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || 'Asia/Singapore';
    return Utilities.formatDate(value, tz, 'yyyy-MM-dd');
  }
  return String(value == null ? '' : value).trim();
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
  // Uploaded videos are converted to an animated GIF client-side, so they
  // arrive as image/gif — tag those 'gif' (not the generic 'image') so the
  // column is meaningful and Telegram can pick sendAnimation. A true 'video'
  // mime is kept for completeness though the client doesn't currently send one.
  var mediaType;
  if (media.mimeType.indexOf('video') === 0) mediaType = 'video';
  else if (media.mimeType === 'image/gif') mediaType = 'gif';
  else mediaType = 'image';
  return {
    fileId: fileId,
    mediaType: mediaType,
    // Convenience field for spreadsheet readability — the front-end builds
    // the correct embed URL itself (image vs. video need different Drive
    // URL patterns), it doesn't rely on this string alone.
    mediaUrl: 'https://drive.google.com/file/d/' + fileId + '/view'
  };
}
