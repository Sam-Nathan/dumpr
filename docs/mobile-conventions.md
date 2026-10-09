# Mobile conventions (apps/mobile)

Owner: mobile foundation (track A). Tracks B (crews / rolls / viewer / invites) and C+F (camera /
import / chat / inbox / downloads / privacy / storage) build on this. Contract: `docs/architecture.md`.
Product: `docs/blueprint/*.md`.

## 1. Rules (non-negotiable)

- **One lime button per screen** (`<Button variant="primary">`). Everything else is strong / secondary /
  tertiary / destructive. Sheets and modals count as their own screen.
- **Every screen has empty, loading and error states** exactly as `docs/blueprint/screens.md` lists them.
  Loading = `Skeleton` (in the screen's tint where the design shows tints), never a lone spinner for content.
- **Dead ends use `EdgeState`** (F6): icon chip, headline, one sentence, one primary fix, one escape.
  Copy comes from `edge.*` presets or `errorCopy(code)`. Never blame the user; name the person when a
  person did it ("Diya took it down"); keep their data.
- **Toasts** (`toast.show`) are for confirmations with at most one action (Undo). Never for errors that
  need a decision. **Dialogs** (`confirmDialog`) only for irreversible actions: verb on the button,
  consequence in the body.
- **Disabled buttons always carry `disabledReason`** (no silent grey buttons).
- **Permissions only at the moment of use, always through `PermissionPrimer` (A6)**, with a manual
  fallback (system picker / paste / gallery). Denied → inline card with Open Settings.
- **Android back pops one level everywhere.** Sheets dismiss first. Intercept only for in-screen steps
  or modes via `Screen onHardwareBack` / `useBackHandler`.
- Min touch target 44 × 44 (kit handles it), pressed scale 0.96 / 80 ms (kit), haptics are garnish.
- Use the kit `Text` (never RN `Text`) and token classes (`bg-paper dark:bg-paper-dark`, `text-ink …`).
  Every colour needs its `dark:` pair. Tailwind class strings must be literal (no string building of
  colour names) — use `TINT_BG[tint]` for crew tints.
- Imports: `@/…` alias (= `src/`). Pure modules (`src/lib/*`, `src/data/signedUrlCache.ts`,
  `src/data/profileGate.ts`) must not import React Native; they are unit-tested with vitest.

## 2. UI kit (`import { … } from '@/ui'`)

| Component | Props (main) | Notes |
|---|---|---|
| `Text` | `variant: displayXl\|display\|title\|heading\|body\|caption\|stamp`, `tone: default\|secondary\|tertiary\|danger\|success\|shutter\|flash\|inverse\|onFlash`, `heading` | Sizes from tokens.json. Display variants cap font scale at 1.3×. `body` defaults to ink-2, `caption` to ink-3, `stamp` to shutter mono caps. `inverse` = light text on always-dark screens. |
| `Button` | `label, onPress, variant: primary\|strong\|secondary\|tertiary\|destructive, size: sm\|md\|lg, loading, disabled, disabledReason, icon, fullWidth, onDark` | `lg` is full width by default. Reason shows beside (inline) or below (full width). |
| `IconButton` | `icon, label (required), onPress, variant: soft\|ink\|flash\|ghost\|onDark, size` | Round. |
| `PressableScale` | Pressable props + `className` (surface), `wrapperStyle` (layout), `style`, `haptics`, `scaleTo` | Base of everything tappable. |
| `Icon` | `name: IconName, size, color, strokeWidth` | SVG, Lucide-style. Add glyphs in `src/ui/Icon.tsx`. |
| `Screen` | `header?: HeaderProps, scroll, padded, dark, footer, bottomInset, onHardwareBack` | Safe area + paper bg. Primary action goes in `footer`. |
| `Header` | `title, eyebrow, back, close, onBack, left, right, inverse` | Back = `goBack()` (pop or Home). |
| `useSheetOptions(detents)` / `SheetContent` | detents `auto\|half\|halfAndFull\|tall\|full`; `SheetContent {title, eyebrow, closeButton, right, footer, scroll}` | formSheet routes: grabber, 32 px corners. |
| `toast` / `ToastHost` | `toast.show({ message, action?: {label, onPress}, durationMs? })` | 5 s, above the nav pill. Host mounted in root. |
| `Dialog` / `confirmDialog` | `confirmDialog({ title, body, confirmLabel, cancelLabel?, destructive? }) → Promise<boolean>` | Host mounted in root. |
| `Chip` | `label, count, selected, onPress, tone: outline\|ink\|lime\|tint, mono, icon, onDark` | Selected outline → ink (state also in a11y). |
| `ReactionChip` | `kind: ICONIC\|LMAO\|CRYING\|HEART\|SAME, count, selected, onPress, onLongPress` | Words, not emoji. |
| `Stamp` | `date \| text, seconds, time, variant: plain\|chip, size 11–15` | `14 03 '26 · 07:42:10`. |
| `Avatar` | `name, uri? \| avatarKey?, size, ring: lime\|lilac\|sky\|peach\|none, tint, badge` | Initials on a stable "random" tint; `avatarKey` is signed via the batched cache. |
| `Facepile` | `people: {name, avatarKey?, avatarUrl?, ring?}[], total, max=3, size` | "DI AR KS +3". |
| `PhotoTile` | `photoId \| uri, variant: thumb\|display, blurhash, state: default\|selected\|uploading\|failed\|duplicate\|sealed, progress, aspectRatio, selectable, onPress, onLongPress, onRetry, label` | expo-image, `cacheKey = photoId:variant`, `recyclingKey = photoId`, blurhash placeholder. |
| `DumpStack` / `SampleArtwork` | `cards: {uri?, cacheKey?, blurhash?, art?, stamp?, blurred?}[] (≤4), aspectRatio, cardAspect, animated` | Tilted prints (Welcome, A4 cover, Crew cards). |
| `EdgeState` + `edge.*` | `icon, tone, title, body, primary?, secondary?, layout: card\|screen` | Presets: `inviteExpired(host)`, `inviteRevoked`, `inviteFull`, `inviteNotFound`, `inviteDeclined(name)`, `requested(name)`, `permissionDenied(kind)`, `uploadsFailed(n)`, `photoRemoved(who)`, `crewDeleted(crew, who)`, `removedFromCrew(crew, who)`, `offline()`, `fromError(e)`. Demo: `/dev/edge-states`. |
| `PermissionPrimer` | `kind: photos\|camera\|contacts\|notifications, context?: {rollName, dates}, request(), check?(), onGranted(outcome), onNotNow, onPickManually?, initialDenied, pickManuallyLabel` | Use `toPermissionOutcome(expoPermissionResponse)` in `request`/`check`. |
| `Skeleton` | `width, height, radius, className` | Shimmer; static with Reduce Motion. |
| `NavPill` | `active, inboxBadge, onCrews, onInbox, onShutter, onShutterLongPress` | Mounted by `(main)/_layout`. Lists pad with `useNavClearance()`. |
| `TextField` | TextInput props + `label, labelHint, error, helper, left, right` | 52 px, focus border. |
| `OtpBoxes` | `value, onChange, onComplete, length=6, error, shakeKey, disabled, autoFocus` | One hidden input: paste + `oneTimeCode` / `sms-otp` autofill. |
| `LogoMark` | `size, tile` | brand/mark.svg. Lime/ink only. |
| `StubScreen` / `StubSheet` | `title, screenId, todo, modal` | Placeholders; replace when you build the screen. |
| helpers | `useColors()`, `useScheme()`, `TINT_BG`, `RING_HEX`, `tintFor(seed)`, `haptic.*`, `goBack()`, `useBackHandler()` | |

Nav store (`@/state/nav`): `useNavStore.getState().setInboxBadge(n)` (C+F), `useNavRetap('crews' | 'inbox', scrollToTop)`.

## 3. Data layer (`@/data`)

- `supabase` – the single client (encrypted session storage, PKCE).
- `queryClient` – app-wide TanStack client (retries only network / server hiccups; nothing persisted yet).
- `useSession()` → `{ session, user, isGuest, isLoading }` (live via `onAuthStateChange`; sign-out clears
  the query cache and URL caches). `getSessionSnapshot()` for imperative code.
- `useProfile()` / `useUpdateProfile()` – own `profiles` row (`['profile', userId]`).
- `useAuthGate()` – `loading | signed-out | needs-profile | ready | error` (used by the root layout).
- `rpc<T>(name, args)` – throws `AppError { code }` (P0001 snake codes, `network`, `timeout`…).
- `callFunction<T>(name, body?, { method, query, timeoutMs })` – Edge Functions with
  `Authorization: Bearer <access token>` + `apikey`; parses `{ error: { code } }` into `AppError`.
- `useSignedUrls([{ photoId, variant }])` → `{ 'photoId:variant': url }`, `useSignedUrl(photoId, variant)`,
  `useAvatarUrls(keys)` / `useAvatarUrl(key)`, `getSignedUrl(photoId, variant)` (non-hook). Requests from
  all components within one 16 ms tick become ONE `media-sign` call (≤ 300 keys per call); URLs are
  cached in memory until `expires_at − 5 min`; unavailable keys are not re-requested; failures back off 8 s.
  Always pass `cacheKey = photoId:variant` to expo-image (PhotoTile does), never key by URL.
- Types for RPC results: `src/data/types.ts` (narrow, hand-written until `@dumpr/db` types are generated).
- Errors: `src/lib/errors.ts` – `AppError`, `toAppError(e)`, `errorCopy(code) → {title, message}`,
  `friendlyMessage(e)`, `isRetryable(e)`. Every §5 RPC code and function code has copy.
- Format: `src/lib/format.ts` – `formatBytes`, `formatDateRange('2026-03-12','2026-03-15') → "12–15 Mar"`,
  `formatRelative → "2h"`, `formatStamp → "14 03 '26 · 07:42:10"`, `formatCountdown`, `formatResend`,
  `formatCount`, `pluralize`, `initials`, `parseDay` (Postgres `date` without timezone shift).
- Deep links: `src/lib/deeplinks.ts` – `parseInviteLink`, `inviteHref`, `inviteUrl(code, kind)`.
- Features: `@/features/invites` (`useInvitePreview`, `joinViaInvite`, `joinedHref`, `usePendingInvite`,
  `InviteLinkSheet`), `@/features/auth` (`signInWithProvider`, `sendPhoneOtp`, `verifyPhoneOtp`,
  `continueAsGuest`, `signOut`), `@/features/notifications/register` (`maybeRegisterForPush`,
  `requestPushPermissionAndRegister`, `ANDROID_CHANNELS`), `@/features/uploads` (upload engineer).

### Query keys

| Key | Data |
|---|---|
| `['profile', userId]` | own profile row |
| `['home-feed']` | `home_feed()` (B1) |
| `['crew', crewId]` | `crew_overview(crewId)` (B2) |
| `['roll-header', rollId]` | `roll_header(rollId)` (B3) |
| `['roll-photos', rollId, chapterId \| null]` | keyset-paged grid (infinite query) |
| `['photo', photoId]` | single photo (viewer) |
| `['reactions', photoId]` | `photo_reaction_counts` |
| `['invite-preview', code]` | `invite-preview` function (A4) |
| `['inbox-threads']` | `inbox_threads()` (C6 Chats) |
| `['activity']` | `activity_events` (C6 Activity) |
| `['messages', threadKey]` | chat thread (`c:<crew>` / `r:<roll>`) |
| `['my-storage']` | `my_storage()` (F4) |
| `['my-profile-stats']` | `my_profile_stats()` (F5) |

Invalidate the narrowest key after a mutation; uploads invalidate `['roll-photos', id]` and `['roll-header', id]`.

## 4. Routes (`src/app`)

| Path | File | Screen | Owner |
|---|---|---|---|
| `/welcome` `/phone` `/profile` | `(onboarding)/*` | A1 · A2 · A3 | A (done) |
| `/` | `(main)/index.tsx` | B1 Home (placeholder) | B |
| `/inbox` | `(main)/inbox.tsx` | C6 (placeholder) | C+F |
| `/crew/[id]` | `crew/[id].tsx` | B2 | B |
| `/roll/[id]` | `roll/[id].tsx` | B3 | B |
| `/photo/[id]` | `photo/[id].tsx` (modal) | B4 | B |
| `/invite/[code]` | `invite/[code].tsx` | A4 (done; public) | A |
| `/camera` | `camera.tsx` (fullScreenModal) | C1 | C+F |
| `/import` | `import.tsx` (fullScreenModal) | C3 | C+F |
| `/uploads` | `uploads.tsx` | C4 | C+F |
| `/chat/[thread]` | `chat/[thread].tsx` | C5 | C+F |
| `/you` `/you/privacy` `/you/storage` `/you/edit` | `you/*` | F5 (minimal) · F3 · F4 · edit | C+F |
| `/sheets/create` `invite` `destination` `download` `photo-actions` `roll-settings` | `sheets/*` (formSheet) | B5 · B6 · C2 · F1 · F2 · settings | B / C+F |
| `/sheets/notifications` | push primer (A6) | A |
| `/auth/callback` | OAuth return | A |
| `/dev/kit`, `/dev/edge-states` | kit + F6 catalogue (linked from You in `__DEV__`) | A |

Gate (root `_layout.tsx`): no session → onboarding; session + non-guest profile without handle (or
default name) → `/profile`; otherwise the app. `invite/[code]` and `auth/callback` are reachable in any
state. Incoming `https://dumpr.app/r|c/<code>` and `dumpr://r|c/<code>` are rewritten to `/invite/<code>`
in `src/app/+native-intent.tsx`. A pending invite (opened signed out, then Join) is persisted
(`usePendingInvite`), shown on A1/A2/A3, offers "Continue as guest" when allowed, and after sign-up the
gate opens `/invite/<code>?autojoin=1`, which joins and lands in the Roll.

### Adding a sheet route

1. Create `src/app/sheets/<name>.tsx` rendering `<SheetContent title=… footer={<Button variant="primary" …/>}>`.
2. Register it in `src/app/_layout.tsx` inside the `ready` `Stack.Protected` with
   `options={sheet}` (or `tallSheet` / `fullSheet`, from `useSheetOptions(...)`).
3. Open with `router.push({ pathname: '/sheets/<name>', params: { rollId } })`; close with `goBack()`.

### Adding a screen

Create the file under `src/app`, register it in the root Stack (inside the right `Stack.Protected`),
wrap in `<Screen header={{ title, back: true }}>`, and implement empty / loading / error states.

## 5. Copy rules

Say what happened, offer one way out. No "invalid", "error", "failed to" in headlines; no raw codes.
Reactions are words. Wordmark always lowercase "dumpr". Crews, Rolls, Chapters, Snaps are capitalised
product nouns.

## 6. Setup notes

- OAuth (Google / Apple via web flow): add `dumpr://auth/callback` and the Expo Go URL
  (`exp://<host>/--/auth/callback`) to Supabase Auth → URL configuration → Redirect URLs.
- Push needs a dev / production build with `extra.eas.projectId`; in Expo Go registration is skipped.
- Tests: `pnpm --filter @dumpr/mobile test` (vitest, pure modules only).
