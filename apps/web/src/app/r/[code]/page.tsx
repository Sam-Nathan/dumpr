import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Join Roll' };

// TODO: look up the Roll by invite code (public RPC), show its name + cover, and deep-link into the app.
export default async function JoinRollPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#16141B] px-4 text-center text-[#F4F3F6]">
      <span className="font-display text-[28px] font-extrabold text-flash">dumpr</span>
      <h1 className="mt-8 font-display text-[36px] font-extrabold">Join Roll</h1>
      <p className="mt-3 font-body text-[16px] text-[#B5B1BC]">
        You&rsquo;ve been invited with code <span className="font-mono text-flash">{code}</span>.
      </p>
      <span className="btn-flash mt-8">Open in Dumpr</span>
    </main>
  );
}
