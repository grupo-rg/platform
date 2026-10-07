'use client';

import React, { useEffect, useState } from 'react';
import { pdf } from '@react-pdf/renderer';
import type { CompanyConfig } from '@/backend/platform/domain/company-config';
import { PriceListDocument, type PriceListDocumentData } from '@/components/pdf/PriceListDocument';

/**
 * El logo se guarda normalmente como data URL; si es una URL externa (legacy)
 * se precarga a data URL para que @react-pdf no falle en silencio (mismo
 * criterio que `BudgetEconomicSummary`).
 */
export async function logoToDataUrl(url?: string): Promise<string | undefined> {
    if (!url) return undefined;
    if (url.startsWith('data:')) return url;
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        return await new Promise<string | undefined>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : undefined);
            reader.readAsDataURL(blob);
        });
    } catch (err) {
        console.warn('[price-list pdf] No se pudo precargar el logo:', err);
        return undefined;
    }
}

export function usePdfCompany(company: CompanyConfig): CompanyConfig {
    const [logo, setLogo] = useState<string | undefined>(company.logoUrl?.startsWith('data:') ? company.logoUrl : undefined);
    useEffect(() => {
        let cancelled = false;
        logoToDataUrl(company.logoUrl).then((l) => !cancelled && setLogo(l));
        return () => {
            cancelled = true;
        };
    }, [company.logoUrl]);
    return { ...company, logoUrl: logo };
}

export async function renderPriceListBlob(data: PriceListDocumentData, company: CompanyConfig): Promise<Blob> {
    return pdf(<PriceListDocument priceList={data} company={company} />).toBlob();
}

export function priceListFileName(data: Pick<PriceListDocumentData, 'reference' | 'title'>): string {
    const slug = (data.title || 'lista')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60);
    return `${data.reference || 'Lista-de-precios'}-${slug}.pdf`;
}

export function downloadBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
