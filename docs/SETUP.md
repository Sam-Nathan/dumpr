# Dumpr: one-time setup (the parts only you can do)

Everything in code is done. These steps need your accounts. Do them in order; each one says what it unlocks.

| # | Step | Unlocks | Time |
|---|---|---|---|
| 1 | GitHub repo | code backup, CI | 2 min |
| 2 | Supabase auth settings | sign-in on your phone | 5 min |
| 3 | Cloudflare R2 bucket + keys | photo uploads and downloads | 10 min |
| 4 | MSG91 (OTP SMS) | real phone OTP for everyone (until then, use test numbers) | 1–3 days for DLT |
| 5 | Expo account + dev build | camera, background upload, push on your phone | 30 min |
| 6 | Domain `dumpr.app` + Vercel | invite links, guest web upload, WhatsApp previews | 20 min |

---

## 1. GitHub repo

1. Create an **empty private** repo named `dumpr` at https://github.com/new (owner `Sam-Nathan`, no README).
2. Make sure the Claude GitHub App can see it: https://github.com/apps/claude/installations/select_target → your account → *Repository access* → add `dumpr` (or "All repositories").
3. Tell Claude "repo is ready". Claude pushes the `main` branch.

## 2. Supabase auth settings (project **Dumpr**, ref `evxufdovegjrlwpxfmhl`)

Dashboard: https://supabase.com/dashboard/project/evxufdovegjrlwpxfmhl

1. **Authentication → Sign In / Providers**
   - **Allow anonymous sign-ins: ON** (guests joining a Roll from a link).
   - **Phone: ON**. Any SMS provider value is fine for now; step 4 replaces it with the MSG91 hook.
   - **Test phone numbers** (under Phone): add `919999900001=123456` (and more if you like). Sign in on the app with `+91 99999 00001` and code `123456` without any SMS being sent.
   - Google / Apple: optional now (see "Later" below).
2. **Authentication → URL Configuration**: add redirect URLs `dumpr://auth/callback`, `exp://**` (Expo Go) and `https://dumpr.app/**`.

## 3. Cloudflare R2 (photo storage, no egress fees)

1. Cloudflare dashboard → **R2** → *Create bucket* `dumpr-media` (location hint: Asia-Pacific). Keep it **private**.
2. Bucket → **Settings → CORS policy** → paste:
   ```json
   [{ "AllowedOrigins": ["https://dumpr.app", "https://www.dumpr.app", "http://localhost:3000"],
      "AllowedMethods": ["GET", "PUT", "HEAD"], "AllowedHeaders": ["*"], "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3600 }]
   ```
3. R2 → **Manage API tokens** → *Create API token* → permission **Object Read & Write**, scoped to `dumpr-media`. Copy the *Access Key ID*, *Secret Access Key* and your *Account ID*.
4. Supabase → **Edge Functions → Secrets** → add:
   `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET=dumpr-media`.
   Until these exist, the app shows "Uploads are paused" instead of failing.

## 4. MSG91 (OTP SMS in India)

1. Sign up at https://msg91.com, complete KYC.
2. India requires **DLT registration** (entity + sender ID + template) on a DLT portal (Jio/Airtel/Vodafone). Template text, for example:
   `<#> {#var#} is your Dumpr code. It expires in 10 minutes. {#var#}`
   (the last variable is the Android app hash for auto-read).
3. In MSG91 create a **Flow/OTP template** linked to that DLT template; note the *Template ID*, *Sender ID* and your *Auth key*.
4. Supabase → **Authentication → Hooks → Send SMS hook** → type **HTTPS** → URL
   `https://evxufdovegjrlwpxfmhl.supabase.co/functions/v1/send-sms-msg91` → *Generate secret* → copy it.
5. Supabase → Edge Functions → Secrets: `SEND_SMS_HOOK_SECRET` (the generated `v1,whsec_…` value), `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`, `MSG91_SENDER_ID`, and later `MSG91_ANDROID_HASH`.

## 5. Expo (preview on your Android phone)

See `docs/PREVIEW.md`. Short version: Expo Go for most screens now; an EAS **development build** APK for the camera, background upload and push.

## 6. Domain + website

1. Buy `dumpr.app` (or another domain; then change `EXPO_PUBLIC_WEB_URL`, `NEXT_PUBLIC_SITE_URL`, app.json `associatedDomains` / `intentFilters`).
2. Vercel → *New project* → import the `dumpr` repo → Root directory `apps/web` → env vars from `apps/web/.env.example`.
3. After the first Android build: set `ANDROID_SHA256_CERT_FINGERPRINTS` (from `eas credentials`) and, once you have an Apple developer account, `APPLE_TEAM_ID` in Vercel, so `https://dumpr.app/r/<code>` opens the app directly.

## Limits you still need to decide

Plan limits are stored in the database, not in code. To set a storage limit (example: 15 GB per user), run in Supabase → SQL editor:
```sql
update app_settings
set value = jsonb_set(value, '{storage_bytes_per_user}', to_jsonb(15::bigint * 1024 * 1024 * 1024))
where key = 'limits';
```
`null` means "no limit yet" (the current setting). Other keys in the same row: `max_photo_bytes`, `invite_ttl_days`, `deleted_crew_grace_days`, `guest_max_photos_per_roll`.

## Later

- **Google sign-in**: Google Cloud → OAuth client (Web) → Supabase → Providers → Google (client id/secret).
- **Apple sign-in**: needs the Apple Developer Program ($99/yr); also needed for iPhone builds/TestFlight.
- **Push on iOS**: APNs key via `eas credentials` (Apple account needed). Android push works with the EAS-managed FCM key: `eas credentials` → Android → FCM V1 service account (from Firebase project settings).
