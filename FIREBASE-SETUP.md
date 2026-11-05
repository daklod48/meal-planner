# Firebase and GitHub Pages: the console steps, click by click

_Written 5 November 2026 for the Meal Planner web app. About 20 minutes. Until step 6 is done the app works in **practice mode** (accounts and data stay in the one browser), so nothing breaks while you do this._

**What you are setting up, anchored on HelloDorm.** It is the same pair you set up for HelloDorm in October: **Firebase Authentication** (the account list: e-mail and password, Google, and anonymous accounts for the demo) and **Cloud Firestore** (the online database: an online notebook where each account's files are kept, so phone and laptop read the same thing). The difference from HelloDorm: one Firestore collection per account, `spaces/<account id>/files`, and nothing shared between accounts.

**Before you start.** A Google account, and the repository `daklod48/meal-planner` on GitHub with this folder pushed to it (Claude does that once the repo is connected). The screens below are named as the Firebase console showed them in October and November 2026. The build machine could not open the console or Firebase's documentation on 5 November (its network blocks those sites), so if a button has a slightly different name, pick the one that means the same thing; the "you should see" lines tell you whether you are in the right place.

## Step 1. Create the project (3 min)
1. Open https://console.firebase.google.com and sign in with your Google account.
2. Click **Create a project** (on some accounts the tile says **Add project**).
3. Project name: `meal-planner`. Firebase adds a short suffix to the **project ID** if the name is taken (for example `meal-planner-4f2a1`); that is fine. Click **Continue**.
4. If it offers **Gemini in Firebase**, switch it off (not needed). Click **Continue**.
5. **Google Analytics**: switch it **off** (the app does not use it, and it would add a cookie notice). Click **Create project**.
6. Wait about 30 seconds, then click **Continue**.
   You should see: the project overview page with the name `meal-planner` at the top left.

## Step 2. Register the web app and copy its config (2 min)
1. On the project overview, click the **Web** icon, which looks like `</>` (under "Get started by adding Firebase to your app"; if you do not see it: the gear icon next to "Project Overview" > **Project settings** > **General** > **Your apps** > **Add app** > Web).
2. App nickname: `meal-planner-web`. Leave **"Also set up Firebase Hosting"** unticked (GitHub Pages hosts the app). Click **Register app**.
3. The page shows a block of code with `const firebaseConfig = { apiKey: ..., authDomain: ..., projectId: ..., storageBucket: ..., messagingSenderId: ..., appId: ... };`. Copy only the part from `{` to `}` into a note. You need it in step 6.
4. Click **Continue to console**.
   You can find the same block later: gear icon > **Project settings** > **General** > scroll to **Your apps** > `meal-planner-web` > **SDK setup and configuration** > **Config**.

## Step 3. Switch on the three ways to sign in (5 min)
1. Left menu: **Build** > **Authentication**. Click **Get started**.
2. Tab **Sign-in method**.
3. **Email/Password**: click it > switch on the first switch **Email/Password** > leave **Email link (passwordless sign-in)** off > **Save**.
4. Click **Add new provider** > **Google** > switch **Enable** on > **Project support email**: choose your own e-mail from the list (users see it on Google's consent screen) > **Save**.
5. Click **Add new provider** > **Anonymous** > switch **Enable** on > **Save**. This is the **demo account**: each "Try the demo account" click creates a private anonymous account with its own copy of the sample data, exactly like HelloDorm's demo.
   You should see: three rows with status **Enabled**: Email/Password, Google, Anonymous.
6. Tab **Settings** > **Authorized domains** (in the left list of that tab). `localhost` and `<your project ID>.firebaseapp.com` are already there. Click **Add domain** > type `daklod48.github.io` (no `https://`, no `/meal-planner`) > **Add**.
   Why: Firebase only lets pages on listed addresses sign people in. Without this line, sign-in on the published link fails with "This web address is not allowed in Firebase yet".
7. Optional, same **Settings** tab > **User actions**: leave **Enable create (sign-up)** ticked (friends must be able to sign up).
8. Optional, for Czech users: **Templates** tab > **Password reset** > the pencil icon > **Template language** > Czech > **Save**.

## Step 4. Create the database (3 min)
1. Left menu: **Build** > **Firestore Database**. Click **Create database**.
2. **Database ID**: leave `(default)`. **Location**: choose `eur3 (europe-west)` (Europe, several data centres) or `europe-west3 (Frankfurt)`. This cannot be changed later; either is fine for Prague. Click **Next**.
3. Choose **Start in production mode** (everything closed until the rules of step 5 open each person's own space). Click **Create**.
   You should see: an empty **Data** tab ("Start collection"). Do not add anything by hand; the app creates its records itself.

## Step 5. Paste the security rules (2 min)
1. Same page, tab **Rules**.
2. Select everything in the editor and delete it.
3. Open the file `firestore.rules` from this folder (in GitHub: the file list > `firestore.rules` > **Raw**), copy all of it, paste it into the editor.
4. Click **Publish**. You should see "Rules published" and today's date under the editor.

What the rules allow, in plain words: a signed-in account (the demo too) may read and write only `spaces/<its own id>/files/...`; each record must be exactly a file path, its text (under about 900 kB), the server's time and a device code; everything else in the database is closed to everyone. `tests/t_rules.mjs` proves 23 such cases against Google's Firestore emulator (a copy of the database program that runs on one computer), including that another account cannot read or write your files.

## Step 6. Put the config into the app (2 min)
1. In the repository open `app/js/firebase-config.js`.
2. Replace `window.MP_FIREBASE_CONFIG = null;` with `window.MP_FIREBASE_CONFIG = ` followed by the block you copied in step 2, and a `;` at the end. The comment at the top of the file shows the exact shape.
3. Save and commit (on GitHub: the pencil icon on the file, paste, **Commit changes**; or ask Claude: "put this Firebase config into meal planner and push").

**Is it safe to publish these values?** Yes. They are not passwords: every Firebase web page sends them to its visitors' browsers, and HelloDorm's `config.js` shows its own. They only say which project to talk to; the rules of step 5 decide what anyone may do there. Never put a **service account key** (a JSON file with `"private_key"` in it) into the repository; the app does not need one.

## Step 7. Publish with GitHub Pages (3 min)
0. Before the first push, and in every new clone: `python3 tools/make-share-copy.py --install-hook`, then `python3 tools/make-share-copy.py --check-publish` must print **OK**. Put your own private words (your name, your Rohlík display name, your e-mail, your computer's user name) one per line into `data/share-forbid.txt`; that file never leaves your computer. The hook then blocks any push that would publish them.
1. Open https://github.com/daklod48/meal-planner > **Settings** (top bar of the repository) > **Pages** (left list, under "Code and automation").
2. **Build and deployment** > **Source**: **Deploy from a branch**. **Branch**: `main`, folder `/ (root)` > **Save**.
3. Wait one or two minutes, refresh the page: it shows "Your site is live at https://daklod48.github.io/meal-planner/".
   No build step is needed: the repository root has `index.html`, and `.nojekyll` tells GitHub to serve every file as it is.

## Step 8. Check it like a friend would (5 min)
1. On the laptop open https://daklod48.github.io/meal-planner/. You should see the home page with **Try the demo account**, **Sign up**, **Sign in**, and **no** yellow "Practice mode" line (that line means step 6 is not live yet: wait a minute and reload).
2. **Try the demo account**: the app opens on "New plan for Tomáš Dvořák" (the kit's test person). Requests and results > open the request: three picks and "the app and tools/planner.py give the same scores".
3. Sign out (confirm), **Sign up** with your own e-mail, make a profile.
4. On the phone open the same link, **Sign in** with the same e-mail. The profile is there. Add a weigh-in on the phone (History); on the laptop it appears within a few seconds without reloading.
5. **Continue with Google** on the phone: a Google window (or a full-page Google sign-in on some phones) and back into the app.
6. In the Firebase console: **Authentication** > **Users** lists your accounts (anonymous ones have no e-mail); **Firestore Database** > **Data** shows `spaces` > one entry per account > `files`.

## What it costs
Nothing, on the free **Spark** plan: Firestore allows 50,000 document reads and 20,000 writes a day and 1 GB stored; e-mail, Google and anonymous sign-in are free. One visit reads about 10 to 15 documents (one per file of the account) and each save writes 1 to 3; 20 friends using it daily stay under 2 % of the read limit. Do not upgrade to the Blaze plan; nothing here needs it. GitHub Pages is free for a public repository.

## If something goes wrong
| What you see | Why | Fix |
|---|---|---|
| Yellow "Practice mode" line on the published link | `firebase-config.js` still says `null`, or the page is an older copy | Step 6, then wait 1 to 2 minutes and reload |
| "This web address is not allowed in Firebase yet" | `daklod48.github.io` is not an authorized domain | Step 3.6 |
| "This way of signing in is not switched on in Firebase yet" | A provider is off | Step 3.3 to 3.5 (the demo needs **Anonymous**) |
| "Not allowed by the database rules" | Rules not published, or old rules | Step 5 |
| "The Google window was closed before signing in" | The person closed the pop-up | Try again; on phones the app falls back to a full-page sign-in when pop-ups are blocked |
| Demo accounts pile up under Users | Each demo click makes one anonymous account | Harmless on Spark. To clear: Authentication > Users > tick rows without e-mail > Delete |
