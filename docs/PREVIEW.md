# Preview Dumpr on your Android phone

The app talks to the live Supabase project (**Dumpr**, `evxufdovegjrlwpxfmhl`), so your phone and PC only need internet. No local database.

Before the first run, do steps 2 and 3 of [`docs/SETUP.md`](SETUP.md): Supabase auth settings (anonymous sign-ins on, phone on, a **test phone number** like `919999900001=123456`) and the Cloudflare R2 bucket (without it, everything works except uploads and photos show "Uploads are paused").

## One-time setup on your PC (Windows)

1. Install **Node.js 22 LTS** (https://nodejs.org) and **Git** (https://git-scm.com/download/win).
2. In **PowerShell**:
   ```powershell
   npm install -g pnpm@10
   git clone https://github.com/Sam-Nathan/dumpr.git
   cd dumpr
   pnpm install
   ```

## Option A: Expo Go (fastest, most screens)

1. Install **Expo Go** from the Play Store.
2. On the PC:
   ```powershell
   cd dumpr\apps\mobile
   pnpm start
   ```
3. Scan the QR code with Expo Go. Phone and PC on the same Wi-Fi; if it won't connect (office/college Wi-Fi), run `pnpm start --tunnel`.
4. Sign in with the test number `+91 99999 00001`, code `123456`.

**Works in Expo Go:** welcome, phone sign-in, profile, Crews, Rolls, the photo grid and viewer, reactions, captions, invites + QR + WhatsApp share, joining by link, camera, picking photos from the gallery, the upload queue (incl. resume after restart and Wi-Fi-only), chat, inbox, You, privacy, storage. Saving to the gallery usually works too, but Expo Go has limited media-library access on newer Android versions; if Save fails there, use Option B.

**Needs the development build (Option B):** push notifications, background uploads while the app is closed, "smart" gallery import by date (Expo Go only gets the system picker), saving whole Rolls into a named album on Android 13+.

## Option B: development build (everything)

1. Create a free account at https://expo.dev.
2. On the PC:
   ```powershell
   npm install -g eas-cli
   eas login
   cd dumpr\apps\mobile
   eas init                      # links the app to your Expo account (one time; adds the projectId to app.json)
   eas build -p android --profile development
   ```
3. After about 10–20 minutes, open the build link on your phone and install the APK (allow "install unknown apps" for your browser).
4. From then on: `pnpm start --dev-client`, then open the **Dumpr** app (not Expo Go). Code changes reload instantly.
5. Push notifications: `eas credentials` → Android → *Google Service Account / FCM V1* → upload the service-account JSON from a Firebase project (Project settings → Service accounts). Then rebuild once.

## Option C: shareable preview APK (no PC needed to run)

`eas build -p android --profile preview` gives an APK you can install on any Android phone and send to friends for testing. It runs the bundled JavaScript (no Metro server).

## Testing with two people

Invite links need the website. Until `dumpr.app` is live, test invites inside the app: on phone A create a Crew → Roll → Invite → **Copy link**; on phone B tap **I have an invite link** on the welcome screen and paste it. Use a second test number (add `919999900002=123456` in Supabase).

## Troubleshooting

| Problem | Fix |
|---|---|
| "Sign-in failed" on the test number | Supabase → Auth → Providers → Phone must be ON and the test number saved exactly as `919999900001`. |
| Photos stay "Uploads are paused" | R2 secrets missing (SETUP.md step 3). |
| Upload fails with 403 | R2 CORS policy missing, or the R2 token isn't scoped to the bucket. |
| QR scan opens nothing | Use `pnpm start --tunnel`. |
| Fonts look default for a second | Normal on first load in Expo Go; they're cached after. |
