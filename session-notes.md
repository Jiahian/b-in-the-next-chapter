# Session notes — B in the Next Chapter!

Working notes from the build/design/hardening session. Not a spec — see
`PRD_B_in_the_Next_Chapter.md` for that. This is "what we decided and why,"
kept up to date as we go.

## Where things stand

- **Live app**: https://jiahian.github.io/b-in-the-next-chapter/
- **Repo**: https://github.com/Jiahian/b-in-the-next-chapter (public)
- **Backend**: Apps Script Web App + Google Sheet + Drive, connected and
  verified end-to-end (create/list/delete all tested against the live
  deployment)
- **Hosting**: GitHub Pages, deployed via `.github/workflows/deploy.yml` on
  every push to `master`
- **Access control**: real, server-verified Google Sign-In — **live as of
  4 Sep 2026**. The client-side password gate is fully retired, not
  layered underneath. See decision 8 below.
- **Gallery/UI overhaul**: live as of 3 Sep 2026 — a community-contributed
  PR (dark mode, masonry gallery layout, post preview modal, photo
  resize/crop, video-to-GIF conversion) was reviewed, hardened, and
  merged. See decision 7 below.
- **User profiles + activity tagging**: live as of 4 Sep 2026 — every
  friend has a real account (Users sheet, stable Google ID), a Profile
  page (edit display name, My Posts, Tagged In), and can tag other
  allowlisted friends on an entry. See decision 8 below.
- **Sheet now has three tabs**: Entries, Users, and Allowlist (the
  allowlist moved off a Script Property onto a sheet tab on 4 Sep 2026,
  for easier editing — see decision 8).

## Key decisions

1. **Secrets never touch the public repo.** `WEB_APP_URL` and
   `SITE_PASSWORD` are read from `window.*` globals set by a gitignored
   `config.js`. The GitHub Actions deploy workflow generates that file at
   build time from repo secrets of the same names, so nothing sensitive is
   ever committed. This was necessary once the repo went public (GitHub
   Pages on the free plan requires a public repo).

2. **Visual design matched exactly to the reference prototype**
   (`index_ori.html`, kept in the repo but untracked — it's a design
   reference with an incompatible Firebase/IndexedDB backend, not part of
   the shipped app). Palette, category colors, button roles, and card
   styling were pulled from that file's actual source rather than
   estimated from screenshots.

3. **Navigation restructured** from a 3-tab bottom nav (Dashboard/Log/
   Gallery) to a single continuous "home" page (countdown → progress →
   category breakdown → gallery, all on one scroll) plus a full-screen Log
   form reached via a header button and closed with a top-left ✕. Header
   is transparent/blurred and stays sticky; it's hidden outright while the
   Log form is open (not just visually covered — that failed on wide
   viewports).

4. **Dark mode was removed entirely.** The app now always renders one
   fixed light palette (`#f8fafc` page background, white for the three
   "primary" cards — Points Accumulated, Points clocked in, Log an
   activity — everything else flat `#f8fafc`) regardless of system theme,
   per explicit request.

5. **Sheets' date-column coercion is handled on the front end, not fought
   server-side.** Earlier attempt normalized dates in `Code.gs`; reverted
   per request. `index.html` now normalizes whatever shape the API
   returns (plain `YYYY-MM-DD` or a full UTC timestamp) at the point
   entries are loaded, so Sheets is free to store the column however it
   wants.

6. **Access control: Option B (Google Sign-In) decided and built.** Of
   the three paths considered — **(A)** server-side password check,
   **(B)** Google Sign-In + per-person email allowlist, **(C)** a custom
   backend with real sessions — **B was chosen** (2026-08-29),
   specifically because Phase 2's planned badges/character-items/Manna
   currency (PRD §12) need to know *who* is making a request, not just
   *that* they know a shared password. First built and tested working
   end-to-end (2026-08-31/09-01) against the pre-overhaul UI on branch
   `feature/google-signin-allowlist`. That version's since been fully
   superseded — see decision 8, which covers what actually shipped
   (rebuilt against the new UI, plus user profiles and tagging that
   weren't part of the original plan).

7. **Gallery/UI overhaul reviewed, hardened, and merged** (3 Sep 2026,
   PR #1 from a collaborator's fork `ozywasborn/b-in-the-next-chapter`).
   Brought in: dark mode (reversing decision 4 above — light-only was an
   explicit earlier choice, now deliberately reversed), a masonry gallery
   layout with a post preview modal, a unified filter control (replacing
   separate Month/Category dropdowns), photo resize/crop, and automatic
   video-to-GIF conversion on upload. Also added optional local dev
   tooling (`server.js`/Express) alongside the existing static-file
   workflow — doesn't change production hosting.
   - **Review process**: ran `/code-review` against the PR, verified
     every finding against the actual code before trusting it (the
     review's own line numbers didn't match the real file, and one
     finding — a supposedly-missing "Name" field validation — turned out
     to be entirely hallucinated, citing field IDs that don't exist;
     both real forms already validated correctly). Of the real findings:
     - **Fixed directly** (no product decision needed): a stored-XSS gap
       (an unescaped image URL could break out of an `<img src>`
       attribute), a missing video size limit (reintroduced at 20MB,
       matching the earlier stress-test recommendation — see "Stress
       test findings" below, now resolved), localStorage save failures
       being silently swallowed, two service-worker caching bugs (error
       responses getting cached as the offline shell; a cache write that
       could be aborted before completing), and a GIF-frame-capture race
       (a timeout fallback could draw whatever frame the video happened
       to have decoded, rather than the one actually requested).
     - **Fixed after a product decision**: transparent PNGs were turning
       solid black when downscaled (JPEG has no alpha channel) — decided
       to flatten onto white before conversion. Keyboard focus outlines
       on form fields were reduced to a faint, possibly-invisible
       box-shadow — decided to leave as-is (skipped) rather than fix.
     - **Attempted, then reverted**: a photo resize/crop feature could
       fail to load a Drive-hosted image due to missing CORS headers,
       silently corrupting the export. First attempt: a backend proxy
       (`Code.gs` re-serving the file from a response we control).
       Testing revealed a genuine Apps Script platform limitation —
       binary (`Blob`) `doGet` output can't carry custom response
       headers, so the proxy could never actually satisfy
       `crossOrigin="anonymous"`. Removed the dead code (both sides)
       rather than leave a "fix" that silently can't work; the failure
       now surfaces as a clean, immediate error message instead, which
       — on reflection — is functionally equivalent to what the proxy
       would have achieved anyway (same generic error either way, just
       one fewer wasted network round-trip). Low real-world impact:
       secondary feature, rare trigger (Drive rate-limiting, which this
       project has already hit twice — see below), no data loss.
   - **Also removed**: a "demo card" / local-storage fallback mode that
     silently faked success ("Logged to gallery! 🎉") when the app
     wasn't actually connected to a backend, and seeded a canned demo
     entry into an empty gallery. Replaced with honest states: a plain
     "no activities logged yet" message when there's genuinely no data,
     and a clear "The app isn't connected to your backend yet." error
     when trying to log/edit/delete while disconnected.
   - **Deploy pipeline gap found and fixed**: the PR added
     `gifenc.browser.js` (loaded via a `<script>` tag) but the GitHub
     Actions workflow's file-copy list predated it — without the fix,
     GIF conversion would have silently 404'd on the live site (falling
     back to raw video upload, not breaking outright, but not the
     intended feature). Fixed directly on `master`, confirmed the next
     deploy run picked it up.
   - **Collaboration channel**: this PR came through a proper GitHub fork
     (`ozywasborn/b-in-the-next-chapter`, maintainer-edit-enabled),
     superseding the earlier one-off manual mirror to a separate repo
     (`ozywasborn/b-next-2026`, from 2026-08-31). **Superseded again
     (2026-09-05)**: `ozywasborn` is now a full repo collaborator, so
     future work happens on branches in this repo directly rather than
     via fork+PR.

8. **Google Sign-In, real per-person identity, and activity tagging —
   built and shipped live** (4 Sep 2026, on `feature/google-signin-
   allowlist`, merged to `master` and deployed).
   - **Not a mechanical rebase.** Given how much `index.html` changed in
     the 3 Sep 2026 overhaul, the old branch's diff was used as a
     reference (extracted from its git stash) rather than replayed —
     everything was reapplied by hand against the current file, adapted
     to its structure.
   - **Real per-person identity, not just a gate.** Mid-build, the scope
     grew past "just add sign-in" once it became clear Phase 2 needs
     actual user profiles, not just an access check:
     - First sign-in prompts for a one-time display name (pre-filled
       from the Google account's real name, editable), stored in a new
       **Users** sheet keyed by Google's stable `sub` claim — not email
       (could change) and not the display name (meant to be freely
       editable without breaking anything).
     - **Design call, made before writing code**: considered capturing a
       *second*, immutable "real name" field alongside the editable
       username (for reliably identifying people when tagging). Pushed
       back on this as a PM/designer would — two name-shaped fields on a
       first-run screen invites confusion, "cannot be changed" creates
       first-run anxiety and a support burden, and email (already
       captured, immutable, never shown) already answers "who is this
       really" if a username ever gets confusing. Kept the single
       editable field. User agreed, also declined an email hint in the
       tag-friends list for the same reason — the concern (silly/
       nonsensical Gmail addresses) doesn't actually leak through to
       what other people see, since the display name is fully separate
       from the account's email or Google name.
     - Username capped at 24 characters (down from an initial 40) —
       long names could wrap awkwardly in the compact overlapping-avatar
       gallery view once ellipsis-truncation was deliberately turned off
       (see below).
   - **Edit/delete restricted to the entry's owner**, enforced
     server-side. Entries with no `userId` on record (logged before this
     system existed) stay open to anyone — a deliberate choice so
     upgrading the system doesn't strand old data, not an oversight.
   - **Allowlist moved off a Script Property onto a sheet tab**
     (requested mid-session, for easier editing — one email per row
     instead of a comma-separated property value), then to two columns,
     name + email (name is admin-facing only, for tracking who's who;
     only email is checked).
   - **Activity tagging** (`tagged_friends`, renamed from `participants`
     on 2026-09-05, comma-separated `userId`s on the Entry row,
     denormalized rather than a join-table tab — the set is small and
     bounded per entry). A "Tag friends" multi-select (select-all,
     individual deselect) on both the log and edit forms; tagged
     friends are credited, not co-owners. Backend
     `sanitizeTaggedFriends_()` strips unknown IDs and the logger's own
     ID before storing.
   - **Profile page**: editable display name, a "My Posts" tab (tap
     straight into editing — skips the normal preview step, since the
     profile page is for managing, not browsing) and a "Tagged In" tab
     (entries logged by someone else that tagged this user — view-only,
     opens the normal preview since there's no edit right there).
   - **Gallery attribution**: cards show overlapping avatar initials
     (poster + up to 2 tagged friends, capped at 3 circles) and a
     summary line — just the name if no one's tagged, "X and Y were
     there" for one tag, "X and N friends were there" for more; no
     "was there" suffix at all for the solo case, per explicit request.
     Text wraps instead of truncating with an ellipsis (also explicit —
     avatars centered against the (possibly 2-line) text once wrapping
     replaced truncation). The expanded preview reveals everyone
     involved, no cap, avatar + name for each.
   - **Unrelated UI decisions made alongside**: an earlier full-screen
     experiment for the gallery preview modal was reverted back to the
     original popup-card style per request; a real background-scroll
     lock was added (pinning `body` with `position:fixed`, not just
     `overflow:hidden` — the latter isn't reliably honored by mobile
     Chrome, confirmed by the user hitting exactly that); "Delete
     activity" restyled from a muted text link to a filled red button
     using the existing `--critical` token.
   - **Going live — sequencing mattered.** Frontend (GitHub Pages, auto-
     deploys on push) and backend (Apps Script, manually deployed) update
     through separate mechanisms, so there's no way to flip both
     perfectly atomically. Order used: (1) confirm Script Properties/
     Allowlist already apply project-wide to whatever deployment runs
     next (they do — same bound Sheet), so no separate prod-specific
     setup was needed there; (2) add the live GitHub Pages origin to the
     OAuth client's Authorized JavaScript origins; (3) populate the
     Allowlist with the real friend group's emails, not just test
     accounts; (4) push a new version to the *production* Apps Script
     deployment specifically (a different URL from the test deployment
     used throughout development); (5) verify the new backend via
     `curl` (`?action=ping` succeeds, `?action=list` correctly returns
     `AUTH_REQUIRED` without a token — confirms the new code is actually
     live, not just saved); (6) merge to `master` and push, triggering
     the GitHub Pages deploy.
   - **Two real snags during the go-live, both caught and fixed
     immediately via `curl` verification against the deployed
     `config.js`:**
     - The `GOOGLE_CLIENT_ID` GitHub repository secret was never
       actually created (only referenced in `deploy.yml`) — first
       deploy shipped with an empty client ID, silently disabling
       sign-in (the button just doesn't render). Manually re-triggered
       the deploy workflow (`workflow_dispatch`, no new commit needed)
       after the user added the secret.
     - Second attempt: the user accidentally overwrote the *existing*
       `WEB_APP_URL` secret's value with the client ID string instead of
       creating a new secret — broke the backend URL entirely. Caught by
       the same `curl config.js` check; both secrets were corrected and
       the workflow re-triggered a second time before it actually
       worked.
     - Also hit `[GSI_LOGGER]: The given origin is not allowed for the
       given client ID` right after the origin was added to the OAuth
       client — resolved itself after a few minutes plus a hard refresh.
       Google's own docs note origin changes can take a few minutes to a
       few hours to propagate; this wasn't a misconfiguration, just
       needed to wait. Worth remembering if this recurs after any future
       OAuth client change — don't assume it's broken immediately.

## Fixed this session (bugs, not design changes)

- iOS Safari's native date input was overflowing the form/viewport
  (WebKit-specific shadow-DOM sizing bug, not reproducible in Chromium) —
  fixed with `appearance: none` plus defensive `overflow-x: hidden`.
  **Confirmed resolved on a real iOS device (2026-09-05).**
- Gallery photos/videos were visibly flashing every ~20 seconds — the poll
  loop was unconditionally rebuilding the entire gallery grid (destroying
  and recreating every `<img>`) even when nothing had changed. Now skips
  the rebuild unless the fetched entries actually differ from what's
  rendered.
- A manual edit had removed the `#totalPoints`/`#targetPoints` markup
  while the JS still wrote to those ids on every render, throwing and
  silently breaking the progress bar. Restored.
- **Tagging 2+ friends corrupted the stored `participants` value**
  (found 2026-09-05, user-reported: an entry's userId recorded as
  `111,866,889,883,005,000,000,000,000,000,000,000,000,000`). Root
  cause: `Code.gs` writes `userId`/`participants` to the Sheet as raw
  JS strings (`appendRow`/`setValues`, `createEntry_`/`updateEntry_`),
  and Sheets auto-detects digit-only strings and silently coerces them
  to `Number` cells. A lone `userId` (Google's ~21-digit `sub` claim)
  already risked quiet float64 precision loss past ~15-17 significant
  digits; with 2+ tagged friends, `participants.join(',')` (e.g.
  `"111866889883005337,118668898830053380"`) got read back with the
  comma as a *thousands separator*, merging multiple ids into one
  garbled number. **Fixed**: added `forcePlainTextColumns_()`, called
  from `setup()`, which sets the `userId`/`tagged_friends` columns
  (Entries sheet) and `userId` column (Users sheet) to plain-text
  format (`'@'`) up front so Sheets never reinterprets them — covers
  existing and future rows in range. Cell capacity was never actually
  a risk here regardless of friend-group size — a Sheets cell holds up
  to 50,000 characters, and even 30 userIds joined with commas is only
  ~650 characters.
  - **Deploy steps**: paste updated `Code.gs` into the Apps Script
    editor, save, re-run `setup()` once (function dropdown > Run) on
    the *production* bound Sheet, then push a new version to the
    production Web App deployment (Deploy > Manage deployments >
    pencil icon > New version > Deploy) — editing the script alone
    doesn't update the live URL.
  - **Does not repair already-corrupted rows** — `setNumberFormat`
    only changes how a cell is parsed going forward; the precision on
    already-mangled `participants`/`userId` values is genuinely gone,
    not just mis-displayed. Any entry tagged with 2+ friends before
    this fix needs its "Tag friends" re-selected and the entry re-
    saved once the fix is live, to overwrite the cell with a correctly
    text-formatted value. **Not yet done.**
  - **Renamed `participants` → `tagged_friends`** (2026-09-05, same
    session, for clarity) across `Code.gs` (the `HEADERS` column,
    `sanitizeParticipants_()` → `sanitizeTaggedFriends_()`, and every
    read/write site) and `index.html` (the JSON payload field sent on
    create/edit, `entry.tagged_friends` on read, and the
    `pendingParticipants`/`pendingEditParticipants` state vars →
    `pendingTaggedFriends`/`pendingEditTaggedFriends`). **The Entries
    sheet's actual header-row cell (column O) still literally reads
    "participants"** — `ensureHeaders_()` only appends headers for
    newly-added columns, it doesn't rename existing ones, so the label
    needs a one-time manual edit in the Sheet UI. Purely cosmetic: the
    code addresses columns by position, not by matching the header
    cell text, so nothing breaks if this is left as-is.

## Stress test findings — not yet acted on

Full report: [artifact](https://claude.ai/code/artifact/c30fe412-c465-44e8-8c5d-3725d3928aa6)

- **Video upload ceiling**: load testing showed 15MB took ~44s and 40MB
  failed outright (hung, never completed). Recommended tightening the
  client-side limit to ~15–20MB. **Resolved 2026-09-03** — a hard 20MB
  client-side limit is now enforced before any upload/GIF-conversion
  attempt (found independently during the gallery PR's code review, not
  something we had to remember to circle back to).
- **Concurrent submissions are fragile by platform design**: when many
  people submit at the exact same instant, Apps Script's free-tier
  execution ceiling rejects a large fraction of them outright (not a bug
  in our code, not fixable there). Mitigation is just "retry if it fails."
- Concurrent reads, gallery scaling to hundreds of entries, and Drive
  thumbnail serving under load all held up fine — no action needed.
- **Drive rate-limiting confirmed happening in practice, not just in
  theory** (2026-08-30, 2026-09-03): repeated heavy testing/reloading hit
  both a 429 (Too Many Requests, on the thumbnail endpoint) and a 403
  (Forbidden, on the `lh3.googleusercontent.com` CDN) at different points.
  Both self-resolved within the session without any code change — matches
  PRD §8.1's documented "Drive occasionally rate-limits hotlinked
  content" trade-off. Not a bug; just confirms this can genuinely happen
  under sustained use, worth remembering if it recurs after real launch.

## Next steps

- [x] ~~One-time reconciliation of any pre-4-Sep-2026 entries that still
      show a free-text/no-owner attribution~~ — decided (2026-09-05) not
      to do this; old entries stay open to anyone by design, and that's
      fine as-is
- [x] Confirm the iOS Safari date-input fix actually resolved the issue
      on a real device — **confirmed 2026-09-05**
- [x] Add the collaborator (`ozywasborn`) as a full repo collaborator —
      **done**; future work happens on branches here directly instead
      of the fork+PR dance
- [ ] Do a real end-to-end pass with the actual friend group now that
      sign-in is live: confirm everyone's email is in the Allowlist,
      everyone can sign in and set a display name, and the app otherwise
      feels normal day-to-day (not just single-account testing)
- [ ] Phase 2 (gamification) groundwork is now further along than
      originally planned — every entry and every user already has a
      stable ID, which §12.3 of the PRD called out as the main thing
      Phase 1 needed to get right for a painless Firestore migration
      later. Worth revisiting Phase 2 scoping sooner than "once the
      group's used Phase 1 for a while," given this
