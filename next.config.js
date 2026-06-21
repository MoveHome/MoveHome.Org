/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
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
      { source: '/mcp', destination: '/api/mcp' }
    ];
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
