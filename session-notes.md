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
- **Password gate**: enabled, password `BNext2026` (see the "Access
  control" decision below — this is explicitly a soft gate, not real auth)
- **Gallery/UI overhaul**: live as of 3 Sep 2026 — a community-contributed
  PR (dark mode, masonry gallery layout, post preview modal, photo
  resize/crop, video-to-GIF conversion) was reviewed, hardened, and
  merged. See decision 7 below.
- **Google Sign-In (Option B)**: built and tested working (against the
  pre-overhaul UI), but still not merged — needs rebasing onto the new
  gallery/UI before it can move forward. See decision 6.

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

6. **Access control: Option B (Google Sign-In) decided and built, but
   still not merged.** Of the three paths considered — **(A)** server-side
   password check, **(B)** Google Sign-In + per-person email allowlist,
   **(C)** a custom backend with real sessions — **B was chosen**
   (2026-08-29), specifically because Phase 2's planned badges/
   character-items/Manna currency (PRD §12) need to know *who* is making
   a request, not just *that* they know a shared password, and Firebase
   Authentication pairs natively with the Firestore migration Phase 2
   already calls for. Built and tested working end-to-end
   (2026-08-31/09-01) on branch `feature/google-signin-allowlist`:
   front-end signs in with Google Identity Services, `Code.gs`'s
   `requireAuth_()` verifies the token and checks an `ALLOWED_EMAILS`
   Script Property, the free-text name field is replaced by the verified
   Google identity. **Still not merged** — it was built against the
   pre-overhaul UI, and the 3 Sep 2026 gallery/UI rewrite (decision 7)
   changed most of `index.html`, so it now needs a rebase before it can
   land.

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
     (`ozywasborn/b-next-2026`, from 2026-08-31) as the going-forward way
     the group's collaborator contributes.

## Fixed this session (bugs, not design changes)

- iOS Safari's native date input was overflowing the form/viewport
  (WebKit-specific shadow-DOM sizing bug, not reproducible in Chromium) —
  fixed with `appearance: none` plus defensive `overflow-x: hidden`.
  **Not yet confirmed working on a real iOS device.**
- Gallery photos/videos were visibly flashing every ~20 seconds — the poll
  loop was unconditionally rebuilding the entire gallery grid (destroying
  and recreating every `<img>`) even when nothing had changed. Now skips
  the rebuild unless the fetched entries actually differ from what's
  rendered.
- A manual edit had removed the `#totalPoints`/`#targetPoints` markup
  while the JS still wrote to those ids on every render, throwing and
  silently breaking the progress bar. Restored.

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

- [ ] Rebase `feature/google-signin-allowlist` (Option B, built and
      tested working) onto the new post-overhaul `index.html` — the
      auth-gate markup/script, header sign-out button, and removed name
      field were all built against the old UI and need reapplying
- [ ] One-time reconciliation of existing free-text-named entries to the
      correct Google accounts, once Option B lands (deferred — not
      required by the access-control work itself)
- [ ] Confirm the iOS Safari date-input fix actually resolved the issue
      on a real device
- [ ] Decide whether/when to add the collaborator (`ozywasborn`) as a
      full repo collaborator so future work happens on branches here
      directly, instead of continuing the fork+PR dance indefinitely
      (discussed 2026-09-01, not yet decided)
