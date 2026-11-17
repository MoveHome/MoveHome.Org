/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      {
        source: '/.well-known/raia-agent.json',
        destination: '/.well-known/raia.json',
        permanent: true
      },
      {
        source: '/about',
        has: [{ type: 'host', value: 'app.movehome.org' }],
        destination: 'https://movehome.org/',
        permanent: true
      },
      {
        source: '/about',
        has: [{ type: 'host', value: 'application.movehome.org' }],
        destination: 'https://movehome.org/',
        permanent: true
      },
      {
        source: '/charter',
        has: [{ type: 'host', value: 'app.movehome.org' }],
        destination: 'https://movehome.org/charter',
        permanent: true
      },
      {
        source: '/charter',
        has: [{ type: 'host', value: 'application.movehome.org' }],
        destination: 'https://movehome.org/charter',
        permanent: true
      },
      {
        source: '/terms',
        has: [{ type: 'host', value: 'app.movehome.org' }],
        destination: 'https://movehome.org/terms',
        permanent: true
      },
      {
        source: '/terms',
        has: [{ type: 'host', value: 'application.movehome.org' }],
        destination: 'https://movehome.org/terms',
        permanent: true
      },
      {
        source: '/privacy',
        has: [{ type: 'host', value: 'app.movehome.org' }],
        destination: 'https://movehome.org/privacy',
        permanent: true
      },
      {
        source: '/privacy',
        has: [{ type: 'host', value: 'application.movehome.org' }],
        destination: 'https://movehome.org/privacy',
        permanent: true
      },
      {
        source: '/registry',
        has: [{ type: 'host', value: 'app.movehome.org' }],
        destination: 'https://movehome.org/registry',
        permanent: true
      },
      {
        source: '/registry',
        has: [{ type: 'host', value: 'application.movehome.org' }],
        destination: 'https://movehome.org/registry',
        permanent: true
      },
      {
        source: '/connect',
        has: [{ type: 'host', value: 'app.movehome.org' }],
        destination: 'https://movehome.org/connect',
        permanent: true
      },
      {
        source: '/connect',
        has: [{ type: 'host', value: 'application.movehome.org' }],
        destination: 'https://movehome.org/connect',
        permanent: true
      }
    ];
  },
  async rewrites() {
    return {
      // Host rewrites must run before the filesystem, or `/` resolves to the
      // landing page and the subdomain never reaches the deck.
      beforeFiles: [
        // The swipe webapp owns its host root. app. is primary; application.
        // is kept as an alias for links already shared.
        {
          source: '/',
          has: [{ type: 'host', value: 'app.movehome.org' }],
          destination: '/app'
        },
        {
          source: '/',
          has: [{ type: 'host', value: 'application.movehome.org' }],
          destination: '/app'
        }
      ],
      afterFiles: [
        // RAIA Agent Card discovery
        { source: '/.well-known/raia.json', destination: '/api/raia-card' },
        // A2A Agent Card discovery at the spec well-known locations.
        { source: '/.well-known/agent.json', destination: '/api/agent-card' },
        { source: '/.well-known/agent-card.json', destination: '/api/agent-card' },
        // JWKS for verifying the signed Agent Card (jku target).
        { source: '/.well-known/jwks.json', destination: '/api/jwks' },
        // llms.txt convention — alias to the AI-agent integration guide.
        { source: '/llms.txt', destination: '/skills.md' },
        // Machine-readable bulk export of the public A2A registry.
        { source: '/registry.json', destination: '/api/registry/v1/all' },
        // Clean URL for the hosted property MCP server.
        { source: '/mcp', destination: '/api/mcp' },
        // Well-Known Property Card JSON discovery
        { source: '/.well-known/property/:raia_id.json', destination: '/p/:raia_id/card.json' }
      ],
      fallback: []
    };
  },
  // Baseline security headers (no CSP — a strict policy needs per-page testing
  // against Maps/Cloudinary/embeds and is deferred). HTTPS/HSTS is handled by Vercel.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=()' }
        ]
      }
    ];
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'res.cloudinary.com' },
      { protocol: 'https', hostname: 'storage.googleapis.com' },
      { protocol: 'https', hostname: 'app.giraffe360.com' },
      { protocol: 'https', hostname: 'i.ytimg.com' }
    ]
  }
};

module.exports = nextConfig;
