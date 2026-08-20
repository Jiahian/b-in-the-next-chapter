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

1. Open `index.html` in a text editor.
2. Near the top of the `<script>` section, find:
   ```js
   var WEB_APP_URL = "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE";
   ```
3. Replace the placeholder with the URL you copied in step 4.
4. Save the file. The orange "not connected" banner at the top of the app disappears once this is set correctly.

If you ever want to change the point target (currently 1,000), the deadline, or the polling frequency, they're the next few lines down (`TARGET_POINTS`, `DEADLINE_ISO`, `POLL_INTERVAL_MS`).

## 6. Host it so friends can open it

`index.html` (plus `manifest.json`, `sw.js`, and the `icons/` folder) needs to live somewhere with a stable HTTPS link. The easiest free option:

**GitHub Pages**
1. Create a new GitHub repo, upload `index.html`, `manifest.json`, `sw.js`, and the `icons/` folder (keep the folder structure — `icons/icon-192.png` etc. must stay at that relative path).
2. Repo **Settings > Pages > Deploy from a branch**, pick `main` and `/ (root)`.
3. Your app will be live at `https://<your-username>.github.io/<repo-name>/`.

Any other static host (Netlify, Vercel, Cloudflare Pages) works the same way — just make sure all four items (`index.html`, `manifest.json`, `sw.js`, `icons/`) are uploaded together with their relative paths intact.

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
