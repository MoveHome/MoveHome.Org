export const metadata = {
  title: 'Privacy Policy — MoveHome.org'
};

const code = 'rounded border border-[var(--border)] bg-[var(--bg-elev)] px-1 text-[var(--text)]';

export default function PrivacyPage() {
  return (
    <article className="max-w-3xl mx-auto px-4 py-10 text-[var(--text-dim)]">
      <h1 className="text-3xl font-semibold mb-4 text-[var(--text)]">Privacy Notice</h1>

      <p className="mb-4">
        Move Home Organisation CIC (&quot;MoveHome&quot;, &quot;we&quot;, &quot;us&quot;), registered in England &amp; Wales (Co. No. 17202438), operates movehome.org as a free, open, not-for-profit property listing aggregator. This notice sets out how we handle data under UK GDPR and PECR.
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-3 text-[var(--text)]">1. Zero Accounts & Zero Tracking</h2>
      <p className="mb-4">
        MoveHome requires zero user accounts or logins to browse listings. We do not use third-party tracking, advertising, or analytics cookies.
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-3 text-[var(--text)]">2. Local Storage & Preferences</h2>
      <p className="mb-4">
        Your saved property listings and UI preferences (such as theme, narration voice, app language, and preferred contact channel) are saved locally on your device in browser <code className={code}>localStorage</code>. They remain on your device and are never sent to or stored on our servers.
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-3 text-[var(--text)]">3. Server Data Processing</h2>
      <ul className="list-disc pl-5 mb-4 space-y-2">
        <li>
          <strong className="text-[var(--text)]">Country Default:</strong> The incoming <code className={code}>x-vercel-ip-country</code> HTTP header is read in-memory to set your initial country view and is not logged or persisted.
        </li>
        <li>
          <strong className="text-[var(--text)]">Rate Limiting & Abuse Protection:</strong> Standard IP addresses are processed temporarily for rate limiting and abuse prevention on public endpoints such as <code className={code}>/api/mcp</code> and <code className={code}>/api/tts</code>.
        </li>
        <li>
          <strong className="text-[var(--text)]">Viewing Enquiries:</strong> Details submitted explicitly when requesting a viewing are forwarded directly to the listing estate agency (the legal data controller for the viewing).
        </li>
        <li>
          <strong className="text-[var(--text)]">A2A Registry Cards:</strong> Public agent registry cards submitted to the network are published publicly as intended.
        </li>
      </ul>

      <h2 className="text-xl font-semibold mt-8 mb-3 text-[var(--text)]">4. Your UK GDPR Rights</h2>
      <p className="mb-4">
        Under UK GDPR, you have rights of access, rectification, and erasure regarding any personal data processed. For privacy enquiries or rights requests, email us at <a href="mailto:privacy@movehome.org" className="text-[var(--accent)] hover:text-[var(--accent-hover)] underline">privacy@movehome.org</a>. You also have the right to lodge a complaint with the UK Information Commissioner&apos;s Office (ICO).
      </p>

      <p className="mt-10 text-sm">
        <a href="/" className="text-[var(--accent)] hover:text-[var(--accent-hover)] underline">← Back to MoveHome.org</a>
      </p>
    </article>
  );
}
