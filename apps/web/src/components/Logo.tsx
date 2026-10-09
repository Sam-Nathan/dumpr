/** The Dumpr logo tile (brand/logo-tile.svg), inlined so it needs no request. */
export function LogoTile({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 1024 1024"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <rect width="1024" height="1024" rx="236" fill="#D4FF3F" />
      <g transform="translate(512 512) scale(0.86) translate(-512 -512)">
        <g transform="rotate(-14 430 560)">
          <rect x="232" y="318" width="390" height="470" rx="56" fill="#16141B" />
        </g>
        <g transform="rotate(9 590 500)">
          <rect
            x="392"
            y="262"
            width="408"
            height="452"
            rx="60"
            fill="#16141B"
            stroke="#D4FF3F"
            strokeWidth="44"
            paintOrder="stroke"
          />
          <circle cx="676" cy="392" r="54" fill="#D4FF3F" />
        </g>
      </g>
    </svg>
  );
}

/**
 * Logo tile + lowercase "dumpr" wordmark (Bricolage ExtraBold, -4% tracking).
 * `onInk`: lime wordmark on an ink surface; otherwise ink on paper (lime in dark mode).
 */
export function Wordmark({
  onInk = false,
  size = 28,
  href,
}: {
  onInk?: boolean;
  size?: number;
  href?: string;
}) {
  const color = onInk ? 'text-flash' : 'text-ink dark:text-flash';
  const content = (
    <>
      <LogoTile size={Math.round(size * 1.15)} />
      <span
        className={`font-display font-extrabold leading-none tracking-[-0.04em] ${color}`}
        style={{ fontSize: size }}
      >
        dumpr
      </span>
    </>
  );
  const cls = 'inline-flex min-h-[44px] items-center gap-2';
  return href ? (
    <a href={href} className={cls} aria-label="Dumpr home">
      {content}
    </a>
  ) : (
    <span className={cls}>{content}</span>
  );
}
