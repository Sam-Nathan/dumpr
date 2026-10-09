# Dumpr product overview

Source: `Dumpr — UI/UX Blueprint` (v1, Oct 2026), PDF pages 1-2 (sections 01 and 02). Copy is verbatim from the page.

Tagline on cover: "Everyone's photos. One place. No chasing."
Cover description (verbatim): "A camera-first social memory app for Crews — the friends, families and wedding parties whose best photos are always stuck on someone else's phone."

---

## 01 · Product vision

Headline (verbatim): "Make the group's camera roll as easy as the group chat."

Body (verbatim): "Every trip, wedding and fest ends the same way: hundreds of photos on a dozen phones, a WhatsApp group full of compressed copies, and nobody with the full set. Dumpr makes the shared roll the default. Shoot in Dumpr or import from your gallery, and every photo lands — full quality — in one place everyone can see, react to, chat about and download."

Audience tags (as printed): Friend groups · Trips · Indian weddings · College fests · Couples · Families · Everyday life

### The five nouns

| Noun | Definition (verbatim) |
|---|---|
| Crew | Your people. A persistent, private group — "Hostel Block C", "Kulkarni Family". Has members, chat, Snaps and Rolls. |
| Roll | One event inside a Crew — "Goa '26", "Ananya × Rohan". Shared camera + gallery + chat. Can have Chapters (Haldi, Mehendi, Sangeet, Reception). |
| Snap | An everyday photo posted straight to a Crew. Feeds the home-screen widget. Fades from the rail after 24 h, kept in the Crew's Snaps archive. |
| Drop | The Weekly Crew Drop — one optional photo per person, every Sunday. Forgiving streak. |
| Play | The optional social layer — Bracket, Multi-Angle, Surprise Roll, Wrapped and more. One sheet, never in the way. |

---

## 02 · Design principles

Nine principles appear on page 1. The bottom row's body text is clipped at the page edge in the PDF and is not present in the text layer, so it is marked TBD.

| Principle | Body (verbatim) |
|---|---|
| Link → first photo in 60 seconds (highlighted lime card) | Guests join a Roll from a web page with no install. Account creation waits until someone wants to keep, chat or create. |
| Ask only at the moment of use | Camera, photos, contacts and notifications are each requested when the feature is tapped, after a one-screen primer saying why. |
| Never force invites or contacts | Every invite step has Skip. Link, QR and WhatsApp come first; contact matching is opt-in and hashed. |
| Import is a front door | Gallery sits beside the shutter, inside every Roll's Add button, and as a smart nudge when an event ends. |
| Download is never hidden | Save one from the viewer, save a selection from the grid, save the whole Roll from its header. Always ≤ 3 taps. |
| Private by default, consent per person | Crews and Rolls are invite-only. Face features (Stickers, Discovery, Then vs Now) need each person's own opt-in. |
| Photos first, chrome second | TBD (unreadable: body text clipped at page edge) |
| Core is navigation, fun is a sheet | TBD (unreadable: body text clipped at page edge; title wraps to "sheet") |
| Made for India (dark card) | TBD (unreadable: body text clipped at page edge; partial text "WhatsApp-native sharing, wedding Chapters…" is cut off) |

---

## 03 · Feature inventory by module (page 2)

Heading (verbatim): "Every requested feature, where it lives, when it ships"

Intro (verbatim): "Screen IDs (A1, B3 …) point to the mockups below. Nothing from the brief is dropped — later-phase items keep their slot in the architecture so they slot in without new navigation."

Tag key: **MVP** = Launch · **P2** = Retention · **P3** = Advanced.

### A · Crews, Rolls & Invites

| # | Feature | Tag | Description (verbatim) | Screens |
|---|---|---|---|---|
| A-1 | Crews + multiple Rolls | MVP | Persistent Crew, event Rolls inside. | B1, B2, B5 |
| A-2 | Invite by link · QR · WhatsApp · contacts | MVP | One sheet; link first, contacts optional. | B6 |
| A-3 | In-app invites: Join / Join via link | MVP | Inbox card + push; preview before joining. | A4, C6 |
| A-4 | Guest web join & upload | MVP | dumpr.app/r/code — name + upload, no install. | A5 |
| A-5 | New group from gallery import | MVP | Destination picker offers New Crew / New Roll. | C2, C3 |
| A-6 | Mixed iOS + Android Crews | MVP | Same features; deep links resolve on both. | §7 |
| A-7 | Multi-day Chapters | MVP | Haldi · Mehendi · Sangeet · Reception chips in a Roll. | B3, B5 |

### B · Shared camera & gallery

| # | Feature | Tag | Description (verbatim) | Screens |
|---|---|---|---|---|
| B-1 | Group camera + collaborative gallery | MVP | Shoot into the active Roll; everyone's shots merge. | C1, B3 |
| B-2 | View · download · save · share one photo | MVP | Viewer action bar. | B4 |
| B-3 | Batch download whole Roll | MVP | Roll header + select mode; ZIP or straight to gallery. | F1 |
| B-4 | Smart import by event time | MVP | Pre-selects photos taken during the Roll; user approves. | C3 |
| B-5 | Captions, credits, timestamps | MVP | Credit + date stamp on every photo. | B4 |
| B-6 | Sort, duplicates, upload progress, storage controls | MVP | Hash de-dupe, resumable queue. | B3, C4, F4 |
| B-7 | Reveal: live / end of event / next morning | P2 | MVP ships Live; delayed reveal reuses Time Capsule lock. | C4 |
| B-8 | Voice notes on photos | P2 | ≤ 30 s, waveform chip in viewer. | B4 |
| B-9 | Albums & search | P2 | Smart albums (people, places, Lore). | E5 |

### C · Daily sharing & widgets

| # | Feature | Tag | Description (verbatim) | Screens |
|---|---|---|---|---|
| C-1 | Daily Snaps to a Crew | P2 | Long-press shutter = Snap to last Crew. | D1 |
| C-2 | Home-screen widget (iOS + Android) | P2 | Opt-in, per Crew, latest Snap. | D2, §7 |
| C-3 | Weekly Crew Drop | P2 | One photo each, Sundays; streak survives 1 miss/month. | D1 |
| C-4 | Crew Wallpaper | P3 | Collage generated from the Crew's top photos. | E6 |

### D · Group communication

| # | Feature | Tag | Description (verbatim) | Screens |
|---|---|---|---|---|
| D-1 | Chat per Crew and per Roll | MVP | Text, photos, reactions, replies. | C5 |
| D-2 | Notifications | MVP | Invites, uploads (batched), mentions, reveals; per-Crew mute. | C6, F3 |
| D-3 | Share Roll links to WhatsApp & others | MVP | Rich preview card with cover + count. | B6 |

### E · Unique social features

| # | Feature | Tag | Description (verbatim) | Screens |
|---|---|---|---|---|
| E-1 | Pic Bracket | P2 | Knockout votes; winner becomes Roll cover. | D4 |
| E-2 | Friend Stickers | P3 | Cut-outs of opted-in friends → WhatsApp / Instagram. | E1 |
| E-3 | Dumpr Wrapped | P3 | Annual story recap, every December. | E2 |
| E-4 | Multi-Angle Moment | P2 | 60-second group challenge → angle grid. | D5 |
| E-5 | Surprise Roll | P2 | Hidden from the honoree; unlocks on schedule. | D6 |
| E-6 | Then vs Now | P3 | Side-by-side, same friends or place across years. | E3 |
| E-7 | Crew Passport | P2 | Map of Rolls with stamps from photo location. | E4 |
| E-8 | Voice notes on photos | P2 | (no description printed) | B4 |
| E-9 | Ghost Mode | P2 | Limit one photo to chosen members. | F2 |
| E-10 | Hype Notes | P2 | Anonymous compliments from preset prompts only. | B4 |
| E-11 | Lore Tags | P2 | #inside-jokes, searchable across a Crew. | E5 |
| E-12 | Time Capsules | P2 | Lock a Roll until a date. | B5, D3 |
| E-13 | Crew Awards | P2 | End-of-event votes: Best Photographer, Most Candid. | D4 |
| E-14 | AI Recaps | P3 | Auto slideshow + 9:16 video. | E2 |
| E-15 | Photo Discovery | P3 | Find photos of you — only if you opt in. | F5 |

Callout on page (verbatim): "All 15 are reached from one place — the Play sheet on a Crew or Roll (D3) — plus contextual entry points where they naturally belong (viewer, Roll end, December banner)."

### F · Safety, privacy & management

| # | Feature | Tag | Description (verbatim) | Screens |
|---|---|---|---|---|
| F-1 | Private by default + member roles | MVP | Host / Co-host / Member / Guest. | B2, F3 |
| F-2 | Per-photo visibility, removal request, report | MVP | Photo sheet; hosts moderate. | F2 |
| F-3 | Host controls | MVP | Who can invite, upload, download; link expiry. | B6, F3 |
| F-4 | Storage limits, retention, export, delete account | MVP | (no description printed) | F4, F3 |
| F-5 | Host controls for reveal & Surprise Rolls | P2 | (no description printed) | C4, D6 |
| F-6 | Face-feature consent centre | P3 | Ships with the first face feature; per-person opt-in. | F3 |

---

## Counts

- Total features listed: 44 (A 7 · B 9 · C 4 · D 3 · E 15 · F 6)
- Tags: MVP 20 · P2 17 · P3 7 (counted from the tags above)

Notes:
- The `#` column (A-1 … F-6) is a reference ID added for this file. It is numbered in list order. The page itself numbers only the E module (1-15), and those numbers match E-1 … E-15 here.
- "Storage limits, retention, export, delete account" (F-4) and "Host controls for reveal & Surprise Rolls" (F-5) have no description on the page; only their screen references are printed.
- "Voice notes on photos" appears twice on the page: as B-8 (with description) and as E-8 (no description).
