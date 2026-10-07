'use client';

import { useEffect, useRef, useState } from 'react';
import { useWidgetContext } from '@/context/budget-widget-context';
import {
    getVerifiedLeadAction,
    type VerifiedLeadDTO,
} from '@/actions/lead/get-verified-lead.action';

interface UseVerifiedLeadResult {
    /** Lead verificado vía OTP, o null si no hay sesión / hubo error. */
    lead: VerifiedLeadDTO | null;
    /** Pista de leadId guardada en localStorage (sólo UI; el servidor la ignora). */
    leadId: string | null;
    isLoading: boolean;
    /** True si tenemos un lead con `isVerified=true` cargado y listo para usar. */
    isReady: boolean;
}

/**
 * Hook estable para que cualquier formulario público pueda precargar los datos
 * de contacto del visitante después de que haya pasado el OTP.
 *
 * La identidad real la determina el SERVIDOR a partir de la cookie httpOnly
 * firmada `rg_lead_session`; el `leadId` del widget context (localStorage) es
 * sólo una pista de UI. Si el servidor no reconoce sesión, limpiamos la pista
 * para que el visitante vuelva a verificarse.
 */
export function useVerifiedLead(): UseVerifiedLeadResult {
    const { leadId, setLeadId } = useWidgetContext();
    const [lead, setLead] = useState<VerifiedLeadDTO | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const fetchedForKey = useRef<string | null>(null);

    // `setLeadId` se redefine en cada render del provider; lo guardamos en un
    // ref para no invalidar el effect.
    const setLeadIdRef = useRef(setLeadId);
    useEffect(() => {
        setLeadIdRef.current = setLeadId;
    }, [setLeadId]);

    useEffect(() => {
        const key = leadId || '__none__';
        if (fetchedForKey.current === key) return; // single-flight (StrictMode)
        fetchedForKey.current = key;
        setIsLoading(true);
        getVerifiedLeadAction()
            .then(res => {
                if (res.success && res.lead) {
                    setLead(res.lead);
                    if (res.lead.id !== leadId) {
                        fetchedForKey.current = res.lead.id;
                        setLeadIdRef.current(res.lead.id);
                    }
                    return;
                }
                setLead(null);
                if (leadId) {
                    // Pista obsoleta (sin cookie de sesión válida): forzamos reverificación.
                    fetchedForKey.current = '__none__';
                    setLeadIdRef.current(null);
                }
            })
            .catch(err => {
                console.error('[useVerifiedLead] error fetching lead:', err);
                setLead(null);
                fetchedForKey.current = null;
            })
            .finally(() => setIsLoading(false));
    }, [leadId]);

    return {
        lead,
        leadId,
        isLoading,
        isReady: !!lead && lead.isVerified,
    };
}
