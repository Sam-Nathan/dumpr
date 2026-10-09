import Svg, { Circle, Path, Rect } from 'react-native-svg';

type Shape =
  { p: string } | { c: [number, number, number] } | { r: [number, number, number, number, number] };

const p = (d: string): Shape => ({ p: d });

/** 24x24 stroke glyphs (Lucide-style). Add new ones here; keep names generic, not screen-specific. */
const GLYPHS = {
  back: [p('M15 18l-6-6 6-6')],
  close: [p('M18 6L6 18M6 6l12 12')],
  plus: [p('M12 5v14M5 12h14')],
  more: [{ c: [5, 12, 1] }, { c: [12, 12, 1] }, { c: [19, 12, 1] }],
  userPlus: [
    p('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'),
    { c: [9, 7, 4] },
    p('M19 8v6M22 11h-6'),
  ],
  heart: [
    p(
      'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z',
    ),
  ],
  reply: [p('M9 17l-5-5 5-5'), p('M20 18v-2a4 4 0 0 0-4-4H4')],
  pencil: [p('M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z')],
  mail: [{ r: [2, 4, 20, 16, 2] }, p('M22 7l-10 6L2 7')],
  checkCircle: [{ c: [12, 12, 10] }, p('M9 12l2 2 4-4')],
  logout: [p('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4'), p('M16 17l5-5-5-5'), p('M21 12H9')],
  sliders: [
    p('M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3'),
    p('M1 14h6M9 8h6M17 16h6'),
  ],
  calendar: [{ r: [3, 4, 18, 18, 2] }, p('M16 2v4M8 2v4M3 10h18')],
  crown: [p('M2 4l3 12h14l3-12-6 7-4-9-4 9z'), p('M5 20h14')],
  check: [p('M20 6L9 17l-5-5')],
  chevronDown: [p('M6 9l6 6 6-6')],
  chevronRight: [p('M9 18l6-6-6-6')],
  lock: [{ r: [4, 11, 16, 10, 2] }, p('M8 11V7a4 4 0 0 1 8 0v4')],
  link: [
    p('M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'),
    p('M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'),
  ],
  clock: [{ c: [12, 12, 9] }, p('M12 7v5l3 2')],
  download: [p('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'), p('M7 10l5 5 5-5'), p('M12 15V3')],
  upload: [p('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'), p('M17 8l-5-5-5 5'), p('M12 3v12')],
  camera: [
    p('M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z'),
    { c: [12, 13, 4] },
  ],
  image: [{ r: [3, 3, 18, 18, 2] }, { c: [8.5, 8.5, 1.5] }, p('M21 15l-5-5L5 21')],
  users: [
    p('M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2'),
    { c: [9, 7, 4] },
    p('M23 21v-2a4 4 0 0 0-3-3.87'),
    p('M16 3.13a4 4 0 0 1 0 7.75'),
  ],
  user: [p('M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2'), { c: [12, 7, 4] }],
  chat: [
    p(
      'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z',
    ),
  ],
  bell: [p('M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9'), p('M13.73 21a2 2 0 0 1-3.46 0')],
  search: [{ c: [11, 11, 8] }, p('M21 21l-4.35-4.35')],
  share: [p('M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8'), p('M16 6l-4-4-4 4'), p('M12 2v13')],
  copy: [{ r: [9, 9, 13, 13, 2] }, p('M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1')],
  trash: [
    p('M3 6h18'),
    p('M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'),
    p('M10 11v6M14 11v6'),
  ],
  refresh: [p('M23 4v6h-6'), p('M20.49 15a9 9 0 1 1-2.12-9.36L23 10')],
  alert: [{ c: [12, 12, 10] }, p('M12 8v4M12 16h.01')],
  info: [{ c: [12, 12, 10] }, p('M12 16v-4M12 8h.01')],
  qr: [
    { r: [3, 3, 7, 7, 1] },
    { r: [14, 3, 7, 7, 1] },
    { r: [3, 14, 7, 7, 1] },
    p('M14 14h3v3h-3zM20 14v.01M14 20h3M20 17v4'),
  ],
  scan: [
    p('M3 7V5a2 2 0 0 1 2-2h2'),
    p('M17 3h2a2 2 0 0 1 2 2v2'),
    p('M21 17v2a2 2 0 0 1-2 2h-2'),
    p('M7 21H5a2 2 0 0 1-2-2v-2'),
  ],
  blocked: [{ r: [4, 4, 16, 16, 3] }, p('M4 4l16 16')],
  flash: [p('M13 2L3 14h9l-1 8 10-12h-9l1-8z')],
  flip: [
    p('M17 1l4 4-4 4'),
    p('M3 11V9a4 4 0 0 1 4-4h14'),
    p('M7 23l-4-4 4-4'),
    p('M21 13v2a4 4 0 0 1-4 4H3'),
  ],
  bellOff: [
    p('M13.73 21a2 2 0 0 1-3.46 0'),
    p('M18.63 13A17.89 17.89 0 0 1 18 8'),
    p('M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14'),
    p('M18 8a6 6 0 0 0-9.33-5'),
    p('M1 1l22 22'),
  ],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof GLYPHS;

export interface IconProps {
  name: IconName;
  size?: number;
  color: string;
  strokeWidth?: number;
}

/** Decorative by default (parents carry the accessibility label). */
export function Icon({ name, size = 22, color, strokeWidth = 2 }: IconProps) {
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
