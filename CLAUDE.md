# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page PWA where a small friend group logs activities toward a shared
point goal (deadline-driven progress tracker with a photo/video gallery).
Nearly the entire front-end lives in one file, `index.html` (~7.6k lines:
inline `<style>` + inline `<script>`). The backend is a Google Apps Script
project (`Code.gs`) bound to a Google Sheet, deployed as a Web App — there is
no separate Node/database backend in production. `server.js` / `dev_server.py`
only serve static files locally (with a `/config.js` shim); they are not the
app's backend.

## Commands

- `npm run dev` / `npm start` — run the local static file server (Express, `server.js`) on port 3000.
- `python3 dev_server.py` — alternative local static server (stdlib only, no npm install needed), also port 3000.
- `npm run lint` — syntax-checks `server.js` and `gifenc.browser.js` via `node --check` (no linter for `index.html` or `Code.gs`).
- `npm run build` — a no-op placeholder (GitHub Pages deploy doesn't need a build step; see below).
- There is no test suite in this repo.

Local dev requires a `config.js` file (gitignored, not present by default) that sets `window.WEB_APP_URL` and `window.GOOGLE_CLIENT_ID` — copy the shape from `.env.example` / SETUP_GUIDE.md §6. Without it, the app runs with an unconfigured banner and rejects writes.

## Architecture

**Front end (`index.html`, single file):**
- Config block near the top of the inline `<script>` (~line 4242): `WEB_APP_URL` and `GOOGLE_CLIENT_ID` come from `window.*` (set by gitignored `config.js`, generated at deploy time from repo secrets — see below). `TARGET_POINTS`, `DEADLINE_ISO`, `POLL_INTERVAL_MS` are plain non-secret config that live directly in source — edit them here to change the point target/deadline/refresh rate.
- Everything else is organized into clearly commented sections (search for `// ====` banners): media capture/compression (`prepareImageFile`, `convertVideoToGif` — video-to-GIF uses `gifenc.browser.js`), countdown/progress rendering, the filter capsule + masonry gallery, preview/edit modals, the resize/crop tool, activity tagging, the log/edit form, Google Sign-In (`initGoogleSignIn_`, `handleCredentialResponse_`), and polling (`loadEntries` on a `POLL_INTERVAL_MS` timer).
- All backend calls go through `apiList()` / `apiGetProfile()` / `apiWrite()`, which hit `WEB_APP_URL` with an `idToken` from the stored Google Sign-In credential. There is no client-side routing/framework — state lives in a single `state` object and rendering is done by direct DOM manipulation.
- `sw.js` is a small service worker (offline shell caching) registered by `index.html`.

**Backend (`Code.gs`, Google Apps Script bound to a Sheet):**
- `doGet(e)` handles `?action=ping|list|profile`; `doPost(e)` handles `create`/`update`/`delete`/`setUsername`, dispatched by `body.action`.
- `requireAuth_(idToken)` verifies the Google ID token against Google's tokeninfo endpoint and checks the caller's email against the **Allowlist** sheet tab (`isAllowedEmail_`) — this is real server-side auth, not a client-side password gate. `GOOGLE_CLIENT_ID` is set as an Apps Script **Script Property**, not in code.
- Data lives in three Sheet tabs: **Entries** (activity log, one row per entry, soft-deleted via a `deleted` flag), **Users** (profile per Google account: stable `userId`, `username`, email), **Allowlist** (name/email pairs — editing this tab live-updates who can sign in, no redeploy needed).
- Media (photos/videos) is uploaded as base64 in the request body and written to a dedicated Google Drive folder by `saveMedia_`; the Sheet stores the Drive file ID/URL, not the binary.
- Edit/delete is ownership-scoped: a user can only mutate their own entries (matched by `userId`), except legacy entries with no owner on record, which stay open to anyone (see `session-notes.md` decision list for why).
- This file cannot be run/tested locally — it only runs inside the Apps Script editor bound to the Google Sheet. Changes here require manually pasting into the Apps Script editor and redeploying (see SETUP_GUIDE.md §2–4) to take effect; nothing in this repo automates that.

**Deploy (`.github/workflows/deploy.yml`):**
- On push to `master`, copies `index.html`, `manifest.json`, `sw.js`, `gifenc.browser.js`, `icons/` into `_site/`, generates `_site/config.js` from the `WEB_APP_URL` and `GOOGLE_CLIENT_ID` repo secrets, and deploys `_site/` to GitHub Pages. If you add a new top-level static asset that `index.html` references, it must be added to this workflow's copy step or it will 404 in production even though it works locally.
- Secrets are never committed; `.gitignore` excludes `.env` and `config.js` for the same reason (this repo is public).

## Key constraints to keep in mind when changing things

- **No secrets in tracked files.** `WEB_APP_URL` grants access to the group's Sheet/Drive; it and `GOOGLE_CLIENT_ID` must only ever be read from `window.*` globals (`config.js`), never hardcoded into `index.html` or `Code.gs`.
- **Apps Script quirks that already caused reverts** (see `session-notes.md`): binary (`Blob`) `doGet` responses can't carry custom headers, so a Drive-image CORS proxy is not viable there — don't reintroduce it. Sheets coerces date-column values inconsistently; date normalization is handled front-end-side (at the point entries are loaded in `index.html`), not in `Code.gs` — don't move it back.
- **`index_ori.html`**, if present locally, is an untracked design reference (old Firebase/IndexedDB prototype) — not part of the shipped app, don't wire it up or treat it as source of truth for behavior, only for visual styling that was intentionally matched.
- Uploads: photos are compressed client-side; videos are not and are capped (~30s/~45MB) by an Apps Script request-size limit — this is a hard platform limit, not a bug to fix.
- `session-notes.md` is the up-to-date running log of design/architecture decisions and why past approaches were reverted — check it before re-deciding something that looks off (e.g. why dark mode was removed then re-added, why the CORS proxy was removed). `PRD_B_in_the_Next_Chapter.md` is the fuller spec/rationale if more context is needed.
