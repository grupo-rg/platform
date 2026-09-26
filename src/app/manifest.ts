import type { MetadataRoute } from 'next';

/**
 * Web App Manifest (servido en `/manifest.webmanifest`).
 *
 * El nombre del fichero contiene un punto, por lo que la ruta queda excluida del
 * middleware de next-intl (matcher `(?!…|.*\..*)`) y no se le añade prefijo de
 * locale. Los iconos son ficheros estáticos con extensión por el mismo motivo.
 */
export default function manifest(): MetadataRoute.Manifest {
    return {
        name: 'Grupo RG | Constructores en Mallorca',
        short_name: 'Grupo RG',
        description:
            'Constructora de alta gama en Mallorca y Baleares: obras, proyectos, reformas integrales y construcción de lujo.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        lang: 'es',
        dir: 'ltr',
        categories: ['business', 'lifestyle'],
        background_color: '#faf8f3',
        theme_color: '#e9c230',
        icons: [
            {
                src: '/icon-192.png',
                sizes: '192x192',
                type: 'image/png',
                purpose: 'any',
            },
            {
                src: '/icon-512.png',
                sizes: '512x512',
                type: 'image/png',
                purpose: 'any',
            },
            {
                src: '/maskable-icon.png',
                sizes: '512x512',
                type: 'image/png',
                purpose: 'maskable',
            },
            {
                src: '/icon.svg',
                sizes: 'any',
                type: 'image/svg+xml',
            },
        ],
    };
}
