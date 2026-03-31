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

# Instalar dependencias primero (cacheado si requirements no cambia)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar el código fuente (el .dockerignore excluye lo innecesario)
COPY . .

# Puerto estándar Cloud Run
EXPOSE 8080

# Arrancar con Uvicorn en modo producción
CMD ["uvicorn", "src.core.http.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
