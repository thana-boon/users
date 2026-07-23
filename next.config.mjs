// BASE_PATH (e.g. "/users-app") lets the module live behind the SchoolOS
// gateway's catch-all without its root-relative assets colliding with other
// apps. Build-time only: set it when building the image (see Dockerfile ARG),
// not at `docker run`. Empty (the default) keeps today's root-mounted behavior.
const basePath = process.env.BASE_PATH || '';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  ...(basePath ? { basePath } : {}),
  env: {
    // Inlined into the client bundle so lib/client.ts can prefix the raw
    // fetch()/href spots Next does not rewrite (Link/router/redirect it does).
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  serverExternalPackages: ['exceljs', 'mysql2'],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
