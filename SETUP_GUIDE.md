# Setup guide — B in the Next Chapter!

This app has two pieces you need to connect: a **Google Sheet + Apps Script**
(the backend — database + photo/video storage on Google Drive) and the
**index.html** file (the front-end everyone opens on their phone).

Do this once, on the Google account with spare Drive storage — that account
becomes the app's data owner (see the PRD's §8 note on this).

## 1. Create the Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new blank spreadsheet.
2. Name it something like **"B in the Next Chapter — Data"**.
3. Leave it empty — the script sets up its own tab and headers in step 3.

## 2. Add the Apps Script backend

1. In the Sheet, go to **Extensions > Apps Script**. This opens a script editor bound to your Sheet.
2. Delete any placeholder code in `Code.gs`, then paste in the entire contents of the `Code.gs` file from this delivery.
3. Click **Save** (the disk icon), name the project **"B in the Next Chapter — Backend"**.

## 3. Run setup once

1. In the Apps Script editor toolbar, pick **setup** from the function dropdown (next to Debug/Run).
2. Click **Run**.
3. The first time, Google will ask you to authorize the script — click through **Review permissions > (choose your account) > Advanced > Go to ... (unsafe) > Allow**. This warning appears because it's your own unpublished script, not because anything is wrong.
4. Check **View > Logs** (or Executions) — you should see a Sheet URL and a Drive folder URL logged. A new tab called **Entries** now exists in your Sheet, and a new Drive folder called **"B in the Next Chapter - Media"** now exists in your Drive — that's where every uploaded photo/video will land.

## 4. Deploy as a Web App

1. Still in the Apps Script editor, click **Deploy > New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Fill in:
   - **Description**: `v1`
   - **Execute as**: **Me** (your account)
   - **Who has access**: **Anyone** (this lets friends use the app without logging into Google — see the "who can do what" note below)
4. Click **Deploy**, authorize again if asked, then **copy the Web app URL** it gives you (looks like `https://script.google.com/macros/s/AKfycb.../exec`).
5. To sanity-check it, paste that URL into a browser with `?action=ping` on the end — you should see `{"ok":true,"message":"B in the Next Chapter backend is live."}`.

> **Re-deploying later**: if you ever edit `Code.gs`, use **Deploy > Manage deployments > (pencil icon) > New version > Deploy** — editing the script alone doesn't update the live URL.

## 5. Connect the front-end

`WEB_APP_URL` is **not** hardcoded in `index.html` — this repo is public, and that URL grants unauthenticated write access to your Sheet/Drive, so it's kept out of git history entirely. Instead it's read from `window.WEB_APP_URL`, set by a `config.js` file that is gitignored.

**For local testing on your own machine:**
1. Copy `.env.example`'s value.
2. Create a `config.js` file next to `index.html` (it's gitignored, so this stays local):
   ```js
   window.WEB_APP_URL = "https://script.google.com/macros/s/.../exec";
   ```
3. Open `index.html` — the orange "not connected" banner disappears once this is set correctly.

**For the hosted GitHub Pages build**, see step 6 below — the deploy workflow generates `config.js` at deploy time from a repository secret, so you never paste the URL into a tracked file.

If you ever want to change the point target (currently 1,000), the deadline, or the polling frequency, edit `TARGET_POINTS`, `DEADLINE_ISO`, `POLL_INTERVAL_MS` directly in `index.html` — those aren't secrets, so they stay in source.

## 6. Host it so friends can open it

This repo ships a GitHub Actions workflow (`.github/workflows/deploy.yml`) that deploys to GitHub Pages and injects the backend URL from a repo secret at build time — so the URL never lands in the repo's source or git history (it does still end up in the page every visitor's browser loads, since a static client-side app has no other way to reach the backend — but it's not sitting in a searchable public repo).

1. **Settings > Secrets and variables > Actions > New repository secret**, name it `WEB_APP_URL`, paste the Apps Script Web App URL from step 4 as the value.
2. **Settings > Pages > Build and deployment > Source**, choose **GitHub Actions**.
3. Push to `master` (or run the workflow manually from the **Actions** tab) — it builds `index.html` + `manifest.json` + `sw.js` + `icons/` + a generated `config.js` into a `_site` folder and deploys that.
4. Your app will be live at `https://<your-username>.github.io/<repo-name>/`.

Any other static host (Netlify, Vercel, Cloudflare Pages) works too — each has its own equivalent of a repo secret / environment variable for injecting `WEB_APP_URL` at build time without committing it.

## 7. Add to home screen

Share the hosted link with the group. On each friend's phone:
- **iPhone (Safari)**: open the link, tap the Share icon, **Add to Home Screen**.
- **Android (Chrome)**: open the link, tap the ⋮ menu, **Install app** / **Add to Home screen**.

It'll then open full-screen like a native app, using the icon we generated.

## Who can do what (important to know)

The Web App is deployed with **"Anyone" access and no login**, matching the low-friction design in the PRD — anyone with the link can submit, edit, or delete *any* entry (not just their own). This keeps things frictionless for a small trusted friend group, but means the link itself is the only real "access control." Don't post it somewhere public.

## Limits worth knowing

- **Upload size**: photos are automatically compressed client-side; videos are not. Keep clips under ~30 seconds / ~45MB or they may fail to upload — this is an Apps Script request-size limit, not something the app can work around.
- **Sync speed**: everyone's view refreshes automatically every 20 seconds (and whenever they reopen the app), not instantly. This is expected — see the PRD's note on why (§8).
- **Daily quotas**: a personal Google account has a daily cap on Apps Script executions — at 30 friends logging a few times a day this isn't a concern, but if usage ever spikes far beyond that, requests could start failing until the quota resets the next day.

## Troubleshooting

- **"Backend not configured yet" banner won't go away** — double check `WEB_APP_URL` in `index.html` was pasted exactly, including `https://` and ending in `/exec`.
- **Submitting fails / gallery won't load** — visit `<your web app URL>?action=ping` directly in a browser. If that doesn't return JSON, the deployment itself is the problem (redo step 4, making sure "Execute as: Me" and "Access: Anyone" are set).
- **Photos don't show in the gallery** — open the Drive folder from step 3 and confirm files are actually landing there; if not, re-run `setup()` and re-deploy.
