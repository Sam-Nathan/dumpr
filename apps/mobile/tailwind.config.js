const preset = require('@dumpr/ui-tokens/tailwind-preset');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'media',
  presets: [require('nativewind/preset'), preset],
  theme: {
    extend: {
      // Colours, radii and the web font stacks come from @dumpr/ui-tokens (tokens.json) via the preset.
      // React Native needs the exact loaded font-family name per weight (see src/lib/fonts.ts).
      fontFamily: {
        display: ['BricolageGrotesque_700Bold'],
        'display-extrabold': ['BricolageGrotesque_800ExtraBold'],
        body: ['HankenGrotesk_400Regular'],
        'body-medium': ['HankenGrotesk_500Medium'],
        'body-semibold': ['HankenGrotesk_600SemiBold'],
        'body-bold': ['HankenGrotesk_700Bold'],
        mono: ['SpaceMono_400Regular'],
        'mono-bold': ['SpaceMono_700Bold'],
      },
    },
  },
  plugins: [],
};
