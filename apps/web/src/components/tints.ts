/** Static class names so Tailwind's JIT sees them. Crews own one named tint each. */
const LILAC = 'bg-tint-lilac dark:bg-tint-lilac-dark';

export const TINT_BG: Record<string, string> = {
  lilac: LILAC,
  lime: 'bg-tint-lime dark:bg-tint-lime-dark',
  sky: 'bg-tint-sky dark:bg-tint-sky-dark',
  peach: 'bg-tint-peach dark:bg-tint-peach-dark',
  pink: 'bg-tint-pink dark:bg-tint-pink-dark',
  mint: 'bg-tint-mint dark:bg-tint-mint-dark',
};

export function tintBg(tint: string | null | undefined): string {
  return TINT_BG[tint ?? ''] ?? LILAC;
}
