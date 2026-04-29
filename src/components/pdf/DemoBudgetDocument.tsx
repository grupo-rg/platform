'use client';

import React from 'react';
import { Page, Text, View, Document, StyleSheet, Image } from '@react-pdf/renderer';
import { formatCurrency, formatNumberES } from '@/lib/utils';

const styles = StyleSheet.create({
    page: {
        flexDirection: 'column',
        backgroundColor: '#FFFFFF',
        padding: 40,
        fontFamily: 'Helvetica',
        fontSize: 10,
        color: '#333333'
    },
    header: {
        marginBottom: 20,
        paddingBottom: 20,
        borderBottomWidth: 1,
        borderColor: '#E2E8F0',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-end'
    },
    logoSection: {
        width: '40%'
    },
    companyLogo: {
        height: 40,
        marginBottom: 10,
        objectFit: 'contain'
    },
    metaSection: {
        textAlign: 'right',
        fontSize: 8,
        color: '#64748B',
        lineHeight: 1.4
    },
    title: {
        fontSize: 22,
        fontWeight: 'bold',
        color: '#0F172A',
        marginBottom: 5,
        textTransform: 'uppercase'
    },
    sectionTitle: {
        fontSize: 13,
        fontWeight: 'bold',
        marginBottom: 10,
        marginTop: 20,
        color: '#0F172A',
        borderBottomWidth: 1,
        borderBottomColor: '#E2E8F0',
        paddingBottom: 4,
        textTransform: 'uppercase'
    },
    bold: {
        fontWeight: 'bold',
        color: '#0F172A'
    },
    // --- NUEVOS ESTILOS PRESTO-STYLE ---
    chapterHeader: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#000000',
        borderBottomWidth: 1.5,
        borderBottomColor: '#000000',
        paddingBottom: 4,
        marginTop: 20,
        marginBottom: 10
    },
    itemContainer: {
        marginBottom: 15,
        paddingBottom: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#F1F5F9', // Subtle divider between items
    },
    itemMainRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 4,
    },
    itemCode: {
        width: '12%',
        fontSize: 9,
        fontWeight: 'bold',
        color: '#000000'
    },
    itemUnit: {
        width: '5%',
        fontSize: 9,
        fontWeight: 'bold',
        color: '#000000'
    },
    itemTitleColumn: {
        width: '68%',
        flexDirection: 'column',
        paddingRight: 10,
    },
    itemTitle: {
        fontSize: 9,
        color: '#334155',
        lineHeight: 1.3
    },
    itemTotal: {
        width: '15%',
        fontSize: 10,
        fontWeight: 'bold',
        color: '#000000',
        textAlign: 'right'
    },
    itemDescription: {
        fontSize: 8,
        color: '#64748B',
        marginTop: 4,
        marginBottom: 6,
        lineHeight: 1.4
    },
    breakdownRow: {
        flexDirection: 'row',
        marginLeft: '17%', // Indent under description
        marginBottom: 2,
    },
    bdCode: { width: '15%', fontSize: 7, color: '#475569' },
    bdQty: { width: '10%', fontSize: 7, color: '#475569', textAlign: 'right', paddingRight: 5 },
    bdUnit: { width: '5%', fontSize: 7, color: '#475569' },
    bdDesc: { width: '45%', fontSize: 7, color: '#475569', paddingRight: 5 },
    bdPrice: { width: '12%', fontSize: 7, color: '#475569', textAlign: 'right' },
    bdTotal: { width: '13%', fontSize: 7, color: '#475569', textAlign: 'right' },
    totalSection: {
        marginTop: 10,
        paddingTop: 10,
        borderTopWidth: 1,
        borderColor: '#E2E8F0',
        alignItems: 'flex-end',
        alignSelf: 'flex-end',
        width: '65%'
    },
    totalRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        width: '100%',
        marginBottom: 4
    },
    totalLabel: {
        fontSize: 9,
        fontWeight: 'bold',
        color: '#64748B'
    },
    totalValue: {
        fontSize: 9,
        fontWeight: 'bold',
        color: '#0F172A',
        textAlign: 'right'
    },
    finalTotal: {
        fontSize: 14,
        color: '#0F172A',
        fontWeight: 'bold',
        marginTop: 8,
        borderTopWidth: 1,
        borderColor: '#E2E8F0',
        paddingTop: 5,
        textAlign: 'right'
    },
    footerContainer: {
        position: 'absolute',
        bottom: 30,
        left: 40,
        right: 40,
    },
    footerLine: {
        borderTopWidth: 1,
        borderColor: '#E2E8F0',
        marginBottom: 5
    },
    footerText: {
        textAlign: 'center',
        color: '#94A3B8',
        fontSize: 7,
    },
});

interface DemoBudgetDocumentProps {
    budgetNumber: string;
    clientName: string;
    clientEmail: string;
    clientAddress: string;
    items: any[];
    costBreakdown: any;
    date: string;
    logoUrl?: string;
    budgetConfig?: { tax: number; marginGG: number; marginBI: number };
}

const Footer = ({ pageNumber, companyName, cif, address }: { pageNumber: number, companyName?: string, cif?: string, address?: string }) => {
    const defaultCompany = 'Basis';
    const defaultCif = '';
    const defaultAddress = '';

    const companyPart = (companyName || defaultCompany) + (cif || defaultCif ? ` - CIF: ${cif || defaultCif}` : '');
    const addressPart = address || defaultAddress ? ` - ${address || defaultAddress}` : '';

    return (
        <View style={styles.footerContainer} fixed>
            <View style={styles.footerLine} />
            <Text style={styles.footerText}>
                {companyPart}{addressPart} {"\n"}
                Página {pageNumber}
            </Text>
        </View>
    );
};

const Header = ({ budgetNumber, date, logoUrl, companyName }: { budgetNumber: string, date: string, logoUrl?: string, companyName?: string }) => (
    <View style={styles.header}>
        <View style={styles.logoSection}>
            {logoUrl ? (
                <Image
                    src={logoUrl}
                    style={styles.companyLogo}
                />
            ) : (
                <Image
                    src="/images/logo-negro.png"
                    style={{ height: 32, marginBottom: 10, objectFit: 'contain' }}
                />
            )}
        </View>
        <View style={styles.metaSection}>
            <Text style={styles.bold}>PRESUPUESTO Nº {budgetNumber}</Text>
            <Text>Fecha: {date}</Text>
        </View>
    </View>
);

export const DemoBudgetDocument = ({
    budgetNumber,
    clientName,
    clientEmail,
    clientAddress,
    items,
    costBreakdown,
    date,
    logoUrl,
    budgetConfig
}: DemoBudgetDocumentProps) => {

    const itemsByChapter = items.reduce((acc: Record<string, any[]>, item) => {
        const chapter = item.chapter || 'Partidas Generales';
        if (!acc[chapter]) acc[chapter] = [];
        acc[chapter].push(item);
        return acc;
    }, {});

    const chapters = Object.keys(itemsByChapter);

    return (
        <Document>
            <Page size="A4" style={styles.page}>
                <Header budgetNumber={budgetNumber} date={date} logoUrl={logoUrl} companyName={clientEmail} />

                <Text style={styles.title}>Propuesta Técnica y Económica</Text>

                <View style={{ marginBottom: 20, backgroundColor: '#F8FAFC', padding: 15, borderRadius: 8, marginTop: 10 }}>
                    <Text style={{ fontSize: 9, color: '#64748B', marginBottom: 6, textTransform: 'uppercase', fontWeight: 'bold' }}>Cliente / Ubicación</Text>
                    <Text style={{ fontSize: 14, fontWeight: 'bold', color: '#0F172A', marginBottom: 4 }}>{clientName}</Text>
                    <Text style={{ fontSize: 10, color: '#475569' }}>{clientEmail}</Text>
                    <Text style={{ fontSize: 10, color: '#475569', marginTop: 4 }}>{clientAddress || 'Dirección de obra facilitada'}</Text>
                </View>

                <Text style={styles.sectionTitle}>Desglose Detallado de Partidas</Text>

                {chapters.map((chapterName) => (
                    <View key={chapterName} wrap={false} style={{ marginBottom: 15 }}>
                        <Text style={styles.chapterHeader}>{chapterName}</Text>

                        {itemsByChapter[chapterName].map((item: any, index: number) => {
                            const bTotal = (item.item?.totalPrice || item.item?.price || 0);
                            const qTotal = (item.item?.quantity || 1);

                            // Prevent duplicating title into description if they are implicitly the same 
                            const showDescription = item.item?.description && item.item.description.trim() !== "" && item.item.description.trim() !== item.originalTask.trim();

                            return (
                                <View key={item.id || index} style={styles.itemContainer} wrap={false}>
                                    {/* Main Row: Code | Unit | Title Column | Total */}
                                    <View style={styles.itemMainRow}>
                                        <Text style={styles.itemCode}>{item.item?.code || '-'}</Text>
                                        <Text style={styles.itemUnit}>{item.item?.unit || 'ud'}</Text>
                                        <View style={styles.itemTitleColumn}>
                                            <Text style={styles.itemTitle}>{item.originalTask}</Text>
                                            {showDescription && (
                                                <Text style={styles.itemDescription}>{item.item.description}</Text>
                                            )}
                                        </View>
                                        <Text style={styles.itemTotal}>{formatCurrency(bTotal)}</Text>
                                    </View>

                                    {/* Detailed Breakdown nested correctly */}
                                    {item.item?.breakdown && item.item.breakdown.length > 0 && (
                                        <View style={{ marginTop: 2 }}>
                                            {item.item.breakdown.map((b: any, bIdx: number) => {
                                                const unitPrice = b.price || 0;
                                                const qty = b.quantity || 1;
                                                const lineTotal = unitPrice * qty;

                                                return (
                                                    <View key={bIdx} style={styles.breakdownRow}>
                                                        <Text style={styles.bdCode}>{b.code || '-'}</Text>
                                                        <Text style={styles.bdQty}>{formatNumberES(parseFloat(qty.toString()), 3)}</Text>
                                                        <Text style={styles.bdUnit}>{b.unit?.toLowerCase() === '%' ? 'h' : (b.unit || 'u')}</Text>
                                                        <Text style={styles.bdDesc}>{b.description}</Text>
                                                        <Text style={styles.bdPrice}>{formatCurrency(unitPrice)}</Text>
                                                        <Text style={styles.bdTotal}>{formatCurrency(lineTotal)}</Text>
                                                    </View>
                                                );
                                            })}
                                        </View>
                                    )}
                                </View>
                            );
                        })}
                    </View>
                ))}

                <View style={styles.totalSection} wrap={false}>
                    <View style={styles.totalRow}>
                        <Text style={[styles.totalLabel, { marginRight: 24 }]}>P.E.M.</Text>
                        <Text style={styles.totalValue}>{formatCurrency(costBreakdown.materialExecutionPrice)}</Text>
                    </View>
                    <View style={styles.totalRow}>
                        <Text style={[styles.totalLabel, { marginRight: 24 }]}>IVA ({budgetConfig?.tax || 21}%)</Text>
                        <Text style={styles.totalValue}>{formatCurrency(costBreakdown.tax)}</Text>
                    </View>
                    <View style={[styles.totalRow, { marginTop: 8 }]}>
                        <Text style={[styles.totalLabel, styles.finalTotal, { marginRight: 24 }]}>TOTAL PRESUPUESTO</Text>
                        <Text style={[styles.totalValue, styles.finalTotal]}>{formatCurrency(costBreakdown.total)}</Text>
                    </View>
                </View>

                <Footer pageNumber={1} companyName={clientEmail} cif={clientEmail ? "Generado por Basis" : undefined} address={clientEmail ? "Demostración Pública" : undefined} />
                <Footer pageNumber={2} companyName={clientEmail} cif={clientEmail ? "Generado por Basis" : undefined} address={clientEmail ? "Demostración Pública" : undefined} />
                <Footer pageNumber={3} companyName={clientEmail} cif={clientEmail ? "Generado por Basis" : undefined} address={clientEmail ? "Demostración Pública" : undefined} />
            </Page>
        </Document>
    );
};
