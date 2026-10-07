'use client';

import React from 'react';
import { Page, Text, View, Document, StyleSheet } from '@react-pdf/renderer';
import { formatNumberES } from '@/lib/utils';
import type { CompanyConfig } from '@/backend/platform/domain/company-config';
import type { TemplatePlaceholderValues } from '@/backend/document-template/domain/document-template';
import {
    formatDateEs,
    groupPriceListRows,
    priceColumnHeader,
    validityDays,
    type PriceList,
} from '@/backend/price-list/domain/price-list';
import { DocumentHeader, DocumentFooter, TemplateBlocksView, DisclaimerView, pdfBaseStyles } from './shared/pdf-common';

/** Datos que necesita el PDF (la lista tal cual está en el editor, guardada o no). */
export type PriceListDocumentData = Pick<
    PriceList,
    | 'title'
    | 'reference'
    | 'clientName'
    | 'clientEmail'
    | 'clientAddress'
    | 'date'
    | 'validUntil'
    | 'pricesIncludeVat'
    | 'vatRate'
    | 'intro'
    | 'notes'
    | 'blocks'
    | 'disclaimer'
    | 'items'
>;

const styles = StyleSheet.create({
    page: {
        flexDirection: 'column',
        backgroundColor: '#FFFFFF',
        padding: 40,
        paddingBottom: 70,
        fontFamily: 'Helvetica',
        fontSize: 10,
        color: '#333333',
    },
    title: { fontSize: 20, fontWeight: 'bold', color: '#0F172A', marginBottom: 6, textTransform: 'uppercase' },
    clientBox: { marginTop: 10, marginBottom: 14, backgroundColor: '#F8FAFC', padding: 14, borderRadius: 8 },
    clientLabel: { fontSize: 8, color: '#64748B', marginBottom: 5, textTransform: 'uppercase', fontWeight: 'bold' },
    clientName: { fontSize: 13, fontWeight: 'bold', color: '#0F172A', marginBottom: 3 },
    clientLine: { fontSize: 9, color: '#475569', marginTop: 1 },
    vatBand: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#0F172A',
        borderRadius: 4,
        paddingVertical: 6,
        paddingHorizontal: 10,
        marginBottom: 14,
    },
    vatText: { fontSize: 10, fontWeight: 'bold', color: '#0F172A' },
    vatSub: { fontSize: 8, color: '#64748B' },
    sectionHeader: {
        fontSize: 12,
        fontWeight: 'bold',
        color: '#000000',
        borderBottomWidth: 1.5,
        borderBottomColor: '#000000',
        paddingBottom: 3,
        marginTop: 14,
        marginBottom: 6,
        textTransform: 'uppercase',
    },
    colHeaderRow: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: '#94A3B8',
        paddingBottom: 3,
        marginBottom: 2,
    },
    colHeaderText: { fontSize: 7, fontWeight: 'bold', color: '#64748B', textTransform: 'uppercase' },
    row: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingVertical: 5,
        borderBottomWidth: 0.5,
        borderBottomColor: '#F1F5F9',
    },
    cellText: { fontSize: 9, color: '#1E293B' },
    price: { fontSize: 10, fontWeight: 'bold', color: '#000000', textAlign: 'right' },
    pricePending: { fontSize: 9, color: '#94A3B8', textAlign: 'right' },
    notesBox: { marginTop: 20, backgroundColor: '#F8FAFC', padding: 10, borderRadius: 4, borderLeft: 2, borderColor: '#3B82F6' },
});

export interface PriceListDocumentProps {
    priceList: PriceListDocumentData;
    company: CompanyConfig;
    /** Logo específico (data URL). Si no, `company.logoUrl`. */
    logoUrl?: string;
}

export const PriceListDocument = ({ priceList, company, logoUrl }: PriceListDocumentProps) => {
    const sections = groupPriceListRows(priceList.items);
    const hasCodes = priceList.items.some((r) => r.type === 'item' && (r.code || '').trim() !== '');
    const dateLabel = formatDateEs(priceList.date);
    const days = validityDays(priceList.date, priceList.validUntil);
    const values: TemplatePlaceholderValues = {
        empresa: company.name,
        cliente: priceList.clientName || '',
        fecha: dateLabel,
        validez_dias: days !== null ? String(days) : '',
    };
    const vatRate = Number.isFinite(priceList.vatRate) ? priceList.vatRate : 21;
    const vatLabel = priceList.pricesIncludeVat
        ? `Precios IVA incluido (${formatNumberES(vatRate, vatRate % 1 === 0 ? 0 : 2)} %)`
        : 'Precios sin IVA';
    const vatSub = priceList.pricesIncludeVat
        ? 'Los importes ya incluyen el IVA indicado.'
        : `A los importes se les aplicará el IVA vigente (${formatNumberES(vatRate, vatRate % 1 === 0 ? 0 : 2)} %).`;

    const W = hasCodes
        ? { code: '12%', desc: '58%', unit: '12%', price: '18%' }
        : { code: '0%', desc: '70%', unit: '12%', price: '18%' };

    return (
        <Document title={`${priceList.title} — ${priceList.reference}`}>
            <Page size="A4" style={styles.page}>
                <DocumentHeader
                    docLabel="LISTA DE PRECIOS Nº"
                    docNumber={priceList.reference || '—'}
                    date={dateLabel}
                    logoUrl={logoUrl}
                    company={company}
                    extraLines={priceList.validUntil ? [`Válida hasta: ${formatDateEs(priceList.validUntil)}`] : undefined}
                />

                <Text style={styles.title}>{priceList.title}</Text>

                {(priceList.clientName || priceList.clientEmail || priceList.clientAddress) && (
                    <View style={styles.clientBox} wrap={false}>
                        <Text style={styles.clientLabel}>Cliente</Text>
                        {priceList.clientName ? <Text style={styles.clientName}>{priceList.clientName}</Text> : null}
                        {priceList.clientEmail ? <Text style={styles.clientLine}>{priceList.clientEmail}</Text> : null}
                        {priceList.clientAddress ? <Text style={styles.clientLine}>{priceList.clientAddress}</Text> : null}
                    </View>
                )}

                <View style={styles.vatBand} wrap={false}>
                    <Text style={styles.vatText}>{vatLabel}</Text>
                    <Text style={styles.vatSub}>{vatSub}</Text>
                </View>

                {priceList.intro && priceList.intro.trim() !== '' && (
                    <View style={{ marginBottom: 4 }}>
                        <TemplateBlocksView blocks={[{ id: 'intro', title: '', body: priceList.intro }]} values={values} />
                    </View>
                )}

                {sections.map((section, sIdx) => {
                    const header = priceColumnHeader(section.items);
                    return (
                        <View key={section.sectionId ?? `s-${sIdx}`} style={{ marginBottom: 6 }}>
                            {/* El título de sección + cabecera de columnas no se separan de la primera línea. */}
                            <View wrap={false}>
                                {section.title !== null && <Text style={styles.sectionHeader}>{section.title}</Text>}
                                <View style={[styles.colHeaderRow, section.title === null ? { marginTop: 10 } : {}]}>
                                    {hasCodes && <Text style={[styles.colHeaderText, { width: W.code }]}>Cód.</Text>}
                                    <Text style={[styles.colHeaderText, { width: W.desc }]}>Descripción</Text>
                                    <Text style={[styles.colHeaderText, { width: W.unit, textAlign: 'center' }]}>Ud</Text>
                                    <Text style={[styles.colHeaderText, { width: W.price, textAlign: 'right', textTransform: 'none' }]}>{/* "€/h" sin mayúsculas forzadas */}{header === 'Precio' ? 'PRECIO' : header}</Text>
                                </View>
                                {section.items[0] && <PriceRow row={section.items[0]} hasCodes={hasCodes} W={W} />}
                            </View>
                            {section.items.slice(1).map((row) => (
                                <PriceRow key={row.id} row={row} hasCodes={hasCodes} W={W} />
                            ))}
                            {section.items.length === 0 && (
                                <Text style={[styles.cellText, { color: '#94A3B8', paddingVertical: 4 }]}>Sin líneas.</Text>
                            )}
                        </View>
                    );
                })}

                {priceList.notes && priceList.notes.trim() !== '' && (
                    <View style={styles.notesBox} wrap={false}>
                        <Text style={[pdfBaseStyles.bold, { fontSize: 8, color: '#334155', marginBottom: 4 }]}>Notas:</Text>
                        <Text style={{ fontSize: 8, color: '#475569', lineHeight: 1.4 }}>{priceList.notes}</Text>
                    </View>
                )}

                {priceList.blocks && priceList.blocks.length > 0 && (
                    <TemplateBlocksView blocks={priceList.blocks} values={values} />
                )}

                <DisclaimerView text={priceList.disclaimer} values={values} />

                <DocumentFooter company={company} />
            </Page>
        </Document>
    );
};

const PriceRow = ({
    row,
    hasCodes,
    W,
}: {
    row: PriceListDocumentData['items'][number];
    hasCodes: boolean;
    W: { code: string; desc: string; unit: string; price: string };
}) => {
    const hasPrice = typeof row.unitPrice === 'number' && Number.isFinite(row.unitPrice);
    return (
        <View style={styles.row} wrap={false}>
            {hasCodes && <Text style={[styles.cellText, { width: W.code, fontWeight: 'bold' }]}>{row.code || ''}</Text>}
            <Text style={[styles.cellText, { width: W.desc, paddingRight: 8 }]}>{row.description}</Text>
            <Text style={[styles.cellText, { width: W.unit, textAlign: 'center' }]}>{row.unit || ''}</Text>
            <Text style={[hasPrice ? styles.price : styles.pricePending, { width: W.price }]}>
                {hasPrice ? `${formatNumberES(row.unitPrice as number, 2)} €` : '—'}
            </Text>
        </View>
    );
};
