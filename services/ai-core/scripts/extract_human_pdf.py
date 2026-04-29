import sys
import fitz

pdf_path = "data_extraction_lab/docs-to-analisys/MU02-aparejador-humano.pdf"
out_path = "tmp_budget_human.txt"

print(f"Extracting {pdf_path} to {out_path}...")
try:
    doc = fitz.open(pdf_path)
    text = ""
    for idx, page in enumerate(doc):
        text += f"---PAGE---\n"
        text += page.get_text()
    
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"Extraction successful. Wrote {len(text)} characters.")
except Exception as e:
    print(f"Error: {e}")
