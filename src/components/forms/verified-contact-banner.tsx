'use client';

import { ShieldCheck } from 'lucide-react';

/**
 * Banner reusable que aparece encima de los campos de contacto cuando el
 * visitante ya verificó su identidad por OTP. Reduce la duplicación visual
 * entre QuickBudgetForm, QuickBudgetWizard, NewBuildForm, BudgetRequestWizard, etc.
 */
export function VerifiedContactBanner({
    show,
    message = 'Tus datos de contacto ya fueron verificados. Continúa con los detalles de la obra.',
}: {
    show: boolean;
    message?: string;
}) {
    if (!show) return null;
    return (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">
            <ShieldCheck className="h-4 w-4 flex-shrink-0" />
            <span>{message}</span>
        </div>
    );
}

/** Icono inline pequeño para acompañar la label del campo verificado. */
export function VerifiedFieldIcon({ show }: { show: boolean }) {
    if (!show) return null;
    return <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />;
}
