# Dumpr flows, information architecture, cross-platform, roadmap

Source: `Dumpr — UI/UX Blueprint` (v1, Oct 2026). Contents, in order:

1. Core user flows (PDF page 42, section 05): all 12 flows, steps in order with screen IDs, and each EDGE line verbatim.
2. Information architecture and navigation (PDF page 3, section 03).
3. Cross-platform design (PDF page 44, section 07).
4. MVP prioritisation, architecture hooks and key UX risks (PDF page 45, sections 08-09).

Legend printed on page 42: "Step SCREEN", "Decision?" (dashed box), "Done / value moment" (lime). The page also notes: "Mermaid source for every flow ships alongside as dumpr-flows.md".

Step notation below: `→` is the flow arrow. Screen IDs are in parentheses. Decisions are marked **[Decision]**. Value moments are marked **[Done]**.

---

## 1. Core user flows (PDF page 42)

Heading: "05 · CORE USER FLOWS" · "Twelve flows, happy path plus every dead end"

### Flow 01 · New user onboarding

1. Open app or invite link
2. Welcome (A1)
3. Phone + OTP auto-read (A2)
4. Name, @handle, photo (A3)
5. **[Decision]** Pending invite?
   - yes → Invite preview (A4) → Inside the Roll (B3) **[Done]**
   - no → Home with "Start a Crew / Got a link?" (B1)

EDGE No SMS → resend at 0:30, then voice call · number already registered → straight to log-in · invite context survives install (deferred deep link) · photos/camera are NOT requested here — only at first use (A6).

### Flow 02 · Create a Crew and invite

1. Home › New (B1)
2. Create sheet · Crew tab (B5)
3. Name + cover (auto if skipped)
4. Invite sheet (B6)
5. **[Decision]** How? → WhatsApp · Copy link · QR · Contacts (opt-in)
6. Crew home, "2 joined" toast (B2) **[Done]**

EDGE Skip invites → Crew still created, invite banner stays until someone joins · contacts denied → row hidden behind "Find friends" with primer · host can require approval → joiners land in "Requested".

### Flow 03 · Join via in-app invite, QR, link or WhatsApp

1. Tap link / scan QR / Inbox card
2. **[Decision]** App installed?
   - yes → Deep link → Invite preview (A4) → Join → Roll (B3) **[Done]**
   - no → Web page (A5) → **[Decision]** Guest or app?
     - Upload as guest (name only)
     - Store → install → lands on A4

EDGE Expired or revoked link → F6 "Ask for a new link" · approval required → "Requested — we'll tell you" · already a member → opens Roll directly · uploads closed → read-only view · Decline → can reopen until expiry.

### Flow 04 · Import from the phone gallery into an existing or new Crew/Roll

1. Roll › Add, or swipe up in camera
2. **[Decision]** First time? → Primer (A6) → OS prompt
3. Smart import, date window pre-selected (C3)
4. Review / adjust
5. Destination: Roll · Snap · New Roll · New Crew (C2)
6. Upload queue (C4)
7. In the grid (or sealed until reveal) **[Done]**

EDGE iOS limited / Android partial access → "Choose more" · denied → system picker still works · duplicates already in Roll skipped by hash · > 200 photos → suggest Wi-Fi · storage full → F4 with upgrade or free-up.

### Flow 05 · Capture a photo and publish it to a shared gallery

1. Shutter in nav
2. Camera, target = live/last Roll (C1)
3. Shoot (burst allowed)
4. Auto-post + 5 s Undo toast
5. Background upload with credit + stamp
6. Visible to Crew (per reveal mode) **[Done]**

EDGE Offline → kept in Dumpr's local queue, never lost · no Roll yet → destination sheet first · camera denied → primer + Settings · user switches Roll via pill before shooting.

### Flow 06 · Post a daily Snap and show it on members' widgets

1. Hold shutter (or Snap mode)
2. Pick Crew(s) — remembers last
3. Posted to Snaps rail (D1)
4. Silent push to members' devices
5. Widget reloads latest Snap (D2)
6. Friend taps widget → opens Snap **[Done]**

EDGE iOS refresh budget → server push + timeline, worst case shows "2h ago" · Android battery saver → same label · "Blur until unlocked" honoured · Snap deleted → widget falls back to Crew cover.

### Flow 07 · Chat and interact within a Crew

1. Crew › Chat or Inbox (C5 / C6)
2. Text · photo from Roll · voice
3. Long-press → word reactions
4. Reply to a photo from viewer (B4)
5. @mention notifies **[Done]**

EDGE Send fails → clock + Retry · muted Crew → badge only · removed member → keeps nothing, sees "You're no longer in this Crew" · reported message hidden for reporter immediately.

### Flow 08 · Download one photo or an entire gallery

Path A (single photo):
1. Viewer › Save (B4) → Saved to gallery toast **[Done]**

Path B (gallery):
1. Roll › Download all / Select (B3)
2. Scope, quality, destination (F1)
3. Background job + progress notification
4. "Album ready" → open **[Done]**

EDGE Host disabled downloads → explained, owner can still save own · not enough space → split by chapter · app killed → resumes · Ghost photos never included · guests on web → per photo only.

### Flow 09 · Run a Pic Bracket or Multi-Angle Moment

1. Play sheet (D3)
2. **[Decision]** Which?
   - Bracket: host starts (≥ 8 photos) → Timed vote rounds (D4) → Winner = Roll cover **[Done]**
   - Multi-Angle: start 60 s → Push → members shoot (D5) → Angle grid saved to Roll **[Done]**

EDGE Too few photos → tile disabled with reason · tie → coin flip · photo deleted mid-round → bye · late angle → saved as normal photo · members can mute game pushes.

### Flow 10 · Create and reveal a Surprise Roll

1. Play › Surprise Roll
2. Pick honoree (auto-hidden from them)
3. Unlock date + time
4. Invite contributors
5. Photos + voice wishes (D6)
6. 24 h reminder to contributors
7. Unlock: honoree's reveal sequence **[Done]**

EDGE Honoree never sees it in lists, search, Activity or widgets · host leaves → co-host takes over · no contributions by T-24h → host asked to postpone · past date blocked.

### Flow 11 · Generate and share Wrapped or a recap

1. 1 Dec banner / Roll ends
2. Story cards (E2)
3. Optional: render 9:16 video
4. Share to WhatsApp Status / Instagram **[Done]**

EDGE Too few photos → mini edition · people who opted out of face features are never "most photographed" · render fails → slideshow still shareable.

### Flow 12 · Declined invites, expired links, denied permissions, failed uploads, removed content, deleted groups

1. Something goes wrong
2. One-card state (F6: what happened)
3. One primary fix
4. One escape (Home / Back)
5. User never stuck **[Done]**

RULES Never blame the user · keep their data (failed uploads stay local, deleted Crews give 30 days to download) · tell them who did it when it was a person (host removed, Diya deleted) · permissions always have a manual fallback.

(Note: the source labels this line "RULES" rather than "EDGE". It is transcribed as printed.)

---

## 2. Information architecture and navigation (PDF page 3)

Heading: "03 · INFORMATION ARCHITECTURE & NAVIGATION" · "Three slots. Everything else is one level down."

Intro (verbatim): "A floating pill holds Crews · Shutter · Inbox. Your avatar (top-left on Crews) opens You. Crew → Roll → Photo is the only deep stack. Optional features never get a tab — they open from a Play sheet on a Crew or Roll."

### Slot map

| Slot | Root | Child screens (chain as printed) |
|---|---|---|
| Avatar (top-left) | You — "profile · memories · settings" | You (F5): "Wrapped · Crew Passport / My Stickers · Photos of me / Downloads · Storage (F4) / Privacy & safety (F3) / Account & export" |
| Nav slot 1 · Home | Crews — "Snaps rail · invites · live Rolls · Crew cards" | Crew (B2): "Rolls · Snaps · Chat · Lore · Play" → Roll (B3): "Chapters · grid · Add · Download · Chat" → Photo viewer (B4): "swipe · react · voice · save · share" |
| Nav slot 2 · Centre | Shutter — "tap = camera · hold = quick Snap" | Camera (C1): "defaults to the live / last Roll" → Gallery import (C3): "swipe up in camera · Roll › Add" → Destination sheet (C2): "Roll · Snap · new Crew / Roll" |
| Nav slot 3 | Inbox — "badge = unread + pending invites" | Chats \| Activity (C6): "segmented control" → Chat thread (C5) · Invite preview (A4). Deep links: "dumpr.app/r/<code> → Roll or A5 web" |

### Primary destinations

| Destination | Description (verbatim) |
|---|---|
| Crews (home) | Where your people are. Snaps rail, pending invites, a pinned "Live now" Roll, then Crew cards by recent activity. |
| Shutter | Fastest path to sharing. Opens camera targeted at the live Roll; hold to post a Snap. |
| Inbox | Chats across every Crew and Roll, plus Activity: invites, uploads, reactions, reveals. |
| You | Your profile, personal memory features, downloads, storage, privacy and account. |
| Crew | Persistent group home. Tabs: Rolls · Snaps · Chat · Lore. Header: members, Invite, Play. |
| Roll | One event: Chapters, the shared grid, Add, Download all, Chat, Share link. |
| Photo viewer | Full-bleed; credit + stamp; reactions, caption, voice, Hype; save/share; privacy. |

### Bottom sheets (stay in context)

| Sheet | Description (verbatim) |
|---|---|
| Create | New Crew or new Roll; name, cover, dates, Chapters, reveal, lock (B5). |
| Invite | Link, QR, WhatsApp, contacts; link settings (B6). |
| Destination | Where captured or imported photos go (C2). |
| Play | Launcher for all social features on this Crew/Roll (D3). |
| Download | This photo / selected / whole Roll; quality; ZIP vs gallery (F1). |
| Photo actions | Ghost Mode, Lore tag, request removal, report, delete (F2). |
| Roll settings | Host controls: uploads, invites, reveal time, link expiry. |

### Full-screen modals (focused tasks)

| Modal | Description (verbatim) |
|---|---|
| Camera | C1. Dark, edge to edge. Close returns to where you were. |
| Gallery import | C3. Multi-select with smart pre-selection. |
| Pic Bracket · Multi-Angle | D4, D5. Timed game screens. |
| Surprise Roll · Time Capsule | D6. Creator wizard + countdown. |
| Wrapped · Recap | E2. Story-format, tap to advance. |
| Stickers · Then vs Now · Wallpaper | E1, E3, E6. Maker + export. |
| Navigation rules | Sheets dismiss by swipe; modals by ✕ or back. Android system back pops one level everywhere. Tab re-tap scrolls to top. |

---

## 3. Cross-platform design (PDF page 44)

Heading: "07 · CROSS-PLATFORM DESIGN" · "One visual language, native manners"

Intro (verbatim): "Same tokens, components, copy and feature set on iPhone and Android. Each platform keeps its own back behaviour, sheet physics, permission dialogs and system surfaces. Where an OS can't do something, the design degrades in the open — it never pretends."

Widget panels (verbatim):

- **iOS · WidgetKit:** "Small · Medium · Large + Lock Screen circular/rectangular. iOS budgets reloads, so the widget shows a relative "2h" label and reloads when the app wakes for a push. Interactive button: "Snap back" opens camera."
- **Android · App widgets:** "Freely resizable; Dumpr asks the launcher to pin it (one tap). Updates via push + scheduled work, but aggressive battery managers on popular Indian OEM skins can delay them — same "2h" label, plus an optional "keep widgets fresh" tip."

| Area | iOS | Android | Guest web | Design decision |
|---|---|---|---|---|
| Navigation & back | Edge-swipe back; sheets with detents; large-title collapse on scroll. | System back + predictive back gesture; back always pops one level, closes sheets first. | Browser back; single page, no tabs. | Same floating pill on both. No hamburger menus anywhere. |
| Camera | Native capture; consistent hardware. | Wide device variance; very low-end devices fall back to the system camera. | File input with capture (opens phone camera). | Camera never blocks sharing: system camera + import is always a fallback. |
| Gallery access | Full or Limited library; system picker needs no permission. | Android 13+ media permission; 14+ partial "selected photos"; Photo Picker needs none. | System file picker only. | Smart import needs full/limited access; without it, import still works via the picker (no date smarts). |
| Notifications | Permission asked after first join, never on launch. Per-type settings in-app. | Android 13+ runtime permission. One channel per type: Invites, Uploads, Chats, Reveals, Games. | None. Optional email/SMS for "Roll revealed" if guest leaves a number. | Upload notices batched hourly on both platforms. |
| Background upload | Background transfer session continues while suspended; large queues may be throttled by the OS. | Scheduled work + visible progress notification for long batches. | Tab must stay open; chunks resume if the page reloads. | Chunked, resumable uploads everywhere; queue persists across app restarts. |
| Downloads | Add-only Photos access; creates album per Roll. ZIP to Files. | Saved to Pictures/Dumpr/<Roll>. ZIP to Downloads. | Per-photo save; "Get the app for the whole Roll". | Whole-Roll download is an app feature — the key install reason for guests. |
| Links & install | Universal Links; deferred deep link through install. | Verified App Links; deferred deep link through install. | Every link opens here when the app is missing. | One URL format: dumpr.app/r/<code> and dumpr.app/c/<code>. |
| No-install join | Optional App Clip later (P3). | Instant Apps no longer an option. | The universal no-install path. | Invest in the web page, not platform-specific instant experiences. |
| Contacts | Full or limited contacts access (newer iOS). | Runtime permission. | — | Optional, hashed, never uploaded raw. Links/QR always work without it. |
| Stickers | Export pack to WhatsApp via its sticker integration; Instagram via share to Stories. | Same, via WhatsApp's sticker integration and share intents. | — | Exported packs leave Dumpr — consent screen says so before first export. |
| Wallpaper | Apps can't set wallpaper: save to Photos + 3-step guide. | Can set home/lock wallpaper directly after confirmation. | — | Same button label "Save wallpaper"; next step differs. |
| Face features | On-device detection where possible. | On-device detection where possible. | Not available. | Per-person opt-in; data deleted within 24 h of opt-out on both. |
| Haptics & motion | Fine-grained haptics on shutter, vote, reveal. | Basic vibration on most devices; skipped where weak. | None. | Haptics are garnish; nothing depends on them. |

---

## 4. MVP prioritisation, hooks and risks (PDF page 45)

Heading: "08 · MVP PRIORITISATION & ROADMAP" · "Ship the shared roll first. Earn the fun."

### MVP · Launch: "Join, share, keep"

- Phone OTP + Apple/Google sign-in; profile
- Crews, Rolls, Chapters
- Invite: link, QR, WhatsApp, optional contacts
- In-app invites with Join / Preview link
- Guest web join + upload
- Camera into live Roll; destination picker
- Smart gallery import with approval
- Resumable uploads, de-dupe, Wi-Fi only
- Gallery grid, viewer, captions, credits, stamps
- Save one · selected · whole Roll
- Crew + Roll chat, reactions, replies
- Inbox, notifications (batched)
- Live reveal only
- Roles, host controls, per-photo visibility, removal request, report, moderation queue
- Storage view, export, delete account

Footer (verbatim): "Every item serves the two promises: anyone can join in seconds, and everyone ends up with the full set in full quality."

### Phase 2 · Retention: "Come back daily"

- Daily Snaps + iOS/Android widgets
- Weekly Crew Drop, forgiving streak
- End-of-event / next-morning reveal
- Time Capsules (same lock engine)
- Play sheet goes live
- Pic Bracket + Crew Awards
- Multi-Angle Moment
- Surprise Roll
- Voice notes on photos
- Hype Notes with abuse controls
- Ghost Mode
- Lore Tags + search + smart albums
- Crew Passport (photo location)

Footer (verbatim): "Turns event usage into weekly usage between events. Mostly reuses MVP plumbing: reveal timer, voting, tags, pushes."

### Phase 3 · Advanced: "Delight at scale"

- Face-feature consent centre
- Friend Stickers + WhatsApp/Instagram export
- Photo Discovery ("photos of me")
- Then vs Now
- AI Recaps (slideshow + 9:16 video)
- Dumpr Wrapped (December)
- Crew Wallpaper
- Optional App Clip for guests
- Hindi, Kannada, Tamil, Telugu, Marathi UI

Footer (verbatim): "Costly ML, rendering and consent work. Each needs real photo volume to feel magical — so it waits until Crews have history."

### Architecture hooks the MVP must already have

- **Roll.reveal_at / locked_until** — Live = now; P2 just sets a time.
- **Photo.visibility** enum — everyone · selected people · only me.
- **Per-person consent flags** — face, stickers, discovery; default off.
- **Play button slot** on Crew/Roll — hidden at MVP, no nav change later.
- **Activity events** — one feed powers Inbox, pushes, widgets, Wrapped.
- **Tags table** — Chapters now, Lore Tags later.

### 09 · Key UX risks and recommended solutions

Heading: "09 · KEY UX RISKS & RECOMMENDED SOLUTIONS" · "What could go wrong, and the design answer"

| # | Risk | Why it hurts | Design response |
|---|---|---|---|
| 01 | Empty-app cold start | A new user with no Crew sees nothing to do. | Most users arrive by link, so onboarding lands inside a Roll. Home never shows an empty list: "Start a Crew" + "Got a link?" + import nudge for last weekend's photos. |
| 02 | Permission denial | Denied photos/camera kills import and capture. | Just-in-time primers (A6); every permission has a manual fallback (system picker, system camera); Settings deep link only after a denial. |
| 03 | People who never consented | Wedding guests appear in photos uploaded by others. | Request removal on any photo you're in; Ghost Mode; hosts moderate; face features opt-in per person; no public profiles or discovery outside Crews. |
| 04 | Notification flood | 1,200 wedding photos = 1,200 pings, then uninstall. | Upload notices batched hourly; per-Roll mute; Android channels; only invites, mentions, reveals and games are instant. |
| 05 | Uploads failing on patchy data | Lost photos destroy trust permanently. | Local queue survives restarts; chunked resumable uploads; Wi-Fi-only switch; visible per-photo status; never delete local originals automatically. |
| 06 | Feature bloat | 15 social features can bury the core. | Three nav slots only; every extra lives in the Play sheet; phase-gate with flags; each Play tile states what it needs ("needs 8 photos"). |
| 07 | Delayed reveal confusion | "Where did my photos go?" | Sealed tile state, countdown on Roll, camera and Inbox; uploader always sees own photos with a lock badge. |
| 08 | Surprise Roll leaks | One stray push ruins the surprise. | Honoree excluded server-side from lists, search, Activity, widgets, Wrapped and chat previews; contributors warned before sharing outside Dumpr. |
| 09 | Anonymous Hype Notes abused | Anonymity invites bullying. | Preset positive phrases only (no free text); rate limits; owner can turn off per photo; reports reveal sender to moderators. |
| 10 | Streak anxiety | Guilt mechanics feel manipulative. | Weekly, not daily; 1 free skip/month; no "you lost your streak" pushes; copy celebrates, never shames. |
| 11 | Stickers can't be recalled | Once in WhatsApp, a sticker is out of Dumpr's control. | Only opted-in friends; one-time export consent sheet; friend can opt out of future packs at any time. |
| 12 | Guest uploads at big events | Strangers can post anything. | Host can switch guest uploads to "review first"; report; hosts can hide a guest's uploads in one action. |
| 13 | Mixed iPhone/Android formats | HEIC and Live Photos confuse Android users. | Originals stored; download offers "High · JPG" by default on Android; Live Photos saved as still + optional video. |
| 14 | Storage costs vs "full quality" | Unlimited originals isn't sustainable. | Clear plan limits in F4; "free up space on phone" as a benefit; retention notice 30 days before any removal; [PLAN LIMITS] still to be set. |
