import ThemeToggle from '@/components/ThemeToggle';

function BotInShield({ className = "w-10 h-10" }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" className={className} aria-hidden="true">
      {/* Shield Outline with dynamic theme colors */}
      <path
        d="M20 2 L35 6.5 V18 C35 26.5 28.5 34 20 37.5 C11.5 34 5 26.5 5 18 V6.5 Z"
        fill="var(--tint-lightest)"
        stroke="var(--accent)"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {/* Pixel-art bot logo centered inside the shield */}
      <g transform="translate(4, 4)">
        <rect x="12" y="1" width="8" height="4" fill="var(--accent)"/>
        <rect x="14" y="4" width="4" height="4" fill="var(--accent)"/>
        <rect x="5" y="7" width="22" height="18" fill="var(--accent)"/>
        <rect x="8" y="25" width="16" height="3" fill="var(--accent-hover)"/>
        <rect x="9" y="11" width="5" height="5" fill="#ffffff"/>
        <rect x="18" y="11" width="5" height="5" fill="#ffffff"/>
      </g>
    </svg>
  );
}

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col justify-between bg-[var(--bg)] text-[var(--text)] font-sans selection:bg-[var(--tint-light)] selection:text-[var(--accent-hover)]">

      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 h-16 border-b border-[var(--border)] bg-[var(--bg)]/80 backdrop-blur-md px-6 md:px-12 flex items-center justify-between">
        <a href="#" className="flex items-center gap-3 group focus:outline-none focus:ring-2 focus:ring-[var(--accent)] rounded-md px-2 py-1">
          <BotInShield className="w-8 h-8 group-hover:scale-105 transition-transform" />
          <span className="text-lg font-bold tracking-tight font-sans">
            MoveHome<span className="text-[var(--accent)]">.org</span>
          </span>
        </a>
        <div className="flex items-center gap-4">
          <a
            href="/search"
            className="text-sm font-medium text-[var(--text-dim)] hover:text-[var(--accent)] transition-colors hidden sm:inline-block focus:outline-none focus:ring-2 focus:ring-[var(--accent)] rounded"
          >
            Browse Properties
          </a>
          <a
            href="/registry"
            className="text-sm font-medium text-[var(--text-dim)] hover:text-[var(--accent)] transition-colors hidden sm:inline-block focus:outline-none focus:ring-2 focus:ring-[var(--accent)] rounded"
          >
            Agent Registry
          </a>
          <a
            href="https://estateaigents.org/charter.html"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-[var(--text-dim)] hover:text-[var(--accent)] transition-colors hidden sm:inline-block focus:outline-none focus:ring-2 focus:ring-[var(--accent)] rounded"
          >
            The Charter
          </a>
          <ThemeToggle />
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 pt-32 pb-16 px-6 md:px-12 max-w-5xl mx-auto flex flex-col items-center justify-center">

        {/* Hero Section */}
        <section className="text-center mb-16 flex flex-col items-center">
          <div className="relative mb-8 group">
            {/* Soft breathing background glow */}
            <div className="absolute inset-0 bg-[var(--accent)] rounded-full filter blur-xl opacity-20 group-hover:opacity-35 transition-opacity animate-pulse-glow" style={{ width: '80px', height: '80px', margin: 'auto' }}></div>
            <BotInShield className="w-20 h-20 relative hover:scale-105 transition-transform duration-300 cursor-pointer" />
          </div>

          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[var(--border-bright)] bg-[var(--bg-elev)] text-xs font-semibold text-[var(--accent)] mb-6 tracking-wide uppercase">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-ping"></span>
            AI-Managed Property Network
          </div>

          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-6 max-w-3xl leading-tight">
            Browse properties.<br />
            <span className="text-[var(--accent)]">Let AI handle the rest.</span>
          </h1>

          <p className="text-lg md:text-xl text-[var(--text-dim)] max-w-2xl mx-auto leading-relaxed mb-4">
            MoveHome.org is a traditional property portal for humans — search, save, and enquire the familiar way.
            Behind the scenes, AI agents are managing the full transaction: viewings, compliance, references, and rent.
          </p>

          <a
            href="/search"
            className="mt-4 inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white dark:text-black font-bold text-base transition-all shadow-sm shadow-[var(--accent)]/20 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          >
            Search Properties →
          </a>
        </section>

        {/* Two-door explainer */}
        <section className="w-full grid grid-cols-1 md:grid-cols-2 gap-8 mb-16">

          {/* Human door */}
          <div className="flex flex-col justify-between p-8 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--accent)] transition-all group">
            <div>
              <div className="text-xs font-mono text-[var(--accent)] uppercase tracking-wider mb-2">For Humans</div>
              <h3 className="text-2xl font-bold tracking-tight mb-3">Browse the portal</h3>
              <p className="text-sm text-[var(--text-dim)] leading-relaxed mb-6">
                Search listings, book viewings, and submit enquiries the familiar way.
                No new apps to learn. The AI works in the background — you just pick a home.
              </p>
              <ul className="text-xs text-[var(--text-dim)] space-y-1.5 mb-6">
                <li className="flex items-center gap-2"><span className="text-[var(--accent)]">✓</span> Search by area, price, bedrooms</li>
                <li className="flex items-center gap-2"><span className="text-[var(--accent)]">✓</span> Book viewings instantly</li>
                <li className="flex items-center gap-2"><span className="text-[var(--accent)]">✓</span> Reference checks &amp; contracts handled automatically</li>
              </ul>
            </div>
            <a
              href="/search"
              className="w-full py-3.5 px-6 rounded-xl border border-[var(--border-bright)] group-hover:border-[var(--accent)] hover:bg-[var(--accent)] hover:text-white dark:hover:text-black font-semibold text-sm text-center transition-all focus:outline-none focus:ring-2 focus:ring-[var(--accent)] flex items-center justify-center gap-1.5"
            >
              Start browsing
              <span className="text-xs">→</span>
            </a>
          </div>

          {/* Agent door */}
          <div className="flex flex-col justify-between p-8 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--accent)] transition-all group">
            <div>
              <div className="text-xs font-mono text-[var(--accent)] uppercase tracking-wider mb-2">For AI Agents</div>
              <h3 className="text-2xl font-bold tracking-tight mb-3">Talk to our agents</h3>
              <p className="text-sm text-[var(--text-dim)] leading-relaxed mb-6">
                Point your AI assistant at our <strong>Agent Card</strong> — it can discover, inspect,
                and enquire on listings entirely agent-to-agent using the open <span className="text-[var(--accent)] font-semibold">RAIA</span> protocol.
              </p>
              <ul className="text-xs text-[var(--text-dim)] space-y-1.5 mb-6">
                <li className="flex items-center gap-2"><span className="text-[var(--accent)]">✓</span> Google A2A endpoint — live at <code className="text-[var(--accent)]">/.well-known/agent.json</code></li>
                <li className="flex items-center gap-2"><span className="text-[var(--accent)]">✓</span> Search, get, and enquire skills over JSON-RPC</li>
                <li className="flex items-center gap-2"><span className="text-[var(--text-dim)]">◷</span> MCP server for property discovery — coming next</li>
              </ul>
            </div>
            <a
              href="/.well-known/agent.json"
              className="w-full py-3.5 px-6 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white dark:text-black font-semibold text-sm text-center transition-all focus:outline-none focus:ring-2 focus:ring-[var(--accent)] flex items-center justify-center gap-1.5 shadow-sm shadow-[var(--accent)]/10"
            >
              View our Agent Card
              <span className="text-xs">↗</span>
            </a>
          </div>

        </section>

        {/* How it works — single sentence each */}
        <section className="w-full p-8 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] mb-8 text-center">
          <h2 className="text-sm font-mono text-[var(--accent)] uppercase tracking-wider mb-4">How it works</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <div className="text-2xl mb-2">🏠</div>
              <div className="text-sm font-semibold mb-1">You browse</div>
              <div className="text-xs text-[var(--text-dim)]">Search and shortlist properties the traditional way on this portal.</div>
            </div>
            <div>
              <div className="text-2xl mb-2">🤖</div>
              <div className="text-sm font-semibold mb-1">Agents transact</div>
              <div className="text-xs text-[var(--text-dim)]">Estate agent AI at estateaigents.com handles viewings, references, contracts, and rent — no human chasing.</div>
            </div>
            <div>
              <div className="text-2xl mb-2">🔑</div>
              <div className="text-sm font-semibold mb-1">You move in</div>
              <div className="text-xs text-[var(--text-dim)]">The full transaction is completed at a flat £1/property rate. No hidden fees.</div>
            </div>
          </div>
        </section>

      </main>

      {/* Footer */}
      <footer className="w-full border-t border-[var(--border)] bg-[var(--bg-elev)]/50 py-8 px-6 md:px-12">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="text-xs font-mono text-[var(--text-dim)] text-center md:text-left leading-relaxed">
            Move Home Organisation CIC · Registered in England &amp; Wales · Co. No. 17202438<br />
            An asset-locked Community Interest Company governed by the CIC Regulator.
          </div>
          <div className="flex gap-6 text-xs font-semibold text-[var(--text-dim)]">
            <a href="https://estateaigents.com" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--accent)] transition-colors">.com</a>
            <a href="https://estateaigents.org" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--accent)] transition-colors">.org</a>
            <a href="https://github.com/MoveHome/MoveHome.Org" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--accent)] transition-colors">GitHub</a>
            <a href="https://estateaigents.org/charter.html" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--accent)] transition-colors">Charter</a>
          </div>
        </div>
      </footer>

    </div>
  );
}
