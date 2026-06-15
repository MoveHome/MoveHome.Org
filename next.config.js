/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      // A2A Agent Card discovery at the spec well-known locations.
      { source: '/.well-known/agent.json', destination: '/api/agent-card' },
      { source: '/.well-known/agent-card.json', destination: '/api/agent-card' },
      // JWKS for verifying the signed Agent Card (jku target).
      { source: '/.well-known/jwks.json', destination: '/api/jwks' }
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
