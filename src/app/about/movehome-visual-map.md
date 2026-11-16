# MoveHome Decentralized Visual Map & SVG

Below is the high-fidelity SVG code and structural mapping for the MoveHome decentralized property ecosystem. This diagram illustrates the frictionless, direct peer-to-peer relationships between agents, tenants, and landlords, bypassing traditional closed property portals.

```xml
<!-- Visual map representing MoveHome.org Decentralized Ecosystem -->
<div class="space-y-8 p-6 border rounded-2xl bg-white shadow-sm" style="border-color: #e5e7eb; font-family: 'Inter', system-ui, sans-serif;">
  
  <div class="border-b pb-2 flex justify-between items-center" style="border-color: #f3f4f6;">
    <h3 class="text-base font-bold text-zinc-900">MoveHome.org: The Decentralized Property Ecosystem</h3>
    <span class="text-xs font-mono text-[#2563FF] font-bold uppercase tracking-wider">Visual Standard Map</span>
  </div>

  <p class="text-xs text-zinc-500 leading-relaxed">
    Unlike traditional closed-database property portals that charge estate agents high monthly toll fees, MoveHome.org acts as a free, federated, and decentralized public aggregator. It crawls open-standard feeds directly from sovereign agent nodes.
  </p>

  <!-- Interactive SVG Visual Chart -->
  <div class="w-full flex items-center justify-center p-4 border rounded-xl bg-slate-50" style="border-color: #f3f4f6;">
    <svg viewBox="0 0 840 320" class="w-full h-auto" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="movehome-grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#f1f5f9" stroke-width="0.5" />
        </pattern>
        <marker id="m-arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 1.5 L 6 5 L 0 8.5 z" fill="#2563FF" />
        </marker>
        <marker id="green-arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 1.5 L 6 5 L 0 8.5 z" fill="#16a34a" />
        </marker>
      </defs>
      <rect width="100%" height="100%" fill="url(#movehome-grid)" rx="12" />

      <!-- Nodes & Connections -->
      <g font-family="Inter, system-ui, sans-serif" font-size="10" font-weight="500">
        
        <!-- Node A: Sovereign Agent Node -->
        <rect x="30" y="30" width="180" height="90" rx="10" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5" />
        <rect x="30" y="30" width="180" height="25" rx="10" fill="#4f46e5" fill-opacity="0.05" />
        <text x="120" y="46" font-size="11" font-weight="bold" fill="#4f46e5" text-anchor="middle">Sovereign Local Agent</text>
        <text x="45" y="75" fill="#4b5563">● Owns Local Database</text>
        <text x="45" y="90" fill="#4b5563">● Publishes raia.json Feed</text>
        <text x="45" y="105" font-family="monospace" font-size="9" fill="#2563FF">/.well-known/raia-agent.json</text>

        <!-- Arrow: Agent -> Crawled -->
        <path d="M 210 75 L 315 75 L 315 130" stroke="#2563FF" stroke-width="1.5" stroke-dasharray="4,2" marker-end="url(#m-arrow)" />
        <text x="270" y="65" font-size="8" font-family="monospace" fill="#2563FF" text-anchor="middle">Crawled Feed</text>

        <!-- Node B: Independent Landlord -->
        <rect x="30" y="180" width="180" height="90" rx="10" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5" />
        <rect x="30" y="180" width="180" height="25" rx="10" fill="#16a34a" fill-opacity="0.05" />
        <text x="120" y="196" font-size="11" font-weight="bold" fill="#16a34a" text-anchor="middle">Independent Landlord</text>
        <text x="45" y="225" fill="#4b5563">● Registers Property</text>
        <text x="45" y="240" fill="#4b5563">● Protected by RGI</text>
        <text x="45" y="255" fill="#4b5563">● Indefinite Guarantor SOP</text>

        <!-- Arrow: Landlord -> Agent -->
        <path d="M 120 180 L 120 130" stroke="#16a34a" stroke-width="1.5" marker-end="url(#green-arrow)" />
        <text x="135" y="155" font-size="8" fill="#16a34a" font-weight="bold">Instructs Agent</text>

        <!-- Central Node: MoveHome.org Federated Cache -->
        <rect x="330" y="110" width="180" height="100" rx="12" fill="#ffffff" stroke="#2563FF" stroke-width="2" />
        <rect x="330" y="110" width="180" height="30" rx="12" fill="#2563FF" fill-opacity="0.05" />
        <text x="420" y="129" font-size="12" font-weight="extrabold" fill="#2563FF" text-anchor="middle">MoveHome.org</text>
        <text x="345" y="160" fill="#4b5563" font-weight="bold">● Federated Listings Cache</text>
        <text x="345" y="175" fill="#4b5563" font-weight="bold">● Free Public Directory</text>
        <text x="345" y="190" fill="#4b5563" font-weight="bold">● Zero Tolls / Listing Fees</text>

        <!-- Arrow: Central -> Consumer Search -->
        <path d="M 510 160 L 610 160" stroke="#2563FF" stroke-width="1.5" marker-end="url(#m-arrow)" />

        <!-- Node C: Consumer (Tenant / Buyer) -->
        <rect x="620" y="110" width="180" height="100" rx="10" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5" />
        <rect x="620" y="110" width="180" height="30" rx="10" fill="#111827" fill-opacity="0.05" />
        <text x="710" y="129" font-size="11" font-weight="bold" fill="#111827" text-anchor="middle">Consumer (Tenant/Buyer)</text>
        <text x="635" y="160" fill="#4b5563">● Free Search &amp; Filter</text>
        <text x="635" y="175" fill="#4b5563">● Biometric Verification</text>
        <text x="635" y="190" fill="#4b5563">● Direct Peer Handshake</text>

        <!-- Node D: MoveHome Foundation CIC -->
        <rect x="330" y="10" width="180" height="45" rx="8" fill="#ffffff" stroke="#000000" stroke-width="1.5" />
        <text x="420" y="28" font-size="10" font-weight="bold" fill="#000000" text-anchor="middle">MoveHome Foundation CIC</text>
        <text x="420" y="41" font-size="8" fill="#4b5563" text-anchor="middle">Co. 17202438 · Asset-Locked Non-Profit</text>

        <!-- Arrow: CIC -> Central -->
        <path d="M 420 55 L 420 100" stroke="#000000" stroke-width="1.5" stroke-dasharray="2,2" marker-end="url(#m-arrow)" />
        <text x="440" y="78" font-size="8" fill="#000" font-weight="bold">Governs &amp; Protects</text>

        <!-- Node E: Biometric Security Gate -->
        <rect x="550" y="235" width="180" height="45" rx="8" fill="#f0fdf4" stroke="#86efac" stroke-width="1" />
        <text x="640" y="253" font-size="9" font-weight="bold" fill="#16a34a" text-anchor="middle">🔐 Biometric Sumsub Verification</text>
        <text x="640" y="267" font-size="8" fill="#15803d" text-anchor="middle">Anti-Subletting &amp; Identity Lock</text>

        <!-- Connect Tenant -> Biometric Gate -->
        <path d="M 710 210 L 710 220 L 640 220 L 640 230" stroke="#16a34a" stroke-width="1" />

      </g>
    </svg>
  </div>

</div>
```
