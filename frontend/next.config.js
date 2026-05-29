/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * Security headers applied to every response.
   * These are a baseline — tighten CSP once you know your exact asset origins.
   */
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Prevent MIME-type sniffing
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Clickjacking protection
          { key: "X-Frame-Options", value: "DENY" },
          // Stop the browser from leaking referrer info to external sites
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Disable browser features we don't use
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          // Basic CSP — tighten in production
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'", // Next.js inline scripts; tighten with nonces in prod
              "style-src 'self' 'unsafe-inline'",  // Tailwind inline styles
              "img-src 'self' data: https://avatar.xboxlive.com https://images-eds-ssl.xboxlive.com",
              "connect-src 'self'",
              "font-src 'self'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },

  // Limit upload body size to 11 MB (10 MB image + overhead)
  experimental: {
    serverActions: {
      bodySizeLimit: "11mb",
    },
  },
};

module.exports = nextConfig;
