'use client';

import React from 'react';
import { Page, Text, View, Document, StyleSheet, Image, Font } from '@react-pdf/renderer';
import { formatCurrency } from '@/lib/utils';

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
    logoUrl?: string;
    notes?: string;
    budgetConfig?: { tax: number; marginGG: number; marginBI: number };
    executionMode?: 'complete' | 'execution' | 'labor';
    renders?: any[];
}

const Footer = ({ pageNumber, companyName, cif, address }: { pageNumber: number, companyName?: string, cif?: string, address?: string }) => {
    const defaultCompany = 'Basis';
    return (
        <View style={styles.footerContainer} fixed>
            <View style={styles.footerLine} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={styles.footerText}>
                    {companyName || defaultCompany} {cif ? `- CIF: ${cif}` : ''} {address ? `- ${address}` : ''}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Text style={{ fontSize: 6, color: '#CBD5E1', fontStyle: 'italic' }}>Generado con Basis</Text>
                    <Text style={[styles.footerText, { marginLeft: 10 }]}>Página {pageNumber}</Text>
                </View>
            </View>
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
    renders = []
}: BudgetDocumentProps) => {

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
                <Header budgetNumber={budgetNumber} date={date} logoUrl={logoUrl} companyName={clientEmail} />

                <View style={{ marginTop: 20, marginBottom: 30 }}>
                    <Text style={styles.title}>Propuesta Técnica y Económica</Text>
                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 5 }}>
                        <Text style={styles.badge}>Reforma Personalizada</Text>
                        <Text style={styles.badge}>Basis Estándar de Calidad</Text>
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

                            // Prevent duplicating title into description if they are implicitly the same 
                            const showDescription = item.item?.description && item.item.description.trim() !== "" && item.item.description.trim() !== item.originalTask.trim();

                            return (
                                <View key={item.id || index} style={styles.itemContainer} wrap={false}>
                                    {/* Main Row: Code | Unit | Titles Column | Total */}
                                    <View style={styles.itemMainRow}>
                                        <Text style={styles.itemCode}>{item.item?.code || '-'}</Text>
                                        <Text style={styles.itemUnit}>{item.item?.unit || 'ud'}</Text>
                                        <View style={styles.itemTitleColumn}>
                                            <Text style={styles.itemTitle}>{item.originalTask}</Text>
                                            {showDescription && (
                                                <Text style={styles.itemDescription}>{item.item.description}</Text>
                                            )}
                                        </View>
                                        <Text style={styles.itemTotal}>{bTotal.toLocaleString('es-ES', { minimumFractionDigits: 2 })}</Text>
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
                                                        <Text style={styles.bdQty}>{parseFloat(qty.toString()).toLocaleString('es-ES', { minimumFractionDigits: 3 })}</Text>
                                                        <Text style={styles.bdUnit}>{b.unit?.toLowerCase() === '%' ? 'h' : (b.unit || 'u')}</Text>
                                                        <Text style={styles.bdDesc}>{b.description || b.concept}</Text>
                                                        <Text style={styles.bdPrice}>{unitPrice.toLocaleString('es-ES', { minimumFractionDigits: 2 })}</Text>
                                                        <Text style={styles.bdTotal}>{lineTotal.toLocaleString('es-ES', { minimumFractionDigits: 2 })}</Text>
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

                <View style={[styles.totalSection, { marginTop: 20 }]} wrap={false}>
                    <View style={styles.totalRow}>
                        <Text style={styles.totalLabel}>Base Imponible (P.E.M.):</Text>
                        <Text style={styles.totalValue}>{formatCurrency(costBreakdown.materialExecutionPrice)}</Text>
                    </View>
                    <View style={styles.totalRow}>
                        <Text style={styles.totalLabel}>Gastos Generales / Org.:</Text>
                        <Text style={styles.totalValue}>{formatCurrency(costBreakdown.overheadExpenses)}</Text>
                    </View>
                    <View style={styles.totalRow}>
                        <Text style={styles.totalLabel}>IVA ({budgetConfig?.tax || 21}%):</Text>
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
                <Footer pageNumber={1} companyName={clientEmail} cif={clientEmail ? "Generado desde Basis" : undefined} address={clientEmail ? "Presupuesto" : undefined} />
            </Page>

            {/* --- PAGE: METHODOLOGY & INFO (MOVED TO THE END) --- */}
            <Page size="A4" style={styles.page}>
                <Header budgetNumber={budgetNumber} date={date} logoUrl={logoUrl} companyName={clientEmail} />

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
                    El precio total estimado para este proyecto es de <Text style={styles.bold}>{costBreakdown.total.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}</Text>.
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

                <Footer pageNumber={2} companyName={clientEmail} cif={clientEmail ? "Generado desde Basis" : undefined} address={clientEmail ? "Presupuesto" : undefined} />
            </Page>

            {/* --- AI VISUAL PROPOSAL PAGE --- */}
            {renders && renders.filter(r => r.includeInPdf).length > 0 && (
                <Page size="A4" style={styles.page}>
                    <Header budgetNumber={budgetNumber} date={date} logoUrl={logoUrl} companyName={clientEmail} />
                    
                    <Text style={[styles.sectionTitle, { fontSize: 16, borderBottomWidth: 2 }]}>Anexo: Propuesta Visual Conceptual</Text>
                    <Text style={styles.textBlock}>
                        Las presentes infografías han sido generadas mediante inteligencia artificial paramétrica. Tienen carácter exclusivamente conceptual y orientativo para comprender el estilo, la distribución espacial y la paleta de colores propuesta en este presupuesto. No poseen valor contractual exacto sobre elementos mobiliarios o acabados finales menores.
                    </Text>

                    <View style={{ marginTop: 20, flex: 1, flexDirection: 'column', gap: 20 }}>
                        {renders.filter(r => r.includeInPdf).slice(0, 2).map((render, idx) => (
                            <View key={idx} style={{ flex: 1, backgroundColor: '#F8FAFC', padding: 8, borderRadius: 8, border: 1, borderColor: '#E2E8F0' }}>
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                                    <Text style={[styles.bold, { fontSize: 10 }]}>{render.roomType} - Estilo {render.style}</Text>
                                    <Text style={{ fontSize: 8, color: '#64748B' }}>Dochevi AI Render Engine</Text>
                                </View>
                                {/* Limit height to fit 2 images perfectly per page */}
                                <Image src={render.url} style={{ width: '100%', height: 260, objectFit: 'cover', borderRadius: 4 }} />
                                {render.prompt && (
                                    <Text style={{ fontSize: 7, color: '#94A3B8', marginTop: 6, fontStyle: 'italic', textAlign: 'center' }}>
                                        {render.prompt}
                                    </Text>
                                )}
                            </View>
                        ))}
                    </View>

                    {renders.filter(r => r.includeInPdf).length > 2 && (
                         <View style={{ marginTop: 10 }}>
                             <Text style={{ fontSize: 8, color: '#64748B', textAlign: 'center' }}>
                                 * Se han omitido imágenes adicionales. Solicite el Anexo Visual Completo si desea mayor detalle.
                             </Text>
                         </View>
                    )}

                    <Footer pageNumber={3} companyName={clientEmail} cif={clientEmail ? "Generado desde Basis" : undefined} address={clientEmail ? "Presupuesto" : undefined} />
                </Page>
            )}
        </Document>
    );
};
