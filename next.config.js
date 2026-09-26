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
  // NOTA: la canonicalización www ↔ no-www la gestiona la plataforma (Vercel:
  // Dominio principal en el panel) / DNS. NO añadir aquí un redirect por host:
  // si la plataforma ya redirige apex↔www, un redirect Next en sentido contrario
  // provoca un bucle infinito (ERR_TOO_MANY_REDIRECTS). Incidente 2026-09-26.
  async headers() {
    // Cabeceras de seguridad aplicadas a todas las rutas.
    // Nota: X-Frame-Options controla si NUESTRAS páginas pueden incrustarse en
    // frames de terceros; NO afecta a que nuestras páginas incrusten iframes de
    // terceros (p. ej. el embed de Google Maps en /contacto), que sigue funcionando.
    const securityHeaders = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      {
        key: 'Strict-Transport-Security',
        value: 'max-age=63072000; includeSubDomains; preload',
      },
      {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=(), browsing-topics=(), interest-cohort=()',
      },
      { key: 'X-DNS-Prefetch-Control', value: 'on' },
    ];

    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

const createNextIntlPlugin = require('next-intl/plugin');

const withNextIntl = createNextIntlPlugin(
  './src/i18n/request.ts'
);

module.exports = withNextIntl(nextConfig);

