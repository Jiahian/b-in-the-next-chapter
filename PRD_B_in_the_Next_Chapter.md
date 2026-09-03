# Product Requirements Document

## B in the Next Chapter!

| | |
|---|---|
| **Author** | Sef |
| **Date** | 26 Aug 2026 (last updated 3 Sep 2026) |
| **Status** | v6 — Phase 1 live and in use; gallery/UI overhaul merged (§6.4, §6.6, §11); Phase 2 documented (§12); Drive-vs-Firebase trade-off recorded (§8.1); access-control decision open (§8.3/§10), now blocked on rebasing the unmerged Google Sign-In branch onto the overhauled UI |
| **Challenge deadline** | 31 Dec 2026 |
| **Reference** | [binthenextchapter.ai.studio](https://binthenextchapter.ai.studio/) — the prototype this build's visual design was matched to exactly (pulled from its actual source, not just screenshots) |

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
4. Points broken down by category, shown as a bar per category.
5. A media gallery of all uploaded photos/videos, in a masonry collage layout with a tap-to-open post preview, filterable by month and by category via a single unified filter control, with edit and delete on individual entries. An uploaded photo can also be resized/cropped after the fact (§6.4).
6. A submission form (see §6) for logging a new activity/points entry, including an edit flow for correcting an existing one. Video uploads are automatically converted to a short animated GIF client-side (§6.6).
7. A celebration modal that fires once the group crosses the 1,000-point target.
8. Light/dark theme, user-toggleable and persisted per device (added 3 Sep 2026 — reverses an earlier build decision to ship light-only; see session-notes.md for that history).

### 5.2 Out of scope (v1)

- Per-user accounts / real login — a lightweight free-text identity model is used instead (see §8). A shared-password gate for the whole app *was* added post-launch (§8.3) as a soft deterrent, but that's an app-wide gate, not individual accounts — whether individual accounts get added is the open §8.3/§10 access-control decision.
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

### 6.3 Points by category — bar chart

- One row per category (Spiritual / Relationship / Others): category name, a horizontal bar, and the point total.
- Each bar fills proportionally toward the overall 1,000-point target (not toward the other categories' totals), so the three bars visually show each category's individual contribution to the shared goal.
- Labeled with name and point total on every row (not color-only, for accessibility) — no separate legend needed.
- Updates as entries are submitted, edited, or deleted.
- *Changed from an earlier pie-chart design during build — a pie/donut chart (via Chart.js) was implemented first, then dropped in favor of this bar layout, which also removed a CDN dependency (Chart.js) the app no longer needs.*

### 6.4 Photo/video gallery

*Substantially reworked 3 Sep 2026 via a community-contributed PR (reviewed, tested, and hardened — see session-notes.md).*

- **Masonry collage view** by default — thumbnails of varying aspect ratios tiled together without subheaders; an alternate grouped-by-month view is available via the filter control.
- A single **filter capsule** replaces the earlier separate Month/Category dropdowns, offering the same two filter dimensions (usable together) through one unified control.
- Tapping a thumbnail opens a **post preview modal** with the full photo/video and its details: who logged it, activity name, category, date, and amount + units.
- Each entry can be **edited** (opens the entry form pre-filled, including the option to replace the media) or **deleted** (behind a confirmation modal, since deletes also remove the underlying Drive file and are not recoverable).
- **Resize/crop**: from the edit flow, an uploaded photo can be re-cropped (zoom, pan, 3:4/4:3 aspect ratio) via an in-browser canvas tool. This is **destructive** — cropping replaces the currently-stored photo; the pre-crop original is not preserved, so cropping again later crops the already-cropped version, not the original upload. Deliberate simplicity trade-off (see §10) — revisit only if this causes real user frustration, since fixing it non-destructively means storing two files per cropped entry.
- Not available for videos (resize/crop is photo-only).

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
| Photo/video | File upload | **Mandatory.** Accepts image or video, from camera or existing gallery. Videos over 20MB are rejected client-side before any processing (tightened from an original 45MB ceiling per §8.2's stress-test findings). |

- On submit, the entry is added to the shared pool and reflected in the progress bar, category breakdown, and gallery for everyone (see §8 for sync timing).
- Form validates all fields client-side before allowing submission (in particular: no future dates, amount > 0 with max 1 decimal, media file present).
- The same form is reused for **editing** an existing entry (pre-filled from the gallery's edit action), with the option to keep the existing photo/video or replace it.
- **Video-to-GIF conversion** (added 3 Sep 2026): a chosen video is automatically converted client-side to a short animated GIF (~5 seconds, 9fps, capped at 360px on the long edge) before upload, so the gallery can show it as a simple, consistently-playable image rather than needing a native video embed. If conversion fails (unsupported format, slow device, etc.), the app falls back to uploading the original video file as before.

## 7. Non-functional requirements

- **Mobile-first**: designed and tested primarily for phone screen sizes; installable to the home screen (so it opens and feels like a native app) rather than requiring a browser tab each time.
- **Shared state, kept in sync**: an entry logged by one friend must become visible to the rest of the group without anyone needing to manually refresh, and without any single friend's *device* being the source of truth (the backend is). Given the chosen backend (§8), this is near-real-time (a periodic refresh, on the order of seconds) rather than an instant push.
- **Low friction**: no per-user login; friends should be able to open the app and log an entry within seconds. (A one-time, app-wide shared password gate was added post-launch — see §8.3 — but it's typed once per device, not a per-user login.)
- **Media handling**: photo/video uploads should work reliably over mobile data, with a visible upload progress/state so users know an entry has actually gone through.
- **Data durability**: once submitted, entries and their media persist independent of any one friend's device (i.e., not stored only in one person's browser).
- **Theming**: supports both light and dark appearance, user-toggleable and persisted per device (added 3 Sep 2026).
- **Honest empty/error states** (added 3 Sep 2026): the app no longer substitutes a canned demo entry or a false "saved" confirmation when it isn't actually connected to a backend — an empty gallery shows a plain "no activities yet" message, and attempting to log/edit/delete while disconnected shows a clear error instead of silently no-op'ing to on-device storage.

## 8. Proposed technical approach

Because points must sync across every friend's own phone, this cannot be a purely front-end, on-device app (there is no single device to be the shared source of truth) — it needs a small always-on backend. Per your decision, this runs entirely on one existing Google account with spare Drive storage, rather than a separate paid backend like Firebase — **$0 cost, no billing/credit card setup.**

- **Frontend**: a single mobile-optimized web app (installable as a home-screen PWA on iOS/Android), covering the dashboard (countdown, progress, category breakdown), the entry form, and the gallery.
- **Data ("database")**: a **Google Sheet**, owned by the one nominated Google account, with one row per entry (name, category, activity, date, amount, units, Drive file link, edited/deleted flags). Doubles as a human-readable audit log/export if anyone ever wants to open it directly.
- **Media storage**: **Google Drive**, same account — one folder holding all uploaded photos/videos, using that account's existing spare space.
- **Glue**: a **Google Apps Script**, deployed as a Web App under that same account ("Execute as: Me / Access: Anyone with the link"). It exposes simple endpoints the front-end calls to submit, edit, delete, and list entries — it writes rows to the Sheet and files to the Drive folder, and returns a Drive-hosted URL for each media file back to the app. This is what lets every friend log entries and upload media *without* needing their own Google login or write access to the Sheet/Drive — only the Apps Script owner's account touches Drive/Sheets directly.
- **Sync model**: the app polls the Apps Script endpoint every 20 seconds, and on each app open/resume, rather than an instant push like a realtime database would give. For a friend group logging a few times a day, this trade-off is invisible in practice — worth flagging since it differs from a Firebase-style setup.
- **Identity**: lightweight — no login at all; a free-text "your name" field on each entry provides attribution, matching the reference prototype.
- **Hosting**: **GitHub Pages**, deployed automatically on every push via a GitHub Actions workflow. The repo is public (required for free-tier Pages), so `WEB_APP_URL` is never committed to it — the workflow injects it into a generated `config.js` at deploy time from a GitHub repository secret instead.
- **Local dev tooling** (added 3 Sep 2026): an optional small Express server (`server.js`, run via `npm run dev`) can serve the app locally for contributors, as an alternative to any plain static file server. Purely a development convenience — doesn't change production hosting (still static GitHub Pages) and isn't part of the deploy pipeline.
- **Known platform limitation** (found 3 Sep 2026, while investigating a resize/crop bug): Apps Script Web Apps cannot set custom HTTP response headers — including CORS headers — on binary (`Blob`) `doGet` output, only on plain text/JSON output. This rules out using Apps Script itself as a general-purpose CORS-friendly proxy for re-serving media; any future feature needing that would require infrastructure outside Apps Script (see §10).

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
- *Upload size ceiling*: Apps Script Web Apps have request-size limits well-suited to photos and short clips. Load testing found the real practical ceiling is lower than originally assumed — a 15MB video took ~44s to upload, and a 40MB video failed outright (hung, never completed). **Resolved 3 Sep 2026** — the client now enforces a hard 20MB limit before any upload/GIF-conversion attempt.
- *Write concurrency*: also found under load testing — if many people submit at the exact same instant, Apps Script's free-tier execution ceiling rejects a large fraction of the truly-simultaneous requests outright (a platform limit, not a bug in this app's code). Reads (viewing the gallery) don't have this problem even under heavy concurrent load. Mitigation is just "retry if a submission fails."
- *Quotas*: consumer Google accounts have daily Apps Script execution quotas; at 30 friends logging a few times a day this is far under the limit, but it's a shared ceiling to be aware of if usage spikes.

### 8.3 Access control

Not in the original scope — added after the app went live, once the group wanted the link itself to not be the only thing standing between a stranger and the group's data.

- **Currently live**: a client-side password prompt gates the whole app. This is explicitly a **soft deterrent, not real authentication** — a static site has no server to keep a secret from the browser, so the password ships in plain text to every visitor and is trivially readable via dev tools or view-source. It stops someone from wandering in by accident; it will not stop someone who's determined to get in.
- **Real protection — decided, built, tested, not yet merged.** Three options were scoped:
  - **(A)** Move the password check server-side into the Apps Script backend (closes the "leaks to everyone" hole specifically; still one shared secret for the whole group; moderate effort, no new services).
  - **(B)** Google Sign-In with a per-person allowlist (real, unspoofable per-person identity; more friction — contradicts the §7 "no per-user login" goal; bigger lift).
  - **(C)** A custom backend with real sessions (most textbook-correct; abandons the $0-cost Apps Script stack this whole project is built around).
  - **Chosen: (B)** (2026-08-29). Phase 2's planned badges/character-items/Manna currency (§12) can only be tied to *specific individuals* if the backend can verify *who* is making a request, not just *that* they know a shared password — and Firebase Authentication (Google Sign-In) pairs natively with the Firestore migration §12.3 already calls for. Built and tested working end-to-end (2026-08-31/09-01) — Google Identity Services sign-in, `Code.gs` verifies the token server-side and checks an email allowlist, the free-text name field is replaced by the verified identity. **Not yet merged**: it was built against the pre-3-Sep-2026 UI, and the gallery/UI overhaul (§6.4, §11) rewrote most of `index.html`, so it needs a rebase first — see §10.

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

- **Points = amount.** The brief doesn't define a separate points value distinct from the logged amount/units, so this PRD assumes 1 unit logged (1 km or 1 hour) = 1 point. *Still open: should km and hours convert to points differently (e.g., weighted), or should there be a separate "points" field independent of the measured amount?*
- **Target = 1,000 points** — confirmed, built and live (`TARGET_POINTS` in `index.html`).
- **Categories are fixed** at Spiritual / Relationship / Others for v1 (not user-editable) — confirmed, built and live.
- **Edit/delete is unrestricted** — any group member can edit or delete any entry, not just their own (matches the reference prototype). *Still open: is that trust level fine for this group, or should edit/delete be limited to the entry's original author? Relevant to the same §8.3 access-control decision — per-author restriction only really means something once entries are tied to a verified identity.*
- **Whose Google account hosts this?** Resolved in practice — the backend is deployed and connected (Sheet + Drive + Apps Script all live). Not documented here by name.
- **Privacy**: gallery and totals are visible to anyone with the app link, currently behind a shared password gate (§8.3) as a soft deterrent. Real per-person access control (§8.3 Option B) is decided and built, just not yet merged — see §10's Google Sign-In note below.
- **Sync interval**: confirmed at 20 seconds (`POLL_INTERVAL_MS` in `index.html`), within the originally proposed 15–30s range.
- **Photo re-cropping is destructive** (decided 3 Sep 2026) — cropping replaces the currently-stored photo; the pre-crop original isn't kept, so re-cropping later starts from the already-cropped version. Deliberate: the alternative (preserving the original) needs a second stored file per cropped entry plus a schema/lifecycle change, which felt disproportionate to a rare, low-stakes failure mode (worst case, re-upload the photo). Revisit only if this causes real frustration in practice.
- **Google Sign-In (§8.3 Option B) still isn't merged**, and now needs a substantial rebase — the 3 Sep 2026 gallery/UI overhaul rewrote most of `index.html`, so the auth-gate/header/form changes built for Option B (on the old UI) will need to be reapplied against the new one before that work can move forward.

| Milestone | Status |
|---|---|
| PRD sign-off | Done |
| Backend setup (Sheet + Drive folder + Apps Script deployment) | Done — connected and verified end-to-end |
| Core build (form incl. edit, countdown, progress + status line, category breakdown, gallery incl. delete, celebration modal) | Done — category breakdown shipped as bars, not the originally planned pie chart (§6.3) |
| Hosting + deploy pipeline | Done — GitHub Pages via GitHub Actions, secrets kept out of the repo |
| Access-control hardening (password gate) | Done as a soft deterrent (§8.3); real per-person protection still an open decision |
| Load/stress testing | Done — found and partly acted on (see §8.2's upload-size and write-concurrency notes) |
| Testing across friends' phones | In progress — an iOS Safari-specific rendering bug was found and fixed, not yet confirmed resolved on a real device |
| Gallery/UI overhaul (masonry layout, dark mode, resize/crop, GIF conversion) | Done — 3 Sep 2026, merged via community-contributed PR #1 after code review found and fixed a stored-XSS issue, a missing video size limit, a transparent-PNG-to-black bug, two service-worker caching bugs, and a GIF-frame-capture race; also removed a fake "demo/offline" mode that silently no-op'd saves |
| Google Sign-In access control (§8.3 Option B) | Blocked — built and tested working against the pre-overhaul UI, but not merged; needs rebasing onto the new gallery/UI before it can land |
| Launch to the group | Not yet confirmed |
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

*Phase 1 (this document's core scope, §1–§11) is built and live. Phase 2 (§12) is documented for direction but not started — revisit once the group has been using Phase 1 for a while. See `session-notes.md` for the day-to-day build log this PRD was kept in sync with.*
