import React from 'react';
import { Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import { formatCurrency } from '@/lib/utils';
import type { CompanyConfig } from '@/backend/platform/domain/company-config';
import {
    applyTemplatePlaceholders,
    type TemplateBlock,
    type TemplatePlaceholderValues,
} from '@/backend/document-template/domain/document-template';
import { parseBlockBody, parseInlineBold, type BodyLeaf, type BodyNode, type InlineSpan } from '@/backend/document-template/domain/template-body';

/**
 * Piezas comunes de los PDFs de la empresa (presupuesto y lista de precios):
 * cabecera con logo + datos fiscales, pie con numeración y bloques de
 * condiciones de plantilla. Los valores de estilo son EXACTAMENTE los que tenía
 * `BudgetDocument.tsx` para no alterar su salida.
 */
export const pdfBaseStyles = StyleSheet.create({
    header: {
        marginBottom: 20,
        paddingBottom: 20,
        borderBottom: 1,
        borderColor: '#E2E8F0',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
    },
    logoSection: { width: '50%' },
    companyLogo: { width: 210, height: 90, marginBottom: 8, objectFit: 'contain' },
    issuerBlock: { marginTop: 6 },
    issuerName: { fontSize: 9, fontWeight: 'bold', color: '#0F172A', marginBottom: 1 },
    issuerLine: { fontSize: 7.5, color: '#64748B', lineHeight: 1.45 },
    metaSection: { textAlign: 'right', fontSize: 8, color: '#64748B', lineHeight: 1.4 },
    sectionTitle: {
        fontSize: 13,
        fontWeight: 'bold',
        marginBottom: 10,
        marginTop: 20,
        color: '#0F172A',
        borderBottom: 1,
        borderBottomColor: '#E2E8F0',
        paddingBottom: 4,
        textTransform: 'uppercase',
    },
    textBlock: { marginBottom: 8, lineHeight: 1.6, fontSize: 9, textAlign: 'justify' },
    bold: { fontWeight: 'bold', color: '#0F172A' },
    footerContainer: { position: 'absolute', bottom: 30, left: 40, right: 40 },
    footerLine: { borderTop: 1, borderColor: '#E2E8F0', marginBottom: 5 },
    footerText: { textAlign: 'center', color: '#94A3B8', fontSize: 7 },
});

const s = pdfBaseStyles;

export const DocumentFooter = ({ company }: { company: CompanyConfig }) => {
    // Línea fiscal mínima (los datos completos del emisor van en la cabecera).
    const line = [company.legalName || company.name, company.cif && `CIF: ${company.cif}`, company.address]
        .filter(Boolean)
        .join(' · ');
    return (
        <View style={s.footerContainer} fixed>
            <View style={s.footerLine} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={s.footerText}>{line}</Text>
                {/* `render` se evalúa por página física: numeración correcta aunque
                    una <Page> desborde en varias páginas. */}
                <Text
                    style={s.footerText}
                    render={({ pageNumber, totalPages }) => `Página ${pageNumber} / ${totalPages}`}
                    fixed
                />
            </View>
            {company.footerText && (
                <Text style={{ fontSize: 6, color: '#94A3B8', marginTop: 2 }}>{company.footerText}</Text>
            )}
        </View>
    );
};

export interface DocumentHeaderProps {
    /** Rótulo del documento, p.ej. "PRESUPUESTO Nº" o "LISTA DE PRECIOS Nº". */
    docLabel: string;
    docNumber: string;
    date: string;
    logoUrl?: string;
    company: CompanyConfig;
    totalAmount?: number;
    /** Líneas extra bajo la fecha (p.ej. "Válida hasta: …"). */
    extraLines?: string[];
}

export const DocumentHeader = ({ docLabel, docNumber, date, logoUrl, company, totalAmount, extraLines }: DocumentHeaderProps) => {
    const resolvedLogo = logoUrl || company.logoUrl;
    return (
        <View style={s.header}>
            <View style={s.logoSection}>
                {resolvedLogo ? (
                    <Image src={resolvedLogo} style={s.companyLogo} />
                ) : (
                    <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#0F172A' }}>{company.name}</Text>
                )}
                {company.tagline && (
                    <Text style={{ fontSize: 8, color: '#64748B', marginTop: 2 }}>{company.tagline}</Text>
                )}
                {/* Datos de la empresa emisora bajo el logo. */}
                <View style={s.issuerBlock}>
                    {(company.legalName || company.name) && (
                        <Text style={s.issuerName}>{company.legalName || company.name}</Text>
                    )}
                    {company.cif && <Text style={s.issuerLine}>CIF: {company.cif}</Text>}
                    {company.address && <Text style={s.issuerLine}>{company.address}</Text>}
                    {(company.phone || company.email) && (
                        <Text style={s.issuerLine}>
                            {[company.phone, company.email].filter(Boolean).join('  ·  ')}
                        </Text>
                    )}
                    {company.web && <Text style={s.issuerLine}>{company.web}</Text>}
                </View>
            </View>
            <View style={s.metaSection}>
                <Text style={s.bold}>{docLabel} {docNumber}</Text>
                <Text>Fecha: {date}</Text>
                {extraLines?.map((l, i) => <Text key={i}>{l}</Text>)}
                {totalAmount !== undefined && totalAmount > 0 && (
                    <Text style={{ fontSize: 11, fontWeight: 'bold', color: '#0F172A', marginTop: 4 }}>
                        Total: {formatCurrency(totalAmount)}
                    </Text>
                )}
            </View>
        </View>
    );
};

// ─── Bloques de plantilla ──────────────────────────────────────────────────

const Spans = ({ spans }: { spans: InlineSpan[] }) => (
    <>
        {spans.map((sp, i) =>
            sp.bold ? <Text key={i} style={s.bold}>{sp.text}</Text> : <React.Fragment key={i}>{sp.text}</React.Fragment>,
        )}
    </>
);

/** Spans de varias líneas separados por salto de línea. */
const Lines = ({ lines }: { lines: InlineSpan[][] }) => (
    <>
        {lines.map((spans, i) => (
            <React.Fragment key={i}>
                {i > 0 ? '\n' : null}
                <Spans spans={spans} />
            </React.Fragment>
        ))}
    </>
);

const Leaf = ({ node, highlight }: { node: BodyLeaf; highlight?: boolean }) => {
    if (node.kind === 'bullet') {
        return (
            <View style={{ flexDirection: 'row', marginBottom: 3, paddingLeft: 4 }}>
                <Text style={{ width: 10, fontSize: 9, lineHeight: 1.6 }}>•</Text>
                <Text style={[s.textBlock, { flex: 1, marginBottom: 0 }]}>
                    <Spans spans={node.spans} />
                </Text>
            </View>
        );
    }
    const style = highlight
        ? [s.textBlock, s.bold, { textAlign: 'center' as const, marginBottom: 0 }]
        : s.textBlock;
    return (
        <Text style={style}>
            <Lines lines={node.lines} />
        </Text>
    );
};

const Node = ({ node, highlight }: { node: BodyNode; highlight?: boolean }) => {
    if ('children' in node) {
        return (
            <View style={{ marginBottom: node.kind === 'check' ? 15 : 10 }}>
                <Text style={[s.textBlock, s.bold]}>
                    <Spans spans={node.title} />
                </Text>
                {node.children.map((c, i) => <Leaf key={i} node={c} />)}
            </View>
        );
    }
    return <Leaf node={node} highlight={highlight} />;
};

/**
 * Pinta los bloques (título + cuerpo) de una plantilla con los marcadores ya
 * sustituidos. Bloque `highlight` = recuadro gris centrado (frase de cierre).
 */
export const TemplateBlocksView = ({ blocks, values }: { blocks: TemplateBlock[]; values: TemplatePlaceholderValues }) => (
    <>
        {blocks.map((block) => {
            const title = applyTemplatePlaceholders(block.title || '', values).trim();
            const nodes = parseBlockBody(applyTemplatePlaceholders(block.body || '', values), block.format);
            if (block.variant === 'highlight') {
                return (
                    <View key={block.id} wrap={false} style={{ marginTop: 30, padding: 15, backgroundColor: '#E2E8F0', borderRadius: 4 }}>
                        {title ? <Text style={[s.textBlock, s.bold, { textAlign: 'center', marginBottom: 6 }]}>{title}</Text> : null}
                        {nodes.map((n, i) => <Node key={i} node={n} highlight />)}
                    </View>
                );
            }
            return (
                <React.Fragment key={block.id}>
                    {title ? <Text style={s.sectionTitle}>{title}</Text> : null}
                    {nodes.map((n, i) => <Node key={i} node={n} />)}
                </React.Fragment>
            );
        })}
    </>
);

/** Aviso en cursiva con separador superior (marcadores + `**negrita**`). */
export const DisclaimerView = ({ text, values }: { text?: string; values: TemplatePlaceholderValues }) => {
    const value = applyTemplatePlaceholders(text || '', values).trim();
    if (!value) return null;
    return (
        <View style={{ marginTop: 20, borderTop: 1, borderColor: '#E2E8F0', paddingTop: 15 }} wrap={false}>
            <Text style={[s.textBlock, { fontStyle: 'italic', color: '#64748B' }]}>
                <Spans spans={parseInlineBold(value)} />
            </Text>
        </View>
    );
};
