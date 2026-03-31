import fitz
import io
import base64
import logging
from typing import Any, List, Dict

from src.budget.application.use_cases.extract_budget_from_pdf import IPdfReader

logger = logging.getLogger(__name__)

class PdfPlumberAdapter(IPdfReader):
    """
    Adapter implementation previously using pdfplumber, now upgraded to PyMuPDF.
    We kept the class name 'PdfPlumberAdapter' to avoid touching Dependency Injection wires in main.py.
    Extracts pages as high-resolution PNG Base64 strings to feed the Vision LLM (Zero-Leak Pipeline).
    """
    def extract_text_with_layout(self, pdf_input: Any) -> List[Dict[str, Any]]:
        """
        Reads a File object (Spooler or BytesIO).
        Extracts each physical page as an image to retain perfect visual structure for the VLM.
        """
        pdf_bytes = pdf_input.read()
        extracted_chunks = []
        
        try:
            # Open PDF from bytes
            pdf_document = fitz.open("pdf", pdf_bytes)
            
            # Use 150 DPI for a good balance of OCR readability and token size
            # 150 DPI is usually perfect for Google Gemini 1.5/2.5 Flash constraints
            zoom = 150 / 72
            mat = fitz.Matrix(zoom, zoom)
            
            for page_num in range(len(pdf_document)):
                page = pdf_document.load_page(page_num)
                pix = page.get_pixmap(matrix=mat, alpha=False)
                
                # Convert to PNG image bytes
                img_bytes = pix.tobytes("png")
                
                # Encode to Base64 String
                b64_string = base64.b64encode(img_bytes).decode("utf-8")
                
                extracted_chunks.append({
                    "image_base64": b64_string,
                    "mime_type": "image/png",
                    "page_num": page_num + 1
                })
                
            logger.info(f"PyMuPDF extracted {len(extracted_chunks)} high-res page images for Vision VLM.")
            pdf_document.close()
            return extracted_chunks
            
        except Exception as e:
            logger.error(f"PyMuPDF crashed reading PDF: {str(e)}")
            raise ValueError("Invalid or corrupted PDF file.")
