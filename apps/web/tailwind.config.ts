import type { Config } from 'tailwindcss';
import preset from '@dumpr/ui-tokens/tailwind-preset';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'media',
  presets: [preset as unknown as Partial<Config>],
  theme: {
    extend: {
      // next/font exposes generated family names through CSS variables (see src/app/layout.tsx).
      fontFamily: {
        display: ['var(--font-bricolage)', 'system-ui', 'sans-serif'],
        body: ['var(--font-hanken)', 'system-ui', 'sans-serif'],
        sans: ['var(--font-hanken)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-space-mono)', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
