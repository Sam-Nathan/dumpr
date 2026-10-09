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
    <main className="min-h-screen bg-[#16141B] text-[#F4F3F6]">
      <section className="mx-auto flex max-w-5xl flex-col px-4 pb-20 pt-8 md:px-8">
        <nav className="flex items-center justify-between">
          <span className="font-display text-[28px] font-extrabold tracking-tight text-flash">
            dumpr
          </span>
        </nav>
        <h1 className="mt-20 max-w-3xl font-display text-[44px] font-extrabold leading-[1.02] md:text-[72px]">
          Everyone&rsquo;s photos. One place. No chasing.
        </h1>
        <p className="mt-6 max-w-xl font-body text-[18px] text-[#B5B1BC]">
          Dumpr is a camera-first app for shared photos. Start a Roll, add your shots, and everyone
          in the Crew gets them all.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <span className="btn-flash">Get the app</span>
        </div>
      </section>
      <section className="mx-auto grid max-w-5xl gap-4 px-4 pb-24 md:grid-cols-3 md:px-8">
        {STEPS.map(([title, body], i) => (
          <div key={title} className="rounded-card bg-[#1B1A20] p-6">
            <span className="font-mono text-[13px] text-flash">0{i + 1}</span>
            <h2 className="mt-3 font-display text-[22px] font-bold">{title}</h2>
            <p className="mt-2 font-body text-[15px] text-[#B5B1BC]">{body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
