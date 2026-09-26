# Backlog

The single home for planned-but-unbuilt work. Nothing here is scheduled — it's
captured so the data model and build don't have to be reworked to support it
later. Two areas: **gamification** (the larger product direction, formerly
"Phase 2" in the PRD) and **notification enhancements** (deferred pieces of the
Telegram notification feature).

---

## Gamification

Turn the points system into something more playful, in a retro 64px pixel-art
style (in the spirit of the "Walking Charlie" reference the group shared — an
original art set inspired by that style, not a copy). Each friend gets a pixel
character living in a shared "town." Not built; the current data model already
supports it (every entry/user carries a stable `userId`).

**Concept**
- Rename "points" to **Bread** — the Biblical food-from-heaven, doubling as a
  pun on game "mana." (Placeholder name pending final confirmation.)
- A **spendable currency** alongside the group's lifetime point total (see the
  split below — the key data-model decision).
- A **shop** where Bread buys clothing/accessories and backgrounds to customize
  a character (dress-up, optionally with a "mystery box" random-reward element).
- An **inactivity state**: if a friend hasn't logged in 2+ days, their character
  appears "sleeping"; friends can "poke" them. (Historically this surfaced only
  on next app open; now that a Telegram notification channel exists, a poke
  could optionally push there instead.)

**Key requirement — split lifetime points from spendable currency.** The shared
progress bar must be driven by **lifetime points earned** (sum of every entry's
amount, ever — never decreases). **Bread balance** (spendable, decreases on
purchase) is a separate number that starts equal to lifetime points and diverges
once spending begins. If spending drew down the same number that feeds the
group's goal, buying a hat would visibly shrink the whole group's progress bar.

**Technical approach — hybrid, not a full migration.** Sign-in already verifies
Google ID tokens directly against Apps Script (cheaper than Firebase Auth for
access control alone) and doesn't block a later Firestore move.
- **Media** stays on Google Drive — write-once, no concurrency concerns.
- **Game state** (Bread balance, inventory, equipped items, sleep/poke) moves to
  Firebase Firestore when this begins, for real-time listeners (a friend's new
  outfit appears instantly, not on a 20s poll) and atomic transactions (no
  double-spend on the same Bread balance).
- **Migration**: a one-time script carries Users-sheet rows (+ their game state)
  into Firestore documents keyed by the same `userId`; entries can stay on
  Sheets/Drive indefinitely. Done in a short maintenance window, not zero-
  downtime dual writes. Net cost: a small Firebase Blaze bill (near-$0 at this
  scale) on top of the still-free Drive/Sheets layer.

**Open items (not yet decided)**
- Final currency name (Bread vs. alternatives).
- Mystery-box mechanic vs. direct-purchase shop only.
- Sprite/art: fixed canvas (e.g. 64×64 or 128×128px), base character(s), a
  clothing/accessory set, a background set, idle/sleeping/poke poses — sourced
  from the group or generated as an original starter set.
- Whether "poke" does anything mechanical (e.g. a small Bread bonus) or stays
  purely social.

---

## Notification enhancements

Deferred pieces of the Telegram notification feature. The counters, queue,
Gemini generation, name-scrubbing, milestones, and deep link are all built and
live; these build on top of them.

- **Named achievement announcements.** Streak badges, personal post-count
  milestones, per-category milestones, and "Well-Rounded" (all three category
  counts `> 0`). The counters they need (`postCount`, per-category counts,
  streaks) already exist and are backfilled — this is wording + trigger wiring.

- **First-post & group-activity folding.** Fold two extras into the SAME entry
  announcement, each gated by its Settings toggle (`FIRST_POST_MENTION_ENABLED`,
  `GROUP_ACTIVITY_MENTION_ENABLED`, already seeded): (1) first-post — owner's
  freshly recomputed `postCount === 1` (owned-only, so being tagged earlier
  doesn't suppress it); (2) group activity — creator + ≥1 tagged friend, passing
  only the COUNT to Gemini, never the friends' names. Sketch: a
  `buildEntryContext_(entry, counters)` helper setting `isFirstPost` /
  `isGroupActivity`+`friendCount`, called from doPost's create branch, plus two
  `facts.push(...)` lines in `buildGeminiPrompt_`. Purely wiring.

- **Scheduled announcements: Points Update + Highlight of the week.** A **daily**
  time trigger (bake the hour into `everyDays(1).atHour(...)`, keep a "sent
  today" guard). Points Update: current total, points-to-go, days-to-deadline
  (tunables `POINTS_UPDATE_MODE`/`_DAY_OF_WEEK`/`_HOUR`/`_SPECIFIC_DATES`,
  script-maintained `POINTS_UPDATE_LAST_SENT_DATE`; needs mirrored
  `TARGET_POINTS`/`DEADLINE_ISO` in Code.gs). Highlight: admin ticks the
  `highlightOfWeek` column; the check finds `highlightOfWeek === true &&
  !highlightAnnouncedAt`, announces once, stamps it, guarded by
  `HIGHLIGHT_LAST_SENT_WEEK` (≤1/week). Columns/toggles already exist. Add a
  `setupDailyTrigger` (run once) + set the script timezone to `Asia/Singapore`.

- **Gemini model fallback chain.** Replace the single `GEMINI_MODEL` setting with
  an ordered, phone-editable list (best → worst). `generateMessageText_` starts
  at the best; on a 429 for the current model it advances to the next in the
  same run (each free-tier model has its own daily quota, so cycling multiplies
  daily capacity). Only when all are exhausted does it drop to the offline
  fallback sentence (current behavior). The pointer / per-model "exhausted today"
  state resets at Google's **midnight-Pacific** daily reset — compare a stored
  date against `Utilities.formatDate(new Date(), 'America/Los_Angeles',
  'yyyy-MM-dd')`. Best-effort state (a stale flag just wastes one attempt).
