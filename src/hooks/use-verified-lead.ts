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
    /** Snapshot de leadId del widget context. */
    leadId: string | null;
    isLoading: boolean;
    /** True si tenemos un lead con `isVerified=true` cargado y listo para usar. */
    isReady: boolean;
}

/**
 * Hook estable para que cualquier formulario público pueda precargar los datos
 * de contacto del visitante después de que haya pasado el OTP.
 *
 * Si en el momento de montar no hay leadId en el context, devuelve `lead=null`
 * y los formularios deben pedir los datos como si fuera un visitante anónimo.
 *
 * Hace fetch una sola vez por leadId. Si el leadId cambia (logout / new flow),
 * vuelve a hacer fetch. Si la action falla, lead queda null y el form
 * degrada al modo "edición" normal.
 */
export function useVerifiedLead(): UseVerifiedLeadResult {
    const { leadId, setLeadId } = useWidgetContext();
    const [lead, setLead] = useState<VerifiedLeadDTO | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const fetchedForLeadId = useRef<string | null>(null);

    // El `setLeadId` del context se redefine en cada render del provider.
    // Si lo metemos en deps del useEffect, éste se re-ejecuta constantemente y
    // el `active=false` del cleanup descarta toda respuesta antes de llegar.
    // Lo guardamos en un ref para acceder a la versión más reciente sin
    // invalidar el effect.
    const setLeadIdRef = useRef(setLeadId);
    useEffect(() => {
        setLeadIdRef.current = setLeadId;
    }, [setLeadId]);

    useEffect(() => {
        if (!leadId) {
            setLead(null);
            fetchedForLeadId.current = null;
            return;
        }
        if (fetchedForLeadId.current === leadId) {
            // Single-flight: ya disparamos un fetch para este leadId.
            // En React 18 StrictMode esto evita la fetch duplicada del doble-mount.
            return;
        }
        fetchedForLeadId.current = leadId;
        setIsLoading(true);
        getVerifiedLeadAction(leadId)
            .then(res => {
                // No usamos un flag `active` con cleanup. React 18 tolera
                // setState tras unmount (no logea warning) y necesitamos que la
                // respuesta llegue al state aunque StrictMode haga doble-mount.
                if (res.success && res.lead) {
                    setLead(res.lead);
                    return;
                }
                console.warn(
                    `[useVerifiedLead] leadId='${leadId}' no se encontró en Firestore — limpiando localStorage para forzar reverificación.`
                );
                setLead(null);
                setLeadIdRef.current(null);
                fetchedForLeadId.current = null;
            })
            .catch(err => {
                console.error('[useVerifiedLead] error fetching lead:', err);
                setLead(null);
                fetchedForLeadId.current = null;
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
