# Setup guide — B in the Next Chapter!

This app has two pieces you need to connect: a **Google Sheet + Apps Script**
(the backend — database + photo/video storage on Google Drive) and the
**index.html** file (the front-end everyone opens on their phone).

Do this once, on the Google account with spare Drive storage — that account
becomes the app's data owner (see the PRD's §8 note on this).

## 1. Create the Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new blank spreadsheet.
2. Name it something like **"BNext - Data"**.
3. Leave it empty — the script sets up its own tab and headers in step 3.

## 2. Add the Apps Script backend

1. In the Sheet, go to **Extensions > Apps Script**. This opens a script editor bound to your Sheet.
2. Delete any placeholder code in `Code.gs`, then paste in the entire contents of the `Code.gs` file from this delivery.
3. Click **Save** (the disk icon), name the project **"BNext — Backend"**.

## 3. Run setup once

1. In the Apps Script editor toolbar, pick **setup** from the function dropdown (next to Debug/Run).
2. Click **Run**.
3. The first time, Google will ask you to authorize the script — click through **Review permissions > (choose your account) > Advanced > Go to ... (unsafe) > Allow**. This warning appears because it's your own unpublished script, not because anything is wrong.
4. Check **View > Logs** (or Executions) — you should see a Sheet URL and a Drive folder URL logged. Three new tabs now exist in your Sheet — **Entries**, **Users** (fills up as people sign in and pick a display name), and **Allowlist** (empty until you fill it in — step 5b) — and a new Drive folder called **"BNext - Media"** now exists in your Drive, where every uploaded photo/video will land.

## 4. Deploy as a Web App

1. Still in the Apps Script editor, click **Deploy > New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Fill in:
   - **Description**: `v1`
   - **Execute as**: **Me** (your account)
   - **Who has access**: **Anyone** (this lets friends use the app without logging into Google — see the "who can do what" note below)
4. Click **Deploy**, authorize again if asked, then **copy the Web app URL** it gives you (looks like `https://script.google.com/macros/s/AKfycb.../exec`).
5. To sanity-check it, paste that URL into a browser with `?action=ping` on the end — you should see `{"ok":true,"message":"BNext backend is live."}`.

> **Re-deploying later**: if you ever edit `Code.gs`, use **Deploy > Manage deployments > (pencil icon) > New version > Deploy** — editing the script alone doesn't update the live URL.

## 5. Set up Google Sign-In

Access control is real, server-verified authentication: everyone signs in with their own Google account, and `Code.gs` checks that account against an allowlist before serving or accepting any data. Two things to set up once.

### 5a. Create an OAuth client

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) (use the same Google account that owns the Sheet/Drive/Apps Script, or any account — this step is independent of that).
2. Create a new project (or pick an existing one), e.g. **"BNext"**.
3. **APIs & Services > OAuth consent screen** — choose **External**, fill in the required app name/support email, and add the group's emails as **test users** if the consent screen stays in "Testing" mode (fine for a small friend group — no Google review needed).
4. **APIs & Services > Credentials > Create Credentials > OAuth client ID**, application type **Web application**.
5. Under **Authorized JavaScript origins**, add every origin the app will be opened from, e.g.:
   - `https://<your-username>.github.io`
   - `http://localhost:5500` (or whatever you use for local testing)
6. Click **Create**, then copy the **Client ID** (looks like `1234567890-abc...apps.googleusercontent.com`). This is **not a secret** — OAuth client IDs are meant to be public — but it is deployment-specific, so it's still wired through `config.js`/repo secrets alongside `WEB_APP_URL` for consistency.

### 5b. Set the client ID and the allowlist

1. Back in the Apps Script editor (Extensions > Apps Script on the Sheet), click the **⚙️ Project Settings** gear icon in the left sidebar.
2. Under **Script Properties**, add one property: `GOOGLE_CLIENT_ID` — the Client ID from step 5a. The backend checks that every sign-in token was issued for this exact client.
3. **Save script properties.**
4. Back in the Sheet itself, open the **Allowlist** tab (created automatically by `setup()` — see step 3). Add one approved person per row: **name** in column A (just for your own tracking — not checked by anything), **email** in column B (their Google account email — this is the one that's actually checked).
5. To add or remove someone later, just edit that tab directly — no script edit, no redeploy, takes effect on their next request.

### 5c. One-time authorization for external requests

`Code.gs` now calls out to Google's own servers to verify each sign-in token — the first time any Apps Script project does this, it needs a permission (`script.external_request`) that earlier versions of this project never needed, so it was never granted. Nothing prompts you for it automatically (a deployed Web App has no one there to click "Allow"), so do this once manually:

1. In the Apps Script editor, temporarily add: `function testAuth() { UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=test'); }`
2. Save, select **testAuth** in the Run dropdown, click **Run**.
3. Click through the **Review permissions** prompt that appears (same flow as the original `setup()` authorization).
4. You'll see an error about an invalid token afterward — that's expected (the test call used a fake token just to trigger the prompt), not a problem. Delete `testAuth` once done.

Skip this and sign-in will appear to succeed in the browser, then immediately bounce back to the sign-in screen — see Troubleshooting below if that happens.

## 6. Connect the front-end

`WEB_APP_URL` is **not** hardcoded in `index.html` — this repo is public, and that URL grants access to your Sheet/Drive, so it's kept out of git history entirely. Instead it's read from `window.WEB_APP_URL`, set by a `config.js` file that is gitignored. `GOOGLE_CLIENT_ID` (from step 5a) is wired the same way, for consistency, even though it isn't sensitive.

**For local testing on your own machine:**
1. Copy `.env.example`'s values.
2. Create a `config.js` file next to `index.html` (it's gitignored, so this stays local):
   ```js
   window.WEB_APP_URL = "https://script.google.com/macros/s/.../exec";
   window.GOOGLE_CLIENT_ID = "....apps.googleusercontent.com";
   ```
3. Open `index.html` — the orange "not connected" banner disappears once `WEB_APP_URL` is set correctly, and a **Sign in with Google** button appears in place of the old password prompt.

**For the hosted GitHub Pages build**, see step 7 below — the deploy workflow generates `config.js` at deploy time from repository secrets, so you never paste either value into a tracked file.

If you ever want to change the point target (currently 1,000), the deadline, or the polling frequency, edit `TARGET_POINTS`, `DEADLINE_ISO`, `POLL_INTERVAL_MS` directly in `index.html` — those aren't secrets, so they stay in source.

## 7. Host it so friends can open it

This repo ships a GitHub Actions workflow (`.github/workflows/deploy.yml`) that deploys to GitHub Pages and injects the backend URL and Google Client ID from repo secrets at build time — so neither lands in the repo's source or git history.

1. **Settings > Secrets and variables > Actions > New repository secret**, name it `WEB_APP_URL`, paste the Apps Script Web App URL from step 4 as the value. Repeat for `GOOGLE_CLIENT_ID` with the value from step 5a.
2. **Settings > Pages > Build and deployment > Source**, choose **GitHub Actions**.
3. Push to `master` (or run the workflow manually from the **Actions** tab) — it builds `index.html` + `manifest.json` + `sw.js` + `icons/` + a generated `config.js` into a `_site` folder and deploys that.
4. Your app will be live at `https://<your-username>.github.io/<repo-name>/`. **Go back to step 5a and add this exact URL to the OAuth client's Authorized JavaScript origins** if you haven't already — Google Sign-In will fail with an origin-mismatch error otherwise.

Any other static host (Netlify, Vercel, Cloudflare Pages) works too — each has its own equivalent of a repo secret / environment variable for injecting these at build time without committing them.

## 8. Add to home screen

Share the hosted link with the group. On each friend's phone:
- **iPhone (Safari)**: open the link, tap the Share icon, **Add to Home Screen**.
- **Android (Chrome)**: open the link, tap the ⋮ menu, **Install app** / **Add to Home screen**.

It'll then open full-screen like a native app, using the icon we generated. First open still requires signing in with Google.

## Who can do what (important to know)

The Web App is deployed with **"Anyone" access** at the Apps Script layer (required so friends don't need to be added as Apps Script/Drive collaborators), but every request is verified server-side against the **Allowlist** sheet tab before anything happens — only signed-in, allowlisted accounts get any data back. Adding/removing someone from the group only requires editing that tab (step 5b) — no redeploy.

**First sign-in creates a profile.** The first time someone signs in, they're prompted to pick a display name, stored in the **Users** tab alongside their Google account email and a stable account ID. That ID is what entries are actually tied to — not the display name, so renaming later doesn't rewrite history.

**Edit/delete is now per-person, not group-wide** (a change from the original reference prototype's fully-open model): a friend can only edit or delete their *own* entries, from either the gallery or their Profile page ("My posts"). The one exception is entries logged before this identity system existed — those have no owner on record and stay open to anyone, so nothing from before the upgrade gets stranded.

## Limits worth knowing

- **Upload size**: photos are automatically compressed client-side; videos are not. Keep clips under ~30 seconds / ~45MB or they may fail to upload — this is an Apps Script request-size limit, not something the app can work around.
- **Sync speed**: everyone's view refreshes automatically every 20 seconds (and whenever they reopen the app), not instantly. This is expected — see the PRD's note on why (§8).
- **Daily quotas**: a personal Google account has a daily cap on Apps Script executions — at 30 friends logging a few times a day this isn't a concern, but if usage ever spikes far beyond that, requests could start failing until the quota resets the next day.
- **Sign-in expires**: a Google ID token is valid for about an hour. If a request fails with a session-expired message, the app re-shows the sign-in button automatically — just sign in again, no data is lost.

## Troubleshooting

- **"Backend not configured yet" banner won't go away** — double check `WEB_APP_URL` in `index.html` was pasted exactly, including `https://` and ending in `/exec`.
- **Sign-in button doesn't appear** — check the browser console for an origin-mismatch error; the page's exact URL (protocol + host) needs to be listed under the OAuth client's Authorized JavaScript origins (step 5a).
- **Sign-in succeeds client-side but the app bounces back to "this app is private"** — the front-end never sees why; check the failed request's response body in DevTools' Network tab for the actual `error` message. If it says something like *"You do not have permission to call UrlFetchApp.fetch... Required permissions: .../auth/script.external_request"* — this is a one-time authorization gap: `Code.gs` didn't call any external URL before this feature was added, so Apps Script never asked for that permission, and it won't prompt for it just from running an unrelated function (like `setup`) or from a deployed Web App request (no one's there to click "Allow"). Fix: add a throwaway function that actually calls `UrlFetchApp.fetch(...)` anywhere in the file, save, select *that* function in the editor's Run dropdown, and run it — this triggers a fresh permissions prompt covering the new scope. Approve it, delete the throwaway function, done — no redeploy needed, it's account-level authorization.
- **"That Google account isn't on the group's list"** — add the email to the **Allowlist** tab (step 5b); check for typos/extra spaces, and that it's the exact address they signed in with.
- **Submitting fails / gallery won't load** — visit `<your web app URL>?action=ping` directly in a browser. If that doesn't return JSON, the deployment itself is the problem (redo step 4, making sure "Execute as: Me" and "Access: Anyone" are set). `?action=ping` doesn't require sign-in, so it isolates deployment issues from auth issues.
- **Photos don't show in the gallery** — open the Drive folder from step 3 and confirm files are actually landing there; if not, re-run `setup()` and re-deploy.
