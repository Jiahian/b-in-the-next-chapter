# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"B in the Next Chapter!" — a mobile-first PWA for a private friend group to log
activities toward a shared point goal (deadline 31 Dec 2026), with a photo/video
gallery, Google Sign-In, and per-person profiles. Full product spec:
`docs/PRD.md`. Build history and known gaps: `docs/DECISIONS.md` — read it
before making non-trivial changes, it documents *why* things are the way
they are (several features were built, found buggy, and re-fixed more than
once).

## Commands

- `npm run dev` / `npm start` — runs `server.js` (Express) on `localhost:3000`, serving the app for local testing.
- `python dev_server.py` — equivalent zero-dependency dev server (stdlib `http.server`), same port/behavior, used when Node isn't available.
- `npm run lint` — `node --check` on `server.js` and `gifenc.browser.js` only. There is no linter for `index.html`'s inline script and no automated test suite in this repo — verify changes by running a dev server and testing in a browser (see "Local dev setup" below).
- `npm run build` — a deliberate no-op (`process.exit(0)`); this is a static site, "build" happens in CI (see Deployment below), not locally.

### Local dev setup

Neither dev server has a real backend of its own — `config.js` is gitignored and must be created locally (or exported as `WEB_APP_URL`/env vars, which both dev servers also read) pointing at a deployed Apps Script backend. See `docs/SETUP.md` for the full one-time backend setup (Sheet + Apps Script + OAuth client + allowlist). Without it, the app loads in a visible "not connected" state.

## Architecture

This is a two-repo-in-one deployment: a static front-end (this repo, hosted on
GitHub Pages) and a Google Apps Script backend (`Code.gs`, pasted manually into
a Sheet-bound script editor — **not deployed by CI**, has its own manual
release process). They're versioned together here but deployed independently.

### Front-end: single-file app, no build step

`index.html` (~7,600 lines) is the entire client — markup, CSS, and a single
vanilla-JS IIFE, no framework/bundler/npm frontend deps. All client logic
(rendering, form handling, gallery, auth) lives in that one `<script>` block
near the bottom of the file. A few things worth knowing before editing it:
- `var state = {...}` near the top of the script is the single client-side
  state object (entries, users, pending form data, etc.) — most functions
  read/mutate it directly rather than passing data around.
- Config constants (`TARGET_POINTS`, `DEADLINE_ISO`, `POLL_INTERVAL_MS`,
  `CATEGORIES`) are plain source config and are edited directly in
  `index.html`; `WEB_APP_URL`/`GOOGLE_CLIENT_ID` are the only two values
  pulled from `window.*` (set by `config.js`), since those are deployment
  secrets that must never be committed.
- Data refresh is polling, not push (`POLL_INTERVAL_MS`, currently 20s) —
  there's no websocket/SSE layer; `loadEntries()` diffs against a stored
  `gallerySignature` so an unchanged poll doesn't re-render/flash the gallery.
- Gallery preview, the Log form, and the Profile panel are all full-bleed
  fullscreen pages (sticky back-button navbar + independently scrolling
  content), not modals — a deliberate, repeated redesign (see
  `docs/DECISIONS.md`). Don't reintroduce centered/backdrop-blurred modal
  cards for these three without checking that decision first.
- `gifenc.browser.js` is a separate script (loaded via `<script src="gifenc.browser.js">`
  before `config.js`) used client-side to convert uploaded video to an
  animated GIF before upload — it has its own file that must be kept in sync
  with the deploy workflow's copy list (this broke once silently — see
  `docs/DECISIONS.md`'s gallery/UI overhaul entry).
- `sw.js` (service worker) + `manifest.json` + `icons/` make this installable
  as a home-screen PWA.
- Opening the link inside Telegram's built-in browser blocks Google
  Sign-In, so `index.html` detects it (`isInAppBrowser_`) and shows a
  dedicated screen before sign-in ever loads, instead of a broken sign-in
  button — see `docs/DECISIONS.md` for what that screen does and why.

### Backend: Google Apps Script bound to a Sheet

`Code.gs` is the entire server — deployed by hand (Apps Script editor >
Deploy > Manage deployments > New version), **not** touched by
`.github/workflows/deploy.yml`. Editing `Code.gs` in this repo does nothing
to production until someone manually pastes it into the Apps Script editor
and redeploys — keep this in mind when reasoning about whether a fix is
"live." `doGet`/`doPost` are the only entry points, dispatching on
`?action=` (`ping`, `list`, `profile`) or `body.action` (`create`, `update`,
`delete`, `setUsername`).

- **Storage**: a bound Google Sheet — core tabs `Entries`, `Users`,
  `Allowlist`, plus (for the Telegram notification feature) `Settings`,
  `Notifications`, and `NameScrub` — plus a Drive folder (`BNext - Media`) for
  uploaded photos/videos and a style-guide Google Doc. There is no other
  database. The notification subsystem (async queue + every-minute trigger,
  Gemini message generation with name-scrubbing, milestones, Telegram delivery)
  lives in the same `Code.gs`; see `docs/SETUP.md` §9 and `docs/DECISIONS.md`.
- **Data model mirrors a future Firestore migration** on purpose (see `docs/BACKLOG.md`):
  stable UUID `entryId`/Google `sub`-claim `userId`, ISO timestamp strings,
  media referenced by plain `fileId`/URL. Don't add Sheets-specific modeling
  (e.g. relying on row position as an id) — the whole point is the backlog's
  gamification/Firestore work can lift this into Firestore documents with
  minimal rework.
- **Auth**: Google Sign-In on the client (`GOOGLE_CLIENT_ID`), verified on
  *every* request server-side via `requireAuth_()` calling Google's
  `tokeninfo` endpoint (not a local JWKS check — deliberate, see the comment
  block above `requireAuth_`) and cross-checked against the `Allowlist`
  sheet tab by email. There's no session/cookie layer; the client resends
  its short-lived (~1hr) ID token on every request.
- **Ownership**: entries have a `userId` owner; `updateEntry_`/`deleteEntry_`
  reject edits from anyone else *except* legacy entries with no `userId`
  (predating this system), which stay open to anyone by design — don't
  "fix" this by requiring ownership universally.
- **`tagged_friends`**: a denormalized, comma-separated list of *other*
  users' `userId`s on an entry row (not a join table — the set is small and
  bounded). The logger is always sole owner; tagged friends are credited,
  not co-owners. Sanitized server-side via `sanitizeTaggedFriends_()`
  (strips unknowns/dupes/the owner's own id).
- **Concurrency**: `doPost` takes a `LockService` script lock around all
  writes, since Sheets itself isn't transactional.

#### The Sheets auto-coercion gotcha (read before touching write paths)

Google Sheets silently auto-detects digit-only strings and converts them to
`Number` cells — `userId` (a ~21-digit Google `sub` claim) and comma-joined
`tagged_friends` lists are exactly this shape, and once Sheets reinterprets a
comma-joined list as a *number*, the commas get read as thousands separators
and multiple ids merge into one garbled value irrecoverably. This bug was hit
and re-fixed three times in one day (see `docs/DECISIONS.md`'s
`tagged_friends` corruption entry) before landing on the current fix:
- `forcePlainTextRow_(sheet, rowIndex, fieldNames, HEADERS)` **must** be
  called immediately before any `setValues()`/write that touches a
  `userId`/`tagged_friends` cell, and the write must target that *exact*
  pre-formatted row/range (`sheet.getRange(rowIndex, ...).setValues(...)`) —
  **not** `appendRow()`, which resolves its own target row independently and
  can silently miss the formatting. `createEntry_`/`updateEntry_`/
  `upsertUserProfile_` all follow this pattern; any new write path touching
  these columns must too.
- Values read back from the sheet are coerced with `String(...)` at read time
  (`rowToEntry_`, `rowToUser_`, etc.) as a second line of defense, since
  already-corrupted or pre-fix cells may still come back as `Number`.

### Secrets & deployment

- `WEB_APP_URL` (Apps Script Web App URL) and `GOOGLE_CLIENT_ID` (OAuth
  client ID) are never committed — `index.html` reads them from
  `window.WEB_APP_URL`/`window.GOOGLE_CLIENT_ID`, set by a gitignored
  `config.js`. Locally, create that file yourself (see `.env.example` for
  the two keys); `server.js`/`dev_server.py` can also synthesize it from
  `WEB_APP_URL`/`SITE_PASSWORD` env vars at request time.
- **Production build**: `.github/workflows/deploy.yml` runs on every push to
  `master`, copies the static files into `_site/` and generates `config.js`
  there from the `WEB_APP_URL`/`GOOGLE_CLIENT_ID` repo secrets, then deploys
  `_site/` to GitHub Pages. If you add a new top-level static asset that
  `index.html` loads (like `gifenc.browser.js` was), it must be added to this
  workflow's copy step or it will 404 in production while working fine
  locally.
- Full one-time backend/OAuth/allowlist setup and troubleshooting steps live
  in `docs/SETUP.md` — consult it rather than re-deriving Apps Script
  deployment steps from scratch.

## Maintaining these docs

`README.md`, `docs/PRD.md`, `docs/SETUP.md`, and `docs/DECISIONS.md` were
condensed from three sprawling files (one of which — a chronological build
log — had grown to 541 lines by re-logging the same bug's fix attempt 3
times). To keep that from happening again:
- After a non-trivial change, append **one short current-state entry** to
  `docs/DECISIONS.md` — what shipped + the one-line "why" that'll still
  matter later. Not a paragraph per attempt; if something got fixed, found
  still broken, and re-fixed, that's still one entry once it's actually
  resolved.
- Update `docs/PRD.md` only when scope/requirements actually change, and
  state things as current truth (not "added 4 Sep 2026") — that framing
  belongs in `DECISIONS.md`, not the spec.
- `docs/BACKLOG.md` is the single home for planned-but-unbuilt work
  (gamification + deferred notification enhancements). Put future ideas there,
  not scattered across the other docs or in one-off NOTES files.
- If `docs/DECISIONS.md` crosses ~300 lines, re-condense it the same way
  this file was condensed, rather than letting it sprawl indefinitely.
