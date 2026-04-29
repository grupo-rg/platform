'use client';

import React from 'react';
import { Page, Text, View, Document, StyleSheet, Image, Font } from '@react-pdf/renderer';
import { formatCurrency, formatNumberES } from '@/lib/utils';
import type { CompanyConfig } from '@/backend/platform/domain/company-config';

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
        borderBottom: 1,
        borderColor: '#E2E8F0',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-end'
    },
    logoSection: {
        width: '40%'
    },
    companyLogo: {
        width: 140,
        height: 60,
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
    subtitle: {
        fontSize: 11,
        color: '#64748B',
        marginBottom: 20
    },
    sectionTitle: {
        fontSize: 13,
        fontWeight: 'bold',
        marginBottom: 10,
        marginTop: 20,
        color: '#0F172A',
        borderBottom: 1,
        borderBottomColor: '#E2E8F0',
        paddingBottom: 4,
        textTransform: 'uppercase'
    },
    textBlock: {
        marginBottom: 8,
        lineHeight: 1.6,
        fontSize: 9,
        textAlign: 'justify'
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
    // Header de columnas — repetido al inicio de cada capítulo para legibilidad.
    columnHeaderRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        borderBottomWidth: 0.5,
        borderBottomColor: '#94A3B8',
        paddingBottom: 3,
        marginBottom: 6,
    },
    columnHeaderText: {
        fontSize: 7,
        fontWeight: 'bold',
        color: '#64748B',
        textTransform: 'uppercase',
    },
    itemMainRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 4,
    },
    // Distribución 6 columnas (suma 100%): Code | Description | Ud | Cant | Precio | Total
    itemCode: {
        width: '10%',
        fontSize: 9,
        fontWeight: 'bold',
        color: '#000000',
        paddingRight: 4,
    },
    itemTitleColumn: {
        width: '40%',
        flexDirection: 'column',
        paddingRight: 8,
    },
    itemTitle: {
        fontSize: 9,
        color: '#334155',
        lineHeight: 1.3
    },
    itemUnit: {
        width: '8%',
        fontSize: 9,
        color: '#000000',
        textAlign: 'center',
    },
    itemQty: {
        width: '10%',
        fontSize: 9,
        color: '#000000',
        textAlign: 'right',
        paddingRight: 4,
    },
    itemPrice: {
        width: '15%',
        fontSize: 9,
        color: '#000000',
        textAlign: 'right',
        paddingRight: 4,
    },
    itemTotal: {
        width: '17%',
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
        marginLeft: '10%', // Indent bajo la columna de código (10% width)
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
        borderTop: 1,
        borderColor: '#000000',
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
        color: '#000000',
        fontWeight: 'bold',
        marginTop: 8,
        borderTop: 1,
        borderColor: '#000000',
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
        borderTop: 1,
        borderColor: '#E2E8F0',
        marginBottom: 5
    },
    footerText: {
        textAlign: 'center',
        color: '#94A3B8',
        fontSize: 7,
    },
    badge: {
        backgroundColor: '#F1F5F9',
        color: '#0F172A',
        paddingVertical: 2,
        paddingHorizontal: 6,
        borderRadius: 4,
        fontSize: 8,
        fontWeight: 'bold'
    }
});

interface BudgetDocumentProps {
    budgetNumber: string;
    clientName: string;
    clientEmail: string;
    clientAddress: string;
    items: any[];
    costBreakdown: any;
    date: string;
    /** Logo específico del presupuesto. Si no se pasa, se usa company.logoUrl. */
    logoUrl?: string;
    notes?: string;
    budgetConfig?: { tax: number; marginGG: number; marginBI: number };
    executionMode?: 'complete' | 'execution' | 'labor';
    renders?: any[];
    /** IDs de renders seleccionados para incluir en el anexo visual. Vacío/undefined = sin anexo. */
    selectedRenderIds?: string[];
    /** Datos de la empresa emisora. Fuente única para header, footer y branding del PDF. */
    company: CompanyConfig;
}

const Footer = ({ pageNumber, company }: { pageNumber: number; company: CompanyConfig }) => {
    const line = [company.legalName || company.name, company.cif && `CIF: ${company.cif}`, company.address]
        .filter(Boolean)
        .join(' · ');
    return (
        <View style={styles.footerContainer} fixed>
            <View style={styles.footerLine} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={styles.footerText}>{line}</Text>
                <Text style={styles.footerText}>Página {pageNumber}</Text>
            </View>
            {company.footerText && (
                <Text style={{ fontSize: 6, color: '#94A3B8', marginTop: 2 }}>{company.footerText}</Text>
            )}
        </View>
    );
};

const Header = ({ budgetNumber, date, logoUrl, company, totalAmount }: { budgetNumber: string; date: string; logoUrl?: string; company: CompanyConfig; totalAmount?: number }) => {
    const resolvedLogo = logoUrl || company.logoUrl;
    return (
        <View style={styles.header}>
            <View style={styles.logoSection}>
                {resolvedLogo ? (
                    <Image src={resolvedLogo} style={styles.companyLogo} />
                ) : (
                    <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#0F172A' }}>{company.name}</Text>
                )}
                {company.tagline && (
                    <Text style={{ fontSize: 8, color: '#64748B', marginTop: 2 }}>{company.tagline}</Text>
                )}
            </View>
            <View style={styles.metaSection}>
                <Text style={styles.bold}>PRESUPUESTO Nº {budgetNumber}</Text>
                <Text>Fecha: {date}</Text>
                {totalAmount !== undefined && totalAmount > 0 && (
                    <Text style={{ fontSize: 11, fontWeight: 'bold', color: '#0F172A', marginTop: 4 }}>
                        Total: {formatCurrency(totalAmount)}
                    </Text>
                )}
                {company.web && <Text>{company.web}</Text>}
                {company.phone && <Text>{company.phone}</Text>}
            </View>
        </View>
    );
};

export const BudgetDocument = ({
    budgetNumber,
    clientName,
    clientEmail,
    clientAddress,
    items,
    costBreakdown,
    date,
    logoUrl,
    notes,
    budgetConfig,
    executionMode = 'complete',
    renders = [],
    selectedRenderIds,
    company,
}: BudgetDocumentProps) => {
    const selectedRenders = selectedRenderIds && selectedRenderIds.length > 0
        ? renders.filter((r: any) => selectedRenderIds.includes(r.id))
        : [];
    const renderPages: any[][] = [];
    for (let i = 0; i < selectedRenders.length; i += 2) {
        renderPages.push(selectedRenders.slice(i, i + 2));
    }

    // Group items by chapter
    const itemsByChapter = items.reduce((acc: Record<string, any[]>, item) => {
        const chapter = item.chapter || 'Partidas Generales';
        if (!acc[chapter]) acc[chapter] = [];
        acc[chapter].push(item);
        return acc;
    }, {});

    const chapters = Object.keys(itemsByChapter);

    return (
        <Document>
            {/* --- PAGES: DETAILED BUDGET (NOW COMES FIRST) --- */}
            <Page size="A4" style={styles.page}>
                <Header budgetNumber={budgetNumber} date={date} logoUrl={logoUrl} company={company} totalAmount={costBreakdown.total} />

                <View style={{ marginTop: 20, marginBottom: 30 }}>
                    <Text style={styles.title}>Propuesta Técnica y Económica</Text>
                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 5 }}>
                        <Text style={styles.badge}>Reforma Personalizada</Text>
                        <Text style={styles.badge}>{company.name} · Estándar de Calidad</Text>
                    </View>
                </View>

                <View style={{ marginBottom: 30, backgroundColor: '#F8FAFC', padding: 20, borderRadius: 8 }}>
                    <Text style={{ fontSize: 9, color: '#64748B', marginBottom: 8, textTransform: 'uppercase', fontWeight: 'bold' }}>Cliente / Ubicación</Text>
                    <Text style={{ fontSize: 14, fontWeight: 'bold', color: '#0F172A', marginBottom: 4 }}>{clientName}</Text>
                    <Text style={{ fontSize: 10, color: '#475569' }}>{clientEmail}</Text>
                    <Text style={{ fontSize: 10, color: '#475569', marginTop: 4 }}>{clientAddress || 'Dirección de obra facilitada'}</Text>
                </View>

                {chapters.map((chapterName) => (
                    <View key={chapterName} style={{ marginBottom: 15 }}>
                        <Text style={styles.chapterHeader} wrap={false}>{chapterName}</Text>

                        {/* Header de columnas (repetido por capítulo para legibilidad si rompe página). */}
                        <View style={styles.columnHeaderRow} wrap={false}>
                            <Text style={[styles.columnHeaderText, { width: '10%' }]}>Cód</Text>
                            <Text style={[styles.columnHeaderText, { width: '40%' }]}>Descripción</Text>
                            <Text style={[styles.columnHeaderText, { width: '8%', textAlign: 'center' }]}>Ud</Text>
                            <Text style={[styles.columnHeaderText, { width: '10%', textAlign: 'right' }]}>Cant.</Text>
                            <Text style={[styles.columnHeaderText, { width: '15%', textAlign: 'right' }]}>Precio</Text>
                            <Text style={[styles.columnHeaderText, { width: '17%', textAlign: 'right' }]}>Total</Text>
                        </View>

                        {itemsByChapter[chapterName].map((item: any, index: number) => {
                            let bTotal = (item.item?.totalPrice || item.item?.price || 0);
                            const qTotal = (item.item?.quantity || 1);

                            // Adjust bTotal dynamically for PDF based on execution mode
                            const activeBreakdown = item.item?.breakdown || [];
                            if (executionMode === 'execution' && activeBreakdown.length > 0) {
                                const vCost = activeBreakdown
                                    .filter((c: any) => c.is_variable === true || c.is_variable === 'true' || c.isVariable === true)
                                    .reduce((acc: number, c: any) => acc + (c.totalPrice || c.total || ((c.unitPrice || c.price || 0) * (c.quantity || c.yield || 1))), 0);
                                bTotal = Math.max(0, bTotal - (vCost * qTotal));
                            } else if (executionMode === 'labor' && activeBreakdown.length > 0) {
                                const laborCost = activeBreakdown
                                    .filter((c: any) => c.code && String(c.code).toLowerCase().startsWith('mo'))
                                    .reduce((acc: number, c: any) => acc + (c.totalPrice || c.total || ((c.unitPrice || c.price || 0) * (c.quantity || c.yield || 1))), 0);
                                bTotal = Math.max(0, laborCost * qTotal);
                            }

                            // Phase 15 — distribuir GG+BI equitativamente sobre partidas para PDF.
                            // El cliente ve precios all-in por partida; sus sumas matchean el Base Imponible.
                            // Los componentes internos (breakdown) siguen mostrando raw para auditabilidad.
                            const markupFactor = 1 + ((budgetConfig?.marginGG || 0) + (budgetConfig?.marginBI || 0)) / 100;
                            const bTotalAllIn = bTotal * markupFactor;

                            // Prevent duplicating title into description if they are implicitly the same 
                            const showDescription = item.item?.description && item.item.description.trim() !== "" && item.item.description.trim() !== item.originalTask.trim();

                            // Phase 16.C — precio unitario all-in (raw × markupFactor) para mostrar al cliente.
                            const unitPriceRaw = item.item?.unitPrice || 0;
                            const unitPriceAllIn = unitPriceRaw * markupFactor;

                            return (
                                <View key={item.id || index} style={styles.itemContainer} wrap={false}>
                                    {/* Main Row: 6 columnas (Code | Description | Ud | Cant | Precio | Total) */}
                                    <View style={styles.itemMainRow}>
                                        <Text style={styles.itemCode}>{item.item?.code || '-'}</Text>
                                        <View style={styles.itemTitleColumn}>
                                            <Text style={styles.itemTitle}>{item.originalTask}</Text>
                                            {showDescription && (
                                                <Text style={styles.itemDescription}>{item.item.description}</Text>
                                            )}
                                        </View>
                                        <Text style={styles.itemUnit}>{item.item?.unit || 'ud'}</Text>
                                        <Text style={styles.itemQty}>{formatNumberES(qTotal, 2)}</Text>
                                        <Text style={styles.itemPrice}>{formatNumberES(unitPriceAllIn, 2)}</Text>
                                        <Text style={styles.itemTotal}>{formatNumberES(bTotalAllIn, 2)}</Text>
                                    </View>

                                    {/* Detailed Breakdown nested correctly */}
                                    {activeBreakdown.length > 0 && (
                                        <View style={{ marginTop: 2 }}>
                                            {activeBreakdown.map((b: any, bIdx: number) => {
                                                if (executionMode === 'execution' && (b.is_variable === true || b.is_variable === 'true' || b.isVariable === true)) return null;
                                                if (executionMode === 'labor' && !(b.code && String(b.code).toLowerCase().startsWith('mo'))) return null;
                                                const unitPrice = b.price || 0;
                                                const qty = b.quantity || 1;
                                                const lineTotal = unitPrice * qty;

                                                return (
                                                    <View key={bIdx} style={styles.breakdownRow}>
                                                        <Text style={styles.bdCode}>{b.code || '-'}</Text>
                                                        <Text style={styles.bdQty}>{formatNumberES(parseFloat(qty.toString()), 3)}</Text>
                                                        <Text style={styles.bdUnit}>{b.unit?.toLowerCase() === '%' ? 'h' : (b.unit || 'u')}</Text>
                                                        <Text style={styles.bdDesc}>{b.description || b.concept}</Text>
                                                        <Text style={styles.bdPrice}>{formatNumberES(unitPrice, 2)}</Text>
                                                        <Text style={styles.bdTotal}>{formatNumberES(lineTotal, 2)}</Text>
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

                {/* Phase 15 — Resumen económico simplificado: Base Imponible + IVA + Total.
                    Sin GG/BI como líneas separadas (markup distribuido implícitamente entre partidas).
                    Convención de presupuesto al cliente final. */}
                <View style={[styles.totalSection, { marginTop: 20 }]} wrap={false}>
                    <View style={styles.totalRow}>
                        <Text style={styles.totalLabel}>Base Imponible:</Text>
                        <Text style={styles.totalValue}>{formatCurrency(costBreakdown.materialExecutionPrice + costBreakdown.overheadExpenses + costBreakdown.industrialBenefit)}</Text>
                    </View>
                    <View style={styles.totalRow}>
                        <Text style={styles.totalLabel}>IVA ({budgetConfig?.tax || 10}%):</Text>
                        <Text style={styles.totalValue}>{formatCurrency(costBreakdown.tax)}</Text>
                    </View>
                    <View style={[styles.totalRow, { marginTop: 8 }]}>
                        <Text style={[styles.totalLabel, styles.finalTotal, { fontSize: 13, marginRight: 24 }]}>TOTAL PRESUPUESTO</Text>
                        <Text style={styles.finalTotal}>{formatCurrency(costBreakdown.total)}</Text>
                    </View>
                </View>

                {notes && (
                    <View style={{ marginTop: 30, backgroundColor: '#F8FAFC', padding: 10, borderRadius: 4, borderLeft: 2, borderColor: '#3B82F6' }} wrap={false}>
                        <Text style={[styles.bold, { fontSize: 8, color: '#334155', marginBottom: 4 }]}>Notas Adicionales / Condiciones:</Text>
                        <Text style={{ fontSize: 7, color: '#475569', lineHeight: 1.4 }}>{notes}</Text>
                    </View>
                )}

                <View style={{ marginTop: 20, borderTop: 1, borderColor: '#E2E8F0', paddingTop: 15 }} wrap={false}>
                    <Text style={[styles.textBlock, { fontStyle: 'italic', color: '#64748B' }]}>
                        * Este documento es una estimación técnica preliminar. Un experto contactará con usted para realizar una visita técnica y refinar los detalles finales del presupuesto.
                    </Text>
                </View>
                <Footer pageNumber={1} company={company} />
            </Page>

            {/* --- PAGE: METHODOLOGY & INFO (MOVED TO THE END) --- */}
            <Page size="A4" style={styles.page}>
                <Header budgetNumber={budgetNumber} date={date} logoUrl={logoUrl} company={company} totalAmount={costBreakdown.total} />

                <Text style={styles.sectionTitle}>1. Por qué es importante leer este presupuesto hasta el final</Text>
                <Text style={styles.textBlock}>
                    Independientemente de que finalmente trabajemos juntos o no, le recomendamos leer este presupuesto hasta el final.
                    La información que contiene le ayudará a comprender cómo debe desarrollarse un proceso de reforma bien organizado, seguro y de calidad, qué riesgos es importante evitar y cómo tomar una decisión informada al elegir a la empresa ejecutora.
                </Text>
                <Text style={styles.textBlock}>
                    Este documento no es solo un precio: describe nuestra forma de trabajar, el nivel de responsabilidad que asumimos y el valor real que recibe como cliente.
                </Text>

                <Text style={styles.sectionTitle}>2. Precio y Validez del Presupuesto</Text>
                <Text style={styles.textBlock}>
                    El precio total estimado para este proyecto es de <Text style={styles.bold}>{formatCurrency(costBreakdown.total)}</Text>.
                </Text>
                <Text style={styles.textBlock}>
                    <Text style={styles.bold}>Validez del presupuesto:</Text> hasta el 15 días posteriores a la fecha de emisión.
                    Trabajamos con planificación previa y con capacidad limitada. Una vez finalizado el plazo de validez, no podemos garantizar ni el precio ni las fechas de inicio y ejecución indicadas.
                </Text>

                <Text style={styles.sectionTitle}>3. Qué problemas resolvemos por usted</Text>
                <Text style={styles.textBlock}>
                    Como cliente, no debería supervisar diariamente si los trabajos se están realizando correctamente, conocer materiales técnicos, coordinar operarios o asumir riesgos de mala planificación.
                </Text>
                <Text style={styles.textBlock}>
                    En la práctica, la falta de organización suele provocar retrasos y sobrecostes. Nuestro trabajo consiste en asumir ese riesgo por usted y ofrecerle un proceso tranquilo, claro y previsible.
                </Text>

                <Text style={styles.sectionTitle}>4. Qué hacemos y qué beneficios obtiene usted</Text>
                <View style={{ marginBottom: 15 }}>
                    <Text style={[styles.textBlock, styles.bold]}>✔ Experiencia contrastada y control real</Text>
                    <Text style={styles.textBlock}>
                        Contamos con 25 años de experiencia práctica real. Dispongo de formación profesional en diseño de interiores, lo que me permite tener una visión global de cada proyecto: funcional, estético y duradero. Cada fase está supervisada personalmente.
                    </Text>
                </View>

                <View style={{ marginBottom: 15 }}>
                    <Text style={[styles.textBlock, styles.bold]}>✔ Equipo propio, medios y estándares</Text>
                    <Text style={styles.textBlock}>
                        Trabajamos con personal propio y formado. Todos cuentan con equipos de protección individual y siguen estándares claros de ejecución. Disponemos de herramientas profesionales de alta precisión.
                    </Text>
                </View>

                <View style={{ marginBottom: 15 }}>
                    <Text style={[styles.textBlock, styles.bold]}>✔ Materiales de calidad y buena ejecución</Text>
                    <Text style={styles.textBlock}>
                        Utilizamos materiales contrastados que previenen problemas futuros y evitan reparaciones innecesarias, suponiendo un ahorro de tiempo y dinero para usted.
                    </Text>
                </View>

                <View style={{ marginBottom: 15 }}>
                    <Text style={[styles.textBlock, styles.bold]}>✔ Pensamos como inversor y como cliente</Text>
                    <Text style={styles.textBlock}>
                        Como profesional que ha sido inversor, entiendo perfectamente sus necesidades. Abordamos cada proyecto como si fuera para nosotros mismos.
                    </Text>
                </View>

                <Text style={styles.sectionTitle}>5. Plazos de inicio y organización</Text>
                <Text style={styles.textBlock}>
                    Este sistema de trabajo nos permite no asumir más proyectos de los que podemos ejecutar correctamente, cumplir los plazos acordados y mantener un nivel de calidad constante.
                </Text>

                <Text style={styles.sectionTitle}>6. Preguntas frecuentes</Text>
                <View style={{ marginBottom: 10 }}>
                    <Text style={[styles.textBlock, styles.bold]}>¿Por qué el precio es más alto que otras ofertas?</Text>
                    <Text style={styles.textBlock}>Porque incluye organización integral, 25 años de experiencia y responsabilidad real. Un precio más bajo casi siempre implica concesiones en materiales, ejecución o control.</Text>
                </View>
                <View style={{ marginBottom: 10 }}>
                    <Text style={[styles.textBlock, styles.bold]}>¿Tendré que supervisar la obra constantemente?</Text>
                    <Text style={styles.textBlock}>No. Nuestro trabajo es que usted no tenga que involucrarse en cuestiones técnicas u operativas.</Text>
                </View>

                <View wrap={false} style={{ marginTop: 30, padding: 15, backgroundColor: '#E2E8F0', borderRadius: 4 }}>
                    <Text style={[styles.textBlock, styles.bold, { textAlign: 'center', marginBottom: 0 }]}>
                        No buscamos clientes que elijan únicamente por precio. Trabajamos con quienes valoran seguridad, calidad y profesionalidad.
                    </Text>
                </View>

                <Footer pageNumber={2} company={company} />
            </Page>

            {/* --- AI VISUAL PROPOSAL PAGES (antes / después) --- */}
            {renderPages.map((pageRenders, pageIdx) => (
                <Page key={`renders-${pageIdx}`} size="A4" style={styles.page}>
                    <Header budgetNumber={budgetNumber} date={date} logoUrl={logoUrl} company={company} totalAmount={costBreakdown.total} />

                    {pageIdx === 0 && (
                        <>
                            <Text style={[styles.sectionTitle, { fontSize: 16, borderBottomWidth: 2 }]}>Anexo: Propuesta Visual Conceptual</Text>
                            <Text style={styles.textBlock}>
                                Las siguientes infografías han sido generadas mediante inteligencia artificial paramétrica. Tienen carácter exclusivamente conceptual y orientativo para comprender el estilo, la distribución espacial y la paleta de colores propuestos. No poseen valor contractual sobre mobiliario o acabados finales.
                            </Text>
                        </>
                    )}

                    <View style={{ marginTop: pageIdx === 0 ? 20 : 0, flex: 1, flexDirection: 'column', gap: 20 }}>
                        {pageRenders.map((render: any, idx: number) => (
                            <View key={render.id || idx} style={{ flex: 1, backgroundColor: '#F8FAFC', padding: 8, borderRadius: 8, border: 1, borderColor: '#E2E8F0' }}>
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                                    <Text style={[styles.bold, { fontSize: 10 }]}>{render.roomType} · {render.style}</Text>
                                </View>
                                {render.originalUrl ? (
                                    <View style={{ flexDirection: 'row', gap: 8 }}>
                                        <View style={{ flex: 1 }}>
                                            <Text style={{ fontSize: 7, color: '#64748B', marginBottom: 3, textTransform: 'uppercase' }}>Antes</Text>
                                            <Image src={render.originalUrl} style={{ width: '100%', height: 200, objectFit: 'cover', borderRadius: 4 }} />
                                        </View>
                                        <View style={{ flex: 1 }}>
                                            <Text style={{ fontSize: 7, color: '#64748B', marginBottom: 3, textTransform: 'uppercase' }}>Después</Text>
                                            <Image src={render.url} style={{ width: '100%', height: 200, objectFit: 'cover', borderRadius: 4 }} />
                                        </View>
                                    </View>
                                ) : (
                                    <Image src={render.url} style={{ width: '100%', height: 220, objectFit: 'cover', borderRadius: 4 }} />
                                )}
                                {render.prompt && (
                                    <Text style={{ fontSize: 7, color: '#94A3B8', marginTop: 6, fontStyle: 'italic', textAlign: 'center' }}>
                                        {render.prompt}
                                    </Text>
                                )}
                            </View>
                        ))}
                    </View>

                    <Footer pageNumber={3 + pageIdx} company={company} />
                </Page>
            ))}
        </Document>
    );
};
