'use client';

/**
 * Cancel / Retry / Force-fail buttons for a single job, used on the
 * detail page above the timeline. Shares the same actions as the table
 * row dropdown but with bigger affordances and inline error display.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
    XCircle,
    RefreshCw,
    AlertTriangle,
    Loader2,
} from 'lucide-react';
import { sileo } from 'sileo';

import { adminCancelPipelineJobAction } from '@/actions/admin/cancel-pipeline-job.action';
import { adminRetryPipelineJobAction } from '@/actions/admin/retry-pipeline-job.action';
import { adminForceFailPipelineJobAction } from '@/actions/admin/force-fail-pipeline-job.action';

export interface JobActionBarProps {
    jobId: string;
    status: string;
    cancellationRequested?: boolean;
}

export function JobActionBar({ jobId, status, cancellationRequested }: JobActionBarProps) {
    const router = useRouter();
    const [actionError, setActionError] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();
    const [dialog, setDialog] = useState<{
        open: boolean;
        title: string;
        description: string;
        onConfirm: () => void;
        confirmClassName?: string;
    }>({ open: false, title: '', description: '', onConfirm: () => {} });

    const isActive = status === 'queued' || status === 'running' || status === 'in_progress';
    const isRetryable = status === 'failed' || status === 'canceled';

    const doCancel = () => {
        setDialog({
            open: true,
            title: 'Cancelar job',
            description: 'Esto envía señal de cancelación cooperativa al worker. Los checkpoints ya generados se conservan para que un futuro retry los reaproveche.',
            onConfirm: () => {
                setDialog(d => ({ ...d, open: false }));
                setActionError(null);
                startTransition(async () => {
                    const res = await adminCancelPipelineJobAction(jobId);
                    if (res.success) {
                        sileo.success({ title: 'Cancelación solicitada', description: `Status: ${res.status}`, duration: 4000 });
                        router.refresh();
                    } else {
                        setActionError(`No se pudo cancelar: ${res.error}`);
                    }
                });
            },
        });
    };

    const doRetry = () => {
        setDialog({
            open: true,
            title: 'Reintentar job',
            description: 'Se lanza una nueva ejecución conservando los checkpoints del intento anterior. El worker reanudará desde donde quedó.',
            onConfirm: () => {
                setDialog(d => ({ ...d, open: false }));
                setActionError(null);
                startTransition(async () => {
                    const res = await adminRetryPipelineJobAction(jobId);
                    if (res.success) {
                        sileo.success({ title: 'Job reencolado', description: 'Nueva ejecución arrancada.', duration: 4000 });
                        router.refresh();
                    } else {
                        setActionError(`No se pudo reintentar: ${res.error}`);
                    }
                });
            },
        });
    };

    const doForceFail = () => {
        setDialog({
            open: true,
            title: 'Force-fail (admin override)',
            description: 'OVERRIDE: marca el job como FAILED directamente en Firestore, sin esperar al worker. Úsalo SOLO para limpiar zombis (workers muertos por OOM). No detiene un worker vivo — si el worker sigue corriendo, podría completar la ejecución después.',
            confirmClassName: 'bg-red-600 hover:bg-red-700 text-white',
            onConfirm: () => {
                setDialog(d => ({ ...d, open: false }));
                setActionError(null);
                startTransition(async () => {
                    const res = await adminForceFailPipelineJobAction(jobId);
                    if (res.success) {
                        sileo.success({ title: 'Job forzado a failed', description: `Previo: ${res.previousStatus}`, duration: 4000 });
                        router.refresh();
                    } else {
                        setActionError(`No se pudo forzar fallo: ${res.error}`);
                    }
                });
            },
        });
    };

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
                {isActive && (
                    <Button variant="outline" size="sm" onClick={doCancel} disabled={pending}>
                        {pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <XCircle className="mr-1 h-4 w-4" />}
                        Cancelar
                        {cancellationRequested && ' (ya solicitada)'}
                    </Button>
                )}
                {isRetryable && (
                    <Button size="sm" onClick={doRetry} disabled={pending}>
                        {pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
                        Reintentar
                    </Button>
                )}
                {isActive && (
                    <Button variant="destructive" size="sm" onClick={doForceFail} disabled={pending}>
                        {pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <AlertTriangle className="mr-1 h-4 w-4" />}
                        Force-fail (admin)
                    </Button>
                )}
                {!isActive && !isRetryable && (
                    <span className="text-xs text-muted-foreground">
                        Estado terminal: sin acciones disponibles.
                    </span>
                )}
            </div>

            {actionError && (
                <Alert variant="destructive">
                    <AlertDescription>{actionError}</AlertDescription>
                </Alert>
            )}

            <AlertDialog open={dialog.open} onOpenChange={(open) => setDialog(d => ({ ...d, open }))}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{dialog.title}</AlertDialogTitle>
                        <AlertDialogDescription>{dialog.description}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(e) => {
                                e.preventDefault();
                                dialog.onConfirm();
                            }}
                            className={dialog.confirmClassName}
                        >
                            Confirmar
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
