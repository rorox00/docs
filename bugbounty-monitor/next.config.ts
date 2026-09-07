import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['pg', 'bullmq', 'ioredis', 'nodemailer'],
  eslint: { ignoreDuringBuilds: true },
  experimental: { optimizePackageImports: ['cheerio'] },
};

export default nextConfig;
