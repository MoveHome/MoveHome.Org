export const metadata = {
  title: 'Charter — MoveHome.org'
};

export default function CharterPage() {
  return (
    <article className="max-w-3xl mx-auto px-4 py-10 prose prose-invert">
      <h1 className="text-3xl font-semibold mb-4 text-zinc-100">The MoveHome Charter</h1>
      <p className="mb-4 text-zinc-300">
        MoveHome CIC is founded on the principle of open, accessible, and fee-free property discovery for everyone.
      </p>
      <h2 className="text-xl font-semibold mt-8 mb-3 text-zinc-100">1. Zero Agency Fees</h2>
      <p className="mb-4 text-zinc-300">
        We never charge estate agencies to list their properties or gain visibility.
      </p>
      <h2 className="text-xl font-semibold mt-8 mb-3 text-zinc-100">2. Agent & AI Equality</h2>
      <p className="mb-4 text-zinc-300">
        Human searchers and personal AI agents receive equal, unhindered access to open property feeds.
      </p>
    </article>
  );
}
