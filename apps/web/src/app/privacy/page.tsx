import type { Metadata } from 'next';
import { LegalPage } from '../../components/LegalPage';

export const metadata: Metadata = { title: 'Privacy' };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy">
      <p>
        Photos in a Roll are private to the people in that Roll. There are no public profiles and no
        public photo pages.
      </p>
      <p>
        We store your photos and the name or phone number you sign in with so the app can work.
        Guests who add photos from the web are asked only for a name, which is shown as photo
        credit.
      </p>
      <p>
        You can ask for a photo of you to be removed, and you can export or delete your data from
        the app at any time.
      </p>
      <p>We do not sell your data.</p>
    </LegalPage>
  );
}
