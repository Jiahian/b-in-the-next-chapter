# Product Requirements Document

## B in the Next Chapter!

| | |
|---|---|
| **Author** | Sef |
| **Date** | 26 Aug 2026 (last updated 4 Sep 2026) |
| **Status** | v7 — Phase 1 live and in use; gallery/UI overhaul merged (§6.4, §6.6, §11); real per-person access control (Google Sign-In + allowlist) is now live (§6.7, §8.3, §11) — the app no longer has a "no login" model, see §5.2/§7; user profiles and activity tagging shipped alongside it (§6.8); Phase 2 documented (§12), and the identity groundwork it needed is now already in place |
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

A private group of friends (not the general public) participating in the same challenge. No public sign-up flow is needed; the app is shared as a link/installed app within the friend group. **As of 4 Sep 2026**, viewing or logging entries requires signing in with a Google account that's on the group's allowlist (§6.7/§8.3) — the link alone is no longer sufficient, a deliberate tightening from the original "anyone with the link" model. There is still no admin/moderator *role* in-app; managing the allowlist is done directly in the Sheet by whoever owns the backend.

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
9. **Real per-person accounts** (added 4 Sep 2026, see §6.7): Google Sign-In gated by an allowlist, a one-time display-name setup on first sign-in, and a Profile page (edit display name, browse/edit "My Posts", browse "Tagged In"). Supersedes the earlier free-text-name model entirely.
10. **Activity tagging** (added 4 Sep 2026, see §6.8): a logger can credit other allowlisted friends as having done the activity with them; tagged friends aren't co-owners, just credited.

### 5.2 Out of scope (v1)

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
- Each entry can be **edited** (opens the entry form pre-filled, including the option to replace the media) or **deleted** (behind a confirmation modal, since deletes also remove the underlying Drive file and are not recoverable) — as of 4 Sep 2026, only by the entry's own owner (see §6.7).
- **Who was there** (added 4 Sep 2026, see §6.8): every card shows overlapping avatar initials (poster first, then tagged friends, capped at 3 circles) plus a one-line summary — just the poster's name if no one's tagged, "X and Y were there" for one tag, "X and N friends were there" for more. The expanded preview reveals everyone involved, no cap, each with their avatar and name.
- **Resize/crop**: from the edit flow, an uploaded photo can be re-cropped (zoom, pan, 3:4/4:3 aspect ratio) via an in-browser canvas tool. This is **destructive** — cropping replaces the currently-stored photo; the pre-crop original is not preserved, so cropping again later crops the already-cropped version, not the original upload. Deliberate simplicity trade-off (see §10) — revisit only if this causes real user frustration, since fixing it non-destructively means storing two files per cropped entry.
- Not available for videos (resize/crop is photo-only).

### 6.5 Goal-achieved celebration

- The moment total points reach or cross 1,000, the app shows a one-time celebratory modal (e.g., confetti + congratulatory message) to whoever is viewing at that moment.
- Does not block continued logging — the group may still choose to log activities after reaching goal; the celebration does not need to repeat on every subsequent visit once acknowledged.

### 6.6 Entry form ("log an activity")

*Table updated 4 Sep 2026 to match what's actually built — "Your name" was repurposed into "What went on?" by the 3 Sep 2026 gallery overhaul (see session-notes.md), and identity now comes from the signed-in account rather than a form field at all (§6.7).*

| Field | Type | Rules |
|---|---|---|
| Activity name | Free text | Required. |
| What went on? | Free text | Required. A short narrative/description, not the logger's name — who logged it is now the signed-in account, shown automatically (§6.7), not typed here. |
| Category (Area) | Dropdown | Required. Options: Spiritual, Relationship, Others. |
| Date | Date picker | Required. Defaults to today. Cannot be a future date. |
| Amount | Number | Required. Up to 1 decimal place. Must be greater than 0. |
| Units | Dropdown | Required. Options: km, hours. |
| Tag friends | Multi-select | Optional (added 4 Sep 2026, see §6.8). Select-all / individual-deselect dropdown listing other allowlisted users. |
| Photo/video | File upload | **Mandatory.** Accepts image or video, from camera or existing gallery. Videos over 20MB are rejected client-side before any processing (tightened from an original 45MB ceiling per §8.2's stress-test findings). |

- On submit, the entry is added to the shared pool and reflected in the progress bar, category breakdown, and gallery for everyone (see §8 for sync timing).
- Form validates all fields client-side before allowing submission (in particular: no future dates, amount > 0 with max 1 decimal, media file present).
- The same form is reused for **editing** an existing entry (pre-filled from the gallery's edit action), with the option to keep the existing photo/video or replace it.
- **Video-to-GIF conversion** (added 3 Sep 2026): a chosen video is automatically converted client-side to a short animated GIF (~5 seconds, 9fps, capped at 360px on the long edge) before upload, so the gallery can show it as a simple, consistently-playable image rather than needing a native video embed. If conversion fails (unsupported format, slow device, etc.), the app falls back to uploading the original video file as before.

### 6.7 Access control — Google Sign-In (added 4 Sep 2026, live)

Real, server-verified authentication replacing the earlier client-side password gate (§8.3's Option B, now shipped):

- Sign-in uses Google Identity Services; `Code.gs` verifies each request's ID token server-side and checks the resulting email against an **Allowlist** sheet tab (name + email columns — name is admin-facing only, for tracking who's who; only email is actually checked). Adding/removing someone is a direct edit to that tab, no redeploy.
- A signed-in-but-not-allowlisted account gets a distinct "not on the group's list" message rather than a generic error, so re-trying with the same account doesn't loop pointlessly.
- No password exists anywhere in this model — friends sign in with the Google account they already have.
- A small header control (initial-letter avatar) opens the Profile page (§6.8); tapping "Sign out" there clears the session, useful on a shared device.

### 6.8 User profiles & activity tagging (added 4 Sep 2026, live)

- **First sign-in** prompts for a one-time display name (pre-filled with the signer's real Google name, editable), stored in a new **Users** sheet keyed by Google's stable account ID — not email, which a person could technically change, and not the display name itself, which is meant to be freely editable later without breaking anything tied to that person.
- **Profile page**: edit display name any time; a "My Posts" tab (tap any post to edit it directly, skipping the normal preview step) and a "Tagged In" tab (posts someone else logged that tagged this user — view-only, since tagging doesn't grant ownership).
- **Edit/delete ownership**: an entry can only be edited or deleted by the account that logged it (enforced server-side). Entries logged before this system existed have no owner on record and stay open to anyone, so nothing from before the upgrade is stranded.
- **Tagging**: the "Tag friends" field (§6.6) lets a logger credit other allowlisted friends as having done the activity together. Tagged friends are not co-owners — they can't edit or delete the entry, it just shows up under their own "Tagged In" tab and in the gallery's "who was there" display (§6.4).

## 7. Non-functional requirements

- **Mobile-first**: designed and tested primarily for phone screen sizes; installable to the home screen (so it opens and feels like a native app) rather than requiring a browser tab each time.
- **Shared state, kept in sync**: an entry logged by one friend must become visible to the rest of the group without anyone needing to manually refresh, and without any single friend's *device* being the source of truth (the backend is). Given the chosen backend (§8), this is near-real-time (a periodic refresh, on the order of seconds) rather than an instant push.
- **Low friction, reconsidered** (updated 4 Sep 2026): the original "no login at all" goal has been deliberately superseded — every friend now signs in with their own Google account (§6.7). This trades some of the original frictionlessness for real security and the per-person identity Phase 2 needs (§12), but stays low-friction relative to a typical account system: no new password to create, sign-in persists per device/session so it's a one-time thing in practice, and Google's own sign-in flow is already familiar to everyone.
- **Media handling**: photo/video uploads should work reliably over mobile data, with a visible upload progress/state so users know an entry has actually gone through.
- **Data durability**: once submitted, entries and their media persist independent of any one friend's device (i.e., not stored only in one person's browser).
- **Theming**: supports both light and dark appearance, user-toggleable and persisted per device (added 3 Sep 2026).
- **Honest empty/error states** (added 3 Sep 2026): the app no longer substitutes a canned demo entry or a false "saved" confirmation when it isn't actually connected to a backend — an empty gallery shows a plain "no activities yet" message, and attempting to log/edit/delete while disconnected shows a clear error instead of silently no-op'ing to on-device storage.

## 8. Proposed technical approach

Because points must sync across every friend's own phone, this cannot be a purely front-end, on-device app (there is no single device to be the shared source of truth) — it needs a small always-on backend. Per your decision, this runs entirely on one existing Google account with spare Drive storage, rather than a separate paid backend like Firebase — **$0 cost, no billing/credit card setup.**

- **Frontend**: a single mobile-optimized web app (installable as a home-screen PWA on iOS/Android), covering the dashboard (countdown, progress, category breakdown), the entry form, and the gallery.
- **Data ("database")**: a **Google Sheet**, owned by the one nominated Google account, with three tabs — **Entries** (one row per logged activity: name/description, category, activity, date, amount, units, Drive file link, edited/deleted flags, owner + tagged-friends IDs as of 4 Sep 2026 — see §9), **Users** (one row per person who's signed in: account ID, email, chosen display name), and **Allowlist** (who's allowed to sign in at all: name + email, editable directly by whoever manages the group). Doubles as a human-readable audit log/export if anyone ever wants to open it directly.
- **Media storage**: **Google Drive**, same account — one folder holding all uploaded photos/videos, using that account's existing spare space.
- **Glue**: a **Google Apps Script**, deployed as a Web App under that same account ("Execute as: Me / Access: Anyone with the link"). It exposes simple endpoints the front-end calls to submit, edit, delete, and list entries — it writes rows to the Sheet and files to the Drive folder, and returns a Drive-hosted URL for each media file back to the app. This is what lets every friend log entries and upload media without needing *write access* to the Sheet/Drive themselves — only the Apps Script owner's account touches Drive/Sheets directly. (Friends do need their own Google account to *sign in* as of 4 Sep 2026 — see the Identity line below — but that's for authentication, not Sheet/Drive access.)
- **Sync model**: the app polls the Apps Script endpoint every 20 seconds, and on each app open/resume, rather than an instant push like a realtime database would give. For a friend group logging a few times a day, this trade-off is invisible in practice — worth flagging since it differs from a Firebase-style setup.
- **Identity** (updated 4 Sep 2026 — real, not lightweight anymore): every request carries a Google ID token that `Code.gs` verifies server-side against an Allowlist sheet tab; entries are tied to the signer's stable Google account ID, not a free-text name. See §6.7/§6.8 and §8.3.
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

Not in the original scope — added after the app went live, once the group wanted the link itself to not be the only thing standing between a stranger and the group's data. Went through two stages:

- **Stage 1 (shipped, now retired)**: a client-side password prompt gated the whole app. This was explicitly a **soft deterrent, not real authentication** — a static site has no server to keep a secret from the browser, so the password shipped in plain text to every visitor and was trivially readable via dev tools or view-source. It stopped someone from wandering in by accident; it would not have stopped someone determined to get in.
- **Stage 2 (live as of 4 Sep 2026) — real protection.** Three options were scoped originally:
  - **(A)** Move the password check server-side into the Apps Script backend (closes the "leaks to everyone" hole specifically; still one shared secret for the whole group; moderate effort, no new services).
  - **(B)** Google Sign-In with a per-person allowlist (real, unspoofable per-person identity; more friction — a deliberate departure from the original §7 "no per-user login" goal, see that section's 4 Sep 2026 update; bigger lift).
  - **(C)** A custom backend with real sessions (most textbook-correct; abandons the $0-cost Apps Script stack this whole project is built around).
  - **Chosen and shipped: (B).** Phase 2's planned badges/character-items/Manna currency (§12) can only be tied to *specific individuals* if the backend can verify *who* is making a request, not just *that* they know a shared password — and real per-person identity is exactly what this option adds. Google Identity Services sign-in; `Code.gs` verifies the ID token server-side on every request and checks the resulting email against an **Allowlist** sheet tab (§9) — not a Script Property, so adding/removing someone is a direct Sheet edit, no redeploy. The password gate is fully removed, not layered underneath.
  - **Where this ended up differing from the original Firebase-leaning plan**: §12.3 originally assumed Google Sign-In would arrive via *Firebase* Authentication, pairing with a Firestore migration. What actually shipped verifies Google ID tokens directly against Apps Script (no Firebase involved) — cheaper and simpler for this stage, and doesn't foreclose a Firestore move later if Phase 2 needs it; see §12.3's update.

## 9. Data model (indicative)

*Updated 4 Sep 2026 — Entry gained `userId`/`participants`, and two new tables (Users, Allowlist) were added alongside it. `name`'s meaning changed earlier (3 Sep 2026 gallery overhaul): it's the "What went on?" narrative, not who logged it — see §6.6's note.*

**Entry — one row per entry, in the Sheet's "Entries" tab**

| Field | Type | Notes |
|---|---|---|
| entryId | string | Generated on create; used for edit/delete lookups |
| name | string | The "What went on?" narrative/description — *not* who logged it (see above) |
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
| userId | string | **Added 4 Sep 2026.** The logger's Google account ID (stable `sub` claim, not email). The entry's owner — only this account can edit/delete it. Blank on entries logged before this system existed; those stay editable by anyone (§6.8). |
| participants | string | **Added 4 Sep 2026.** Comma-separated userIds of other people tagged as having done the activity too (§6.8). Never includes the logger's own userId. Denormalized (not a separate join-table tab) since the set is small and bounded per entry. |

Total points = SUM(amount) across all entries where `deleted = false`. Category totals = SUM(amount) grouped by category, same filter.

**User — one row per person who's signed in, in the Sheet's "Users" tab**

| Field | Type | Notes |
|---|---|---|
| userId | string | Google account's stable `sub` claim — matches Entry.userId/participants |
| email | string | Captured at sign-in, never user-editable |
| username | string | Display name, editable any time from the Profile page; max 24 characters |
| createdAt | timestamp | Set on first sign-in (profile creation) |
| updatedAt | timestamp | Set whenever the display name changes |

**Allowlist — one row per approved person, in the Sheet's "Allowlist" tab**

| Field | Type | Notes |
|---|---|---|
| name | string | Admin-facing only, for tracking who's who in the list — not checked by anything |
| email | string | The Google account email that's actually checked at sign-in |

## 10. Assumptions & open questions

- **Points = amount.** The brief doesn't define a separate points value distinct from the logged amount/units, so this PRD assumes 1 unit logged (1 km or 1 hour) = 1 point. *Still open: should km and hours convert to points differently (e.g., weighted), or should there be a separate "points" field independent of the measured amount?*
- **Target = 1,000 points** — confirmed, built and live (`TARGET_POINTS` in `index.html`).
- **Categories are fixed** at Spiritual / Relationship / Others for v1 (not user-editable) — confirmed, built and live.
- **Edit/delete restricted to the owner** (resolved 4 Sep 2026) — previously unrestricted (any group member could edit/delete any entry, matching the reference prototype); now only the account that logged an entry can edit or delete it, enforced server-side. This was explicitly gated on having real identity, which §8.3 Option B now provides. Entries logged before this system existed have no owner on record and stay open to anyone, so nothing old is stranded.
- **Whose Google account hosts this?** Resolved in practice — the backend is deployed and connected (Sheet + Drive + Apps Script all live). Not documented here by name.
- **Privacy**: gallery and totals are only visible to signed-in, allowlisted accounts as of 4 Sep 2026 (§6.7/§8.3) — the earlier "anyone with the link" model and its password-gate soft deterrent are both retired.
- **Sync interval**: confirmed at 20 seconds (`POLL_INTERVAL_MS` in `index.html`), within the originally proposed 15–30s range.
- **Photo re-cropping is destructive** (decided 3 Sep 2026) — cropping replaces the currently-stored photo; the pre-crop original isn't kept, so re-cropping later starts from the already-cropped version. Deliberate: the alternative (preserving the original) needs a second stored file per cropped entry plus a schema/lifecycle change, which felt disproportionate to a rare, low-stakes failure mode (worst case, re-upload the photo). Revisit only if this causes real frustration in practice.
- **Google Sign-In (§8.3 Option B) is live** (resolved 4 Sep 2026) — built against the pre-3-Sep-2026 UI, then fully reapplied against the post-overhaul UI (rather than a mechanical git rebase, given how much of `index.html` had changed) alongside the new Users/Allowlist/tagging system, and merged to `master`. Both the production Apps Script backend and the OAuth client's authorized origins were updated to match before the frontend went live, to avoid a mismatch window where signed-in users could reach the app but the backend didn't yet recognize their requests (or vice versa).
- **Username length**: capped at 24 characters (client + server) — chosen so a display name rarely wraps past one line even in the compact overlapping-avatar gallery view; not something the original brief specified.

| Milestone | Status |
|---|---|
| PRD sign-off | Done |
| Backend setup (Sheet + Drive folder + Apps Script deployment) | Done — connected and verified end-to-end |
| Core build (form incl. edit, countdown, progress + status line, category breakdown, gallery incl. delete, celebration modal) | Done — category breakdown shipped as bars, not the originally planned pie chart (§6.3) |
| Hosting + deploy pipeline | Done — GitHub Pages via GitHub Actions, secrets kept out of the repo |
| Access-control hardening (password gate) | Superseded — see the Google Sign-In row below; the password gate has been fully retired |
| Load/stress testing | Done — found and partly acted on (see §8.2's upload-size and write-concurrency notes) |
| Testing across friends' phones | In progress — an iOS Safari-specific rendering bug was found and fixed, not yet confirmed resolved on a real device |
| Gallery/UI overhaul (masonry layout, dark mode, resize/crop, GIF conversion) | Done — 3 Sep 2026, merged via community-contributed PR #1 after code review found and fixed a stored-XSS issue, a missing video size limit, a transparent-PNG-to-black bug, two service-worker caching bugs, and a GIF-frame-capture race; also removed a fake "demo/offline" mode that silently no-op'd saves |
| Google Sign-In access control + user profiles + activity tagging (§6.7, §6.8, §8.3) | **Done and live — 4 Sep 2026.** Production Apps Script backend and OAuth client both updated ahead of the frontend going out, to minimize the window where the two could mismatch. |
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

*Note (4 Sep 2026): the identity groundwork this section assumed Phase 1 would eventually need is now already built — every entry carries a stable `userId` (Google's account `sub` claim), and a Users sheet already exists mapping that ID to a display name. One assumption below turned out different in practice: sign-in verifies Google ID tokens directly against Apps Script, not via Firebase Authentication — cheaper and simpler for Phase 1's access-control need alone (§8.3), and it doesn't block a Firestore move; Firebase Auth can adopt the same Google accounts later if Phase 2's real-time/transaction needs still make Firestore worth it.*

- **Media (photo/video gallery) stays on Google Drive** — it's write-once data with no concurrency concerns, no reason to re-host it.
- **Game state (Manna balance, inventory, equipped items, sleep/poke status) moves to Firebase Firestore** when Phase 2 begins, because that layer genuinely benefits from what Firestore gives that Sheets/Apps Script doesn't: real-time listeners (a friend's new outfit or wake-up appears instantly for everyone, not on a 15–30s poll) and atomic transactions (prevents two purchases racing against the same Manna balance and double-spending it).
- **Migration mechanics**: a one-time script reads existing Sheet rows and writes them into Firestore documents; the front-end swaps its game-state calls from the Apps Script endpoint to the Firestore SDK; done during a short "back in a few minutes" maintenance window rather than engineering zero-downtime dual writes, which isn't worth it at this scale. **Simpler than originally scoped**: since every entry and every user already has a stable ID (userId), the migration only needs to carry Users-sheet rows (and their in-progress game state, once that exists) into Firestore documents keyed by the same ID — entries themselves can stay on Sheets/Drive indefinitely if Phase 2 only needs game state to move.
- **To keep this painless later, Phase 1 should**: give every row a stable UUID-style `entryId` (not a spreadsheet row number), store timestamps in ISO format, and keep media references as plain URLs/file IDs decoupled from any Sheets-specific formatting — all of which carries over into Firestore documents with no rework. **Done** — and extended further than originally planned, since `userId` (also a stable ID, not a row number) now exists too.
- Net effect: Phase 2 adds a small Firebase Blaze bill (Firestore usage at this scale is near-$0, per the earlier cost estimate) on top of the still-free Drive/Sheets media layer — not a full swap of everything to Firebase.

### 12.4 Open items for Phase 2 (not yet decided)

- Final currency name (Manna vs. alternatives).
- Whether the shop includes a randomized "mystery box" mechanic or a straightforward direct-purchase shop only.
- Sprite/art requirements: fixed canvas size for layering (e.g. 64×64 or 128×128px), a base character (or a few), a clothing/accessory set, a background set, an idle pose, a sleeping pose, and a poke reaction — either sourced from the group or Claude can generate an original starter set.
- Whether "poke" should do anything mechanically (e.g., a small Manna bonus for waking up) or stay purely social.

---

*Phase 1 (this document's core scope, §1–§11) is built and live. Phase 2 (§12) is documented for direction but not started — revisit once the group has been using Phase 1 for a while. See `session-notes.md` for the day-to-day build log this PRD was kept in sync with.*
