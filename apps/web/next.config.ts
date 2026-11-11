import path from 'node:path';
import type { NextConfig } from 'next';

const monorepoRoot = path.join(__dirname, '../..');

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Self-contained server bundle for the Docker image; trace from the monorepo root so the
  // workspace packages (@caretrail/*) are included.
  output: 'standalone',
  outputFileTracingRoot: monorepoRoot,
  poweredByHeader: false,
  turbopack: {
    root: monorepoRoot,
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
