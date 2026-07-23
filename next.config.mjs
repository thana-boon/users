// BASE_PATH (deploy: "/users") = the prefix the SchoolOS gateway serves this
// app under. The app's PAGE routes already start with /users, so Next's real
// `basePath` would double them (/users/users/...). Instead the prefix is
// grafted on around the edges:
//   - assetPrefix            -> <base>/_next/* asset URLs in the HTML
//   - NEXT_PUBLIC_BASE_PATH  -> lib/client.ts withBase() prefixes client
//                               fetches / <a href> / <img src>
//   - beforeFiles rewrites   -> strip the prefix again when those requests
//                               come back in through the gateway
// Direct-port callers (http://host:3002/api/...) keep working unprefixed.
// Build-time only (see Dockerfile ARG) — rebuild after changing it. Empty
// (the default) keeps today's root-mounted behavior exactly.
const basePath = process.env.BASE_PATH || '';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  ...(basePath ? { assetPrefix: basePath } : {}),
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  serverExternalPackages: ['exceljs', 'mysql2'],
  eslint: { ignoreDuringBuilds: true },
  async rewrites() {
    // The gateway only routes /users/* to this app, so the login page must be
    // reachable UNDER /users. The page itself stays at src/app/login — moving
    // it under src/app/users/ would put it inside the auth-redirecting users
    // layout (infinite loop). This alias serves it at /users/login.
    const loginAlias = [{ source: '/users/login', destination: '/login' }];
    if (!basePath) return loginAlias;
    return {
      // Un-prefix asset/API/public-file requests that arrive via the gateway.
      // beforeFiles = wins over the filesystem, and middleware has already
      // classified these (src/middleware.ts) since it runs before rewrites.
      beforeFiles: [
        { source: `${basePath}/_next/:path*`, destination: '/_next/:path*' },
        { source: `${basePath}/api/:path*`, destination: '/api/:path*' },
        { source: `${basePath}/icon.svg`, destination: '/icon.svg' },
        { source: `${basePath}/mediapipe/:path*`, destination: '/mediapipe/:path*' },
      ],
      afterFiles: loginAlias,
    };
  },
  async redirects() {
    return [{ source: '/login', destination: '/users/login', permanent: false }];
  },
};

export default nextConfig;
