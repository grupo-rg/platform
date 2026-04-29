'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle2, Edit3, Loader2, AlertTriangle, PenLine, Send, Clock } from 'lucide-react';
import {
    acceptBudgetAction,
    requestBudgetChangesAction,
} from '@/actions/budget/budget-acceptance.action';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface BudgetAcceptanceFormProps {
    token: string;
    clientName: string;
    /** ISO string si ya hay una solicitud de cambios pendiente. */
    pendingChangeRequestAt?: string;
}

export function BudgetAcceptanceForm({
    token,
    clientName,
    pendingChangeRequestAt,
}: BudgetAcceptanceFormProps) {
    const router = useRouter();
    const [tab, setTab] = useState<'accept' | 'changes'>('accept');
    const [signatureName, setSignatureName] = useState(clientName || '');
    const [acceptCheck, setAcceptCheck] = useState(false);
    const [comment, setComment] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [submittedChange, setSubmittedChange] = useState(false);

    const onAccept = async () => {
        setError(null);
        if (!acceptCheck) {
            setError('Confirma que has leído y aceptas el presupuesto.');
            return;
        }
        if (signatureName.trim().length < 2) {
            setError('Indica tu nombre completo para firmar.');
            return;
        }
        setSubmitting(true);
        const result = await acceptBudgetAction({ token, signatureName });
        setSubmitting(false);
        if (!result.success) {
            setError(result.error || 'Error al firmar el presupuesto.');
            return;
        }
        // Refresca la página: el server detecta acceptedAt y muestra el confirm.
        router.refresh();
    };

    const onRequestChanges = async () => {
        setError(null);
        if (comment.trim().length < 10) {
            setError('Cuéntanos brevemente qué cambios necesitas (mínimo 10 caracteres).');
            return;
        }
        setSubmitting(true);
        const result = await requestBudgetChangesAction({ token, comment });
        setSubmitting(false);
        if (!result.success) {
            setError(result.error || 'Error al enviar la solicitud.');
            return;
        }
        setSubmittedChange(true);
    };

    if (submittedChange) {
        return (
            <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-500/5">
                <CardHeader className="text-center">
                    <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-amber-100 flex items-center justify-center">
                        <CheckCircle2 className="h-6 w-6 text-amber-600" />
                    </div>
                    <CardTitle>Solicitud enviada</CardTitle>
                </CardHeader>
                <CardContent className="text-center text-sm text-muted-foreground space-y-2">
                    <p>
                        Hemos recibido tu petición de cambios. Nuestro equipo la revisará y volverá a contactarte en breve con un presupuesto actualizado.
                    </p>
                    <p>Puedes cerrar esta pestaña.</p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <div className="flex gap-2 p-1 bg-muted rounded-lg">
                    <button
                        type="button"
                        onClick={() => {
                            setTab('accept');
                            setError(null);
                        }}
                        className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
                            tab === 'accept'
                                ? 'bg-background text-foreground shadow-sm'
                                : 'text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        <CheckCircle2 className="h-4 w-4 inline mr-2" />
                        Aceptar
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setTab('changes');
                            setError(null);
                        }}
                        className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
                            tab === 'changes'
                                ? 'bg-background text-foreground shadow-sm'
                                : 'text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        <Edit3 className="h-4 w-4 inline mr-2" />
                        Pedir cambios
                    </button>
                </div>
            </CardHeader>
            <CardContent>
                {pendingChangeRequestAt && tab === 'accept' && (
                    <Alert className="mb-4 border-amber-200 bg-amber-50 dark:bg-amber-500/5">
                        <Clock className="h-4 w-4 text-amber-600" />
                        <AlertDescription className="text-amber-900 dark:text-amber-200 text-xs">
                            Hay una solicitud de cambios pendiente del{' '}
                            {format(new Date(pendingChangeRequestAt), "d 'de' MMMM 'a las' HH:mm", { locale: es })}.
                            Si aceptas ahora, esa solicitud quedará sin efecto.
                        </AlertDescription>
                    </Alert>
                )}

                {tab === 'accept' ? (
                    <div className="space-y-4">
                        <p className="text-sm text-muted-foreground leading-relaxed">
                            Al aceptar, autorizas a Grupo RG a iniciar los preparativos de la obra y nos pondremos en contacto contigo para coordinar fechas, contrato definitivo y pagos.
                        </p>

                        <div className="space-y-2">
                            <Label htmlFor="signatureName" className="text-xs uppercase tracking-wide">
                                Firmar como
                            </Label>
                            <div className="relative">
                                <PenLine className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    id="signatureName"
                                    value={signatureName}
                                    onChange={(e) => setSignatureName(e.target.value)}
                                    placeholder="Tu nombre completo"
                                    className="pl-9"
                                    maxLength={120}
                                />
                            </div>
                        </div>

                        <label className="flex items-start gap-2 cursor-pointer text-sm">
                            <input
                                type="checkbox"
                                checked={acceptCheck}
                                onChange={(e) => setAcceptCheck(e.target.checked)}
                                className="mt-1 h-4 w-4"
                            />
                            <span className="text-muted-foreground">
                                He leído el presupuesto y acepto el importe y las condiciones descritas. Entiendo que mi firma queda registrada con fecha, hora y datos del navegador.
                            </span>
                        </label>

                        {error && (
                            <Alert variant="destructive">
                                <AlertTriangle className="h-4 w-4" />
                                <AlertDescription>{error}</AlertDescription>
                            </Alert>
                        )}

                        <Button
                            onClick={onAccept}
                            disabled={submitting || !acceptCheck}
                            size="lg"
                            className="w-full"
                        >
                            {submitting ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Registrando aceptación…
                                </>
                            ) : (
                                <>
                                    <CheckCircle2 className="h-4 w-4 mr-2" />
                                    Aceptar y firmar
                                </>
                            )}
                        </Button>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <p className="text-sm text-muted-foreground leading-relaxed">
                            Cuéntanos qué te gustaría revisar (precio, alcance, materiales, plazo…) y nuestro equipo preparará un presupuesto actualizado.
                        </p>

                        <div className="space-y-2">
                            <Label htmlFor="comment" className="text-xs uppercase tracking-wide">
                                Tus comentarios
                            </Label>
                            <Textarea
                                id="comment"
                                value={comment}
                                onChange={(e) => setComment(e.target.value)}
                                placeholder="Por ejemplo: querría ajustar el material del baño y revisar el plazo…"
                                rows={5}
                                maxLength={2000}
                            />
                            <p className="text-xs text-muted-foreground">
                                {comment.length}/2000
                            </p>
                        </div>

                        {error && (
                            <Alert variant="destructive">
                                <AlertTriangle className="h-4 w-4" />
                                <AlertDescription>{error}</AlertDescription>
                            </Alert>
                        )}

                        <Button
                            onClick={onRequestChanges}
                            disabled={submitting}
                            size="lg"
                            className="w-full"
                            variant="outline"
                        >
                            {submitting ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Enviando…
                                </>
                            ) : (
                                <>
                                    <Send className="h-4 w-4 mr-2" />
                                    Enviar solicitud de cambios
                                </>
                            )}
                        </Button>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
