import type { ReactNode } from 'react';
import { Footer } from './Footer';
import { Wordmark } from './Logo';

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <header className="mx-auto flex max-w-2xl items-center px-5 pt-5">
        <Wordmark href="/" />
      </header>
      <main className="mx-auto max-w-2xl px-5 pb-10 pt-8">
        <h1 className="font-display text-[32px] font-extrabold leading-[1.05] tracking-[-0.02em]">
          {title}
        </h1>
        <p className="mt-2 text-[13px] text-ink3 dark:text-ink3-dark">
          Placeholder text. The final version is coming before launch.
        </p>
        <div className="mt-6 space-y-4 text-[15px] leading-[1.5] text-ink2 dark:text-ink2-dark">
          {children}
        </div>
      </main>
      <Footer />
    </>
  );
}
