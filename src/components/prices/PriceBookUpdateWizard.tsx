'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { PdfPageThumbnails } from '@/components/prices/PdfPageThumbnails';
import {
  detectPriceBookPagesAction,
  type PageDetectionResult,
} from '@/actions/price-book/detect-price-book-pages.action';

/**
 * Asistente de actualización del libro de precios COAATMCA.
 *
 * Rebanada 1 (esta): subir el PDF → detectar las páginas de precios → el admin
 * CONFIRMA/ajusta qué páginas entran. Es la compuerta humana: la máquina
 * propone, el humano decide. La confirmación es POR PÁGINA (fuente de verdad =
 * `includedPages`); los rangos y el render del PDF son dos vistas de lo mismo.
 * Los pasos siguientes (extraer + preview + diff, ingesta a staging, activar)
 * se añaden encima.
 */
export function PriceBookUpdateWizard() {
  const [file, setFile] = useState<File | null>(null);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [detecting, setDetecting] = useState(false);
  const [detection, setDetection] = useState<PageDetectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Fuente de verdad: qué páginas (1-indexadas) se van a extraer.
  const [includedPages, setIncludedPages] = useState<Set<number>>(new Set());
  const [showThumbs, setShowThumbs] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onDetect() {
    if (!file) return;
    setDetecting(true);
    setError(null);
    setDetection(null);
    setIncludedPages(new Set());
    setShowThumbs(false);
    const fd = new FormData();
    fd.append('file', file);
    const res = await detectPriceBookPagesAction(fd);
    if (res.success) {
      setDetection(res.detection);
      // Semilla: las páginas que la detección clasificó como de precio.
      setIncludedPages(
        new Set(res.detection.pages.filter((p) => p.is_price).map((p) => p.page)),
      );
    } else {
      setError(res.error);
    }
    setDetecting(false);
  }

  const confirmedPages = includedPages.size;

  const togglePage = useCallback((page: number) => {
    setIncludedPages((prev) => {
      const next = new Set(prev);
      next.has(page) ? next.delete(page) : next.add(page);
      return next;
    });
  }, []);

  // Toggle de un rango entero: si alguna página del rango está incluida, lo
  // excluye completo; si ninguna, lo incluye completo.
  function toggleRange([a, b]: [number, number]) {
    setIncludedPages((prev) => {
      const next = new Set(prev);
      let anyIncluded = false;
      for (let p = a; p <= b; p++) if (next.has(p)) { anyIncluded = true; break; }
      for (let p = a; p <= b; p++) {
        if (anyIncluded) next.delete(p);
        else next.add(p);
      }
      return next;
    });
  }

  // Estado de un rango: 'all' | 'none' | 'partial'
  function rangeState([a, b]: [number, number]): 'all' | 'none' | 'partial' {
    let inc = 0;
    const total = b - a + 1;
    for (let p = a; p <= b; p++) if (includedPages.has(p)) inc++;
    if (inc === 0) return 'none';
    if (inc === total) return 'all';
    return 'partial';
  }

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-6 py-2">
      {/* Paso 1 — subir */}
      <section className="rounded-xl border bg-card p-5">
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <h3 className="text-base font-semibold">1 · Subir el libro (PDF)</h3>
          <span className="text-xs text-muted-foreground font-mono">COAATMCA</span>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Sube el PDF del libro de precios. Detectaremos automáticamente las páginas de
          precios y descartaremos promociones, índices y separadores.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <div
            onClick={() => inputRef.current?.click()}
            className="flex-1 cursor-pointer rounded-lg border border-dashed px-4 py-6 text-center hover:border-primary/60 hover:bg-muted/40 transition-colors"
          >
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setDetection(null);
                setError(null);
                setShowThumbs(false);
              }}
            />
            {file ? (
              <div className="text-sm">
                <span className="font-medium">{file.name}</span>
                <span className="text-muted-foreground">
                  {' '}· {(file.size / 1024 / 1024).toFixed(1)} MB
                </span>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">
                Haz clic para elegir el PDF del libro
              </span>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Edición / año</label>
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="w-28 rounded-md border bg-background px-3 py-2 text-sm"
              min={2020}
              max={2100}
            />
          </div>
          <Button onClick={onDetect} disabled={!file || detecting}>
            {detecting ? 'Analizando…' : 'Detectar páginas'}
          </Button>
        </div>
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      </section>

      {/* Paso 2 — confirmar páginas */}
      {detection && (
        <section className="rounded-xl border bg-card p-5">
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <h3 className="text-base font-semibold">2 · Confirmar las páginas de precios</h3>
            <span className="text-xs text-muted-foreground font-mono">{detection.signal}</span>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Revisa lo detectado. Puedes ajustar por rangos o abrir el render del PDF para
            validar página a página (las excluidas se ven opacas y marcadas).
          </p>

          {/* Tiles */}
          <div className="grid grid-cols-3 gap-px rounded-lg overflow-hidden border bg-border mb-4">
            <Stat n={confirmedPages} l="páginas confirmadas" accent />
            <Stat n={detection.total_pages - confirmedPages} l="excluidas" />
            <Stat n={detection.ranges.length} l="rangos detectados" />
          </div>

          {/* Filmstrip */}
          <Filmstrip detection={detection} rangeState={rangeState} />

          {/* Rangos como chips toggle */}
          <div className="mt-4 flex flex-wrap gap-2">
            {detection.ranges.map((range, i) => {
              const st = rangeState(range);
              const [a, b] = range;
              return (
                <button
                  key={i}
                  onClick={() => toggleRange(range)}
                  className={
                    'font-mono text-xs rounded-md border px-2 py-1 transition-colors ' +
                    (st === 'none'
                      ? 'line-through text-muted-foreground bg-muted/40'
                      : st === 'partial'
                        ? 'border-amber-500/50 text-amber-600 dark:text-amber-400'
                        : 'border-primary/40 text-foreground hover:bg-muted/40')
                  }
                  title={
                    st === 'none'
                      ? 'Excluido — clic para incluir'
                      : st === 'partial'
                        ? 'Parcial — clic para excluir todo el rango'
                        : 'Incluido — clic para excluir'
                  }
                >
                  {a === b ? `p.${a}` : `${a}–${b}`}
                </button>
              );
            })}
          </div>

          {/* Toggle del render visual */}
          <div className="mt-5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowThumbs((v) => !v)}
            >
              {showThumbs ? 'Ocultar render del PDF' : 'Ver páginas del PDF (validación visual)'}
            </Button>
          </div>

          {showThumbs && file && (
            <div className="mt-4 rounded-lg border bg-muted/10 p-3">
              <PdfPageThumbnails
                file={file}
                pages={detection.pages}
                includedPages={includedPages}
                onTogglePage={togglePage}
              />
            </div>
          )}

          {/* Confirmar */}
          <div className="mt-5 flex items-center justify-between border-t pt-4">
            <p className="text-sm">
              <span className="font-semibold tabular-nums">{confirmedPages}</span>
              <span className="text-muted-foreground"> páginas confirmadas para extraer</span>
            </p>
            <Button disabled title="Siguiente paso (extracción + preview) — en construcción">
              Confirmar y extraer →
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            El siguiente paso (extraer las partidas de las páginas confirmadas, ver el
            diff vs el libro activo, e ingestar a{' '}
            <span className="font-mono">price_book_{year}</span>) está en construcción.
          </p>
        </section>
      )}
    </div>
  );
}

function Stat({ n, l, accent }: { n: number; l: string; accent?: boolean }) {
  return (
    <div className="bg-card p-3">
      <div className={'text-2xl font-bold tabular-nums leading-none ' + (accent ? 'text-primary' : '')}>
        {n}
      </div>
      <div className="text-xs text-muted-foreground mt-1">{l}</div>
    </div>
  );
}

function Filmstrip({
  detection,
  rangeState,
}: {
  detection: PageDetectionResult;
  rangeState: (r: [number, number]) => 'all' | 'none' | 'partial';
}) {
  const total = detection.total_pages || 1;
  return (
    <div>
      <div className="relative h-14 rounded-md overflow-hidden border bg-muted/40">
        {detection.ranges.map((range, i) => {
          const st = rangeState(range);
          const [a, b] = range;
          const cls =
            st === 'none'
              ? 'bg-muted-foreground/25'
              : st === 'partial'
                ? 'bg-primary/50'
                : 'bg-primary';
          return (
            <div
              key={i}
              className={'absolute top-0 bottom-0 ' + cls}
              style={{ left: `${((a - 1) / total) * 100}%`, width: `${((b - a + 1) / total) * 100}%` }}
              title={a === b ? `Página ${a}` : `Páginas ${a}–${b}`}
            />
          );
        })}
      </div>
      <div className="flex justify-between mt-1 text-[11px] font-mono text-muted-foreground">
        <span>pág. 1</span>
        <span>{Math.round(total / 2)}</span>
        <span>{total}</span>
      </div>
    </div>
  );
}
