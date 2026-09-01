import type { NextConfig } from 'next';

/**
 * The engine modules import each other with explicit `.ts` extensions, because
 * Node's native type-stripping requires it. Bundlers historically dislike that,
 * so it is resolved explicitly here rather than left to chance.
 */
const config: NextConfig = {
  serverExternalPackages: ['pg'],
  typescript: { ignoreBuildErrors: false },
};

export default config;
