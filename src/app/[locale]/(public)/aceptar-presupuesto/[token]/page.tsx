import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { CheckCircle2, FileText, ShieldCheck, AlertTriangle, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
    getBudgetByAcceptanceTokenAction,
    type PublicBudgetView,
} from '@/actions/budget/budget-acceptance.action';
import { BudgetAcceptanceForm } from '@/components/public/BudgetAcceptanceForm';

interface PageProps {
    params: Promise<{ locale: string; token: string }>;
}

export const dynamic = 'force-dynamic';

export default async function AcceptBudgetPage({ params }: PageProps) {
    const { token } = await params;

    const result = await getBudgetByAcceptanceTokenAction(token);

    if (!result.success || !result.data) {
        return (
            <main className="flex-1 flex items-center justify-center px-4 py-16 bg-muted/30">
                <Card className="max-w-md w-full">
                    <CardHeader className="text-center">
                        <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-rose-100 flex items-center justify-center">
                            <AlertTriangle className="h-6 w-6 text-rose-600" />
                        </div>
                        <CardTitle>Enlace no válido</CardTitle>
                    </CardHeader>
                    <CardContent className="text-center text-sm text-muted-foreground space-y-3">
                        <p>
                            Este enlace no corresponde a ningún presupuesto activo. Puede que haya caducado, que el presupuesto se haya reenviado o que la URL esté incompleta.
                        </p>
                        <p>
                            Si tienes dudas, responde al email original o escríbenos a{' '}
                            <a href="mailto:hola@constructoresenmallorca.com" className="text-primary underline">
                                hola@constructoresenmallorca.com
                            </a>
                            .
                        </p>
                    </CardContent>
                </Card>
            </main>
        );
    }

    const budget = result.data;

    return (
        <main className="flex-1 px-4 py-10 md:py-16 bg-muted/30">
            <div className="max-w-2xl mx-auto space-y-6">
                <header className="text-center space-y-2">
                    <p className="text-xs uppercase tracking-widest text-muted-foreground">
                        Grupo RG · Constructores en Mallorca
                    </p>
                    <h1 className="font-headline text-3xl md:text-4xl">Tu presupuesto</h1>
                    <p className="text-muted-foreground">
                        Hola {budget.clientName}. Aquí puedes revisar el presupuesto, descargarlo y firmar la aceptación.
                    </p>
                </header>

                <Card>
                    <CardHeader className="pb-3">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                            <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
                                Resumen
                            </CardTitle>
                            <BudgetStatusBadge budget={budget} />
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-baseline justify-between gap-3 flex-wrap">
                            <p className="text-xs text-muted-foreground">Importe total · IVA incluido</p>
                            <p className="text-3xl md:text-4xl font-bold tracking-tight font-mono">
                                {budget.totalEstimated.toLocaleString('es-ES', {
                                    style: 'currency',
                                    currency: 'EUR',
                                    maximumFractionDigits: 0,
                                })}
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                            <span>Ref. <span className="font-mono">#{budget.refShort}</span></span>
                            {budget.sentAt && (
                                <span>Enviado el {format(new Date(budget.sentAt), "d 'de' MMMM 'de' yyyy", { locale: es })}</span>
                            )}
                        </div>
                        {budget.pdfUrl && (
                            <a
                                href={budget.pdfUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                            >
                                <FileText className="h-4 w-4" />
                                Descargar el PDF completo
                            </a>
                        )}
                    </CardContent>
                </Card>

                {budget.acceptedAt ? (
                    <Card className="border-emerald-200 bg-emerald-50/50 dark:bg-emerald-500/5">
                        <CardHeader className="text-center">
                            <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-emerald-100 flex items-center justify-center">
                                <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                            </div>
                            <CardTitle>Presupuesto aceptado</CardTitle>
                        </CardHeader>
                        <CardContent className="text-center text-sm space-y-1">
                            <p>
                                Firmado por <span className="font-semibold">{budget.acceptedBy}</span>
                            </p>
                            <p className="text-muted-foreground text-xs">
                                {format(new Date(budget.acceptedAt), "d 'de' MMMM 'de' yyyy 'a las' HH:mm", { locale: es })}
                            </p>
                            <p className="text-muted-foreground text-xs pt-3">
                                Te contactaremos en breve para coordinar el inicio de la obra.
                            </p>
                        </CardContent>
                    </Card>
                ) : (
                    <BudgetAcceptanceForm
                        token={token}
                        clientName={budget.clientName}
                        pendingChangeRequestAt={budget.pendingChangeRequestAt}
                    />
                )}

                <p className="text-center text-xs text-muted-foreground flex items-center justify-center gap-1">
                    <ShieldCheck className="h-3 w-3" />
                    Tu firma electrónica queda registrada con fecha y datos del navegador como evidencia del acuerdo.
                </p>
            </div>
        </main>
    );
}

function BudgetStatusBadge({ budget }: { budget: PublicBudgetView }) {
    if (budget.acceptedAt) {
        return (
            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Aceptado
            </Badge>
        );
    }
    if (budget.status === 'pending_review') {
        return (
            <Badge className="bg-amber-100 text-amber-700 border-amber-200">
                <Clock className="h-3 w-3 mr-1" />
                En revisión por nuestro equipo
            </Badge>
        );
    }
    return (
        <Badge className="bg-blue-100 text-blue-700 border-blue-200">
            Pendiente de tu firma
        </Badge>
    );
}
