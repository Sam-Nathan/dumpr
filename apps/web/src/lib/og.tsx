import { ImageResponse } from 'next/og';
import { formatDateRange, formatPeopleCount, formatPhotoCount } from './format';
import { inviteTitle, type InvitePreview } from './invite';
import { getInvite } from './invite-server';

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = 'image/png';

const INK = '#16141B';
const FLASH = '#D4FF3F';
const TEXT = '#F4F3F6';
const TEXT2 = '#B5B1BC';

// brand/logo-tile.svg
const LOGO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" rx="236" fill="#D4FF3F"/><g transform="translate(512 512) scale(0.86) translate(-512 -512)"><g transform="rotate(-14 430 560)"><rect x="232" y="318" width="390" height="470" rx="56" fill="#16141B"/></g><g transform="rotate(9 590 500)"><rect x="392" y="262" width="408" height="452" rx="60" fill="#16141B" stroke="#D4FF3F" stroke-width="44" paint-order="stroke"/><circle cx="676" cy="392" r="54" fill="#D4FF3F"/></g></g></svg>';
const LOGO_URI = `data:image/svg+xml;base64,${Buffer.from(LOGO_SVG).toString('base64')}`;

/** Bricolage ExtraBold for the card; best effort (falls back to the built-in font when offline). */
async function loadWordmarkFont(text: string): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(
      `https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@800&text=${encodeURIComponent(text)}`,
      {
        // An old UA makes Google serve TrueType, which satori can read (it cannot read woff2).
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; de-at) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1',
        },
        signal: AbortSignal.timeout(2500),
      },
    ).then((r) => r.text());
    const url = /src: url\((.+?)\) format\('(?:truetype|opentype)'\)/.exec(css)?.[1];
    if (!url) return null;
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}

async function coverDataUri(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !/^image\/(jpeg|png)/.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:${type.split(';')[0]};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

const ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

interface CardData {
  label: string;
  title: string;
  chip: string;
  cover: string | null;
}

function Card({ label, title, chip, cover }: CardData) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        background: INK,
        color: TEXT,
        fontFamily: 'Bricolage, sans-serif',
      }}
    >
      {cover && (
        <img
          src={cover}
          width={630}
          height={630}
          style={{ width: 630, height: 630, objectFit: 'cover' }}
          alt=""
        />
      )}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          flex: 1,
          padding: 56,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <img src={LOGO_URI} width={72} height={72} alt="" />
          <div
            style={{
              display: 'flex',
              marginLeft: 18,
              fontSize: 56,
              fontWeight: 800,
              color: FLASH,
              letterSpacing: -2,
            }}
          >
            dumpr
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontSize: 26, color: TEXT2, letterSpacing: 2 }}>
            {label.toUpperCase()}
          </div>
          <div
            style={{
              display: 'flex',
              marginTop: 12,
              fontSize: cover ? 72 : 96,
              lineHeight: 1,
              fontWeight: 800,
              letterSpacing: -2,
              maxWidth: cover ? 480 : 1000,
            }}
          >
            {title}
          </div>
        </div>
        <div style={{ display: 'flex' }}>
          <div
            style={{
              display: 'flex',
              background: FLASH,
              color: INK,
              fontSize: 36,
              fontWeight: 800,
              padding: '14px 32px',
              borderRadius: 999,
            }}
          >
            {chip}
          </div>
        </div>
      </div>
    </div>
  );
}

function cardFor(p: InvitePreview, cover: string | null): CardData {
  const title = truncate(inviteTitle(p), cover ? 34 : 44);
  if (p.kind === 'roll' && p.roll) {
    const dates = formatDateRange(p.roll.startsOn, p.roll.endsOn);
    return {
      label: dates ? `Roll · ${dates}` : 'Roll',
      title,
      chip: p.roll.sealed ? 'Sealed until the reveal' : formatPhotoCount(p.roll.photoCount),
      cover: p.roll.sealed ? null : cover,
    };
  }
  return { label: 'Crew', title, chip: formatPeopleCount(p.memberCount), cover };
}

/** WhatsApp / social rich-preview card (B6). Never throws: any failure renders the brand card. */
export async function inviteOgImage(code: string): Promise<ImageResponse> {
  const load = await getInvite(code);
  let data: CardData = {
    label: 'Shared photos',
    title: "Everyone's photos. One place.",
    chip: 'Join on Dumpr',
    cover: null,
  };
  if (load.ok && load.preview.status === 'ok') {
    const sealed = load.preview.roll?.sealed === true;
    data = cardFor(load.preview, sealed ? null : await coverDataUri(load.preview.coverUrl));
  }
  const font = await loadWordmarkFont(`${data.title}${data.label}${data.chip}${ASCII}`);
  return new ImageResponse(<Card {...data} />, {
    ...OG_SIZE,
    fonts: font ? [{ name: 'Bricolage', data: font, weight: 800, style: 'normal' }] : undefined,
  });
}
