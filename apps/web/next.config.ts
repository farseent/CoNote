import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Self-contained server output, enabled only for the production Docker image
  // (infra/Dockerfile.web sets NEXT_OUTPUT=standalone). `next start` does not support it.
  ...(process.env['NEXT_OUTPUT'] === 'standalone' ? { output: 'standalone' as const } : {}),
  poweredByHeader: false,
};

export default nextConfig;
