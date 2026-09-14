'use client';

import { useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  detectPriceBookPagesAction,
  type PageDetectionResult,
} from '@/actions/price-book/detect-price-book-pages.action';

/**
 * Asistente de actualización del libro de precios COAATMCA.
 *
 * Rebanada 1 (esta): subir el PDF → detectar las páginas de precios → el admin
 * CONFIRMA/ajusta los rangos (excluir promos coladas / incluir omitidas). Es la
 * compuerta humana: la máquina propone, el humano decide. Los pasos siguientes
 * (extraer + preview + diff, ingesta a staging, activar) se añaden encima.
 */
export function PriceBookUpdateWizard() {
  const [file, setFile] = useState<File | null>(null);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [detecting, setDetecting] = useState(false);
  const [detection, setDetection] = useState<PageDetectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  async function onDetect() {
    if (!file) return;
    setDetecting(true);
    setError(null);
    setDetection(null);
    setExcluded(new Set());
    const fd = new FormData();
    fd.append('file', file);
    const res = await detectPriceBookPagesAction(fd);
    if (res.success) setDetection(res.detection);
    else setError(res.error);
    setDetecting(false);
  }

  const confirmedPages = useMemo(() => {
    if (!detection) return 0;
    return detection.ranges.reduce(
      (acc, [a, b], i) => acc + (excluded.has(i) ? 0 : b - a + 1),
      0,
    );
  }, [detection, excluded]);

  function toggleRange(i: number) {
    setExcluded((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
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
        {error && (
          <p className="mt-3 text-sm text-destructive">{error}</p>
        )}
      </section>

      {/* Paso 2 — confirmar páginas */}
      {detection && (
        <section className="rounded-xl border bg-card p-5">
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <h3 className="text-base font-semibold">2 · Confirmar las páginas de precios</h3>
            <span className="text-xs text-muted-foreground font-mono">{detection.signal}</span>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Revisa los rangos detectados. Haz clic en un rango para excluirlo (p. ej. si
            coló una página de publicidad) o para volver a incluirlo.
          </p>

          {/* Tiles */}
          <div className="grid grid-cols-3 gap-px rounded-lg overflow-hidden border bg-border mb-4">
            <Stat n={detection.price_page_count} l="páginas de precios" accent />
            <Stat n={detection.total_pages - detection.price_page_count} l="descartadas (promo/índice)" />
            <Stat n={detection.ranges.length} l="rangos detectados" />
          </div>

          {/* Filmstrip */}
          <Filmstrip detection={detection} excluded={excluded} />

          {/* Rangos como chips toggle */}
          <div className="mt-4 flex flex-wrap gap-2">
            {detection.ranges.map(([a, b], i) => {
              const off = excluded.has(i);
              return (
                <button
                  key={i}
                  onClick={() => toggleRange(i)}
                  className={
                    'font-mono text-xs rounded-md border px-2 py-1 transition-colors ' +
                    (off
                      ? 'line-through text-muted-foreground bg-muted/40'
                      : 'border-primary/40 text-foreground hover:bg-muted/40')
                  }
                  title={off ? 'Excluido — clic para incluir' : 'Incluido — clic para excluir'}
                >
                  {a === b ? `p.${a}` : `${a}–${b}`}
                </button>
              );
            })}
          </div>

          {/* Confirmar */}
          <div className="mt-5 flex items-center justify-between border-t pt-4">
            <p className="text-sm">
              <span className="font-semibold tabular-nums">{confirmedPages}</span>
              <span className="text-muted-foreground"> páginas confirmadas para extraer</span>
            </p>
            <Button
              disabled
              title="Siguiente paso (extracción + preview) — en construcción"
            >
              Confirmar y extraer →
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            El siguiente paso (extraer las partidas de las páginas confirmadas, ver el
            diff vs el libro activo, e ingestar a <span className="font-mono">price_book_{year}</span>) está
            en construcción.
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
  excluded,
}: {
  detection: PageDetectionResult;
  excluded: Set<number>;
}) {
  const total = detection.total_pages || 1;
  return (
    <div>
      <div className="relative h-14 rounded-md overflow-hidden border bg-muted/40">
        {detection.ranges.map(([a, b], i) => (
          <div
            key={i}
            className={excluded.has(i) ? 'absolute top-0 bottom-0 bg-muted-foreground/25' : 'absolute top-0 bottom-0 bg-primary'}
            style={{ left: `${((a - 1) / total) * 100}%`, width: `${((b - a + 1) / total) * 100}%` }}
            title={a === b ? `Página ${a}` : `Páginas ${a}–${b}`}
          />
        ))}
      </div>
      <div className="flex justify-between mt-1 text-[11px] font-mono text-muted-foreground">
        <span>pág. 1</span>
        <span>{Math.round(total / 2)}</span>
        <span>{total}</span>
      </div>
    </div>
  );
}
