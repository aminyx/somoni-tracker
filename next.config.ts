import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // better-sqlite3 — нативный модуль, бандлить его нельзя.
  serverExternalPackages: ['better-sqlite3'],
  output: process.env.DOCKER_BUILD ? 'standalone' : undefined,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
    ]
  },
}

export default nextConfig
