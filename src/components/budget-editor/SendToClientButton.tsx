'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Send, Loader2, AlertTriangle, Mail, CheckCircle2 } from 'lucide-react';
import { pdf } from '@react-pdf/renderer';
import { BudgetDocument } from '@/components/pdf/BudgetDocument';
import { sendBudgetToClientAction } from '@/actions/budget/send-budget-to-client.action';
import type { CompanyConfig } from '@/backend/platform/domain/company-config';
import type { BudgetCostBreakdown, BudgetRender } from '@/backend/budget/domain/budget';
import type { ExecutionMode } from '@/types/budget-editor';

interface SendToClientButtonProps {
    budgetId: string;
    budgetNumber: string;
    clientName: string;
    clientEmail: string;
    clientAddress?: string;
    items: any[];
    costBreakdown: BudgetCostBreakdown;
    company: CompanyConfig;
    executionMode: ExecutionMode;
    notes?: string;
    renders?: BudgetRender[];
    selectedRenderIds?: string[];
    budgetConfig?: { marginGG: number; marginBI: number; tax: number };
    /** Callback opcional cuando el envío se confirma con éxito. */
    onSent?: () => void;
}

export function SendToClientButton({
    budgetId,
    budgetNumber,
    clientName,
    clientEmail,
    clientAddress,
    items,
    costBreakdown,
    company,
    executionMode,
    notes,
    renders = [],
    selectedRenderIds = [],
    budgetConfig,
    onSent,
}: SendToClientButtonProps) {
    const [open, setOpen] = useState(false);
    const [step, setStep] = useState<'idle' | 'rendering' | 'sending' | 'sent' | 'error'>('idle');
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [customMessage, setCustomMessage] = useState('');
    const { toast } = useToast();

    const handleSend = async () => {
        setErrorMsg(null);
        setStep('rendering');
        try {
            const blob = await pdf(
                <BudgetDocument
                    budgetNumber={budgetNumber}
                    clientName={clientName}
                    clientEmail={clientEmail}
                    clientAddress={clientAddress || ''}
                    items={items}
                    costBreakdown={costBreakdown}
                    date={new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' })}
                    notes={notes}
                    company={company}
                    executionMode={executionMode}
                    renders={renders}
                    selectedRenderIds={selectedRenderIds}
                    budgetConfig={budgetConfig}
                />
            ).toBlob();

            const base64 = await blobToBase64(blob);

            setStep('sending');
            const result = await sendBudgetToClientAction({
                budgetId,
                pdfBase64: base64,
                customMessage: customMessage.trim() || undefined,
            });

            if (!result.success) {
                setStep('error');
                setErrorMsg(result.error || 'No se pudo enviar el presupuesto.');
                return;
            }

            setStep('sent');
            toast({
                title: 'Presupuesto enviado',
                description: `Email entregado a ${clientEmail}.`,
            });
            onSent?.();
        } catch (err: any) {
            console.error('[SendToClientButton] error', err);
            setStep('error');
            setErrorMsg(err?.message || 'Error inesperado generando el PDF.');
        }
    };

    const reset = () => {
        setStep('idle');
        setErrorMsg(null);
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(v) => {
                setOpen(v);
                if (!v) reset();
            }}
        >
            <DialogTrigger asChild>
                <Button
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/20 gap-2"
                >
                    <Send className="w-4 h-4" />
                    Enviar al cliente
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
                {step === 'sent' ? (
                    <div className="flex flex-col items-center justify-center py-8 space-y-4 animate-in fade-in zoom-in-95 duration-300">
                        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/30">
                            <CheckCircle2 className="w-8 h-8 text-white" />
                        </div>
                        <h3 className="text-xl font-bold">Email entregado</h3>
                        <p className="text-muted-foreground text-center text-sm">
                            El presupuesto se envió a <span className="font-semibold text-foreground">{clientEmail}</span>.
                            El estado del presupuesto cambió a <span className="font-semibold text-foreground">Enviado</span>.
                        </p>
                        <Button onClick={() => setOpen(false)}>Cerrar</Button>
                    </div>
                ) : (
                    <>
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <Mail className="w-5 h-5 text-blue-600" />
                                Enviar presupuesto al cliente
                            </DialogTitle>
                            <DialogDescription>
                                Generaremos el PDF oficial con la configuración actual y lo enviaremos por email
                                a <span className="font-semibold">{clientEmail}</span>. El presupuesto pasará a
                                estado <span className="font-semibold">Enviado</span> y la oportunidad CRM avanzará
                                a <span className="font-semibold">Propuesta enviada</span>.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-3 py-2">
                            <div className="space-y-1.5">
                                <Label htmlFor="custom-message" className="text-xs font-medium">
                                    Mensaje personalizado (opcional)
                                </Label>
                                <textarea
                                    id="custom-message"
                                    value={customMessage}
                                    onChange={(e) => setCustomMessage(e.target.value)}
                                    placeholder="Hola María, adjunto el presupuesto que acordamos en la visita del lunes…"
                                    className="w-full min-h-[80px] rounded-md border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    maxLength={1000}
                                />
                                <p className="text-[10px] text-muted-foreground">{customMessage.length}/1000</p>
                            </div>

                            {errorMsg && (
                                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                                    <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                                    <p className="text-sm text-red-700 dark:text-red-400">{errorMsg}</p>
                                </div>
                            )}
                        </div>

                        <DialogFooter className="gap-2">
                            <Button variant="outline" onClick={() => setOpen(false)} disabled={step === 'rendering' || step === 'sending'}>
                                Cancelar
                            </Button>
                            <Button
                                onClick={handleSend}
                                disabled={step === 'rendering' || step === 'sending'}
                                className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
                            >
                                {step === 'rendering' && (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" /> Generando PDF…
                                    </>
                                )}
                                {step === 'sending' && (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" /> Enviando…
                                    </>
                                )}
                                {(step === 'idle' || step === 'error') && (
                                    <>
                                        <Send className="w-4 h-4" /> Enviar ahora
                                    </>
                                )}
                            </Button>
                        </DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}

function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);
        reader.onload = () => {
            const result = reader.result as string;
            const idx = result.indexOf('base64,');
            resolve(idx >= 0 ? result.substring(idx + 'base64,'.length) : result);
        };
        reader.readAsDataURL(blob);
    });
}
