/**
 * PDF Structure Analysis Script
 * 
 * Purpose: Analyze pages from DIFFERENT sections of the price book to:
 * 1. Understand variations in code formats across chapters
 * 2. Identify consistent visual patterns (column structure, indentation)
 * 3. Generate a robust extraction prompt that works universally
 * 
 * Usage: npx tsx src/backend/scripts/analyze-pdf-structure.ts
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import * as path from 'path';
import * as fs from 'fs/promises';
import { z } from 'zod';
import { ai } from '@/backend/ai/shared/config/genkit.config';
import { PDFDocument } from 'pdf-lib';

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
    pdfPath: path.resolve(process.cwd(), 'public/documents/Libro Precios 46_COAATMCA.pdf'),
    // Sample pages from DIFFERENT sections of the book
    // Based on typical price book structure:
    // - Early pages: Ensayos, Demoliciones
    // - Middle pages: Cimentaciones, Estructuras, Forjados
    // - Late pages: Instalaciones, Acabados
    samplePages: [15, 55, 100, 150, 200], // Diversas secciones
    outputDir: path.resolve(process.cwd(), 'logs'),
};

// ============================================
// ANALYSIS SCHEMA - Focus on STRUCTURE, not content
// ============================================
const StructureAnalysisSchema = z.object({
    pageNumber: z.number(),
    chapterTitle: z.string().optional().describe("Chapter title if visible on page"),
    sectionTitle: z.string().optional().describe("Section title if visible"),

    // Structure Analysis
    codeFormats: z.array(z.object({
        example: z.string().describe("Example code found (e.g., 'XSL010m', 'EFP010e')"),
        pattern: z.string().describe("Describe the pattern (e.g., '3 letters + 3 digits + letter')"),
        isMainItem: z.boolean().describe("Is this a main item code (true) or breakdown resource (false)?")
    })).describe("Different code formats found on this page"),

    columnStructure: z.string().describe("Describe the column layout (e.g., 'Code | Unit | Description | Unit Price | Total Price')"),

    mainItemCount: z.number().describe("Number of MAIN items (partidas principales) on this page"),
    breakdownIndicators: z.array(z.string()).describe("How are breakdown items visually different? (e.g., 'indented', 'lowercase codes', 'no price in rightmost column')"),

    priceColumnPosition: z.string().describe("Where is the total price located? (e.g., 'rightmost column', 'far right after description')"),

    // Sample extraction to validate understanding
    sampleItems: z.array(z.object({
        code: z.string(),
        description: z.string().max(100),
        unit: z.string(),
        priceTotal: z.number(),
        hasBreakdown: z.boolean()
    })).max(3).describe("Extract UP TO 3 sample main items from this page to validate understanding")
});

// ============================================
// ANALYSIS FUNCTION
// ============================================
async function analyzePage(base64Pdf: string, pageNumber: number): Promise<z.infer<typeof StructureAnalysisSchema> | null> {
    const promptText = `
    You are an expert at analyzing construction price book documents.
    
    TASK: Analyze the STRUCTURE of this page, not just the content.
    
    Focus on understanding:
    1. What CODE FORMATS are used? (e.g., XSL010m, EFP010e, mt49sla280)
       - Which are MAIN item codes vs BREAKDOWN/resource codes?
    2. What is the COLUMN STRUCTURE? (Code, Unit, Description, Prices)
    3. How are BREAKDOWN items visually different from main items?
       - Indentation? Lowercase codes? Different columns?
    4. Where are PRICES located?
    
    COUNT the number of MAIN ITEMS (partidas principales) on this page.
    A main item has:
    - A unique code on the left
    - A total price on the right
    - Possibly breakdown items below it
    
    Extract UP TO 3 sample main items to verify your understanding.
    `;

    const dataUri = `data:application/pdf;base64,${base64Pdf}`;

    try {
        const result = await ai.generate({
            model: 'googleai/gemini-2.5-flash',
            prompt: [
                { text: promptText },
                { media: { url: dataUri, contentType: 'application/pdf' } }
            ],
            output: { schema: StructureAnalysisSchema },
        });

        if (result.output) {
            return { ...result.output, pageNumber };
        }
        return null;
    } catch (error: any) {
        console.error(`Error analyzing page ${pageNumber}:`, error.message);
        return null;
    }
}

// ============================================
// MAIN SCRIPT
// ============================================
async function main() {
    console.log("╔══════════════════════════════════════════════════════════════╗");
    console.log("║  PDF STRUCTURE ANALYSIS                                      ║");
    console.log("║  Analyzing sample pages from different sections              ║");
    console.log("╚══════════════════════════════════════════════════════════════╝");
    console.log();

    // 1. Load PDF
    console.log("[1/3] Loading PDF...");
    const pdfBuffer = await fs.readFile(CONFIG.pdfPath);
    const srcDoc = await PDFDocument.load(pdfBuffer);
    const totalPages = srcDoc.getPageCount();
    console.log(`     Total pages: ${totalPages}`);
    console.log(`     Sample pages: ${CONFIG.samplePages.join(', ')}`);
    console.log();

    // 2. Analyze sample pages
    console.log("[2/3] Analyzing structure of sample pages...");
    console.log("─".repeat(60));

    const analyses: (z.infer<typeof StructureAnalysisSchema> | null)[] = [];

    for (const pageNum of CONFIG.samplePages) {
        if (pageNum > totalPages) {
            console.log(`  Page ${pageNum}: SKIPPED (beyond total pages)`);
            continue;
        }

        process.stdout.write(`  Page ${pageNum}: `);

        // Extract single page
        const doc = await PDFDocument.create();
        const [copiedPage] = await doc.copyPages(srcDoc, [pageNum - 1]); // 0-indexed
        doc.addPage(copiedPage);
        const pageBytes = await doc.save();
        const base64Pdf = Buffer.from(pageBytes).toString('base64');

        const analysis = await analyzePage(base64Pdf, pageNum);
        analyses.push(analysis);

        if (analysis) {
            console.log(`✓ Found ${analysis.mainItemCount} main items, ${analysis.codeFormats.length} code formats`);
        } else {
            console.log(`✗ Analysis failed`);
        }
    }

    console.log("─".repeat(60));
    console.log();

    // 3. Generate Report
    console.log("[3/3] Generating structure report...");

    const validAnalyses = analyses.filter(a => a !== null) as z.infer<typeof StructureAnalysisSchema>[];

    // Aggregate findings
    const allCodeFormats = new Map<string, { example: string; pattern: string; isMainItem: boolean; count: number }>();
    const allBreakdownIndicators = new Set<string>();
    let totalMainItems = 0;

    for (const analysis of validAnalyses) {
        totalMainItems += analysis.mainItemCount;

        for (const format of analysis.codeFormats) {
            const key = format.pattern;
            if (allCodeFormats.has(key)) {
                allCodeFormats.get(key)!.count++;
            } else {
                allCodeFormats.set(key, { ...format, count: 1 });
            }
        }

        for (const indicator of analysis.breakdownIndicators) {
            allBreakdownIndicators.add(indicator);
        }
    }

    // Build report
    const report = {
        timestamp: new Date().toISOString(),
        pdfFile: path.basename(CONFIG.pdfPath),
        totalPages,
        sampledPages: CONFIG.samplePages,

        findings: {
            codeFormats: Array.from(allCodeFormats.values()).sort((a, b) => b.count - a.count),
            breakdownIndicators: Array.from(allBreakdownIndicators),
            totalMainItemsInSample: totalMainItems,
            avgItemsPerPage: validAnalyses.length > 0 ? (totalMainItems / validAnalyses.length).toFixed(1) : 0,
        },

        pageAnalyses: validAnalyses,

        recommendedPrompt: generateRecommendedPrompt(allCodeFormats, allBreakdownIndicators)
    };

    // Save report
    await fs.mkdir(CONFIG.outputDir, { recursive: true });
    const reportPath = path.join(CONFIG.outputDir, `structure_analysis_${Date.now()}.json`);
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(`     Report saved to: ${reportPath}`);
    console.log();

    // Print Summary
    console.log("╔══════════════════════════════════════════════════════════════╗");
    console.log("║                    STRUCTURE FINDINGS                        ║");
    console.log("╠══════════════════════════════════════════════════════════════╣");

    console.log("║  CODE FORMATS FOUND:".padEnd(65) + "║");
    for (const [pattern, info] of allCodeFormats.entries()) {
        console.log(`║    ${info.isMainItem ? '📦' : '  '} ${info.example.padEnd(12)} → ${pattern}`.padEnd(65) + "║");
    }

    console.log("╠══════════════════════════════════════════════════════════════╣");
    console.log("║  BREAKDOWN INDICATORS:".padEnd(65) + "║");
    for (const indicator of allBreakdownIndicators) {
        console.log(`║    • ${indicator}`.padEnd(65).substring(0, 65) + "║");
    }

    console.log("╠══════════════════════════════════════════════════════════════╣");
    console.log(`║  Avg items per page: ${report.findings.avgItemsPerPage}`.padEnd(65) + "║");
    console.log(`║  Total items in sample: ${totalMainItems}`.padEnd(65) + "║");
    console.log("╚══════════════════════════════════════════════════════════════╝");

    // Print recommended prompt
    console.log();
    console.log("RECOMMENDED PROMPT (based on analysis):");
    console.log("─".repeat(60));
    console.log(report.recommendedPrompt);
}

function generateRecommendedPrompt(
    codeFormats: Map<string, any>,
    breakdownIndicators: Set<string>
): string {
    const mainFormats = Array.from(codeFormats.values())
        .filter(f => f.isMainItem)
        .map(f => f.example)
        .slice(0, 5);

    const resourceFormats = Array.from(codeFormats.values())
        .filter(f => !f.isMainItem)
        .map(f => f.example)
        .slice(0, 5);

    return `
Role: Expert Construction Price Book Extractor

TASK: Extract ALL main items (partidas) from this price book page.

═══════════════════════════════════════════════════════════════
CRITICAL RULES FOR ACCURATE EXTRACTION:
═══════════════════════════════════════════════════════════════

1. MAIN ITEM IDENTIFICATION:
   - A MAIN ITEM has: Code + Unit + Description + TOTAL PRICE (rightmost column)
   - Each row with a TOTAL PRICE in the far right is a SEPARATE item
   - Examples of main item codes: ${mainFormats.join(', ')}
   - DO NOT merge similar items. Each unique code = 1 item.

2. BREAKDOWN (DESCOMPUESTO) IDENTIFICATION:
   - Breakdown items appear BELOW their parent main item
   - Visual indicators: ${Array.from(breakdownIndicators).join(', ')}
   - Resource codes examples: ${resourceFormats.join(', ')}
   - Breakdown items do NOT have a total price in the rightmost column

3. COUNTING:
   - Before outputting, COUNT the main items on the page
   - If you see 3 codes with total prices, output 3 items, not 1.

4. PRICE EXTRACTION:
   - Total price is ALWAYS in the rightmost column
   - Extract as number (e.g., 110.38 not "110,38")
   - Convert Spanish decimals (comma) to dots

5. CONTEXT:
   - Current Chapter: [CONTEXT_CHAPTER]
   - Current Section: [CONTEXT_SECTION]
   - Update these if you see new headers.
`.trim();
}

main().catch(console.error);
