import { inviteOgImage, OG_CONTENT_TYPE, OG_SIZE } from '../../../lib/og';

export const dynamic = 'force-dynamic';
export const alt = 'Dumpr invite';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return inviteOgImage(code);
}
