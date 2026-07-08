/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  serverExternalPackages: ['exceljs', 'mysql2'],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
