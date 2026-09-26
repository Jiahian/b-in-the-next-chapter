<!--
Handoff artifact only — NOT part of the app. Companion to NOTES_notification_plan.md.
Build proceeds phase by phase: Claude implements one phase, the user runs its checkpoint
by hand (dev server + browser + Apps Script editor + Telegram), and only gives explicit
approval to move on after the checkpoint passes. Delete both NOTES files before opening
a PR / merging.
-->

# Build checklist — Telegram notifications (Phase 1)

Each phase = one round of code changes + one manual checkpoint. Nothing in a later
phase should be started until the current phase's checkpoint is confirmed working.

## Phase 0 — Prerequisites (no code)
- [ ] Telegram bot created via @BotFather, added as admin to the group
- [ ] Topics enabled on the group, notification topic created
- [ ] `chat_id` and the topic's `message_thread_id` retrieved via `getUpdates`
- [ ] Gemini API key obtained (Google AI Studio, free tier)

**Checkpoint:** you have all four values in hand. Nothing to test in the app yet.

## Phase 1 — Data model scaffolding
Code: new Settings/Notifications sheet tabs + `ensureHeaders_`, `highlightOfWeek`/
`highlightAnnouncedAt` columns on Entries, new counter columns on Users,
`getOrCreateStyleGuideDoc_()` wired into `setup()`.

**Checkpoint:**
- [ ] Run `setup()` from the Apps Script editor — no errors
- [ ] Settings and Notifications tabs exist with the right header rows
- [ ] Entries/Users sheets show the new columns (existing rows blank, not broken)
- [ ] A "BNext — Notification Style Guide" Google Doc was created
- [ ] Existing app still works unchanged: `npm run dev`, log/edit/delete an entry as normal — no visible behavior change yet

## Phase 2 — Counters & backfill
Code: `computeCountersForUser_`, `computeStreaks_`, `weekIndexSinceEpoch_`,
`writeUserCounters_`, `recomputeUserCounters_`, `backfillUserCounters()`, wired into
`createEntry_`/`updateEntry_`/`deleteEntry_` (no notifications yet — pure bookkeeping).

**Checkpoint:**
- [ ] Run `backfillUserCounters()` once — spot-check 2-3 friends' counters against what you'd expect by eye
- [ ] Log a new test entry — owner's `postCount` (and category counter) increments correctly
- [ ] Backdate an entry (date in the past) — streaks recompute by date order, not creation order
- [ ] Edit an entry's category — per-category counters shift correctly
- [ ] Delete an entry — affected users' counters drop correctly
- [ ] Still zero Telegram/Gemini activity at this point

## Phase 3 — Queue plumbing (no external calls yet)
Code: lock-scoping change in `doPost` (`Code.gs:286-299`), `queueNotification_`,
`scheduleQueueProcessing_`, `getNotificationsSheet_`/`notificationIndexOf_`/
`updateNotificationStatus_`, `processNotificationQueue_`/`drainNotificationQueue_`
with Gemini/Telegram calls **stubbed** (mark `SENT` with placeholder text) to validate
wiring before adding external-API risk.

**Checkpoint:**
- [ ] Log a test entry — save still returns immediately (no perceptible delay)
- [ ] A `PENDING` row appears in Notifications right after save
- [ ] Within ~2s it flips to `SENT` (placeholder text, no real Telegram message yet)
- [ ] Log two entries back-to-back from two different signed-in sessions — both saves stay fast, neither errors (confirms `getDocumentLock()` isn't contending with `doPost`'s `getScriptLock()`)

## Phase 4 — Gemini integration
Code: `generateMessageText_`, `getSettings_`/`GEMINI_MODEL`, `getStyleGuide_`/
`parseStyleGuide_` with 10-min cache, replaces the Phase 3 placeholder.

**Checkpoint:**
- [ ] Log a real test entry — the Notifications row's `messageContent` is real Gemini-varied text, not placeholder
- [ ] Log 2-3 more — wording actually varies between them, matches the style guide's tone
- [ ] Force a bad case if you can (e.g. temporarily invalid `GEMINI_API_KEY`) — confirm it throws and is treated as retryable (not silently swallowed)

## Phase 5 — Telegram send + media
Code: `sendTelegramMessage_` (Drive blob as bytes, `message_thread_id`, fallback to
plain `sendMessage`, retry loop against `MAX_NOTIFICATION_RETRIES`, `lastError` from
Telegram's `description` field).

**Checkpoint:**
- [ ] Real Telegram message appears in the correct topic with the actual photo/video attached (not a broken link)
- [ ] "Read more" deep link is present and correctly formed
- [ ] Temporarily break `TELEGRAM_BOT_TOKEN` — entry still saves fine, row's `retryCount` climbs across queue runs, eventually lands on `FAILED` with Telegram's real error text in `lastError`
- [ ] Fix the token, edit that row's status to `PENDING_RESEND` — next run resends using the stored `messageContent` verbatim (no second Gemini call)

## Phase 6 — Milestones
Code: `checkAndAdvanceMilestone_` + `LAST_MILESTONE_ANNOUNCED` watermark, called inside
the lock in each write path; queued as a separate message.

**Checkpoint:**
- [ ] Set a low test value in `MILESTONES`, log a qualifying entry — exactly one milestone message + one regular entry message
- [ ] Edit that entry's amount below the threshold, then back up — milestone does **not** re-fire (watermark holds)

## Phase 7 — First-post / group-activity folding
Code: `isFirstPost` derived from Phase 2's counters, group-activity phrasing in
`buildEntryContext_`, `taggedInCount`/`groupActivityPostCount` bumps.

**Checkpoint:**
- [ ] A genuinely new test user's first entry gets first-post phrasing
- [ ] An existing (pre-deploy, backfilled) friend's next post is **not** mislabeled as first-post
- [ ] Log an entry tagging 2 friends — message names the creator + a count, not each tagged friend individually
- [ ] Tagged friends' `taggedInCount` and the creator's `groupActivityPostCount` update

## Phase 8 — hourlyChecks_: Points Update + Highlight
Code: `hourlyChecks_()`, `checkAndSendPointsUpdate_`/`weeksBetween_`,
`checkAndSendHighlight_`, `setupHourlyTrigger()`.

**Checkpoint:**
- [ ] Run `setupHourlyTrigger()` once — Apps Script trigger dashboard shows it scheduled hourly; confirm script project timezone is `Asia/Singapore`
- [ ] Configure Settings so a Points Update is "due now," manually run `hourlyChecks_()` — message sends once, `POINTS_UPDATE_LAST_SENT_DATE` updates, running it again same day does not resend
- [ ] Tick `highlightOfWeek` on a test entry, run `hourlyChecks_()` — fires once, stamps `highlightAnnouncedAt` + `HIGHLIGHT_LAST_SENT_WEEK`
- [ ] Tick a second entry the same week — does **not** also announce

## Phase 9 — Front-end deep link
Code: `?entry=<id>` handling in `index.html` after `loadEntries()`.

**Checkpoint:**
- [ ] Opening a notification's link on a cold session lands directly on that entry's preview
- [ ] It does not re-trigger on the 20s poll
- [ ] A link to a since-deleted entry no-ops gracefully (no crash/error toast)

## Phase 10 — Regression + docs
**Checkpoint:**
- [ ] Full regression pass unrelated to notifications: create/edit/delete entry, gallery, profile, tagging, allowlist auth all still work
- [ ] `docs/PRD.md` §5.2, `docs/SETUP.md`, `docs/DECISIONS.md` updated per the plan
- [ ] Both `NOTES_*.md` handoff files deleted before the PR
