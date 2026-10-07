'use client';

import { Link } from '@/i18n/navigation';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

export interface LeadConsentValue {
    privacyAccepted: boolean;
    marketingAccepted: boolean;
}

export const EMPTY_CONSENT: LeadConsentValue = { privacyAccepted: false, marketingAccepted: false };

interface Props {
    value: LeadConsentValue;
    onChange: (value: LeadConsentValue) => void;
    /** Muestra el error de "casilla obligatoria" (tras intentar enviar). */
    showError?: boolean;
    className?: string;
    compact?: boolean;
    idPrefix?: string;
}

/**
 * Casillas RGPD para formularios públicos:
 *  - Privacidad: OBLIGATORIA, nunca premarcada.
 *  - Comunicaciones comerciales: OPCIONAL, separada, nunca premarcada.
 *
 * El texto de la casilla debe mantenerse alineado con
 * `CONSENT_TEXT_VERSIONS` (src/backend/lead/domain/lead-consent.ts): si se
 * cambia sustancialmente, sube allí la versión.
 */
export function LeadConsentFields({ value, onChange, showError, className, compact, idPrefix = 'consent' }: Props) {
    const textSize = compact ? 'text-[11px]' : 'text-xs';
    return (
        <div className={cn('space-y-2', className)}>
            <label htmlFor={`${idPrefix}-privacy`} className={cn('flex items-start gap-2 cursor-pointer', textSize, 'text-muted-foreground leading-snug')}>
                <Checkbox
                    id={`${idPrefix}-privacy`}
                    checked={value.privacyAccepted}
                    onCheckedChange={checked => onChange({ ...value, privacyAccepted: checked === true })}
                    aria-required="true"
                    aria-invalid={showError && !value.privacyAccepted ? true : undefined}
                    className="mt-0.5"
                />
                <span>
                    He leído y acepto la{' '}
                    <Link href="/privacy" target="_blank" className="underline underline-offset-2 hover:text-foreground">
                        política de privacidad
                    </Link>
                    . Grupo RG tratará mis datos para responder a mi solicitud. <span className="text-rose-600">*</span>
                </span>
            </label>
            {showError && !value.privacyAccepted && (
                <p className={cn(textSize, 'text-rose-600 pl-6')} role="alert">
                    Debes aceptar la política de privacidad para continuar.
                </p>
            )}
            <label htmlFor={`${idPrefix}-marketing`} className={cn('flex items-start gap-2 cursor-pointer', textSize, 'text-muted-foreground leading-snug')}>
                <Checkbox
                    id={`${idPrefix}-marketing`}
                    checked={value.marketingAccepted}
                    onCheckedChange={checked => onChange({ ...value, marketingAccepted: checked === true })}
                    className="mt-0.5"
                />
                <span>(Opcional) Quiero recibir comunicaciones comerciales de Grupo RG por email. Puedo darme de baja en cualquier momento.</span>
            </label>
        </div>
    );
}
