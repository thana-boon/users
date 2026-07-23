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
  // The deployed gateway only routes /users/* and /api/* to this app, so the
  // login page must be reachable UNDER /users. The page itself stays at
  // src/app/login — moving it under src/app/users/ would put it inside the
  // auth-redirecting users layout (infinite loop). A rewrite serves it at
  // /users/login instead; the redirect keeps one canonical URL.
  async rewrites() {
    return [{ source: '/users/login', destination: '/login' }];
  },
  async redirects() {
    return [{ source: '/login', destination: '/users/login', permanent: false }];
  },
};

export default nextConfig;
