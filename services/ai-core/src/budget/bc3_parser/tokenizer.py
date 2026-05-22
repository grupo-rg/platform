"""Tokenizer BC3 — encoding detection + line splitter.

Los archivos BC3 son texto plano con records separados por `\\r\\n` (CRLF).
Cada record empieza por `~` + carácter clave (~V, ~C, ~D, ~M, etc.).

Encoding:
  - BC3 históricamente usa ANSI (latin-1 / cp1252).
  - Algunos exporters modernos (Presto 25+) pueden usar UTF-8.
  - El header `~V|...|FIEBDC-3/2020|...|ANSI|` declara el encoding, pero
    no es siempre fiable. Probamos múltiples encodings en orden.
"""

from __future__ import annotations

from typing import Iterator, List, Tuple


# Orden de prueba: el primero que decodifica sin error gana.
# latin-1 es permisivo (nunca falla con bytes 0-255) pero puede producir
# mojibake. Si UTF-8 funciona, lo preferimos. cp1252 es el ANSI español típico.
_ENCODING_PROBE_ORDER = ("utf-8", "cp1252", "latin-1")


def decode_bc3_bytes(raw: bytes) -> Tuple[str, str]:
    """Decodifica bytes BC3 detectando encoding.

    Retorna `(text, encoding_used)`.
    """
    # Si tiene BOM UTF-8, usar UTF-8.
    if raw.startswith(b"\xef\xbb\xbf"):
        return raw[3:].decode("utf-8"), "utf-8-bom"

    # Probar UTF-8 estricto primero (falla si hay bytes inválidos).
    try:
        return raw.decode("utf-8"), "utf-8"
    except UnicodeDecodeError:
        pass

    # cp1252 (ANSI español) — fall-through a latin-1 si hay caracteres no mapeados.
    try:
        return raw.decode("cp1252"), "cp1252"
    except UnicodeDecodeError:
        pass

    # latin-1 nunca falla — última red de seguridad.
    return raw.decode("latin-1"), "latin-1"


def iter_records(text: str) -> Iterator[str]:
    """Itera records BC3 ya separados.

    Cada record empieza por `~` + char clave. Los records pueden ocupar
    múltiples líneas si tienen continuaciones (raro pero posible), pero
    en los BC3 reales del cliente cada record cabe en una línea CRLF.
    """
    # Algunos archivos usan solo \n en vez de \r\n. Normalizamos.
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    for line in normalized.split("\n"):
        # Records empiezan por ~ — saltar líneas vacías y comentarios.
        if line.startswith("~") and len(line) >= 2:
            yield line


def split_record(line: str) -> List[str]:
    """Divide un record en campos por `|`.

    Cada record sigue el patrón `~X|field1|field2|...|fieldN|`.
    El último campo suele estar vacío (terminador `|`).
    """
    return line.split("|")
