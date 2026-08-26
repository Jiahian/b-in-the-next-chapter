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

6. **Access control is a two-tier decision, and we're mid-decision.**
   - *Shipped now*: a client-side password prompt (soft deterrent only —
     the password ships in plain text to every visitor's browser; stops
     accidental wandering-in, not a determined visitor).
   - *Discussed, not yet built*: three paths to real protection —
     **(A)** move the password check server-side into `Code.gs` (closes
     the "leaks to everyone" hole, still a shared secret, moderate
     effort); **(B)** Google Sign-In with a per-person email allowlist
     (real per-person identity, more friction, bigger lift); **(C)** a
     custom backend with real sessions (most correct, abandons the
     $0-cost Apps Script stack the whole project is built around).
     **Recommendation: B**, specifically *because* Phase 2's planned
     badges/character-items/Manna currency (PRD §12) require knowing
     *who* is making a request, not just *that* they know a shared
     password — and Firebase Authentication (Google Sign-In) pairs
     natively with the Firestore migration Phase 2 already calls for.
     **No decision made yet** — user is weighing this before any code
     changes.

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

- **Video upload ceiling**: `Code.gs`/the client still allow up to 45MB
  (`index.html`'s `handleFileChosen`), but load testing showed 15MB took
  ~44s and 40MB failed outright (hung, never completed). Recommended
  tightening the client-side warning/limit to ~15–20MB — **not yet
  changed in code.**
- **Concurrent submissions are fragile by platform design**: when many
  people submit at the exact same instant, Apps Script's free-tier
  execution ceiling rejects a large fraction of them outright (not a bug
  in our code, not fixable there). Mitigation is just "retry if it fails."
- Concurrent reads, gallery scaling to hundreds of entries, and Drive
  thumbnail serving under load all held up fine — no action needed.

## Next steps

- [ ] Decide between Option A / B / C for real access protection (see
      decision 6 above) — blocking any further auth work
- [ ] If B is chosen: Google OAuth client + consent screen, allowlist of
      approved emails, `Code.gs` verifies identity tokens server-side,
      and a one-time reconciliation of existing free-text-named entries
      to the correct Google accounts
- [ ] Tighten the client-side video size guidance from ~45MB to ~15–20MB
      per the stress-test findings
- [ ] Confirm the iOS Safari date-input fix actually resolved the issue
      on a real device
- [ ] `PRD_B_in_the_Next_Chapter.md` has local edits not yet committed —
      decide whether to commit them
