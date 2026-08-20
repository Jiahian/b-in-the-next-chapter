# Product Requirements Document

## B in the Next Chapter!

| | |
|---|---|
| **Author** | Sef |
| **Date** | 20 Aug 2026 |
| **Status** | v4 — Phase 1 in build, Phase 2 documented (§12), Drive-vs-Firebase trade-off recorded (§8.1) |
| **Challenge deadline** | 31 Dec 2026 |
| **Reference** | [binthenextchapter.ai.studio](https://binthenextchapter.ai.studio/) — an existing prototype this PRD aligns with and extends |

---

## 1. Overview

"B in the Next Chapter!" is a mobile-first web app that lets a group of friends log personal activities as points toward one shared, collective goal. Each friend submits entries through a simple form; the app aggregates everyone's points in real time and visualizes progress toward the group target before the 31 Dec 2026 deadline.

The name and framing suggest this is a personal-growth challenge with the group holding each other accountable — spiritual practice, relationships, and other goals — tracked together rather than individually.

## 2. Problem statement

Groups doing shared challenges typically fall back on a spreadsheet or a chat thread to self-report progress, which is easy to lose track of, hard to visualize, and has no record of proof (photos/videos) or a sense of urgency (a countdown). Friends want a lightweight, always-available place to log an activity in a few taps, see the group's combined progress at a glance, and browse a shared gallery of everyone's proof-of-activity.

## 3. Goals

- Make logging an activity fast enough to do in under 30 seconds from a phone.
- Give the group one shared, always-up-to-date number: total points vs. target.
- Make progress visible and motivating (progress bar, category breakdown, countdown).
- Preserve a browsable record (gallery) of what everyone has been doing, with proof photos/videos.
- Work well as a phone home-screen app, not just a desktop page.

### Success metrics

- Group reaches 1,000 points before the deadline.
- Every active friend logs at least one entry per week.
- Entries include a photo/video in 100% of cases (enforced by the form).

## 4. Target users

A private group of friends (not the general public) participating in the same challenge. No public sign-up flow is needed; the app is shared as a link/installed app within the friend group. Anyone with the link can view and log entries — there is no admin/moderator role in v1.

## 5. Scope (v1)

### 5.1 In scope

1. Page title: **"B in the Next Chapter!"**
2. Live countdown timer to the deadline (**31 Dec 2026**), shown in days, hours, minutes, seconds, updating every second.
3. Total points accumulated by the whole group, shown against the target with a progress bar and a motivational status line (e.g., "🔥 Almost there!") that reacts to how close the group is to goal.
4. Points broken down by category, shown as a pie chart.
5. A media gallery of all uploaded photos/videos, filterable by month and by category, with edit and delete on individual entries.
6. A submission form (see §6) for logging a new activity/points entry, including an edit flow for correcting an existing one.
7. A celebration modal that fires once the group crosses the 1,000-point target.

### 5.2 Out of scope (v1)

- User accounts / login with passwords (see §8 — a lightweight identity model is used instead).
- Restricting edit/delete to only the original submitter — v1 follows the reference prototype and allows any group member to edit or delete any entry (low-friction, trust-based, matching a small friend group). *Flagged as an open question in §10 if tighter control is wanted.*
- Push notifications / reminders.
- Individual leaderboards or rankings between friends (the goal is explicitly collective, not competitive) — the app records who logged each entry, but v1 does not add a ranked leaderboard view.
- Editing the target, deadline, or category list from within the app UI (v1 treats these as configuration, not end-user settings).

## 6. Functional requirements

### 6.1 Countdown timer

- Computed from "now" to 31 Dec 2026, 23:59:59 (Singapore time).
- Displayed as four values: days, hours, minutes, seconds — updating live (every second) without a page refresh.
- After the deadline passes, the timer shows a "Challenge ended" state instead of negative numbers.

### 6.2 Total points & progress bar

- Total points = sum of the "amount" field across all submitted (non-deleted) entries, regardless of category.
- Displayed as a headline number (e.g., "612 / 1,000 pts") plus a horizontal progress bar showing percent-to-goal.
- A short status line under the bar reflects progress at a glance (e.g., early: "Just getting started", mid: "🔥 Almost there!", complete: "🎉 Goal reached!") — exact copy/thresholds to be finalized in design.
- Progress bar, headline number, and status line update as new entries are submitted or edited/deleted (by anyone in the group, on any device) — see §8 for the sync-speed trade-off (near-real-time, not instant push).
- Target: **1,000 points**.

### 6.3 Points by category — pie chart

- One slice per category (Spiritual / Relationship / Others), sized by each category's share of total points.
- Legend labels each slice with its name and point total (not color-only, for accessibility).
- Updates as entries are submitted, edited, or deleted.

### 6.4 Photo/video gallery

- Grid of thumbnails, one per submitted entry (image thumbnail, or a video thumbnail/play icon for video entries).
- Two filters, usable together: **Month** (derived from entry dates) and **Category**.
- Tapping a thumbnail opens the full photo/video along with its details: who logged it, activity name, category, date, and amount + units.
- Each entry can be **edited** (opens the entry form pre-filled, including the option to replace the media) or **deleted** (behind a confirmation modal, since deletes also remove the underlying Drive file and are not recoverable).

### 6.5 Goal-achieved celebration

- The moment total points reach or cross 1,000, the app shows a one-time celebratory modal (e.g., confetti + congratulatory message) to whoever is viewing at that moment.
- Does not block continued logging — the group may still choose to log activities after reaching goal; the celebration does not need to repeat on every subsequent visit once acknowledged.

### 6.6 Entry form ("log an activity")

| Field | Type | Rules |
|---|---|---|
| Your name | Free text | Required. Identifies who logged the entry. |
| Category | Dropdown | Required. Options: Spiritual, Relationship, Others. |
| Activity name | Free text | Required. |
| Date | Date picker | Required. Defaults to today. Cannot be a future date. |
| Amount | Number | Required. Up to 1 decimal place. Must be greater than 0. |
| Units | Dropdown | Required. Options: km, hours. |
| Photo/video | File upload | **Mandatory.** Accepts image or video, from camera or existing gallery. |

- On submit, the entry is added to the shared pool and reflected in the progress bar, pie chart, and gallery for everyone (see §8 for sync timing).
- Form validates all fields client-side before allowing submission (in particular: no future dates, amount > 0 with max 1 decimal, media file present).
- The same form is reused for **editing** an existing entry (pre-filled from the gallery's edit action), with the option to keep the existing photo/video or replace it.

## 7. Non-functional requirements

- **Mobile-first**: designed and tested primarily for phone screen sizes; installable to the home screen (so it opens and feels like a native app) rather than requiring a browser tab each time.
- **Shared state, kept in sync**: an entry logged by one friend must become visible to the rest of the group without anyone needing to manually refresh, and without any single friend's *device* being the source of truth (the backend is). Given the chosen backend (§8), this is near-real-time (a periodic refresh, on the order of seconds) rather than an instant push.
- **Low friction**: no password-based login; friends should be able to open the app and log an entry within seconds.
- **Media handling**: photo/video uploads should work reliably over mobile data, with a visible upload progress/state so users know an entry has actually gone through.
- **Data durability**: once submitted, entries and their media persist independent of any one friend's device (i.e., not stored only in one person's browser).

## 8. Proposed technical approach

Because points must sync across every friend's own phone, this cannot be a purely front-end, on-device app (there is no single device to be the shared source of truth) — it needs a small always-on backend. Per your decision, this runs entirely on one existing Google account with spare Drive storage, rather than a separate paid backend like Firebase — **$0 cost, no billing/credit card setup.**

- **Frontend**: a single mobile-optimized web app (installable as a home-screen PWA on iOS/Android), covering the dashboard (countdown, progress, pie chart), the entry form, and the gallery.
- **Data ("database")**: a **Google Sheet**, owned by the one nominated Google account, with one row per entry (name, category, activity, date, amount, units, Drive file link, edited/deleted flags). Doubles as a human-readable audit log/export if anyone ever wants to open it directly.
- **Media storage**: **Google Drive**, same account — one folder holding all uploaded photos/videos, using that account's existing spare space.
- **Glue**: a **Google Apps Script**, deployed as a Web App under that same account ("Execute as: Me / Access: Anyone with the link"). It exposes simple endpoints the front-end calls to submit, edit, delete, and list entries — it writes rows to the Sheet and files to the Drive folder, and returns a Drive-hosted URL for each media file back to the app. This is what lets every friend log entries and upload media *without* needing their own Google login or write access to the Sheet/Drive — only the Apps Script owner's account touches Drive/Sheets directly.
- **Sync model**: the app polls the Apps Script endpoint on an interval (e.g., every 15–30 seconds) and on each app open/resume, rather than an instant push like a realtime database would give. For a friend group logging a few times a day, this trade-off is invisible in practice — worth flagging since it differs from a Firebase-style setup.
- **Identity**: lightweight — no login at all; a free-text "your name" field on each entry provides attribution, matching the reference prototype.
- **Hosting**: the front-end itself is a static file, hostable for free (e.g., GitHub Pages, or Apps Script's own web hosting) so the app has a stable HTTPS link the group can share and add to their home screens.

### 8.1 Why Google Drive over Firebase Storage for media

This was a deliberate substitution partway through scoping (an earlier draft of this PRD proposed Firebase Storage) after confirming a group member has enough spare Google Drive storage to cover the challenge's media. Worth recording both sides:

**In favor of Firebase Storage** (the road not taken):
- Purpose-built for exactly this — a client SDK uploads straight to storage and hands back a stable public URL, ready to drop into an `<img>`/`<video>` tag.
- Pairs natively with a realtime database (Firestore), so app and data layer are one platform instead of two.
- Uploading doesn't require each friend to authenticate with a personal Google account — Firebase supports frictionless anonymous sign-in per device.
- Cost was never the blocker: even a video-heavy year of uploads from 30 friends came out to roughly $5–10 total for the whole challenge (see the storage-sizing estimate discussed earlier) — cheap either way.

**In favor of Google Drive** (what we went with):
- **$0 marginal cost** — uses storage the group already has, with no new billing account or card to set up at all, versus Firebase's "very cheap but still a bill."
- Files sit in an ordinary, browsable Drive folder the owner can inspect or back up outside the app, if that's ever useful.

**The real cost of this choice** — friction, not money:
- Every friend uploading without their own Google login only works because the Apps Script "glue" layer (§8) accepts uploads on everyone's behalf and writes them into one owner's Drive folder — Drive has no equivalent to Firebase's frictionless anonymous-auth upload path on its own.
- Drive doesn't hand back a clean CDN-style URL the way Storage does — images are fetched via a thumbnail endpoint (`drive.google.com/thumbnail?id=...`) and videos are embedded via Drive's own preview `<iframe>` rather than a native `<video>` tag, which is a little less polished (no custom video player chrome, thumbnail quality is Google's to decide) and a little more fragile (Drive occasionally rate-limits hotlinked content).
- Drive is *only* file storage — it doesn't replace the database, so this build still needs Sheets + Apps Script alongside it (whereas Firebase Storage would have paired with Firestore as one platform). Net effect on the architecture is neutral either way, since Phase 1 already needs a database regardless of where media lives.

**Bottom line**: for a 30-person friend group, free beats "cheap," and the embedding/upload friction is a one-time build cost Claude absorbs while writing the Apps Script and front-end — not an ongoing cost the group feels. Revisit this trade if the group ever outgrows the donated Drive storage or the friction becomes visible to end users (e.g., video playback quality complaints).

### 8.2 Trade-offs of this approach vs. a Firebase-backed build

Broader than just media — the full-stack comparison, worth confirming you're comfortable with:

- *Single point of ownership*: everything (data + media) lives under one friend's Google account. If that person ever revokes access, deletes the Sheet/folder, or runs low on storage, the whole app's data goes with it — worth agreeing as a group who that is and treating it as the de facto admin.
- *Not instant*: near-real-time (polling) rather than push-based live sync.
- *Upload size ceiling*: Apps Script Web Apps have request-size limits well-suited to photos and short clips, but long/high-resolution videos (roughly 50MB+) can be unreliable through this path — worth nudging the group toward short clips (also keeps the reference prototype's spirit intact).
- *Quotas*: consumer Google accounts have daily Apps Script execution quotas; at 30 friends logging a few times a day this is far under the limit, but it's a shared ceiling to be aware of if usage spikes.

## 9. Data model (indicative)

**Entry — one row per entry in the Google Sheet**

| Field | Type | Notes |
|---|---|---|
| entryId | string | Generated on create; used for edit/delete lookups |
| name | string | Who logged it |
| category | enum | Spiritual \| Relationship \| Others |
| activity | string | Free text |
| date | date | ≤ today |
| amount | number | 1 decimal place, > 0; also the point value |
| units | enum | km \| hours |
| driveFileId | string | The uploaded photo/video's Drive file ID |
| mediaUrl | string | Shareable Drive URL, derived from driveFileId |
| mediaType | enum | image \| video |
| createdAt | timestamp | Set by Apps Script on create |
| updatedAt | timestamp | Set by Apps Script on edit |
| deleted | boolean | Soft-delete flag — deleted rows are excluded from totals/gallery; the Apps Script also removes the matching Drive file when a delete is confirmed |

Total points = SUM(amount) across all entries where `deleted = false`. Category totals = SUM(amount) grouped by category, same filter.

## 10. Assumptions & open questions

- **Points = amount.** The brief doesn't define a separate points value distinct from the logged amount/units, so this PRD assumes 1 unit logged (1 km or 1 hour) = 1 point. *Open question: should km and hours convert to points differently (e.g., weighted), or should there be a separate "points" field independent of the measured amount?*
- **Target = 1,000 points**, per your input — confirm this is the final number before build.
- **Categories are fixed** at Spiritual / Relationship / Others for v1 (not user-editable).
- **Edit/delete is unrestricted** — any group member can edit or delete any entry, not just their own (matches the reference prototype). *Open question: is that trust level fine for this group, or should edit/delete be limited to the entry's original author?*
- **Whose Google account hosts this?** Confirm who the "someone with spare Drive storage" is — that account becomes the de facto owner/admin of all data and media (see §8's single-point-of-ownership trade-off).
- **Privacy**: gallery and totals are visible to anyone with the app link, with no per-friend privacy controls. Confirm this is acceptable for the group.
- **Sync interval**: proposing a 15–30 second poll (§8) — flag if the group wants it faster/slower.

## 11. Milestones

| Milestone | Notes |
|---|---|
| PRD sign-off | This document |
| Backend setup (Sheet + Drive folder + Apps Script deployment on the nominated Google account) | ~1 day |
| Core build (form incl. edit, countdown, progress + status line, pie chart, gallery incl. delete, celebration modal) | ~2–3 days |
| Testing across friends' phones | ~1 day |
| Launch to the group | Before campaign start |
| Challenge deadline | **31 Dec 2026** |

## 12. Phase 2 (future) — gamification

Not built in Phase 1; captured here so the direction is on record and Phase 1's data model doesn't have to be reworked to support it later.

### 12.1 Concept

Turn the points system into something more playful, in a retro 64px pixel-art style (in the spirit of the "Walking Charlie" reference the group shared — an original art set inspired by that style, not a copy of it). Each friend gets a pixel character living in a shared "town." Direction discussed:

- Rename "points" to **Manna** — the Biblical food-from-heaven, doubling as a natural pun on game "mana." (Placeholder name pending final confirmation.)
- Introduce a **spendable currency** alongside the group's lifetime point total (see §12.2 — this split is the key data-model decision).
- A **shop** where Manna buys clothing/accessories and backgrounds to customize a friend's character (dress-up mechanic, optionally with a "mystery box" random-reward element like the reference app).
- An **inactivity state**: if a friend hasn't logged an entry in 2+ days, their character appears "sleeping" in the town view; friends can "poke" them (visible next time the sleeping friend opens the app — there's no push-notification channel in this build, so a poke isn't instant, it surfaces on next open).

### 12.2 Key design requirement: split lifetime points from spendable currency

The group's shared progress bar must be driven by **lifetime points earned** (sum of every entry's amount, ever — never decreases). **Manna balance** (spendable, decreases when a friend buys something) is a separate number that starts equal to lifetime points and diverges once spending begins. Getting this split right from the start matters — if spending drew down the same number that feeds the group's shared goal, buying a hat would visibly shrink the whole group's progress bar.

### 12.3 Technical approach: hybrid, not a full migration

- **Media (photo/video gallery) stays on Google Drive** — it's write-once data with no concurrency concerns, no reason to re-host it.
- **Game state (Manna balance, inventory, equipped items, sleep/poke status) moves to Firebase Firestore** when Phase 2 begins, because that layer genuinely benefits from what Firestore gives that Sheets/Apps Script doesn't: real-time listeners (a friend's new outfit or wake-up appears instantly for everyone, not on a 15–30s poll) and atomic transactions (prevents two purchases racing against the same Manna balance and double-spending it).
- **Migration mechanics**: a one-time script reads existing Sheet rows and writes them into Firestore documents; the front-end swaps its game-state calls from the Apps Script endpoint to the Firestore SDK; done during a short "back in a few minutes" maintenance window rather than engineering zero-downtime dual writes, which isn't worth it at this scale.
- **To keep this painless later, Phase 1 should**: give every row a stable UUID-style `entryId` (not a spreadsheet row number), store timestamps in ISO format, and keep media references as plain URLs/file IDs decoupled from any Sheets-specific formatting — all of which carries over into Firestore documents with no rework.
- Net effect: Phase 2 adds a small Firebase Blaze bill (Firestore usage at this scale is near-$0, per the earlier cost estimate) on top of the still-free Drive/Sheets media layer — not a full swap of everything to Firebase.

### 12.4 Open items for Phase 2 (not yet decided)

- Final currency name (Manna vs. alternatives).
- Whether the shop includes a randomized "mystery box" mechanic or a straightforward direct-purchase shop only.
- Sprite/art requirements: fixed canvas size for layering (e.g. 64×64 or 128×128px), a base character (or a few), a clothing/accessory set, a background set, an idle pose, a sleeping pose, and a poke reaction — either sourced from the group or Claude can generate an original starter set.
- Whether "poke" should do anything mechanically (e.g., a small Manna bonus for waking up) or stay purely social.

---

*Phase 1 (this document's core scope, §1–§11) is now in build. Phase 2 (§12) is documented for direction but not started — revisit once Phase 1 is live with the group.*
