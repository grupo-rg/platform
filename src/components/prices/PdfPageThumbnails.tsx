'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { DetectedPage } from '@/actions/price-book/detect-price-book-pages.action';

/**
 * Render visual del PDF para la validación humana (compuerta 1).
 *
 * Muestra una miniatura de CADA página del libro. Las páginas que NO se van a
 * extraer (descartadas por el detector o excluidas a mano) se ven OPACAS y
 * claramente marcadas; las incluidas, nítidas con un anillo de acento. Un clic
 * en cualquier miniatura la incluye/excluye — así el humano ve exactamente qué
 * páginas entran y corrige lo que la máquina se equivocó ANTES de procesar.
 *
 * Rinde perezosamente (IntersectionObserver): un libro de ~500 páginas no cabe
 * en memoria si se pintan todos los canvas a la vez, así que solo se rasteriza
 * lo que entra en viewport (+300px de margen) y se cachea.
 */

type PdfDoc = {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
  destroy: () => Promise<void>;
};
type PdfPage = {
  getViewport: (opts: { scale: number }) => { width: number; height: number };
  render: (opts: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => {
    promise: Promise<void>;
    cancel: () => void;
  };
};

type Filter = 'all' | 'discarded' | 'included';

export function PdfPageThumbnails({
  file,
  pages,
  includedPages,
  onTogglePage,
}: {
  file: File;
  pages: DetectedPage[];
  includedPages: Set<number>;
  onTogglePage: (page: number) => void;
}) {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    let cancelled = false;
    let localDoc: PdfDoc | null = null;
    (async () => {
      try {
        const pdfjs: any = await import('pdfjs-dist');
        // Worker auto-hospedado (mismo origen) → pdf.js hace new Worker(src,{type:'module'}) directo.
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        const buf = await file.arrayBuffer();
        if (cancelled) return;
        const task = pdfjs.getDocument({ data: new Uint8Array(buf) });
        const d: PdfDoc = await task.promise;
        if (cancelled) {
          d.destroy();
          return;
        }
        localDoc = d;
        setDoc(d);
      } catch (e: any) {
        if (!cancelled) setLoadErr(e?.message || 'No se pudo abrir el PDF para previsualizar.');
      }
    })();
    return () => {
      cancelled = true;
      localDoc?.destroy?.();
    };
  }, [file]);

  const byPage = useMemo(() => {
    const m = new Map<number, DetectedPage>();
    for (const p of pages) m.set(p.page, p);
    return m;
  }, [pages]);

  const visiblePages = useMemo(() => {
    const total = doc?.numPages ?? pages.length;
    const all = Array.from({ length: total }, (_, i) => i + 1);
    if (filter === 'discarded') return all.filter((n) => !includedPages.has(n));
    if (filter === 'included') return all.filter((n) => includedPages.has(n));
    return all;
  }, [doc, pages.length, filter, includedPages]);

  if (loadErr) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
        {loadErr}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar: leyenda + filtro */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm ring-2 ring-primary bg-primary/20" /> incluida
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-muted-foreground/25" /> excluida (opaca)
          </span>
        </div>
        <div className="inline-flex rounded-md border p-0.5 text-xs">
          {(
            [
              ['all', 'Todas'],
              ['discarded', 'Solo descartadas'],
              ['included', 'Solo incluidas'],
            ] as [Filter, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={
                'px-2.5 py-1 rounded transition-colors ' +
                (filter === key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted/60')
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {!doc ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="aspect-[1/1.414] rounded-md border bg-muted/40 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 max-h-[70vh] overflow-y-auto pr-1">
          {visiblePages.map((n) => (
            <Thumb
              key={n}
              doc={doc}
              page={n}
              included={includedPages.has(n)}
              meta={byPage.get(n)}
              onToggle={() => onTogglePage(n)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Thumb({
  doc,
  page,
  included,
  meta,
  onToggle,
}: {
  doc: PdfDoc;
  page: number;
  included: boolean;
  meta?: DetectedPage;
  onToggle: () => void;
}) {
  const hostRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisible(true);
            io.disconnect();
          }
        }
      },
      { rootMargin: '300px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || rendered) return;
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    (async () => {
      try {
        const p = await doc.getPage(page);
        if (cancelled) return;
        const base = p.getViewport({ scale: 1 });
        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        const targetCssWidth = 150;
        const scale = (targetCssWidth * dpr) / base.width;
        const vp = p.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.ceil(vp.width);
        canvas.height = Math.ceil(vp.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const r = p.render({ canvasContext: ctx, viewport: vp });
        task = r;
        await r.promise;
        if (!cancelled) setRendered(true);
      } catch {
        /* render cancelado o página inaccesible — se deja el placeholder */
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel?.();
    };
  }, [visible, rendered, doc, page]);

  const isPrice = meta?.is_price ?? false;
  // Divergencia: la máquina la marcó precio pero el humano la excluyó, o viceversa.
  const diverges = isPrice !== included;

  return (
    <button
      ref={hostRef}
      onClick={onToggle}
      title={
        meta
          ? `Página ${page} · ${meta.prices} importes · ${meta.codes} códigos · ${meta.images} imágenes\n${
              included ? 'Incluida — clic para excluir' : 'Excluida — clic para incluir'
            }`
          : `Página ${page}`
      }
      className={
        'group relative aspect-[1/1.414] rounded-md border overflow-hidden text-left transition-all ' +
        (included
          ? 'ring-2 ring-primary border-primary/40'
          : 'border-border opacity-45 grayscale hover:opacity-70')
      }
    >
      <canvas ref={canvasRef} className="w-full h-full object-top bg-white" />
      {!rendered && <div className="absolute inset-0 bg-muted/40 animate-pulse" />}

      {/* nº de página */}
      <span className="absolute top-1 left-1 rounded bg-background/80 px-1 text-[10px] font-mono tabular-nums leading-tight">
        {page}
      </span>

      {/* marca de estado */}
      {!included && (
        <span className="absolute inset-x-0 bottom-0 bg-muted-foreground/70 text-background text-[10px] text-center font-medium py-0.5">
          EXCLUIDA
        </span>
      )}
      {included && isPrice && (
        <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-primary" title="precio" />
      )}
      {/* aviso de divergencia máquina↔humano */}
      {diverges && (
        <span
          className="absolute top-1 right-1 rounded bg-amber-500 text-white text-[9px] px-1 font-semibold"
          title={
            isPrice
              ? 'La detección la marcó como precio, pero está excluida'
              : 'La detección la descartó, pero está incluida'
          }
        >
          ≠
        </span>
      )}
    </button>
  );
}
