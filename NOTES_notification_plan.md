<!--
Handoff artifact only — NOT part of the app. This is the approved implementation plan
for the Telegram push-notification feature (Phase 1), written so a fresh local Claude
Code session on this branch has the full context without needing this conversation's
history. Delete this file before opening a PR / merging.
-->

# Telegram push notifications — Phase 1 (core notification + admin-tunable settings)

## Context

`docs/PRD.md` §5.2 lists push notifications as out of scope, and `docs/DECISIONS.md` even notes "no push-notification channel in this build." The user wants one: whenever someone logs an activity, post a friendly AI-generated announcement (with the actual photo/video and a link back to the post) into a dedicated Telegram topic, plus milestone hype messages, a configurable Points Update, and an admin-picked "highlight of the week." A recurring theme in the user's feedback: **anything that shapes what a message says or when it fires must be editable from a phone, without touching `Code.gs`** — this app already solves that exact problem for the Allowlist (an editable sheet tab, no redeploy/no script editor), so this feature reuses that idiom for every tunable, plus a Google Doc for the longer prose (style guide).

Phased deliberately: this plan is **Phase 1** only — the core per-entry notification (with first-post/group-activity folded in), milestones, the configurable Points Update, admin-picked highlight, and the data capture needed for later achievement badges. Named streak/post-count-milestone/well-rounded/category-milestone **announcements** are deferred to Phase 2.

This plan went through two review passes before build, both against the actual `Code.gs`:
1. **Concurrency/correctness pass** caught two near-certain bugs: running slow notification work inside `doPost`'s shared script lock (would cause real entry-submission failures for concurrent friends), and sending Telegram media via the stored Drive *viewer* URL (doesn't work at all — Telegram fetches HTML, not image bytes).
2. **Architecture discussion** with the user established that "notification happens after saving, in the same request" (the first fix) still isn't truly decoupled — the *poster's own* request still waits through the full Gemini+Telegram round-trip. The design below replaces that with a real queue: saving writes a `PENDING` row and returns immediately; a **separate, near-instantly-triggered execution** does the actual Gemini/Telegram work.

## Answers baked into this plan

- AI message text: Gemini (free tier), generated from **text fields only** — not multimodal.
- Every new entry gets **one** generic, Gemini-varied announcement with the photo/video and a "Read more" deep link. First-post/group-activity (2+ people) get **folded into the same message** when their Settings toggle is on — group-activity phrasing names only the creator plus a count, never the other tagged friends individually.
- **Milestone crossings are the one exception** — always a separate, additional message.
- "Highlight of the week" is **admin-picked** — a checkbox column on the Entries sheet.
- Structured tunables live in a **Settings** sheet tab; the **style guide + per-type fallback sentences** live in a separate **Google Doc**, fetched and cached briefly.
- Every message attempt is logged in a **Notifications** sheet tab, which **doubles as the send queue** (see below). To fix a bad message: delete it in Telegram, edit `messageContent`, flip status to `PENDING_RESEND` — the queue processor resends that row's stored content verbatim.
- **Saving an entry and sending its notification are two separate executions, not one request.** `doPost` never calls Gemini or Telegram directly — it writes a `PENDING` queue row and schedules a one-time trigger to process it moments later, in a different execution. This is the actual mechanism Apps Script offers for "decoupled" work — there's no true background/fire-and-forget primitive, but a self-scheduled near-immediate trigger achieves the same effect without polling on a fixed interval when the queue is empty.
- Failed **sends** (not generation — see "Retry scope" below) retry automatically across subsequent queue-processor runs, up to a configurable max, before being marked `FAILED` for manual attention.
- Achievement counters must stay correct through edits and deletes.
- Deep link needs new `?entry=<id>` routing in `index.html`.

## Data model additions

**New "Settings" sheet tab** (key/value rows, parsed by `getSettings_()` with safe fallbacks — mirrors `getSheet_`/`ensureHeaders_`, `Code.gs:70-117`):
- `MILESTONES` (comma list, e.g. `100,250,500,750,900,1000`), `LAST_MILESTONE_ANNOUNCED` (script-maintained watermark)
- `MILESTONE_ANNOUNCEMENTS_ENABLED`, `FIRST_POST_MENTION_ENABLED`, `GROUP_ACTIVITY_MENTION_ENABLED`, `HIGHLIGHT_ANNOUNCEMENT_ENABLED` (booleans)
- `POINTS_UPDATE_MODE` (`weekly`/`biweekly`/`dates`/`off`), `POINTS_UPDATE_DAY_OF_WEEK`, `POINTS_UPDATE_HOUR` (24h, Singapore time), `POINTS_UPDATE_SPECIFIC_DATES`, `POINTS_UPDATE_LAST_SENT_DATE` (script-maintained)
- `HIGHLIGHT_LAST_SENT_WEEK` (script-maintained)
- `MAX_NOTIFICATION_RETRIES` (default `5`) — phone-editable, same reasoning as every other tunable
- `STYLE_GUIDE_DOC_ID` — the Drive file ID of the style-guide Doc
- `GEMINI_MODEL` (default e.g. `gemini-2.0-flash`) — phone-editable in case the model name needs to change later

**New Google Doc** ("BNext — Notification Style Guide"), created once by `setup()` alongside the existing Drive media folder (`getFolder_`, `Code.gs:150-163`). Holds the tone guide, example messages, and one fallback sentence per message `type`. `getStyleGuide_()` fetches it via `DocumentApp`/`DriveApp` and caches the parsed result in `CacheService.getScriptCache()` with a **10-minute TTL**.

**New "Notifications" sheet tab** — doubles as the send queue: `notificationId`, `type` (`entry`/`milestone`/`highlight`/`points_update`), `entryId`, `contextJson` (the facts needed to generate the message), `messageContent` (blank until generated, or admin-edited for a resend), `mediaUrl`, `mediaType`, `status` (`PENDING`/`SENT`/`FAILED`/`PENDING_RESEND`), `retryCount`, `telegramMessageId`, `createdAt`, `sentAt`, `lastError` (Telegram's/Gemini's actual error description, not just "non-200").

**Entries sheet — 2 new columns**: `highlightOfWeek` (boolean, admin-set), `highlightAnnouncedAt` (timestamp, script-set).

**Users sheet — new columns**, captured now for Phase 2:
- `postCount`, `spiritualPostCount`, `relationshipPostCount`, `othersPostCount` (matches `CATEGORIES`, `Code.gs:26`) — Well-Rounded (Phase 2) = all three `> 0`; also enables per-category milestones later
- `currentDailyStreak`, `longestDailyStreak`, `lastEntryDate`, `currentWeeklyStreak`, `longestWeeklyStreak`, `lastEntryWeek`
- `taggedInCount` — number of *other people's* posts this user has been tagged in
- `groupActivityPostCount` — number of this user's *own* posts with at least one tagged friend

**One-time backfill required.** `ensureHeaders_` only grows the header row for new columns — it doesn't populate historical rows. Without a backfill, every existing friend's cell is blank, which reads as `0` and would make their **next** post wrongly announced as their first-ever post. `backfillUserCounters_()` (same one-time idiom as `setup()`) loops `listUsers_()` and recomputes everyone once — must run immediately after deploy, before real traffic.

### Keeping counters correct through edits and deletes

One **`recomputeUserCounters_(entries, userIds)`** helper — takes an already-fetched `listEntries_()` array and the set of affected userIds, computing all of them from that single shared scan (not one `listEntries_()` per affected user). For each user: filter to entries they own or are tagged in, **sort by `date` ascending first** (sheet/creation order ≠ chronological order — backdating is normal usage and un-sorted input corrupts streak math), then compute counts/streaks and write the row. Called (best-effort, try/caught, after the lock releases — it's pure Sheets work, no external HTTP, so it stays synchronous rather than going through the notification queue) for:
- `createEntry_`: the owner + each newly tagged friend
- `updateEntry_`: the union of the owner, old `tagged_friends`, and new `tagged_friends`
- `deleteEntry_`: the owner + each previously tagged friend

`isFirstPost` is derived from the recompute's own result (owner's new `postCount === 1`), not from reading `postCount` beforehand — avoids depending on fragile call ordering. `recomputeUserCounters_` should return a map of `userId -> counters` so callers can read this straight off the result.

## Code.gs additions

### Lock scoping

`doPost` (`Code.gs:286-299`) wraps all writes in `lock.waitLock(20000) ... finally { lock.releaseLock(); }`. Nothing slow or external (Gemini, Telegram, even scheduling a trigger) may run inside that held lock — `createEntry_`/`updateEntry_`/`deleteEntry_` stay exactly as fast as today (validate + write + milestone-watermark check, which is pure Sheets read/compare and race-free under the existing lock):

```js
var lock = LockService.getScriptLock();
lock.waitLock(20000);
var result;
try {
  if (action === 'create') result = createEntry_(body, auth); // { ok, entry, prevTotal, milestoneCrossed }
  else if (action === 'update') result = updateEntry_(body, auth); // { ok, entry, affectedUserIds, milestoneCrossed }
  else if (action === 'delete') result = deleteEntry_(body, auth); // { ok, entryId, affectedUserIds, milestoneCrossed }
  else if (action === 'setUsername') result = upsertUserProfile_(auth, body.username);
  else result = { ok: false, error: 'Unknown action: ' + action };
} catch (err) {
  return jsonOutput_({ ok: false, error: String(err) });
} finally {
  lock.releaseLock();
}

// Lock released — everything below is fast, Sheets-only bookkeeping (no Gemini/Telegram calls here).
try {
  if (result.ok) {
    var entries = listEntries_();
    if (action === 'create') {
      var counters = recomputeUserCounters_(entries, [auth.userId].concat(result.entry.tagged_friends));
      var isFirstPost = counters[auth.userId] && counters[auth.userId].postCount === 1;
      var context = buildEntryContext_(result.entry, { isFirstPost: isFirstPost });
      queueNotification_('entry', result.entry.entryId, context, result.entry.mediaUrl, result.entry.mediaType);
      if (result.milestoneCrossed) {
        queueNotification_('milestone', result.entry.entryId, { milestone: result.milestoneCrossed }, null, null);
      }
    } else if (action === 'update' || action === 'delete') {
      recomputeUserCounters_(entries, result.affectedUserIds);
      if (result.milestoneCrossed) {
        queueNotification_('milestone', result.entry ? result.entry.entryId : result.entryId, { milestone: result.milestoneCrossed }, null, null);
      }
    }
    scheduleQueueProcessing_(); // one-time trigger, fires in ~2s, separate execution
  }
} catch (err) {
  Logger.log('Notification queueing/counters failed: ' + err);
}
return jsonOutput_(result);
```

This is the achievable goal in Apps Script's synchronous model: **saving never fails or slows down because of notifications**, and — via the queue below — **sending the actual Telegram message happens in a genuinely separate execution**, not just after the lock.

### Notification queue & delivery

`queueNotification_(type, entryId, context, mediaUrl, mediaType)` writes one `PENDING` row to Notifications with `contextJson` — **no Gemini or Telegram call happens here**, just a Sheets write.

`scheduleQueueProcessing_()` calls `ScriptApp.newTrigger('processNotificationQueue_').timeBased().after(2000).create()` — a **one-time trigger, a genuinely separate execution**, firing ~2 seconds later. One-time triggers delete themselves automatically once fired. If several friends post within the same couple of seconds, each schedules its own one-time trigger; the overlap guard below means only one actually processes at a time, and since it processes every currently-`PENDING` row in one pass, the redundant near-simultaneous triggers just find the lock held and exit immediately.

**Locking correction found during implementation planning: use `LockService.getDocumentLock()` for the queue/hourly overlap guard, NOT `getScriptLock()`.** `getScriptLock()` is a single lock shared by the *entire script project* — if the queue processor held that same lock while doing slow Gemini/Telegram work, it would block `doPost`'s own `lock.waitLock(20000)` for concurrent saves, reintroducing the exact problem the lock-scoping fix above was meant to solve. `getDocumentLock()` is a separate lock resource (scoped to the bound Sheet), so it correctly serializes queue-processing runs against each other without ever contending with `doPost`'s save-path lock.

`processNotificationQueue_()` — guarded by `LockService.getDocumentLock().tryLock(5000)` (skip if another run is already in progress); if acquired, calls `drainNotificationQueue_()` (the actual loop, factored out with no locking of its own so `hourlyChecks_` can call it while already holding the same document lock, rather than trying to acquire a second nested lock).

`drainNotificationQueue_()` — for each `PENDING`/`PENDING_RESEND` row, up to a batch/time budget (e.g. 25 rows or ~4 minutes, safely under Apps Script's ~6-minute execution cap):
- **No `messageContent` yet** (first attempt): call `generateMessageText_(context, type)` — one Gemini call. `generateMessageText_` returns the fallback sentence directly (not an error) for a safety-block or empty-candidate response — that's a handled path, not a failure, so it must NOT count toward `retryCount`. It *throws* for a genuine network/HTTP/parse failure, which the caller catches and treats as retryable. Either way, once text exists, write it to `messageContent` **immediately**, before attempting to send — a later send-retry must never re-call Gemini.
- Then **always** attempt `sendTelegramMessage_(messageContent, driveFileId, mediaType)` (uploads the Drive file as bytes — see below). Success → `SENT`. Failure (thrown) → increment `retryCount`; if `< MAX_NOTIFICATION_RETRIES` (Settings), leave `PENDING` for the next run; otherwise `FAILED`, visible in the log for the admin to fix and flip to `PENDING_RESEND`.
- **`PENDING_RESEND` retry-budget reset**: rather than a separate mechanism to reset `retryCount` to 0, treat a row currently in `PENDING_RESEND` status as having an *effective* `retryCount` of 0 for the max-check purposes on its next attempt (simpler than trying to detect the admin's edit via a trigger).
- **`PENDING_RESEND`**: `messageContent` is already set (admin-edited) — skip Gemini entirely, just retry the send with the stored content.

**Retry scope**: a Telegram *send* failure is the common, worth-retrying case (transient network/rate-limit issue). A Gemini safety-block is not retried. A genuine Gemini network error is retried the same as a send failure, but since `messageContent` is only written once generation actually succeeds, a Gemini-side retry re-attempts generation; a Telegram-side retry (the overwhelmingly common case) never touches Gemini again.

`hourlyChecks_()` — also guarded by `LockService.getDocumentLock().tryLock(5000)` (same lock resource as `processNotificationQueue_`, so they correctly can't run concurrently with each other, while neither ever blocks `doPost`) — is a fallback safety net (in case a one-time trigger ever fails to fire or a run dies mid-processing) plus the genuinely hour-granularity checks: (1) calls `drainNotificationQueue_()` directly (already holding the lock — no nested lock acquisition), (2) Points Update check using **"due and not yet sent"** semantics (`now.getHours() >= POINTS_UPDATE_HOUR && POINTS_UPDATE_LAST_SENT_DATE !== today` — exact-hour equality would silently skip a whole day if a trigger firing is late), (3) highlight check: scans Entries for `highlightOfWeek === true && !highlightAnnouncedAt`, guarded by `HIGHLIGHT_LAST_SENT_WEEK` so at most one highlight fires per week even if the admin ticks more than one entry.

`setupHourlyTrigger_()` — one-time function registering `ScriptApp.newTrigger('hourlyChecks_').timeBased().everyHours(1).create()`. Script project timezone must be `Asia/Singapore` (Project Settings > General settings).

### Media upload

`sendTelegramMessage_(text, driveFileId, mediaType)` uploads the media as **bytes, not a URL** — `DriveApp.getFileById(driveFileId).getBlob()` (the script runs "Execute as: Me," the file's owner, so this always works) passed as the `photo`/`video` field of a multipart `UrlFetchApp.fetch(..., { method: 'post', payload: {...} })` to `sendPhoto`/`sendVideo`, with `message_thread_id` set to the configured topic. The stored `mediaUrl` (`https://drive.google.com/file/d/.../view`, `Code.gs:623`) is an HTML viewer page — Telegram fetching that URL directly would get HTML back, not image bytes, and fail on essentially every message. Falls back to plain `sendMessage` (text + deep link) only if the blob upload itself fails (`driveFileId` missing/invalid, or the media-send attempt throws). On a non-200 Telegram response, parses the JSON body's `description` field into the thrown error message so the log is actually diagnostic, not just "non-200."

### Other functions

- `getSettings_()`/`getSettingsSheet_()`/`setSetting_(key, value)`, `getStyleGuide_()`/`parseStyleGuide_()`, `getOrCreateStyleGuideDoc_()` (called from `setup()`), `computeTotals_()`, `checkAndAdvanceMilestone_(newTotal)` (against the `LAST_MILESTONE_ANNOUNCED` watermark, idempotent regardless of which write path — create/update/delete — changed the total; called inside the lock in each write path), `getNotificationsSheet_()`/`notificationIndexOf_()`/`updateNotificationStatus_()`, `buildEntryContext_(entry, extra)`/`getDisplayName_(userId)`, `computeCountersForUser_()`/`computeStreaks_()`/`weekIndexSinceEpoch_()`/`writeUserCounters_()`/`recomputeUserCounters_(entries, userIds)`, `backfillUserCounters_()`, `checkAndSendPointsUpdate_()`/`weeksBetween_()`, `checkAndSendHighlight_()`.
- **Notifications resend semantics**: resending always replays that row's own stored `messageContent`/`mediaUrl`/`mediaType` verbatim — never re-derives from the live `entryId` (which may have since changed or been deleted). This must still work even if the original entry was since soft-deleted.
- Add top-level constants (non-secret, same treatment as existing `TARGET_POINTS`/`DEADLINE_ISO` in `index.html`): `FRONTEND_URL` (the GitHub Pages site URL, for building deep links) and mirrored copies of `TARGET_POINTS`/`DEADLINE_ISO` in `Code.gs` itself (needed for the Points Update message's "days remaining"/target context) — comment both as "keep in sync with index.html," following the existing pattern already used for `HEADERS` at `Code.gs:29`.

New Script Properties: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_TOPIC_ID`, `GEMINI_API_KEY`.

## Front-end change (`index.html`)

Add `?entry=<id>` deep-link support: after `loadEntries()` (`index.html:6647`) populates `state.entries` on the first load, check `new URLSearchParams(location.search).get('entry')`, find the matching entry, call `openPreviewModal(entry)` (`index.html:5408`) once — guarded against refiring on the 20s poll. If the entry isn't found (e.g. deleted before the link was opened), no-op/toast gracefully rather than erroring.

## Docs to update once built

- `docs/PRD.md` §5.2: remove "push notifications / reminders" from "out of scope."
- `docs/SETUP.md`: new "Telegram notifications" section — bot creation, topic ID lookup, the 4 new Script Properties, what Settings/style-guide Doc/Notifications are for, `setupHourlyTrigger_()`'s timezone caveat, and the mandatory one-time `backfillUserCounters_()` step.
- `docs/DECISIONS.md`: one short current-state entry once shipped.

## Deferred to Phase 2

Named streak badges, personal post-count milestone announcements, per-category milestone announcements, "Well-Rounded" — straightforward once Phase 1's counters exist and real data/wording preferences are visible.

## Setup the user needs to do (before code can be tested)

Telegram: create a bot via @BotFather, enable Topics on the group, create the notification topic, add the bot as admin, retrieve `chat_id` and the topic's `message_thread_id` via `getUpdates`. Gemini: get a free API key from Google AI Studio.

## Verification

No automated test suite in this repo — verify via dev server + browser. Plan:
1. Deploy the updated `Code.gs` (Apps Script editor > Deploy > Manage deployments > New version).
2. Run `setup()`, `backfillUserCounters_()`, and `setupHourlyTrigger_()` once each, in that order, from the Apps Script editor.
3. Fill in the Settings tab's defaults, the style-guide Doc's initial content, and the 4 new Script Properties.
4. `npm run dev` locally; log a genuine test activity and confirm: the entry save **returns quickly** (no wait for Telegram/Gemini), a `PENDING` Notifications row appears immediately, and within a couple seconds it flips to `SENT` with the actual photo (uploaded as bytes), varied text, a working deep link.
5. Log two entries in quick succession from two different signed-in sessions/browsers to confirm neither save fails or measurably slows down.
6. Toggle a low milestone value and log a test entry; then edit that entry's amount down below the threshold and back up — confirm the milestone announces exactly once (the watermark, not a double-fire).
7. Break the Telegram token temporarily, log an entry, confirm: the entry still saves fine, the queued row retries automatically (watch `retryCount` climb across queue-processor runs) up to `MAX_NOTIFICATION_RETRIES`, then lands on `FAILED` with Telegram's actual error text in `lastError`. Fix the property, edit that row's status to `PENDING_RESEND`, confirm the next run resends the stored content.
8. Edit a test entry's category and confirm the owner's per-category counters update correctly (sorted-by-date, not naively incremented); delete another and confirm affected users' counters drop accordingly.
9. Confirm an existing (pre-deploy) friend's next post is **not** mislabeled "first post" (the backfill working).
10. Tick `highlightOfWeek` on a test entry, wait for/manually run `hourlyChecks_()`, confirm it fires once and stamps both `highlightAnnouncedAt` and `HIGHLIGHT_LAST_SENT_WEEK`; tick a second entry the same week and confirm it does *not* also announce.
