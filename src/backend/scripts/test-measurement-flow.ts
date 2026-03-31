
import 'dotenv/config';
import { measurementExtractionFlow } from '../ai/private-core/flows/measurements/measurement-extraction.flow';
import { readFileSync } from 'fs';
import { join } from 'path';


const main = async () => {
    console.log("Testing measurementExtractionFlow (Hybrid Page-by-Page)...");

    const pdfPath = join(process.cwd(), 'public', 'documents', '20250325_Mediciones_Alexandre_Rossello_23.pdf');
    console.log(`Reading PDF from: ${pdfPath}`);

    try {
        const pdfBuffer = readFileSync(pdfPath);
        const pdfBase64 = pdfBuffer.toString('base64');

        console.log(`PDF size: ${pdfBuffer.length} bytes. Running flow...`);

        // Call flow directly
        const result = await measurementExtractionFlow({
            pdfBase64: pdfBase64,
            mimeType: 'application/pdf'
        });

        console.log("Flow Output:", JSON.stringify(result, null, 2));
        console.log(`Extracted ${result.items.length} items across ${result.pageCount} pages.`);

    } catch (e) {
        console.error("Error running flow:", e);
    }
};

main();
