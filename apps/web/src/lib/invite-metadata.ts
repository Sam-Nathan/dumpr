import type { Metadata } from 'next';
import { getInvite } from './invite-server';
import { FALLBACK_META, inviteMeta } from './seo';

/** Shared generateMetadata for /r/[code] and /c/[code]. The OG image comes from the opengraph-image convention. */
export async function inviteMetadata(code: string): Promise<Metadata> {
  const load = await getInvite(code);
  const meta = load.ok && load.preview.status === 'ok' ? inviteMeta(load.preview) : FALLBACK_META;
  return {
    title: { absolute: meta.title },
    description: meta.description,
    // Invite links are private-ish: never index them.
    robots: { index: false, follow: false },
    openGraph: {
      title: meta.title,
      description: meta.description,
      type: 'website',
      siteName: 'Dumpr',
    },
    twitter: { card: 'summary_large_image', title: meta.title, description: meta.description },
  };
}
