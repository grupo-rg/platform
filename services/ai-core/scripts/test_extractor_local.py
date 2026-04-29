import os
from pprint import pprint
from src.infrastructure.adapters.pdfplumber_adapter import PdfPlumberAdapter
from src.application.use_cases.extract_budget_use_case import ExtractBudgetFromPdfUseCase
from src.domain.exceptions.errors import MathematicalValidationError

def run_test(pdf_path: str):
    print(f"\\n{'='*60}")
    print(f"TESTING FILE: {os.path.basename(pdf_path)}")
    print(f"{'='*60}\\n")
    
    if not os.path.exists(pdf_path):
        print(f"ERROR: File not found: {pdf_path}")
        return

    adapter = PdfPlumberAdapter()
    use_case = ExtractBudgetFromPdfUseCase(adapter)
    
    try:
        with open(pdf_path, 'rb') as f:
            budget = use_case.execute(f)
            
        print(f"Total Budget Price: {budget.total_price:.2f} EUR")
        print(f"Total Chapters Extracted: {len(budget.chapters)}")
        
        for i, chapter in enumerate(budget.chapters):
            print(f"  [{i+1}] {chapter.name} | Items: {len(chapter.items)} | Subtotal: {chapter.subtotal:.2f}")
            if len(chapter.items) > 0:
                print(f"      - First item: {chapter.items[0].code} {chapter.items[0].description[:40]}... (Qty: {chapter.items[0].quantity}, Total: {chapter.items[0].priceTotal})")
        
        print("\\n✅ Validated: Zero-Leak Math passed successfully.")
            
    except MathematicalValidationError as e:
        print(f"\\n❌ ZERO-LEAK MATH VALIDATION FAILED:")
        print(str(e))
    except Exception as e:
        print(f"\\n❌ FATAL EXTRACTION ERROR:")
        print(str(e))

import sys

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python scripts/test_extractor_local.py <path_to_pdf1> [path_to_pdf2 ...]")
        sys.exit(1)
        
    for pdf_path in sys.argv[1:]:
        run_test(pdf_path)
