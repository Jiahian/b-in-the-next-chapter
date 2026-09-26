# B in the Next Chapter!

A mobile-first PWA for a private friend group to log activities toward a
shared 1,000-point goal before 31 Dec 2026 — countdown, progress bar,
category breakdown, and a shared photo/video gallery, gated behind Google
Sign-In.

**Live app**: https://jiahian.github.io/b-in-the-next-chapter/

## Local dev

```sh
npm run dev        # Express server, or:
python dev_server.py   # zero-dependency alternative
```

Both serve on `localhost:3000`. Neither has a real backend of its own —
create a gitignored `config.js` pointing at a deployed Apps Script backend
first (see [`docs/SETUP.md`](docs/SETUP.md)), or the app loads in a visible
"not connected" state.

## Docs

- [`docs/PRD.md`](docs/PRD.md) — what the app does and why (product spec).
- [`docs/SETUP.md`](docs/SETUP.md) — one-time backend setup (Sheet + Apps Script + OAuth + allowlist), hosting, and troubleshooting.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — build history: what was decided, what shipped, known gaps.
- [`docs/BACKLOG.md`](docs/BACKLOG.md) — planned-but-unbuilt work (gamification + deferred notification enhancements).
- [`CLAUDE.md`](CLAUDE.md) — architecture notes and implementation gotchas, for anyone (human or AI) editing the code.
