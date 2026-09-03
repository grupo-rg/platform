/**
 * Admin — Registro de modelos (spec §5.5). Phase 0.
 *
 * Superficie configurable del `model_registry`: una tabla de roles (Rol ·
 * Proveedor · modelId · pinnedVersion · Región · params · Activo · Salud ·
 * [Probar] · [Editar]) + modal de edición con PROBE-BEFORE-WRITE.
 *
 * Solo admin — `getModelRegistryAction` usa `verifyAuth(true)`. El rol
 * `embedding` es especial: su [Editar] no permite el swap de un clic (spec §6).
 */
import { AlertTriangle, Boxes } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { getModelRegistryAction } from '@/actions/admin/model-registry.actions';
import { ModelsTable } from './models-table';

export const dynamic = 'force-dynamic';

export default async function ModelRegistryPage() {
    const result = await getModelRegistryAction();

    if (!result.success) {
        return (
            <div className="space-y-6 max-w-6xl mx-auto">
                <header className="flex items-center gap-2">
                    <Boxes className="h-6 w-6 text-muted-foreground" />
                    <h1 className="font-headline text-3xl">Registro de modelos</h1>
                </header>
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-3 text-rose-600">
                            <AlertTriangle className="h-5 w-5" />
                            <div>
                                <p className="font-semibold">
                                    {result.error === 'forbidden'
                                        ? 'Acceso restringido a administradores.'
                                        : 'No se pudo cargar el registro de modelos.'}
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">{result.error}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="space-y-6 max-w-6xl mx-auto">
            <header className="space-y-2">
                <div className="flex items-center gap-2">
                    <Boxes className="h-6 w-6 text-muted-foreground" />
                    <h1 className="font-headline text-3xl">Registro de modelos</h1>
                </div>
                <p className="text-muted-foreground">
                    Fuente única de configuración de modelos por rol. Cada guardado ejecuta una
                    prueba (probe) contra el modelo candidato antes de escribir. Los cambios se
                    propagan en ≤60&nbsp;s (caché TTL) y por instancia en serverless.
                </p>
            </header>

            <ModelsTable initialRoles={result.data} />
        </div>
    );
}
