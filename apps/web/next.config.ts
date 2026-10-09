import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@dumpr/core', '@dumpr/db', '@dumpr/ui-tokens'],
  // Workspace packages use explicit `.ts` extensions in relative imports.
  turbopack: {},
};

export default nextConfig;
