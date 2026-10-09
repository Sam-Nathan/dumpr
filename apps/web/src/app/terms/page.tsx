import type { Metadata } from 'next';
import { LegalPage } from '../../components/LegalPage';

export const metadata: Metadata = { title: 'Terms' };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use">
      <p>
        Dumpr lets groups share photos in one place. By using Dumpr you agree to use it kindly and
        legally, and to only add photos you have the right to share.
      </p>
      <p>
        You own your photos. You give Dumpr permission to store them and show them to the people you
        share them with, so the app can work.
      </p>
      <p>
        Hosts can remove photos and members from their Rolls. We may remove content that breaks the
        law or puts people at risk.
      </p>
      <p>
        Questions? Ask the person who invited you, or email us once our address is published here.
      </p>
    </LegalPage>
  );
}
