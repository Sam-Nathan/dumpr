import { Footer } from '../components/Footer';
import { Wordmark } from '../components/Logo';
import { StoreButtons } from '../components/StoreButtons';

const CHIPS = [
  'Full quality, always',
  'No app needed to add photos',
  'Private to the people in it',
  'One link, no chasing',
];

const STEPS = [
  ['Make a Crew', 'Your friends, family or trip group, in one tap.'],
  [
    'Start a Roll',
    'A night out, a trip, a weekend. Everyone adds photos straight from the camera.',
  ],
  ['Done', 'All the photos land in one place. Nobody has to chase anybody.'],
];

export default function HomePage() {
  return (
    <div className="ink-surface min-h-screen bg-[#16141B] text-[#F4F3F6]">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 pt-5 md:px-8">
        <Wordmark onInk href="/" />
      </header>
      <main>
        <section className="mx-auto max-w-5xl px-5 pb-16 pt-14 md:px-8 md:pt-24">
          <h1 className="max-w-3xl font-display text-[44px] font-extrabold leading-[1] tracking-[-0.02em] md:text-[72px] md:leading-[0.9]">
            Everyone&rsquo;s photos. One place. No chasing.
          </h1>
          <p className="mt-6 max-w-xl text-[18px] leading-[1.45] text-[#B5B1BC]">
            Dumpr is a camera-first app for shared photos. Start a Roll, add your shots, and
            everyone in the Crew gets them all.
          </p>
          <ul className="mt-8 flex flex-wrap gap-2" aria-label="Why Dumpr">
            {CHIPS.map((c) => (
              <li
                key={c}
                className="rounded-pill border border-[#2F2D36] bg-[#1B1A20] px-4 py-2 text-[14px] font-semibold"
              >
                {c}
              </li>
            ))}
          </ul>
          <div className="mt-10">
            <h2 className="mb-3 font-mono text-[12px] font-bold uppercase tracking-[0.08em] text-[#A39FAA]">
              Get the app
            </h2>
            <StoreButtons />
          </div>
        </section>
        <section
          aria-label="How it works"
          className="mx-auto grid max-w-5xl gap-4 px-5 pb-16 md:grid-cols-3 md:px-8"
        >
          {STEPS.map(([title, body], i) => (
            <div key={title} className="rounded-card bg-[#1B1A20] p-6">
              <span className="font-mono text-[13px] text-flash">0{i + 1}</span>
              <h2 className="mt-3 font-display text-[22px] font-extrabold">{title}</h2>
              <p className="mt-2 text-[15px] leading-[1.45] text-[#B5B1BC]">{body}</p>
            </div>
          ))}
        </section>
      </main>
      <Footer onInk />
    </div>
  );
}
