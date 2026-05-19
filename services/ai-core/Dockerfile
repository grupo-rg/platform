# Imagen base Python ligera
FROM python:3.11-slim

# Dependencias del sistema para PyMuPDF (fitz) y pdfplumber
RUN apt-get update && apt-get install -y \
    build-essential \
    libpoppler-cpp-dev \
    pkg-config \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instalar dependencias primero (cacheado si requirements no cambia).
#
# S1-A-03 — `torch` se instala desde el índice CPU-only de PyTorch para
# evitar arrastrar el runtime CUDA (~1.5GB extra). El resto de paquetes
# viene del índice estándar PyPI.
COPY requirements.txt .
RUN pip install --no-cache-dir \
        --extra-index-url https://download.pytorch.org/whl/cpu \
        -r requirements.txt

# S1-A-03 — Pre-descarga del modelo BGE reranker (~280MB) durante el build
# para evitar el cold-start (~30s en CPU) del primer `rerank` en producción.
# El modelo se cachea en `/root/.cache/huggingface/` que viaja con la imagen.
RUN python -c "from sentence_transformers import CrossEncoder; CrossEncoder('BAAI/bge-reranker-v2-m3')"

# Copiar el código fuente (el .dockerignore excluye lo innecesario)
COPY . .

# Puerto estándar Cloud Run
EXPOSE 8080

# Arrancar con Uvicorn en modo producción
CMD ["uvicorn", "src.core.http.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
