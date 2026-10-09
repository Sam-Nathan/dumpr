import Svg, { Circle, Path, Rect } from 'react-native-svg';

type Shape =
  { p: string } | { c: [number, number, number] } | { r: [number, number, number, number, number] };

const p = (d: string): Shape => ({ p: d });

/**
 * Extra 24x24 stroke glyphs (Lucide-style) that complement `Icon`. Kept in their own file so tracks
 * adding glyphs in parallel never touch the same lines. Prefer `Icon` when a glyph exists there.
 */
const GLYPHS = {
  send: [p('M22 2L11 13'), p('M22 2l-7 20-4-9-9-4 20-7z')],
  arrowUp: [p('M12 19V5'), p('M5 12l7-7 7 7')],
  reply: [p('M9 14L4 9l5-5'), p('M20 20v-7a4 4 0 0 0-4-4H4')],
  flag: [p('M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z'), p('M4 22v-7')],
  shield: [p('M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z')],
  eye: [p('M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z'), { c: [12, 12, 3] }],
  eyeOff: [
    p('M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94'),
    p('M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19'),
    p('M14.12 14.12a3 3 0 1 1-4.24-4.24'),
    p('M1 1l22 22'),
  ],
  hardDrive: [
    p('M22 12H2'),
    p(
      'M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
    ),
    p('M6 16h.01'),
    p('M10 16h.01'),
  ],
  pause: [p('M6 4h4v16H6z'), p('M14 4h4v16h-4z')],
  play: [p('M5 3l14 9-14 9V3z')],
  sparkle: [
    p('M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z'),
    p('M19 17v4M17 19h4'),
  ],
  more: [{ c: [12, 12, 1] }, { c: [19, 12, 1] }, { c: [5, 12, 1] }],
  wifi: [
    p('M5 12.55a11 11 0 0 1 14.08 0'),
    p('M1.42 9a16 16 0 0 1 21.16 0'),
    p('M8.53 16.11a6 6 0 0 1 6.95 0'),
    p('M12 20h.01'),
  ],
  calendar: [{ r: [3, 4, 18, 18, 2] }, p('M16 2v4M8 2v4M3 10h18')],
  checkCircle: [p('M22 11.08V12a10 10 0 1 1-5.93-9.14'), p('M22 4L12 14.01l-3-3')],
  logout: [p('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4'), p('M16 17l5-5-5-5'), p('M21 12H9')],
  folder: [p('M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z')],
  minus: [p('M5 12h14')],
  smartphone: [{ r: [5, 2, 14, 20, 2] }, p('M12 18h.01')],
  globe: [
    { c: [12, 12, 10] },
    p('M2 12h20'),
    p('M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z'),
  ],
  userX: [
    p('M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2'),
    { c: [8.5, 7, 4] },
    p('M18 8l5 5M23 8l-5 5'),
  ],
} satisfies Record<string, Shape[]>;

export type GlyphName = keyof typeof GLYPHS;

export interface GlyphProps {
  name: GlyphName;
  size?: number;
  color: string;
  strokeWidth?: number;
}

/** Decorative by default (parents carry the accessibility label). */
export function Glyph({ name, size = 22, color, strokeWidth = 2 }: GlyphProps) {
  const shapes: Shape[] = GLYPHS[name];
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {shapes.map((s, i) => {
        const common = {
          stroke: color,
          strokeWidth,
          strokeLinecap: 'round' as const,
          strokeLinejoin: 'round' as const,
        };
        if ('p' in s) return <Path key={i} d={s.p} {...common} />;
        if ('c' in s) return <Circle key={i} cx={s.c[0]} cy={s.c[1]} r={s.c[2]} {...common} />;
        const [x, y, w, h, rx] = s.r;
        return <Rect key={i} x={x} y={y} width={w} height={h} rx={rx} {...common} />;
      })}
    </Svg>
  );
}
