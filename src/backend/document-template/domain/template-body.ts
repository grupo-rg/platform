/**
 * Parser PURO del cuerpo de un bloque de plantilla → árbol que el PDF
 * (react-pdf) sabe pintar. Sin dependencias de React para poder testearlo.
 *
 * Reglas (por líneas):
 *   - Línea en blanco               → cierra el párrafo en curso.
 *   - "✔ texto"                     → abre un grupo `check` (título en negrita,
 *                                     incluye el "✔"). El texto que sigue va dentro
 *                                     del grupo hasta el siguiente grupo.
 *   - "**texto**" (línea completa)  → abre un grupo `heading` (p.ej. pregunta FAQ).
 *   - "- texto"                     → viñeta (•).
 *   - Resto                         → párrafo; líneas consecutivas = salto de línea
 *                                     dentro del mismo párrafo.
 * En cualquier texto, `**x**` es negrita en línea.
 */

export interface InlineSpan {
    text: string;
    bold: boolean;
}

export type BodyLeaf =
    | { kind: 'paragraph'; lines: InlineSpan[][] }
    | { kind: 'bullet'; spans: InlineSpan[] };

export type BodyNode =
    | BodyLeaf
    | { kind: 'check' | 'heading'; title: InlineSpan[]; children: BodyLeaf[] };

/** `**negrita**` en línea → spans. Un `**` sin cerrar se deja literal. */
export function parseInlineBold(text: string): InlineSpan[] {
    const spans: InlineSpan[] = [];
    const re = /\*\*(.+?)\*\*/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        if (m.index > last) spans.push({ text: text.slice(last, m.index), bold: false });
        spans.push({ text: m[1], bold: true });
        last = m.index + m[0].length;
    }
    if (last < text.length) spans.push({ text: text.slice(last), bold: false });
    return spans.length > 0 ? spans : [{ text: '', bold: false }];
}

const CHECK_RE = /^✔\s+/;
const BULLET_RE = /^-\s+/;
/** Línea entera en negrita, sin otro `**` dentro. */
function matchHeading(line: string): string | null {
    const m = /^\*\*(.+)\*\*$/.exec(line);
    if (!m || m[1].includes('**')) return null;
    return m[1];
}

/**
 * Cuerpo en formato `list`: cada línea no vacía es una viñeta (se tolera que el
 * usuario escriba "- " o "✔ " o "• " delante; se quita).
 */
export function parseListBody(body: string): BodyNode[] {
    return (body || '')
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((l) => l.trim().replace(/^(?:[-•✔]\s*)/, ''))
        .filter((l) => l !== '')
        .map((l) => ({ kind: 'bullet' as const, spans: parseInlineBold(l) }));
}

/** Atajo: elige el parser según el formato del bloque. */
export function parseBlockBody(body: string, format?: 'text' | 'list'): BodyNode[] {
    return format === 'list' ? parseListBody(body) : parseTemplateBody(body);
}

export function parseTemplateBody(body: string): BodyNode[] {
    const out: BodyNode[] = [];
    // Contenedor donde caen párrafos/viñetas: raíz o el grupo abierto.
    let container: BodyLeaf[] | null = null;
    let paragraph: InlineSpan[][] | null = null;

    const push = (leaf: BodyLeaf) => {
        if (container) container.push(leaf);
        else out.push(leaf);
    };
    const flush = () => {
        if (paragraph && paragraph.length > 0) push({ kind: 'paragraph', lines: paragraph });
        paragraph = null;
    };

    const lines = (body || '').replace(/\r\n?/g, '\n').split('\n');
    for (const raw of lines) {
        const line = raw.trim();
        if (line === '') {
            flush();
            continue;
        }
        if (CHECK_RE.test(line)) {
            flush();
            const group = { kind: 'check' as const, title: parseInlineBold(line), children: [] as BodyLeaf[] };
            out.push(group);
            container = group.children;
            continue;
        }
        const heading = matchHeading(line);
        if (heading !== null) {
            flush();
            const group = { kind: 'heading' as const, title: [{ text: heading, bold: true }], children: [] as BodyLeaf[] };
            out.push(group);
            container = group.children;
            continue;
        }
        if (BULLET_RE.test(line)) {
            flush();
            push({ kind: 'bullet', spans: parseInlineBold(line.replace(BULLET_RE, '')) });
            continue;
        }
        if (!paragraph) paragraph = [];
        paragraph.push(parseInlineBold(line));
    }
    flush();
    return out;
}
