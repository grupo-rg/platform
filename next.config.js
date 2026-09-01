/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '512mb',
    },
    // Compila sólo los submódulos usados de librerías "barrel" pesadas
    // (menos módulos en dev + bundle más pequeño en prod). lucide-react ya
    // viene optimizada por defecto en Next 15.
    optimizePackageImports: ['framer-motion', 'date-fns', 'lodash'],
  },
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
        port: '',
        pathname: '/**',
      },
    ],
  },
  serverExternalPackages: ['pdf-parse', '@google-cloud/tasks'],
  outputFileTracingIncludes: {
    '/**': ['./src/backend/ai/prompts/**/*.prompt'],
  },
};

const createNextIntlPlugin = require('next-intl/plugin');

const withNextIntl = createNextIntlPlugin(
  './src/i18n/request.ts'
);

module.exports = withNextIntl(nextConfig);

