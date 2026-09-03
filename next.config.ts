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
          // X-Frame-Options: SAMEORIGIN здесь нельзя — на web.telegram.org
          // Mini App открывается в iframe, и заголовок его бы убил.
          // Разрешаем ровно домены Telegram, всё остальное запрещено.
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org",
          },
        ],
      },
    ]
  },
}

export default nextConfig
