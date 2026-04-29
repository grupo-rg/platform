/**
 * Diagnóstico de adjuntos de un lead.
 *
 * Uso:
 *   npx tsx src/scripts/diagnose-lead-attachments.ts <leadId|email>
 *
 * Imprime:
 *   - lead.intake.imageUrls (URLs almacenadas)
 *   - Todos los deals con sus snapshots y URLs
 *   - HTTP HEAD a cada URL (status + content-type) para detectar archivos rotos
 *   - Hash de URL para ver si se duplican entre deals
 */

import { initFirebaseAdminApp } from '../backend/shared/infrastructure/firebase/admin-app';
import { FirestoreLeadRepository } from '../backend/lead/infrastructure/firestore-lead-repository';
import { FirebaseDealRepository } from '../backend/crm/infrastructure/persistence/firebase.deal.repository';

initFirebaseAdminApp();

async function head(url: string): Promise<{ status: number; contentType: string | null; size: string | null }> {
    try {
        const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
        return {
            status: res.status,
            contentType: res.headers.get('content-type'),
            size: res.headers.get('content-length'),
        };
    } catch (err: any) {
        return { status: -1, contentType: `ERROR ${err?.message || err}`, size: null };
    }
}

function shortenUrl(url: string): string {
    if (url.length <= 80) return url;
    return url.slice(0, 50) + '…' + url.slice(-25);
}

async function main() {
    const arg = process.argv[2];
    if (!arg) {
        console.error('Uso: npx tsx src/scripts/diagnose-lead-attachments.ts <leadId|email>');
        process.exit(1);
    }

    const leadRepo = new FirestoreLeadRepository();
    const dealRepo = new FirebaseDealRepository();

    let lead = await leadRepo.findById(arg);
    if (!lead && arg.includes('@')) {
        lead = await leadRepo.findByEmail(arg);
    }
    if (!lead) {
        console.error(`Lead no encontrado: ${arg}`);
        process.exit(1);
    }

    console.log('═'.repeat(80));
    console.log(`LEAD: ${lead.id}  ·  ${lead.personalInfo.name} <${lead.personalInfo.email}>`);
    console.log('═'.repeat(80));

    console.log('\n📦 lead.intake.imageUrls (último intake del lead):');
    if (!lead.intake) {
        console.log('   (sin intake)');
    } else {
        const urls = lead.intake.imageUrls || [];
        console.log(`   Total: ${urls.length}`);
        for (let i = 0; i < urls.length; i++) {
            const url = urls[i];
            const head_ = await head(url);
            console.log(
                `   [${i}] ${head_.status} · ${head_.contentType || '?'} · ${head_.size || '?'}b\n        ${shortenUrl(url)}`
            );
        }
    }

    console.log('\n💼 Deals del lead (con su intakeSnapshot):');
    const deals = await dealRepo.findAllByLeadId(lead.id);
    console.log(`   Total deals: ${deals.length}\n`);

    for (const d of deals) {
        console.log(`─── Deal ${d.id.substring(0, 8)} · stage=${d.stage} · created=${d.createdAt.toISOString()}`);
        const snap = d.metadata?.intakeSnapshot;
        if (!snap) {
            console.log('    (sin intakeSnapshot en metadata)');
            continue;
        }
        console.log(`    projectType=${snap.projectType}  approxSqm=${snap.approxSquareMeters}  desc="${(snap.description || '').slice(0, 50)}…"`);
        const urls: string[] = Array.isArray(snap.imageUrls) ? snap.imageUrls : [];
        console.log(`    intakeSnapshot.imageUrls (${urls.length}):`);
        for (let i = 0; i < urls.length; i++) {
            const url = urls[i];
            const head_ = await head(url);
            console.log(
                `      [${i}] ${head_.status} · ${head_.contentType || '?'} · ${head_.size || '?'}b\n          ${shortenUrl(url)}`
            );
        }
        console.log('');
    }

    // Detección de duplicados entre deals
    console.log('🔍 Análisis de duplicados:');
    const allUrls = new Map<string, string[]>(); // url → dealIds
    for (const d of deals) {
        const urls: string[] = d.metadata?.intakeSnapshot?.imageUrls || [];
        for (const u of urls) {
            if (!allUrls.has(u)) allUrls.set(u, []);
            allUrls.get(u)!.push(d.id.substring(0, 8));
        }
    }
    const duplicates = [...allUrls.entries()].filter(([_, dealIds]) => dealIds.length > 1);
    if (duplicates.length === 0) {
        console.log('   Cada URL aparece en un único deal. ✅');
    } else {
        console.log(`   ⚠️  ${duplicates.length} URL(s) compartidas entre múltiples deals:`);
        for (const [url, dealIds] of duplicates) {
            console.log(`      [${dealIds.join(', ')}] ${shortenUrl(url)}`);
        }
    }

    console.log('\n✅ Diagnóstico completado.');
    process.exit(0);
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
