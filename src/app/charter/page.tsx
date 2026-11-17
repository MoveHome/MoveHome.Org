export const metadata = {
  title: 'Charter — MoveHome.org'
};

// Full RAIA / MoveHome Charter. Source: https://estateaigents.org/charter.html
// Colours come only from the Light/Dark CSS variables in globals.css.

const H2 = 'mt-10 mb-3 text-2xl font-semibold text-[var(--text)]';
const H3 = 'mt-6 mb-2 text-lg font-semibold text-[var(--text)]';
const P = 'mb-4 leading-relaxed';
const LI = 'mb-3 leading-relaxed';

function SectionLabel({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <p className="mt-12 mb-1 text-[11px] font-bold uppercase tracking-widest text-[var(--accent)]">
      {n} · {children}
    </p>
  );
}

const PRINCIPLES: [string, string][] = [
  [
    'The protocol is infrastructure, not a product',
    'RAIA Protocol is not a marketplace. It is not a portal. It is infrastructure — like HTTP, like SMTP, like Ethernet — that enables other things to be built on top of it. Infrastructure that works does not charge for its existence.'
  ],
  [
    'No single actor controls it',
    'No company, no individual, no government body holds a controlling position in RAIA Protocol governance. This is not a policy preference. It is a structural requirement encoded in the governance of Move Home Organisation CIC, the entity that holds the protocol in trust.'
  ],
  [
    'The community it serves governs it',
    'Estate agents, PropTech developers, tenants, buyers, and regulators all have a stake in how property transactions work. All have a seat in how this protocol evolves. Governance is multi-stakeholder by design.'
  ],
  [
    'Compliance is local, mechanics are global',
    'Property law is hyperlocal. The protocol’s mechanics — how agents find each other, query data, verify identity, and execute transactions — are globally uniform. The compliance layer is locally defined and community-contributed through jurisdictional modules. No jurisdiction is subordinate to any other.'
  ],
  [
    'Transparency is non-negotiable',
    'Every governance decision is made in public and logged permanently. No private sessions. No commercial side-agreements that affect the protocol’s behaviour.'
  ],
  [
    'The end client is always protected',
    'AI agents transacting property on behalf of buyers and tenants never expose end-client identity in protocol messages. Qualification signals are transmitted. Personal data is not. The protocol enforces data minimisation at the schema level.'
  ]
];

const COMMITMENTS = [
  'The protocol will be governed by a multi-stakeholder community foundation. Move Home Organisation CIC holds the trademark. EstateAigents Ltd has one seat on the board — not a controlling seat. Move Home Organisation CIC was incorporated on 6 May 2026 (Co. 17202438, England and Wales).',
  'The RAIA™ trademark will be held by Move Home Organisation CIC in trust for the property industry. It will not be exclusively licensed to any commercial entity.',
  'The registry criteria will be published and enforced transparently. Admission will not be at the discretion of any single commercial actor.',
  'The core protocol schema will evolve through open community process. No private amendments.',
  'If EstateAigents Ltd ceases to exist, the protocol continues. The CIC holds the trademark. The GitHub repo is public. The schemas are MIT licensed.',
  'MoveHome.org will remain free to list on. No agent listing fees. No consumer access charges. Ever.'
];

const CONTENTS: [string, string][] = [
  ['#preamble', 'Preamble'],
  ['#the-problem', 'I. The Problem'],
  ['#the-response', 'II. The Response'],
  ['#the-principles', 'III. The Principles'],
  ['#historical-context', 'IV. Historical Context'],
  ['#cic-rationale', 'IV-A. Why a CIC'],
  ['#the-invitation', 'V. The Invitation'],
  ['#the-commitment', 'VI. The Commitment'],
  ['#what-we-ask', 'VII. What We Ask']
];

const Code = ({ children }: { children: string }) => (
  <pre className="mb-4 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-4 text-xs text-[var(--text-dim)]">
    {children}
  </pre>
);

export default function CharterPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-10 text-[var(--text-dim)]">
      <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--accent)]">
        Founding Document · April 2026
      </p>
      <h1 className="mt-2 text-3xl font-semibold text-[var(--text)]">The RAIA Charter</h1>
      <p className="mt-2 text-sm text-[var(--text-faint)]">
        An Open Standard for Property AI · Version 1.0 · Governed by Move Home Organisation CIC ·
        Co. 17202438 · MIT Licensed
      </p>

      <nav className="mt-8 rounded-2xl border border-[var(--border)] bg-[var(--bg-elev)] p-4 text-sm">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--text-faint)]">
          Contents
        </p>
        <ol className="grid gap-1 sm:grid-cols-2">
          {CONTENTS.map(([href, label]) => (
            <li key={href}>
              <a href={href} className="text-[var(--accent)] underline hover:text-[var(--accent-hover)]">
                {label}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <section id="preamble">
        <SectionLabel n="Preamble">Why this exists</SectionLabel>
        <h2 className={H2}>Why this exists.</h2>
        <p className={P}>
          Property is shelter. Shelter is not a commodity. And yet the infrastructure through which
          people find homes — portals, platforms, databases — has been built to extract value from
          the transaction rather than to serve the people in it.
        </p>
        <p className={P}>
          This Charter establishes the principles, the governance, and the invitation behind RAIA
          Protocol — the open standard for AI agents to transact property — and MoveHome.org, its
          public expression. Together they form a single argument: that the infrastructure of
          property transactions should be a commons, not a toll road.
        </p>
        <p className={P}>
          We publish this now — before the protocol has commercial value — because that is the only
          moment such a commitment is credible.
        </p>
      </section>

      <section id="the-problem">
        <SectionLabel n="Section I">The Problem</SectionLabel>
        <h2 className={H2}>The portal toll — a global phenomenon</h2>
        <p className={P}>
          In every country where residential property portals operate, the same dynamic plays out.
          Portals aggregate listings from estate agents, landlords and developers. They charge
          agents — and increasingly, consumers — for access to that aggregated inventory. The fees
          compound across every branch, every market, every month.
        </p>
        <p className={P}>
          Based on the publicly reported annual revenues of the world&apos;s largest listed property
          portal companies, we can credibly reason that{' '}
          <strong className="text-[var(--text)]">
            agents worldwide pay in excess of $10 billion annually to portal platforms
          </strong>{' '}
          for the right to advertise properties they themselves own or manage.
        </p>
        <p className={P}>
          That figure does not include the additional costs agents absorb from CRM systems, listing
          tools, compliance platforms, and social media management — all of which have grown up
          around the portal ecosystem and bill accordingly.
        </p>
        <p className={P}>
          In 2025–26, a £1.5 billion class action lawsuit was filed at the UK Competition Appeal
          Tribunal against the UK&apos;s largest residential property portal — a matter of public
          record and the clearest legal articulation yet of what agents and consumers have
          experienced for years: that portal pricing has become systematically extractive.
        </p>
        <p className={P}>
          The UK lawsuit is not an isolated event. It is the visible tip of a structural problem
          that exists in every market where portals have achieved dominant positions — Australia,
          the United States, Germany, France, Spain, the UAE, Southeast Asia, and beyond.
        </p>

        <h3 className={H3}>How the cost reaches tenants and buyers</h3>
        <p className={P}>
          The portal fee does not stay with the agent. It cannot. It flows through the transaction:
        </p>
        <Code>{`Portal charges agent → agent absorbs into operating costs
        ↓
Agent raises management fees to landlord
        ↓
Landlord factors cost into asking rent or sale price
        ↓
Tenant pays higher rent. Buyer pays more.`}</Code>
        <p className={P}>
          This is not a guarantee or a precise calculation. Markets are complex. But the mechanism
          is clear:{' '}
          <strong className="text-[var(--text)]">
            a cost that enters the transaction at the agent level does not disappear — it
            propagates upward through the price chain.
          </strong>
        </p>
        <p className={P}>
          Remove that cost from the equation and the saving becomes available — to the agent, to the
          landlord, and ultimately to the tenant or buyer. The market determines what happens to
          that saving. The protocol removes the cost. What flows from that is a market decision, not
          a protocol promise.
        </p>

        <h3 className={H3}>The AI inflection</h3>
        <p className={P}>
          AI agents are now capable of finding a home, qualifying requirements, checking
          availability, requesting a viewing, and managing a transaction — without human
          intervention at each step. This is already happening. It is happening via web scraping,
          via fragile proprietary integrations, via informal workarounds.
        </p>
        <p className={P}>
          The absence of a protocol is not preventing AI property transactions. It is making them
          slow, unverified, legally exposed — and creating the conditions for a new form of capture:
          not by portals, but by the AI platforms that will process property transactions at scale
          if no open standard exists.
        </p>
        <p className={P}>
          <strong className="text-[var(--text)]">
            If the infrastructure layer of property AI is controlled by any single commercial actor,
            the toll booth moves but does not disappear.
          </strong>
        </p>

        <h3 className={H3}>The capture risk</h3>
        <p className={P}>
          The history of the internet is a history of open infrastructure being enclosed. Email
          began as an open protocol — and was enclosed into surveillance advertising platforms. The
          web began as an open standard — and search was enclosed into a duopoly. Social connection
          began as an open idea — and was enclosed into data extraction machines.
        </p>
        <p className={P}>
          In every case, the enclosure happened at the infrastructure layer — the protocol, the
          index, the identity system — before the community recognised what was being lost.
        </p>
        <p className={P}>
          Property AI is at that moment now. The protocol layer is being built. The question is
          whether it is built as a commons or as the next enclosure.
        </p>
      </section>

      <section id="the-response">
        <SectionLabel n="Section II">The Response</SectionLabel>
        <h2 className={H2}>The Response — Two Layers</h2>
        <h3 className={H3}>RAIA Protocol — the machine layer</h3>
        <p className={P}>
          RAIA (Real Estate Artificial Intelligence Agent Protocol) is the open standard for AI
          agents to discover, verify, and transact property — lettings, sales, and management —
          directly between agents, without a portal in the middle.
        </p>
        <p className={P}>
          Built on Google&apos;s A2A Protocol (donated to the Linux Foundation) and Anthropic&apos;s
          Model Context Protocol (MCP), RAIA adds the property-specific vocabulary and trust layer
          that general AI infrastructure does not provide.
        </p>
        <Code>{`Google A2A    →  How agents find and talk to each other
RAIA Protocol →  What property agents say — property vocabulary and trust
Anthropic MCP →  How agents connect to property data tools`}</Code>
        <p className={P}>
          Any AI assistant that speaks MCP can query any RAIA-compliant agent&apos;s portfolio. Any
          AI agent that speaks A2A can transact with any other RAIA participant. No portal required.
          No proprietary integration required. No monthly fee to a listing aggregator required.
        </p>
        <p className={P}>
          The protocol is MIT licensed. Anyone can implement it. The schemas, the agent card format,
          the enquiry lifecycle — all open, all free.
        </p>

        <h3 className={H3}>MoveHome.org — the human layer</h3>
        <p className={P}>
          RAIA Protocol enables AI-to-AI property transactions. MoveHome.org is the human face of
          the same infrastructure.
        </p>
        <p className={P}>
          MoveHome.org is a free, not-for-profit property listings portal — for tenants looking for
          homes, buyers searching for properties, landlords marketing their portfolio, and agents
          publishing their listings. No listing fees. No lead generation charges. No subscription
          tiers.
        </p>
        <p className={P}>
          Agents who implement RAIA Protocol receive automatic free listings on MoveHome.org. The
          portal is funded by the community it serves — not by charging agents for access to their
          own market.
        </p>
        <p className={P}>
          Together, RAIA Protocol and MoveHome.org form a complete response to the portal problem:
        </p>
        <ul className="mb-4 list-disc pl-6">
          <li className={LI}>
            <strong className="text-[var(--text)]">RAIA</strong> handles AI-to-AI transactions —
            the future of how property is found
          </li>
          <li className={LI}>
            <strong className="text-[var(--text)]">MoveHome</strong> handles human search — the
            present, made free
          </li>
        </ul>
      </section>

      <section id="the-principles">
        <SectionLabel n="Section III">The Principles</SectionLabel>
        <h2 className={H2}>The 6 Principles</h2>
        <ol className="mb-4 space-y-4 pl-0">
          {PRINCIPLES.map(([title, body], i) => (
            <li key={title} className="rounded-2xl border border-[var(--border)] bg-[var(--bg-elev)] p-4">
              <p className="mb-1 text-sm font-semibold text-[var(--text)]">
                {i + 1}. {title}
              </p>
              <p className="text-sm leading-relaxed">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="historical-context">
        <SectionLabel n="Section IV">Historical Context</SectionLabel>
        <h2 className={H2}>The Historical Context</h2>
        <p className={P}>
          Every protocol that became infrastructure followed the same path: published openly,
          adopted freely, governed collectively, and eventually so embedded that no single actor
          could capture it.
        </p>
        <ul className="mb-4 list-disc pl-6">
          <li className={LI}>
            <strong className="text-[var(--text)]">SMTP (1982)</strong> — Jon Postel published RFC
            821. No company owns email. Every company uses it.
          </li>
          <li className={LI}>
            <strong className="text-[var(--text)]">HTTP (1991)</strong> — Tim Berners-Lee published
            the web proposal at CERN. The W3C — a multi-stakeholder body — governs its evolution.
            No company owns the web.
          </li>
          <li className={LI}>
            <strong className="text-[var(--text)]">TCP/IP (1974)</strong> — Cerf and Kahn published
            the protocol. It became the internet.
          </li>
          <li className={LI}>
            <strong className="text-[var(--text)]">Bitcoin (2008)</strong> — Published without
            institutional backing. No company owns it. The protocol survives because there is no
            single point of capture.
          </li>
          <li className={LI}>
            <strong className="text-[var(--text)]">Linux (1991)</strong> — Torvalds started it. The
            Linux Foundation governs it. Hundreds of companies contribute. None controls it.
          </li>
        </ul>
        <p className={P}>
          In each case, the founding decision — to publish openly, to govern collectively, to refuse
          enclosure — determined everything that followed.
        </p>

        <h3 className={H3}>Why previous property protocol attempts failed</h3>
        <p className={P}>
          Four serious attempts have been made to create open property data standards. All failed
          for the same structural reasons: designed for one market&apos;s legal model, built for
          portal syndication not agent-to-agent transactions, and governed by bodies with
          conflicting commercial interests that converged on the lowest common denominator — the
          status quo.
        </p>
        <p className={P}>
          RAIA is not governed by a working group of incumbents. It is governed by a community
          interest company whose legal structure prevents any single commercial actor from capturing
          it.
        </p>

        <h3 className={H3}>Why now</h3>
        <p className={P}>
          Two things changed between 2024 and 2026 that make this possible for the first time.
        </p>
        <p className={P}>
          <strong className="text-[var(--text)]">The transport layer now exists.</strong> Google&apos;s
          A2A Protocol and Anthropic&apos;s MCP provide the infrastructure for AI agents to find
          each other and communicate. RAIA only needs to define what property agents say to each
          other on top of existing open infrastructure.
        </p>
        <p className={P}>
          <strong className="text-[var(--text)]">The demand is real and growing.</strong> AI
          assistants are already attempting property transactions. The scraping, the workarounds,
          the bespoke integrations are the market signalling that a standard is needed.
        </p>
      </section>

      <section id="cic-rationale">
        <SectionLabel n="Section IV-A">Why a CIC</SectionLabel>
        <h2 className={H2}>
          Why we structured this as a CIC before the protocol had commercial value
        </h2>
        <p className={P}>
          In May 2026, a federal jury in Oakland dismissed Elon Musk&apos;s lawsuit against OpenAI
          and Sam Altman in under two hours. The case was not decided on the merits. It was
          dismissed because Musk had waited too long to sue — statute of limitations.
        </p>
        <p className={P}>
          Notably, OpenAI&apos;s defence was not &quot;we didn&apos;t do it.&quot; It was:{' '}
          <strong className="text-[var(--text)]">&quot;You noticed too late.&quot;</strong>
        </p>
        <p className={P}>
          That defence only works when a nonprofit mission is held in place by policy, culture, and
          the goodwill of whoever happens to be in charge. By the time anyone notices the mission has
          drifted, the clock has run. The structure has already changed. The legal window is closed.
        </p>
        <blockquote className="mb-4 border-l-2 border-[var(--accent)] pl-4 text-sm italic">
          &quot;The judge &amp; jury never actually ruled on the merits of the case, just on a
          calendar technicality. … I will be filing an appeal with the Ninth Circuit, because
          creating a precedent to loot charities is incredibly destructive to charitable giving in
          America. OpenAI was founded to benefit all of humanity.&quot;
          <footer className="mt-1 not-italic text-[var(--text-faint)]">
            — Elon Musk (@elonmusk), 18 May 2026
          </footer>
        </blockquote>
        <p className={P}>
          Whether Musk is correct on the merits is not the point. The point is that{' '}
          <strong className="text-[var(--text)]">
            &quot;you noticed too late&quot; is a viable legal defence
          </strong>{' '}
          when governance rests on intent rather than structure.
        </p>
        <p className={P}>We drew the obvious conclusion.</p>
        <p className={P}>
          <strong className="text-[var(--text)]">
            RAIA Protocol is a not-for-profit open standard.
          </strong>{' '}
          It is governed by Move Home Organisation CIC (Co. 17202438, incorporated 6 May 2026) — a
          UK Community Interest Company. The CIC holds the RAIA trademark in trust for the property
          industry. Its asset lock is enforced by the CIC Regulator — not by board policy, not by a
          founding promise, not by goodwill.
        </p>
        <p className={P}>The structural difference from OpenAI:</p>
        <ul className="mb-4 list-disc pl-6">
          <li className={LI}>
            A CIC cannot transfer assets to members, directors, or any commercial entity — including
            EstateAigents Ltd
          </li>
          <li className={LI}>The asset lock is permanent and regulated externally</li>
          <li className={LI}>
            It cannot be voted away, restructured around, or eroded gradually while a statute of
            limitations runs
          </li>
          <li className={LI}>
            Anyone can check the CIC register at any time — Companies House, Co. 17202438
          </li>
        </ul>
        <p className={P}>
          <strong className="text-[var(--text)]">
            We made this decision in May 2026 — before the RAIA trademark had significant commercial
            value, before MoveHome.org had launched, before the protocol had paying users.
          </strong>{' '}
          That is the only moment a commitment of this kind is credible. OpenAI could not have made
          it in 2024 — the value already existed.
        </p>
        <p className={P}>
          EstateAigents Ltd is the founding contributor. It holds one non-controlling board seat. It
          benefits from free listings on MoveHome.org and a non-exclusive trademark licence. That is
          the full extent of its position. The protocol does not belong to EstateAigents Ltd. It
          belongs to the community it serves.
        </p>
        <p className="mb-2 text-xs text-[var(--text-faint)]">
          References: Musk v. Altman et al., US District Court, Northern District of California
          (Oakland). Verdict 18 May 2026; all claims dismissed on statute of limitations grounds.
          Move Home Organisation CIC:{' '}
          <a
            className="text-[var(--accent)] underline"
            href="https://find-and-update.company-information.service.gov.uk/company/17202438"
          >
            Companies House Co. 17202438
          </a>
          . Canonical charter:{' '}
          <a
            className="text-[var(--accent)] underline"
            href="https://github.com/estateaigents/raia-protocol/blob/main/CHARTER.md"
          >
            github.com/estateaigents/raia-protocol
          </a>
          .
        </p>
      </section>

      <section id="the-invitation">
        <SectionLabel n="Section V">The Invitation</SectionLabel>
        <h2 className={H2}>The Invitation</h2>
        <h3 className={H3}>To estate agents</h3>
        <p className={P}>
          Your data is your most valuable asset. Open protocol infrastructure means your portfolio is
          accessible to every AI assistant that queries RAIA — without paying a portal for the
          privilege.
        </p>
        <p className={P}>
          MoveHome.org gives your listings a free public presence. RAIA Protocol gives your AI agent
          a standard interface to every other participating agent. Together they replace the portal
          dependency with an open alternative.
        </p>
        <p className={P}>
          Join the waitlist at <strong className="text-[var(--text)]">estateaigents.com</strong>.
          List for free at <strong className="text-[var(--text)]">movehome.org</strong>.
        </p>

        <h3 className={H3}>To PropTech developers</h3>
        <p className={P}>
          The schemas are in development. The MCP server is being built. Join the schema working
          group now. Open an issue at{' '}
          <a
            className="text-[var(--accent)] underline"
            href="https://github.com/estateaigents/raia-protocol"
          >
            github.com/estateaigents/raia-protocol
          </a>{' '}
          with the label <code>schema-working-group</code>.
        </p>

        <h3 className={H3}>To portal operators</h3>
        <p className={P}>
          RAIA is not a competitor to your product. It is the transport layer that makes your
          product interoperable with the AI ecosystem. The portal that implements RAIA first stops
          being a toll booth and starts being a node. Contact us at{' '}
          <strong className="text-[var(--text)]">admin@estateaigents.org</strong>.
        </p>

        <h3 className={H3}>To AI developers</h3>
        <p className={P}>
          If your assistant speaks MCP, it can query any RAIA-compliant agent&apos;s portfolio. The
          reference MCP server publishes at <code>mcp.estateaigents.com</code> with v1.0 in Q3 2026.
        </p>

        <h3 className={H3}>To regulators and industry bodies</h3>
        <p className={P}>
          The protocol&apos;s jurisdictional module architecture was designed with regulatory
          compliance in mind. Every jurisdiction&apos;s compliance requirements are encoded in a
          separate module that plugs into the global core. We are actively seeking input from
          professional bodies and regulatory authorities in every market where RAIA is being
          implemented. Contact us at{' '}
          <strong className="text-[var(--text)]">admin@estateaigents.org</strong>.
        </p>

        <h3 className={H3}>To the community</h3>
        <p className={P}>
          Move Home Organisation CIC — the entity that holds the trademark and governs the registry
          — was incorporated on 6 May 2026 (Co. 17202438). Board seats will be announced here.
          Governance criteria will be published.
        </p>
        <p className={P}>
          If you believe that property infrastructure should be a commons — this is where that
          belief becomes a structure rather than a sentiment.
        </p>
      </section>

      <section id="the-commitment">
        <SectionLabel n="Section VI">The Commitment</SectionLabel>
        <h2 className={H2}>The 6 Commitments</h2>
        <p className={P}>We commit to the following, publicly and permanently:</p>
        <ol className="mb-4 space-y-4 pl-0">
          {COMMITMENTS.map((body, i) => (
            <li
              key={body}
              className="rounded-2xl border border-[var(--border)] bg-[var(--bg-elev)] p-4 text-sm leading-relaxed"
            >
              <span className="mr-2 font-bold text-[var(--accent)]">{i + 1}.</span>
              {body}
            </li>
          ))}
        </ol>
      </section>

      <section id="what-we-ask">
        <SectionLabel n="Section VII">What We Ask</SectionLabel>
        <h2 className={H2}>What We Ask</h2>
        <p className={P}>
          Read the spec. Implement the protocol. Find what it gets wrong. Tell us in a GitHub issue.
        </p>
        <p className={P}>
          Join the schema working group. Contribute a jurisdiction module. Express interest in a
          board seat.
        </p>
        <p className={P}>This Charter is the beginning of that conversation.</p>
        <p className="mt-8 text-xs text-[var(--text-faint)]">
          RAIA™ is a registered UK trademark (UK00003359082, Classes 36 + 42, registered 2018).
          Protocol specification MIT licensed. Move Home Organisation CIC — incorporated 6 May 2026
          (Co. 17202438). Founding contributor: EstateAigents Ltd. Canonical source:{' '}
          <a
            className="text-[var(--accent)] underline"
            href="https://github.com/estateaigents/raia-protocol"
          >
            github.com/estateaigents/raia-protocol
          </a>{' '}
          ·{' '}
          <a className="text-[var(--accent)] underline" href="https://estateaigents.org/">
            estateaigents.org
          </a>{' '}
          ·{' '}
          <a className="text-[var(--accent)] underline" href="https://movehome.org/">
            movehome.org
          </a>
        </p>
      </section>

      <p className="mt-10 text-sm">
        <a href="/" className="text-[var(--accent)] underline hover:text-[var(--accent-hover)]">
          ← Back to MoveHome.org
        </a>
      </p>
    </article>
  );
}
