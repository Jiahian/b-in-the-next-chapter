# Decisions & build history — B in the Next Chapter!

What we decided and why, kept current-state rather than a full blow-by-blow
— each entry is the final resolution, not every attempt along the way. See
[`PRD.md`](PRD.md) for the spec this history led to, and `CLAUDE.md` (repo
root) for implementation-level gotchas.

## Current state

- **Live app**: https://jiahian.github.io/b-in-the-next-chapter/
- **Repo**: https://github.com/Jiahian/b-in-the-next-chapter (public)
- **Backend**: Apps Script Web App + Google Sheet + Drive, connected and verified end-to-end.
- **Hosting**: GitHub Pages, deployed via `.github/workflows/deploy.yml` on every push to `master`. The Apps Script backend has its own separate, manual deploy process (see `docs/SETUP.md`) — the two are never atomic.
- **Access control**: real, server-verified Google Sign-In. No password gate exists anywhere anymore.
- Every friend has a real account (Users sheet, stable Google ID), a Profile page, and can tag other allowlisted friends on an entry.
- Sheet has three tabs: Entries, Users, Allowlist.
- Gallery preview, the Log form, and the Profile panel are all full-bleed fullscreen pages (sticky back-button navbar), not modals.
- Tag-friends control is a searchable input + removable pills.
- Profile photo upload/crop works but is device-local only — not synced to the backend (see "Known gaps" below).

## Key decisions

**Secrets never touch the public repo.** `WEB_APP_URL` and
`GOOGLE_CLIENT_ID` are read from `window.*` globals set by a gitignored
`config.js`; the GitHub Actions deploy workflow generates that file at
build time from repo secrets. Necessary once the repo went public
(GitHub Pages' free tier requires a public repo).

**Visual design matched exactly to the reference prototype**
(`binthenextchapter.ai.studio`) — palette, category colors, button roles,
and card styling were pulled from that prototype's actual source rather
than estimated from screenshots.

**Navigation is a single continuous "home" page** (countdown → progress →
category breakdown → gallery, all on one scroll), not a tabbed
Dashboard/Log/Gallery layout, plus a full-screen Log form reached via a
header button.

**Theming**: dark mode was removed early on, then reinstated during the
gallery/UI overhaul below — both light and dark are supported now,
user-toggleable and persisted per device.

**Access control: Google Sign-In + allowlist, chosen over a shared
password or a custom backend with real sessions.** Specifically because
Phase 2's planned badges/currency (`PRD.md` §12) need to know *who* is
making a request, not just *that* they know a shared password — real
per-person identity is exactly what this gives. The original client-side
password gate (a soft deterrent, not real security — the "password"
shipped in plain text to every visitor) is fully retired, not layered
underneath.

**Gallery/UI overhaul** (community-contributed PR from a collaborator's
fork, reviewed and hardened before merging). Brought in: dark mode, a
masonry gallery with a post preview, a unified month+category filter
control, photo resize/crop, and automatic video-to-GIF conversion on
upload — plus optional local dev tooling (`server.js`/Express).
Code review (findings verified against the actual code before trusting
them — one review finding turned out to be entirely hallucinated) caught
and fixed: a stored-XSS gap (unescaped image URL breaking out of an
`<img src>` attribute), a missing video size limit (now a hard 20MB
client-side cap), localStorage save failures being silently swallowed, two
service-worker caching bugs, and a GIF-frame-capture race. Also fixed:
transparent PNGs turning solid black when downscaled (now flattened onto
white before conversion first). Removed: a "demo card" / local-storage
fallback mode that silently faked success when the app wasn't actually
connected to a backend — replaced with honest empty/error states. A
photo resize/crop CORS-proxy attempt was tried and reverted after
confirming Apps Script can't set custom headers on binary `doGet` output
(a genuine platform limitation, not a bug) — the failure now just surfaces
as a clean error message instead.

**Real per-person identity, user profiles, and activity tagging shipped
together**, once it became clear Phase 2 needs actual profiles, not just
an access check. First sign-in prompts for a one-time editable display
name (a second "immutable real name" field was considered and deliberately
rejected — two name-shaped fields on a first-run screen invites confusion,
and email already answers "who is this really" if needed). Username capped
at 24 characters so it doesn't wrap awkwardly in the compact
overlapping-avatar gallery view. Edit/delete is restricted server-side to
an entry's owner; entries with no owner on record (predating this system)
stay open to anyone by design, so nothing old is stranded. The allowlist
moved off a Script Property onto a two-column (name, email) sheet tab for
easier editing.

**Gallery preview, Log form, and Profile panel are fullscreen pages**, not
centered modal cards — a sticky navbar with a back button, content scrolls
independently underneath. Chosen for a cleaner mobile feel; applied
consistently to all three surfaces.

**Tag-friends control is a searchable pill selector**, not a
checkbox-dropdown-behind-a-summary — a text input filters the friend list
live, selections render as removable pills, and the dropdown/pills stay in
sync in both directions.

## Data-integrity bug: `tagged_friends` corruption (resolved)

Google Sheets auto-detects digit-only strings and silently converts them to
`Number` cells. A Google account's `sub` claim (`userId`) is a long
all-digit string; joining 2+ tagged friends' ids with commas produced a
string Sheets would reinterpret as one number, with the commas read as
thousands separators — merging multiple ids into one garbled, unrecoverable
value. Root-caused and fixed at the write path (not just a one-time setup
step): every write that touches a `userId`/`tagged_friends` cell now forces
plain-text formatting on that exact row/range *before* the value is
written (`appendRow()` was part of the problem — it resolves its own
target row independently of any pre-formatting, so writes were switched to
`getRange().setValues()` on the same row that was just formatted). Values
read back from the sheet are also coerced with `String(...)` as a second
line of defense. Full mechanics: `CLAUDE.md`'s "Sheets auto-coercion
gotcha". **Entries tagged with 2+ friends before this fix landed are still
permanently corrupted** — see "Known gaps" below.

## Known gaps / open items

- [ ] **Sync profile photos to the backend.** Currently `localStorage`-only per device — doesn't follow the user across devices, and is never visible to other friends (gallery/tagging avatars still render text initials for everyone). Fix direction: upload to the Drive media folder + a new Users-sheet column for the file ID/URL.
- [ ] **Re-log (or hand-fix in the Sheet) any entries tagged with 2+ friends before the `tagged_friends` corruption fix** — their stored value is permanently corrupted and won't self-heal; re-selecting "Tag friends" and re-saving overwrites the cell correctly.
- [ ] **Real end-to-end pass with the actual friend group** now that sign-in is live: confirm everyone's email is in the Allowlist, everyone can sign in and set a display name, and the app feels normal day-to-day (not just single-account testing).
- [ ] **Phase 2 (gamification) scoping** — worth revisiting sooner than originally planned, since the identity groundwork it needed (stable `userId` on every entry/user) is already in place. See `PRD.md` §12.

## Stress-test findings

- **Video upload ceiling**: load testing showed a 15MB video took ~44s and a 40MB video failed outright (hung, never completed). **Resolved** — a hard 20MB client-side limit is enforced before any upload/GIF-conversion attempt.
- **Concurrent submissions are fragile by platform design**: when many people submit at the exact same instant, Apps Script's free-tier execution ceiling rejects a large fraction of them outright (a platform limit, not a bug in this app's code). Mitigation is "retry if it fails."
- Concurrent reads, gallery scaling to hundreds of entries, and Drive thumbnail serving under load all held up fine — no action needed.
- **Drive rate-limiting happens in practice, not just in theory**: repeated heavy testing/reloading has hit both a 429 (thumbnail endpoint) and a 403 (`lh3.googleusercontent.com` CDN) at different points. Both self-resolved without any code change — matches `PRD.md` §8.1's documented trade-off. Not a bug; worth remembering if it recurs under real usage.
