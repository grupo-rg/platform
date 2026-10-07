import { Building2, HardHat, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';

/**
 * Home básico del encargado (jefe de obra). Sustituye al dashboard de
 * administración (KPIs, presupuestos, solicitudes) que no debe ver.
 */
export function EncargadoHome({ email }: { email?: string | null }) {
    return (
        <div className="max-w-3xl mx-auto space-y-6">
            <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
                    <HardHat className="h-6 w-6 text-primary" />
                </div>
                <div>
                    <h1 className="text-2xl font-semibold">Hola{email ? `, ${email.split('@')[0]}` : ''}</h1>
                    <p className="text-sm text-muted-foreground">Panel de encargado de obra</p>
                </div>
            </div>
            <Link href={'/dashboard/projects' as any} className="block group">
                <Card className="transition-colors group-hover:border-primary/40">
                    <CardHeader className="flex flex-row items-center gap-3 space-y-0">
                        <Building2 className="h-5 w-5 text-primary" />
                        <div className="flex-1">
                            <CardTitle className="text-lg">Obras</CardTitle>
                            <CardDescription>Consulta las obras en curso.</CardDescription>
                        </div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                        Próximamente: partes de trabajo diarios desde aquí.
                    </CardContent>
                </Card>
            </Link>
        </div>
    );
}
