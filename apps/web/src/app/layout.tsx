import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Hanken_Grotesk, Space_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import { SITE_URL } from '../config';
import './globals.css';

// Bricolage: wordmark + headings (`font-display`). Hanken: UI text (`font-body`). Space Mono: codes (`font-mono`).
const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-bricolage',
  display: 'swap',
});
const hanken = Hanken_Grotesk({ subsets: ['latin'], variable: '--font-hanken', display: 'swap' });
const spaceMono = Space_Mono({
  subsets: ['latin'],
  variable: '--font-space-mono',
  display: 'swap',
  weight: ['400', '700'],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'Dumpr', template: '%s · Dumpr' },
  description: "Everyone's photos. One place. No chasing.",
};

export const viewport: Viewport = { themeColor: '#16141B' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${bricolage.variable} ${hanken.variable} ${spaceMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
