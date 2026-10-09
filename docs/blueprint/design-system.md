# Dumpr design system ("Flash & Film")

Source: `Dumpr — UI/UX Blueprint` (v1, Oct 2026), section 06 · Visual design system, PDF page 43. Transcribed from the page's text layer; hex values are as printed. Machine-readable tokens live in `packages/ui-tokens/tokens.json`.

Section heading on page: "06 · VISUAL DESIGN SYSTEM — "FLASH & FILM"" · "Tokens, type, components, themes, accessibility"

---

## 1. Logo direction

- Mark: two tilted frames = a pile of shared shots; the dot is the flash. The mark is a lime tile with ink frames (page shows lime tile + ink frames + lime dot).
- Wordmark: "dumpr" (always lowercase).
- Verbatim rule: "Two tilted frames = a pile of shared shots; the dot is the flash. Wordmark always lowercase Bricolage ExtraBold, −4% tracking. Lime on ink or ink on lime only — never on photos, never outlined."

Rules derived from the rule text:
- Wordmark face: Bricolage ExtraBold, lowercase, tracking −4%.
- Lime (`flash`) on ink, or ink on lime, only.
- Never place the logo on photos.
- Never outline the logo.

---

## 2. Colour

### 2.1 Light and dark roles

| Role (as printed) | Light | Dark |
|---|---|---|
| paper | `#FAFAF8` | `#0F0E12` |
| surface | `#FFFFFF` | `#1B1A20` |
| ink · text (light) / text (dark) | `#16141B` | `#F4F3F6` |
| ink-2 · secondary (light) / text-2 (dark) | `#4A4652` | `#B5B1BC` |
| ink-3 · caption (5.0:1) (light) / text-3 (7.3:1) (dark) | `#6E6977` | `#A39FAA` |
| line | `#E7E5EA` | `#2F2D36` |
| flash · primary action (light) / flash (unchanged) (dark) | `#D4FF3F` | `#D4FF3F` |
| shutter · live, badges (light) / shutter / stamp (dark) | `#FF6B2C` | `#FF8A3D` |
| danger text | `#B42318` | `#FF8A73` |

Contrast annotations printed on the page: ink-3 on light = 5.0:1; text-3 on dark = 7.3:1.

Token keys used in `tokens.json`: light `paper, surface, ink, ink2, ink3, line, flash, shutter, danger`; dark `paper, surface, text, text2, text3, line, flash, shutter, danger`.

### 2.2 Crew tints

Rule printed above the tints: "CREW TINTS — EACH CREW OWNS ONE (NAMED, SO COLOUR IS NEVER THE ONLY CUE)". Each Crew owns one named tint; colour alone is never the only cue.

| Tint | Light | Dark |
|---|---|---|
| Lilac | `#E7DEFF` | `#2B2540` |
| Lime | `#EAF8C2` | `#26301A` |
| Sky | `#D3F0FF` | `#142C38` |
| Peach | `#FFE3D3` | `#3A2418` |
| Pink | `#FFDDEB` | `#3A1E2B` |
| Mint | `#D6F5E8` | `#15302A` |

---

## 3. Typography

Families (page header: "TYPE — BRICOLAGE GROTESQUE · HANKEN GROTESK · SPACE MONO"):
- Display: Bricolage Grotesque
- Body: Hanken Grotesk
- Mono (stamps, counters, labels): Space Mono

### 3.1 Type scale

Notation as printed: `size/line-height · weight`.

| Token | Spec | Sample on page |
|---|---|---|
| display-xl | 72 / 0.9 · 800 | "Goa '26" |
| display | 40 / 1 · 800 | "Crews" |
| title | 26 / 1.1 · 800 | "Invite to Goa Gang" |
| heading | 17 / 1.2 · 700 | "Add 38 to Goa '26" |
| body | 15 / 1.45 · 500 | "Your 38 photos are sealed until 9:00 AM." |
| caption | 13 / 1.4 · 500 | "12–15 Mar · 142 photos" |
| stamp (mono) | 11–15 · caps (line-height and weight not printed) | "14 03 '26 · 07:42:10" |

### 3.2 Scaling rules (verbatim)

"Scales with Dynamic Type / Android font scale to 200%. Display sizes cap at 1.3× and wrap; body reflows; nothing truncates mid-word. Devanagari & Kannada fall back to Noto Sans of matching weight."

---

## 4. Space, radius, depth

- Spacing scale (px): 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 56. Printed as "screen gutter 16–20".
- Radius:
  - tile 10
  - input 14
  - card 20–28 (printed as a range; stored as **24** in `tokens.json`)
  - sheet 32
  - button pill (999)
- Depth: the page shows three depth samples labelled **nav float**, **sheet**, and **dump stack**. No numeric shadow or elevation values are printed. Shadow values: TBD (not specified on p.43).

---

## 5. Buttons

Heading: "BUTTON HIERARCHY — ONE LIME BUTTON PER SCREEN"

| Level (as printed) | Example on page | Appearance (as shown) |
|---|---|---|
| Primary · Join Roll | "Join Roll" | Lime pill, ink text |
| Strong · New | "New" | Ink pill, light text |
| Secondary · Download all | "Download all" | Outlined pill |
| Tertiary · Not now | "Not now" | Text only |
| Destructive · Delete | "Delete" | Red text (danger) |

Also shown: a round icon button (share) and the lime shutter control as a sample.

Rules (verbatim): "Disabled = 40% opacity + reason text beside it, never a silent grey button. Pressed = scale 0.96, 80 ms. Min target 44 × 44."

Summary:
- One lime (primary) button per screen.
- Disabled: 40% opacity, plus reason text beside the control. No silent grey buttons.
- Pressed: scale 0.96 for 80 ms (`motion.pressScale`, `motion.pressMs`).
- Minimum touch target: 44 × 44 (`minTarget`).

---

## 6. Chips, reactions, stamps

Chips shown: "Sangeet 312" (ink chip with lime count), "Haldi" (outlined), "ICONIC 9" (lime), "LMAO 6" (ink), "#maggi-at-3am" (lime tint, mono), "23 11 '25" (mono date stamp, shutter-orange on ink).

Reactions (words, not emoji): ICONIC · LMAO · CRYING · HEART · SAME.

Rule (verbatim): "Reactions are words, not emoji — ICONIC · LMAO · CRYING · HEART · SAME — so they read the same on every phone and in every language pack."

---

## 7. Photo tile states

Six states are shown on the page, in this order:

| State | Visual as shown on page |
|---|---|
| default | Plain photo tile |
| selected | Lime outline with a lime check badge at top-right |
| uploading | Photo under a grey overlay with a partial lime progress ring |
| failed | Photo tile in a failed state (no extra label printed on the tile) |
| duplicate | Photo dimmed with an "IN ROLL" label at the bottom |
| sealed | Solid ink tile with a lime lock icon |

Labels printed under the tiles: default, selected, uploading, failed, duplicate, sealed. The "IN ROLL" badge is the duplicate marker used on screens C3 (smart gallery import).

---

## 8. Toast

Sample: dark bar reading "Posted 3 to Goa '26" with a lime "Undo" button.

Rule (verbatim): "Bottom, above the nav pill. 5 s, one action max. Never for errors that need a decision."

Summary:
- Position: bottom, above the nav pill.
- Duration: 5 s.
- Actions: one maximum.
- Not used for errors that need a decision.

---

## 9. Dialog

Sample: title "Delete Goa Gang for everyone?"; body "6 members get 30 days to download their copies. This can't be undone."; buttons "Cancel" (text) and "Delete" (red).

Rule (verbatim): "Only for irreversible actions. Verb on the button, consequence in the body."

Summary:
- Use only for irreversible actions.
- Button label is a verb ("Delete").
- The consequence goes in the body text.

---

## 10. Push notification copy

Sample notification:
- Title: "Goa '26 is revealed"
- Body: "312 photos from 6 phones. You're in 41."

Rule (verbatim): "Batch uploads hourly ("Diya added 24"), never per photo. Invites, mentions, reveals and Multi-Angle are instant."

Summary:
- Upload notices are batched hourly (example: "Diya added 24"), never one per photo.
- Invites, mentions, reveals and Multi-Angle are instant (not batched).
