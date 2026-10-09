import Link from 'next/link';

export function Footer({ onInk = false }: { onInk?: boolean }) {
  const text = onInk ? 'text-[#B5B1BC]' : 'text-ink2 dark:text-ink2-dark';
  return (
    <footer
      className={`mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-1 px-5 py-8 text-[13px] ${text}`}
    >
      <span>&copy; {new Date().getFullYear()} Dumpr</span>
      <nav aria-label="Legal" className="flex gap-2">
        <Link
          href="/terms"
          className="inline-flex min-h-[44px] items-center px-2 underline underline-offset-4"
        >
          Terms
        </Link>
        <Link
          href="/privacy"
          className="inline-flex min-h-[44px] items-center px-2 underline underline-offset-4"
        >
          Privacy
        </Link>
      </nav>
    </footer>
  );
}
