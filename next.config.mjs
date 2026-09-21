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
    // The gateway only routes /users/* to this app, so these pages must be
    // reachable UNDER /users while living OUTSIDE src/app/users:
    //   /users/login -> src/app/login. Inside src/app/users it would sit under
    //     the auth-redirecting users layout (infinite loop).
    //   /users/me    -> src/app/me. Same reason, different gate: the teacher's
    //     own page is for any signed-in teacher, and src/app/users/layout.tsx
    //     redirects anyone without `users:write` away before it can render.
    const aliases = [
      { source: '/users/login', destination: '/login' },
      { source: '/users/me', destination: '/me' },
    ];
    if (!basePath) return aliases;
    return {
      // Un-prefix asset/API/public-file requests that arrive via the gateway.
      // beforeFiles = wins over the filesystem, and middleware has already
      // classified these (src/middleware.ts) since it runs before rewrites.
      beforeFiles: [
        { source: `${basePath}/_next/:path*`, destination: '/_next/:path*' },
        { source: `${basePath}/api/:path*`, destination: '/api/:path*' },
        { source: `${basePath}/icon.png`, destination: '/icon.png' },
        { source: `${basePath}/mediapipe/:path*`, destination: '/mediapipe/:path*' },
      ],
      afterFiles: aliases,
    };
  },
  async redirects() {
    // The canonical paths are the /users/* ones (that is all the gateway
    // serves); the bare ones exist only because the files do. A rewrite does
    // not re-run redirects, so /users/me -> /me above is unaffected.
    return [
      { source: '/login', destination: '/users/login', permanent: false },
      { source: '/me', destination: '/users/me', permanent: false },
    ];
  },
};

export default nextConfig;
