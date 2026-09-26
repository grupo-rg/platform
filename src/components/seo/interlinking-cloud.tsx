import { Link } from '@/i18n/navigation';
import { MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { locations } from '@/lib/locations';

interface InterlinkingCloudProps {
    /** Nombre del servicio, usado como texto de ancla ("{servicio} en {zona}"). */
    serviceName: string;
    /**
     * Slug de la categoría del servicio. Se mantiene por compatibilidad con las
     * páginas que montan este componente; el interlinking apunta a las landings
     * de zona (`/zonas/[zone]`), no a rutas por categoría.
     */
    categorySlug?: string;
    className?: string;
}

/**
 * Nube de enlaces internos (SEO) que cruza el servicio actual con las zonas de
 * actuación reales definidas en `src/lib/locations.ts`.
 *
 * - Usa el `Link` de next-intl para que las URLs queden localizadas por locale
 *   (p. ej. `/es/zonas/...`, `/en/locations/...`, `/de/standorte/...`).
 * - Enlaza a las landings de zona `/zonas/[zone]` (mismo slug que genera
 *   `generateStaticParams` de la página de zona), en lugar de a query-strings
 *   `/contact?subject=` que no aportan valor de interlinking.
 */
export function InterlinkingCloud({ serviceName, className }: InterlinkingCloudProps) {
    return (
        <section className={cn('py-12 border-t bg-slate-50', className)}>
            <div className="container-limited text-center">
                <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-widest mb-6">
                    {serviceName} en Mallorca - Zonas de Actuación
                </h3>
                <div className="flex flex-wrap justify-center gap-3">
                    {locations.map((loc) => (
                        <Link
                            key={loc}
                            href={{
                                pathname: '/zonas/[zone]',
                                params: { zone: loc.toLowerCase().replace(/\s+/g, '-') },
                            }}
                            className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-slate-500 hover:text-primary hover:underline transition-colors border rounded-full px-3 py-1 bg-white"
                        >
                            <MapPin className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                            {serviceName} en {loc}
                        </Link>
                    ))}
                </div>
            </div>
        </section>
    );
}
