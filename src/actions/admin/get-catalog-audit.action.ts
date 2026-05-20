'use server';

/**
 * Sprint 3.B — catalog audit reader.
 *
 * Lee los CSVs generados por `services/ai-core/scripts/audit_catalog_data_quality.py`
 * (uno contra el JSON source-of-truth, otro contra Firestore production) y los
 * devuelve combinados + comparados para el panel admin.
 *
 * Si los CSVs no existen, devuelve resultado vacío con `hasReport: false` para
 * que la UI muestre instrucciones de cómo generarlos.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { verifyAuth } from '@/backend/auth/auth.middleware';

export type AuditSeverity = 'error' | 'warning' | 'info';

export interface AuditIssue {
    issue_type: string;
    code: string;
    description: string;
    current_value: string;
    suggested_fix: string;
    severity: AuditSeverity;
    sources: ('json' | 'firestore')[];
}

export interface AuditSummary {
    totalIssues: number;
    bySeverity: Record<AuditSeverity, number>;
    byIssueType: Record<string, number>;
    bySource: { json: number; firestore: number; both: number };
}

export interface CatalogAuditResult {
    hasReport: boolean;
    generatedAt?: string;
    summary: AuditSummary;
    issues: AuditIssue[];
    deltas: {
        onlyInJson: number;     // issues que aparecen solo en el JSON source
        onlyInFirestore: number; // issues que aparecen solo en Firestore
        inBoth: number;
    };
    rawCounts: {
        json: number;
        firestore: number;
    };
}

const AUDIT_DIR = path.join(process.cwd(), 'data', 'audit');
const FIRESTORE_CSV = 'audit_catalog_firestore.csv';
const JSON_CSV = 'audit_catalog_json_source.csv';

/**
 * Parse mínimo de CSV. No usa una librería para evitar dependencias; los CSVs
 * que produce el script Python no tienen comas dentro de los campos (el
 * `current_value` puede contener `unit_normalized=...` con comas, así que sí
 * respetamos las comillas dobles).
 */
function parseCsv(text: string): Record<string, string>[] {
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length === 0) return [];

    const header = parseCsvLine(lines[0]);
    const rows: Record<string, string>[] = [];
    for (let i = 1; i < lines.length; i++) {
        const cells = parseCsvLine(lines[i]);
        const row: Record<string, string> = {};
        header.forEach((h, idx) => {
            row[h] = cells[idx] ?? '';
        });
        rows.push(row);
    }
    return rows;
}

function parseCsvLine(line: string): string[] {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"' && line[i + 1] === '"') {
                cur += '"';
                i++;
            } else if (ch === '"') {
                inQuotes = false;
            } else {
                cur += ch;
            }
        } else {
            if (ch === '"') {
                inQuotes = true;
            } else if (ch === ',') {
                out.push(cur);
                cur = '';
            } else {
                cur += ch;
            }
        }
    }
    out.push(cur);
    return out;
}

function normSeverity(s: string): AuditSeverity {
    const v = (s || '').toLowerCase().trim();
    if (v === 'error' || v === 'warning' || v === 'info') return v;
    return 'info';
}

function issueKey(r: Record<string, string>): string {
    return `${r.issue_type}|${r.code}|${r.current_value}`;
}

export async function getCatalogAuditAction(): Promise<CatalogAuditResult> {
    const auth = await verifyAuth(true);
    if (!auth) throw new Error('unauthorized');

    const emptyResult: CatalogAuditResult = {
        hasReport: false,
        summary: {
            totalIssues: 0,
            bySeverity: { error: 0, warning: 0, info: 0 },
            byIssueType: {},
            bySource: { json: 0, firestore: 0, both: 0 },
        },
        issues: [],
        deltas: { onlyInJson: 0, onlyInFirestore: 0, inBoth: 0 },
        rawCounts: { json: 0, firestore: 0 },
    };

    let firestoreCsv = '';
    let jsonCsv = '';
    let generatedAt: string | undefined;

    try {
        const fsPath = path.join(AUDIT_DIR, FIRESTORE_CSV);
        const stat = await fs.stat(fsPath);
        generatedAt = stat.mtime.toISOString();
        firestoreCsv = await fs.readFile(fsPath, 'utf-8');
    } catch {
        // Firestore CSV no existe — devolveremos vacío.
    }
    try {
        jsonCsv = await fs.readFile(path.join(AUDIT_DIR, JSON_CSV), 'utf-8');
    } catch {
        // JSON CSV opcional — la UI sigue funcionando con solo Firestore.
    }

    if (!firestoreCsv && !jsonCsv) {
        return emptyResult;
    }

    const firestoreRows = parseCsv(firestoreCsv);
    const jsonRows = parseCsv(jsonCsv);

    // Deduplicar por issueKey y trackear sources.
    const map = new Map<string, AuditIssue>();
    for (const r of firestoreRows) {
        const key = issueKey(r);
        const existing = map.get(key);
        if (existing) {
            if (!existing.sources.includes('firestore')) existing.sources.push('firestore');
        } else {
            map.set(key, {
                issue_type: r.issue_type || 'unknown',
                code: r.code || '',
                description: r.description || '',
                current_value: r.current_value || '',
                suggested_fix: r.suggested_fix || '',
                severity: normSeverity(r.severity),
                sources: ['firestore'],
            });
        }
    }
    for (const r of jsonRows) {
        const key = issueKey(r);
        const existing = map.get(key);
        if (existing) {
            if (!existing.sources.includes('json')) existing.sources.push('json');
        } else {
            map.set(key, {
                issue_type: r.issue_type || 'unknown',
                code: r.code || '',
                description: r.description || '',
                current_value: r.current_value || '',
                suggested_fix: r.suggested_fix || '',
                severity: normSeverity(r.severity),
                sources: ['json'],
            });
        }
    }

    const issues = Array.from(map.values()).sort((a, b) => {
        const sevOrder = { error: 0, warning: 1, info: 2 };
        const ds = sevOrder[a.severity] - sevOrder[b.severity];
        if (ds !== 0) return ds;
        const dt = a.issue_type.localeCompare(b.issue_type);
        if (dt !== 0) return dt;
        return a.code.localeCompare(b.code);
    });

    // Summary
    const bySeverity: Record<AuditSeverity, number> = { error: 0, warning: 0, info: 0 };
    const byIssueType: Record<string, number> = {};
    let onlyInJson = 0;
    let onlyInFirestore = 0;
    let inBoth = 0;
    for (const it of issues) {
        bySeverity[it.severity]++;
        byIssueType[it.issue_type] = (byIssueType[it.issue_type] || 0) + 1;
        const hasJson = it.sources.includes('json');
        const hasFs = it.sources.includes('firestore');
        if (hasJson && hasFs) inBoth++;
        else if (hasJson) onlyInJson++;
        else if (hasFs) onlyInFirestore++;
    }

    return {
        hasReport: true,
        generatedAt,
        summary: {
            totalIssues: issues.length,
            bySeverity,
            byIssueType,
            bySource: {
                json: jsonRows.length,
                firestore: firestoreRows.length,
                both: inBoth,
            },
        },
        issues,
        deltas: { onlyInJson, onlyInFirestore, inBoth },
        rawCounts: { json: jsonRows.length, firestore: firestoreRows.length },
    };
}
