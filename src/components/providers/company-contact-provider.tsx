'use client';

import { createContext, useContext } from 'react';
import { CONTACT_PHONE_DISPLAY } from '@/lib/contact';

/**
 * Datos de contacto públicos (Ajustes › Empresa) para componentes cliente,
 * que no pueden leer Firestore. Los inyecta el layout público desde
 * `companyConfigService`; fuera del provider se usan los fallback de código.
 */
export interface CompanyContact {
    phone: string;
    email: string;
    address: string;
}

const CompanyContactContext = createContext<CompanyContact>({
    phone: CONTACT_PHONE_DISPLAY,
    email: '',
    address: '',
});

export function CompanyContactProvider({ value, children }: { value: CompanyContact; children: React.ReactNode }) {
    return <CompanyContactContext.Provider value={value}>{children}</CompanyContactContext.Provider>;
}

export function useCompanyContact(): CompanyContact {
    return useContext(CompanyContactContext);
}
