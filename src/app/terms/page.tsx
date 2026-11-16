export const metadata = {
  title: 'Terms of Use — MoveHome.org'
};

export default function TermsPage() {
  return (
    <article className="max-w-3xl mx-auto px-4 py-10 prose prose-invert">
      <h1 className="text-3xl font-semibold mb-4 text-zinc-100">Terms of Use</h1>

      <p className="mb-4 text-zinc-300">
        MoveHome CIC (&quot;MoveHome&quot;, &quot;we&quot;, &quot;us&quot;) operates movehome.org as a free, open, not-for-profit property listing aggregator. By using movehome.org, its API routes, MCP endpoints, or connected AI agent services, you agree to these Terms.
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-3 text-zinc-100">1. Open Access & Free Service</h2>
      <p className="mb-4 text-zinc-300">
        MoveHome is provided free of charge to buyers, renters, estate agents, and AI agents. No user accounts or OAuth credentials are required to search or view property listings.
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-3 text-zinc-100">2. Listing Data & Accuracy</h2>
      <p className="mb-4 text-zinc-300">
        Property listings displayed on MoveHome are aggregated directly from participating estate agency feeds via open protocols (such as the RAIA Protocol). While MoveHome continuously validates feed integrity, listing details (including availability, price, and specs) are provided by the respective listing agent. MoveHome makes no warranties regarding complete real-time accuracy.
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-3 text-zinc-100">3. AI Agent & MCP Usage</h2>
      <p className="mb-4 text-zinc-300">
        Our MCP endpoint (<code>/api/mcp</code>), A2A agent card (<code>/.well-known/agent-card.json</code>), and <code>/skills.md</code> are open for integration with personal AI agents (including Claude, ChatGPT, Hermes Agent, Gemini, and Cursor). Automated queries must respect standard rate limits and operate in good faith. Abuse or Denial-of-Service attempts will result in automated IP throttling.
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-3 text-zinc-100">4. Intellectual Property & Open Source</h2>
      <p className="mb-4 text-zinc-300">
        The MoveHome platform software is open source published under the MIT license on GitHub. Property branding and listing photos remain the intellectual property of their respective estate agencies.
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-3 text-zinc-100">5. Limitation of Liability</h2>
      <p className="mb-4 text-zinc-300">
        MoveHome CIC accepts no liability for any loss, damage, or inconvenience resulting from reliance on property information or temporary unavailability of our open endpoints.
      </p>
    </article>
  );
}
