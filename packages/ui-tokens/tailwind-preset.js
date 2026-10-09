/**
 * Shared Tailwind preset (CommonJS) for NativeWind (apps/mobile) and Next.js (apps/web).
 * Single source of truth: ./tokens.json (also re-exported as typed TS from src/).
 *
 * Light values use plain names (bg-paper, text-ink, border-line, bg-flash ...). Dark values use a
 * `-dark` suffix so components write `bg-paper dark:bg-paper-dark`. Tints: bg-tint-lilac / bg-tint-lilac-dark.
 */
const tokens = require('./tokens.json');

const px = (n) => `${n}px`;

const { light, dark } = tokens.color;

// Dark palette names its text ramp text/text2/text3; expose them under the same ink names as light.
const darkInk = { ink: dark.text, ink2: dark.text2, ink3: dark.text3 };
const darkSource = { ...dark, ...darkInk };

const colors = {};
for (const name of Object.keys(light)) {
  colors[name] = light[name];
  const darkValue = darkSource[name];
  if (darkValue) colors[`${name}-dark`] = darkValue;
}
for (const [name, value] of Object.entries(tokens.tint)) {
  colors[`tint-${name}`] = value.light;
  colors[`tint-${name}-dark`] = value.dark;
}

const radius = tokens.radius;

/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: {
      colors,
      fontFamily: {
        display: [tokens.font.display, 'system-ui', 'sans-serif'],
        body: [tokens.font.body, 'system-ui', 'sans-serif'],
        mono: [tokens.font.mono, 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        tile: px(radius.tile),
        input: px(radius.input),
        card: px(radius.card),
        sheet: px(radius.sheet),
        pill: px(radius.pill),
      },
    },
  },
};
