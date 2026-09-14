'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { PdfPageThumbnails } from '@/components/prices/PdfPageThumbnails';
import {
  detectPriceBookPagesAction,
  type PageDetectionResult,
} from '@/actions/price-book/detect-price-book-pages.action';
import {
  extractPriceBookPreviewAction,
  type ExtractPreviewResult,
  type DiffSample,
} from '@/actions/price-book/extract-price-book-preview.action';
import {
  dispatchPriceBookIngestAction,
  getPriceBookIngestStatusAction,
  type IngestStatus,
} from '@/actions/price-book/dispatch-price-book-ingest.action';
import { v4 as uuidv4 } from 'uuid';
import { useAuth } from '@/hooks/use-auth';
import { uploadPdfForPipelineJob } from '@/lib/firebase/storage-uploader';

// Cuántas páginas se extraen para el preview sincrónico (repartidas por todo
// el libro). El libro completo se procesa en la ingesta (siguiente fase).
const PREVIEW_PAGE_LIMIT = 24;

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
  const { user } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  // El PDF se sube al navegador → Firebase Storage (gs://) y las acciones solo
  // reciben el URI. Esquiva el tope de 4,5MB de body de las server actions en
  // Vercel (un libro son ~7MB). El File se conserva para el render de pdf.js.
  const [gcsUri, setGcsUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [detecting, setDetecting] = useState(false);
  const [detection, setDetection] = useState<PageDetectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Fuente de verdad: qué páginas (1-indexadas) se van a extraer.
  const [includedPages, setIncludedPages] = useState<Set<number>>(new Set());
  const [showThumbs, setShowThumbs] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [preview, setPreview] = useState<ExtractPreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [ingestJobId, setIngestJobId] = useState<string | null>(null);
  const [ingestStatus, setIngestStatus] = useState<IngestStatus | null>(null);
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [ingestStartedAt, setIngestStartedAt] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Al elegir fichero: reset total + subida en background a Storage.
  async function onSelectFile(f: File | null) {
    setFile(f);
    setDetection(null);
    setError(null);
    setIncludedPages(new Set());
    setShowThumbs(false);
    setPreview(null);
    setPreviewError(null);
    resetIngest();
    setGcsUri(null);
    setUploadError(null);
    setUploadPct(0);
    if (!f) return;
    if (!user?.uid) {
      setUploadError('Debes iniciar sesión para subir el libro.');
      return;
    }
    setUploading(true);
    try {
      const { gcsUri: uri } = await uploadPdfForPipelineJob({
        file: f,
        uid: user.uid,
        jobId: uuidv4(),
        onProgress: setUploadPct,
      });
      setGcsUri(uri);
    } catch (e: any) {
      setUploadError(e?.message || 'Falló la subida del PDF a Storage.');
    } finally {
      setUploading(false);
    }
  }

  async function onDetect() {
    if (!gcsUri) return;
    setDetecting(true);
    setError(null);
    setDetection(null);
    setIncludedPages(new Set());
    setShowThumbs(false);
    setPreview(null);
    setPreviewError(null);
    resetIngest();
    try {
      const res = await detectPriceBookPagesAction(gcsUri);
      if (res.success) {
        setDetection(res.detection);
        // Semilla: las páginas que la detección clasificó como de precio.
        setIncludedPages(
          new Set(res.detection.pages.filter((p) => p.is_price).map((p) => p.page)),
        );
      } else {
        setError(res.error);
      }
    } catch (e: any) {
      setError(e?.message || 'Error inesperado en la detección.');
    } finally {
      setDetecting(false);
    }
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

  const pagesJson = () => JSON.stringify([...includedPages].sort((a, b) => a - b));

  async function onConfirmExtract() {
    if (!gcsUri || confirmedPages === 0) return;
    setExtracting(true);
    setPreview(null);
    setPreviewError(null);
    resetIngest();
    try {
      const res = await extractPriceBookPreviewAction({
        gcsUri,
        pages: pagesJson(),
        year,
        limit: PREVIEW_PAGE_LIMIT,
      });
      if (res.success) setPreview(res.preview);
      else setPreviewError(res.error);
    } catch (e: any) {
      setPreviewError(e?.message || 'Error inesperado en la extracción.');
    } finally {
      setExtracting(false);
    }
  }

  function resetIngest() {
    setDispatching(false);
    setIngestJobId(null);
    setIngestStatus(null);
    setIngestError(null);
    setIngestStartedAt(null);
  }

  async function onIngest() {
    if (!gcsUri || confirmedPages === 0) return;
    setDispatching(true);
    setIngestStatus(null);
    setIngestError(null);
    try {
      const res = await dispatchPriceBookIngestAction({
        gcsUri,
        pages: pagesJson(),
        year,
      });
      if (res.success) {
        setIngestJobId(res.jobId);
        setIngestStartedAt(Date.now());
        setIngestStatus({ status: 'queued', eventCount: 0, staging: res.staging });
      } else {
        setIngestError(res.error);
      }
    } catch (e: any) {
      setIngestError(e?.message || 'Error inesperado lanzando la ingesta.');
    } finally {
      setDispatching(false);
    }
  }

  // Polling del estado del job (cada 3s hasta terminal).
  useEffect(() => {
    if (!ingestJobId) return;
    const terminal = (s?: string) => s === 'completed' || s === 'failed' || s === 'canceled';
    if (terminal(ingestStatus?.status)) return;
    let alive = true;
    const tick = async () => {
      const st = await getPriceBookIngestStatusAction(ingestJobId);
      if (!alive) return;
      setIngestStatus(st);
    };
    const id = setInterval(tick, 3000);
    tick();
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [ingestJobId, ingestStatus?.status]);

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
              onChange={(e) => onSelectFile(e.target.files?.[0] ?? null)}
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
          <Button onClick={onDetect} disabled={!gcsUri || detecting || uploading}>
            {uploading
              ? `Subiendo… ${Math.round(uploadPct * 100)}%`
              : detecting
                ? 'Analizando…'
                : 'Detectar páginas'}
          </Button>
        </div>

        {/* Progreso de subida a Storage */}
        {uploading && (
          <div className="mt-3">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${Math.round(uploadPct * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Subiendo el PDF a Storage… {(uploadPct * (file?.size ?? 0) / 1024 / 1024).toFixed(1)} /{' '}
              {((file?.size ?? 0) / 1024 / 1024).toFixed(1)} MB
            </p>
          </div>
        )}
        {gcsUri && !uploading && (
          <p className="mt-3 text-xs text-emerald-600 dark:text-emerald-400">
            ✓ PDF subido. Listo para detectar páginas.
          </p>
        )}
        {uploadError && <p className="mt-3 text-sm text-destructive">{uploadError}</p>}
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
            <Button onClick={onConfirmExtract} disabled={confirmedPages === 0 || extracting}>
              {extracting ? 'Extrayendo muestra…' : 'Confirmar y extraer →'}
            </Button>
          </div>
          {previewError && <p className="mt-3 text-sm text-destructive">{previewError}</p>}
        </section>
      )}

      {/* Paso 3 — preview + diff */}
      {preview && <PreviewPanel preview={preview} />}

      {/* Paso 4 — ingesta a staging (job) */}
      {preview && (
        <IngestPanel
          onIngest={onIngest}
          dispatching={dispatching}
          jobId={ingestJobId}
          status={ingestStatus}
          error={ingestError}
          year={year}
          startedAt={ingestStartedAt}
        />
      )}
    </div>
  );
}

function PreviewPanel({ preview }: { preview: ExtractPreviewResult }) {
  const s = preview.diff.summary;
  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h3 className="text-base font-semibold">3 · Preview y diferencias vs libro activo</h3>
        <span className="text-xs text-muted-foreground font-mono">{preview.active_collection}</span>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Muestra de{' '}
        <span className="font-medium text-foreground">{preview.sampled_count}</span> páginas
        repartidas por las {preview.pages_confirmed} confirmadas ·{' '}
        <span className="font-medium text-foreground">{preview.extracted_count}</span> partidas
        extraídas · contrastadas con{' '}
        <span className="font-medium text-foreground">{preview.active_item_count}</span> del libro
        activo.
      </p>

      {/* Tiles del diff */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px rounded-lg overflow-hidden border bg-border mb-4">
        <Stat n={s.changed} l="con cambio de precio" accent />
        <Stat n={s.new} l="nuevas (no en el libro activo)" />
        <Stat n={s.unchanged} l="sin cambio" />
        <div className="bg-card p-3">
          <div className="text-2xl font-bold tabular-nums leading-none">
            {s.avg_change_pct === null ? '—' : `${s.avg_change_pct > 0 ? '+' : ''}${s.avg_change_pct}%`}
          </div>
          <div className="text-xs text-muted-foreground mt-1">variación media (cambios)</div>
        </div>
      </div>

      {/* Tabla de muestras */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="text-left font-medium px-3 py-2">Estado</th>
              <th className="text-left font-medium px-3 py-2">Código</th>
              <th className="text-left font-medium px-3 py-2">Ud.</th>
              <th className="text-right font-medium px-3 py-2">Activo</th>
              <th className="text-right font-medium px-3 py-2">Nuevo</th>
              <th className="text-right font-medium px-3 py-2">Δ%</th>
              <th className="text-left font-medium px-3 py-2">Descripción</th>
            </tr>
          </thead>
          <tbody>
            {preview.diff.samples.map((d) => (
              <DiffRow key={d.code} d={d} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-5 border-t pt-4 text-xs text-muted-foreground">
        Esto es una <span className="font-medium">muestra</span> para validar precios. Abajo puedes
        lanzar la ingesta del libro <span className="font-medium">completo</span> a staging.
      </p>
    </section>
  );
}

const INGEST_STEPS = ['En cola', 'Extrayendo páginas', 'Embeddings + escritura', 'Diff + cierre'];

function ingestStepIndex(status: IngestStatus | null, done: boolean): number {
  if (done) return INGEST_STEPS.length; // todo hecho
  const phase = status?.phase;
  if (phase === 'embed_write') return 2;
  if (phase === 'extract') return 1;
  return 0; // queued / arranque
}

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

function IngestPanel({
  onIngest,
  dispatching,
  jobId,
  status,
  error,
  year,
  startedAt,
}: {
  onIngest: () => void;
  dispatching: boolean;
  jobId: string | null;
  status: IngestStatus | null;
  error: string | null;
  year: number;
  startedAt: number | null;
}) {
  const st = status?.status;
  const running = st === 'queued' || st === 'running' || dispatching;
  const done = st === 'completed';
  const failed = st === 'failed' || st === 'canceled' || !!error;

  // Reloj de tiempo transcurrido — para que un proceso de minutos nunca parezca colgado.
  const [now, setNow] = useState<number>(Date.now());
  useEffect(() => {
    if (!startedAt || done || failed) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt, done, failed]);
  const elapsed = startedAt ? fmtElapsed((done || failed ? now : Date.now()) - startedAt) : null;
  const stepIdx = ingestStepIndex(status, done);

  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h3 className="text-base font-semibold">4 · Ingestar el libro completo a staging</h3>
        <span className="text-xs text-muted-foreground font-mono">
          price_book_{year}_staging
        </span>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Extrae TODAS las páginas confirmadas, genera embeddings (Vertex) y escribe a la colección de
        staging. No toca el libro activo. Corre en segundo plano (varios minutos); puedes seguir el
        progreso aquí en vivo.
      </p>

      {!jobId && !dispatching && (
        <Button onClick={onIngest}>Ingestar a staging →</Button>
      )}
      {dispatching && !jobId && (
        <p className="text-sm text-muted-foreground">Lanzando el job…</p>
      )}
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      {jobId && (
        <div className="mt-2 rounded-lg border bg-muted/10 p-4">
          <div className="flex items-center gap-3">
            <StatusDot done={done} failed={failed} running={running} />
            <div className="flex-1">
              <div className="text-sm font-medium">
                {done
                  ? 'Ingesta completada'
                  : failed
                    ? 'La ingesta falló'
                    : st === 'queued'
                      ? 'En cola…'
                      : 'Procesando…'}
              </div>
              <div className="text-xs text-muted-foreground">
                {status?.message ||
                  (st === 'queued' ? 'Esperando al worker…' : 'Trabajando…')}
              </div>
            </div>
            {elapsed && (
              <span className="text-xs font-mono tabular-nums text-muted-foreground" title="tiempo transcurrido">
                ⏱ {elapsed}
              </span>
            )}
            <span className="text-[11px] font-mono text-muted-foreground">
              {jobId.slice(0, 8)}
            </span>
          </div>

          {/* Stepper de fases */}
          {!failed && (
            <ol className="mt-4 flex flex-wrap gap-x-4 gap-y-1">
              {INGEST_STEPS.map((label, i) => {
                const state = i < stepIdx ? 'done' : i === stepIdx ? 'active' : 'todo';
                return (
                  <li key={label} className="flex items-center gap-1.5 text-xs">
                    <span
                      className={
                        'h-2 w-2 rounded-full ' +
                        (state === 'done'
                          ? 'bg-emerald-500'
                          : state === 'active'
                            ? 'bg-primary animate-pulse'
                            : 'bg-muted-foreground/30')
                      }
                    />
                    <span
                      className={
                        state === 'todo' ? 'text-muted-foreground/50' : 'text-foreground'
                      }
                    >
                      {label}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
          {failed && status?.error && (
            <p className="mt-3 text-sm text-destructive">{status.error}</p>
          )}

          {done && status?.diff && (
            <div className="mt-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-px rounded-lg overflow-hidden border bg-border">
                <Stat n={status.itemsSaved ?? 0} l="partidas escritas" accent />
                <Stat n={status.breakdownsSaved ?? 0} l="componentes" />
                <Stat n={status.diff.changed} l="con cambio de precio" />
                <Stat n={status.diff.new} l="nuevas vs activo" />
              </div>
              <p className="mt-3 text-sm">
                Escrito a{' '}
                <span className="font-mono">{status.staging}</span>. Diff completo vs libro activo:{' '}
                <span className="font-medium">{status.diff.changed}</span> cambios,{' '}
                <span className="font-medium">{status.diff.new}</span> nuevas,{' '}
                <span className="font-medium">{status.diff.unchanged}</span> iguales
                {status.diff.avg_change_pct !== null && (
                  <>
                    {' '}
                    (media{' '}
                    <span className="font-medium">
                      {status.diff.avg_change_pct > 0 ? '+' : ''}
                      {status.diff.avg_change_pct}%
                    </span>
                    )
                  </>
                )}
                .
              </p>
              <p className="mt-3 text-xs text-muted-foreground">
                Siguiente paso (en construcción): activar 2026 (flip del puntero) o volver a 2025.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function StatusDot({
  done,
  failed,
  running,
}: {
  done: boolean;
  failed: boolean;
  running: boolean;
}) {
  if (done) return <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />;
  if (failed) return <span className="h-2.5 w-2.5 rounded-full bg-destructive" />;
  return (
    <span
      className={
        'h-2.5 w-2.5 rounded-full ' + (running ? 'bg-primary animate-pulse' : 'bg-muted-foreground')
      }
    />
  );
}

function DiffRow({ d }: { d: DiffSample }) {
  const badge =
    d.status === 'changed'
      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
      : d.status === 'new'
        ? 'bg-primary/15 text-primary'
        : 'bg-muted text-muted-foreground';
  const label = d.status === 'changed' ? 'cambio' : d.status === 'new' ? 'nueva' : 'igual';
  const deltaCls =
    d.delta_pct == null || d.delta_pct === 0
      ? 'text-muted-foreground'
      : d.delta_pct > 0
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-red-600 dark:text-red-400';
  return (
    <tr className="border-t">
      <td className="px-3 py-1.5">
        <span className={'rounded px-1.5 py-0.5 text-[11px] font-medium ' + badge}>{label}</span>
      </td>
      <td className="px-3 py-1.5 font-mono text-xs">{d.code}</td>
      <td className="px-3 py-1.5 text-muted-foreground">{d.unit}</td>
      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
        {d.old_price == null ? '—' : d.old_price.toFixed(2)}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums font-medium">{d.new_price.toFixed(2)}</td>
      <td className={'px-3 py-1.5 text-right tabular-nums ' + deltaCls}>
        {d.delta_pct == null ? '—' : `${d.delta_pct > 0 ? '+' : ''}${d.delta_pct}%`}
      </td>
      <td className="px-3 py-1.5 text-muted-foreground truncate max-w-[22rem]" title={d.description}>
        {d.description}
      </td>
    </tr>
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
