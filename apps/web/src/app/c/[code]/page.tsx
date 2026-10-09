import type { Metadata } from 'next';
import { InvitePage } from '../../../components/InvitePage';
import { inviteMetadata } from '../../../lib/invite-metadata';

// Always rendered per request: the invite state (expiry, counts, seal) must be live.
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  return inviteMetadata(code);
}

export default async function Page({ params }: Props) {
  const { code } = await params;
  return <InvitePage code={code} path={`/c/${encodeURIComponent(code)}`} />;
}
