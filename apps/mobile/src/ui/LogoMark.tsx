import Svg, { Circle, G, Rect } from 'react-native-svg';

export interface LogoMarkProps {
  size?: number;
  /** Draw the lime rounded tile behind the frames (the app-icon look). Default true. */
  tile?: boolean;
}

/**
 * The Dumpr mark (brand/mark.svg): two tilted frames = a pile of shared shots; the dot is the flash.
 * Ink on lime only; never on photos, never outlined. `paint-order: stroke` is emulated by drawing the
 * lime-stroked frame first and the ink fill on top, since react-native-svg has no paint-order.
 */
export function LogoMark({ size = 40, tile = true }: LogoMarkProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      accessibilityRole="image"
      accessibilityLabel="Dumpr"
    >
      {tile ? <Rect x={0} y={0} width={1024} height={1024} rx={236} fill="#D4FF3F" /> : null}
      <G scale={tile ? 0.86 : 1} origin="512, 512">
      <G rotation={-14} origin="430, 560">
        <Rect x={232} y={318} width={390} height={470} rx={56} fill="#16141B" />
      </G>
      <G rotation={9} origin="590, 500">
        <Rect x={392} y={262} width={408} height={452} rx={60} fill="#16141B" stroke="#D4FF3F" strokeWidth={44} />
        <Rect x={392} y={262} width={408} height={452} rx={60} fill="#16141B" />
        <Circle cx={676} cy={392} r={54} fill="#D4FF3F" />
      </G>
      </G>
    </Svg>
  );
}
