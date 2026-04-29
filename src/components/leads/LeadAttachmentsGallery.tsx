'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, ExternalLink, FileText, ImageOff, Download } from 'lucide-react';

function fileNameFromUrl(url: string): string {
    try {
        const u = new URL(url);
        const last = u.pathname.split('/').pop() || '';
        return decodeURIComponent(last.replace(/^\d+_/, '')) || 'archivo';
    } catch {
        return url.split('/').pop() || 'archivo';
    }
}

function isPdfUrl(url: string): boolean {
    return /\.pdf(\?|$)/i.test(url);
}

interface LeadAttachmentsGalleryProps {
    urls: string[];
}

/**
 * Galería de adjuntos del lead. Las imágenes abren un modal con carrusel
 * navegable (sólo imágenes — los PDFs van a nueva pestaña porque cada
 * navegador los renderiza con su visor). El modal soporta teclado:
 * flechas izquierda/derecha y ESC para cerrar.
 */
export function LeadAttachmentsGallery({ urls }: LeadAttachmentsGalleryProps) {
    const items = useMemo(
        () =>
            urls.map(url => ({
                url,
                isPdf: isPdfUrl(url),
                name: fileNameFromUrl(url),
            })),
        [urls]
    );

    // Lista de sólo imágenes para el carrusel.
    const imageItems = useMemo(() => items.filter(it => !it.isPdf), [items]);

    const [openIndex, setOpenIndex] = useState<number | null>(null);
    const [imgErrored, setImgErrored] = useState<Record<number, boolean>>({});

    const closeModal = useCallback(() => setOpenIndex(null), []);
    const showPrev = useCallback(() => {
        setOpenIndex(prev =>
            prev === null ? null : (prev - 1 + imageItems.length) % imageItems.length
        );
    }, [imageItems.length]);
    const showNext = useCallback(() => {
        setOpenIndex(prev => (prev === null ? null : (prev + 1) % imageItems.length));
    }, [imageItems.length]);

    // Teclado: flechas y ESC
    useEffect(() => {
        if (openIndex === null) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'ArrowLeft') showPrev();
            else if (e.key === 'ArrowRight') showNext();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [openIndex, showPrev, showNext]);

    if (items.length === 0) return null;

    const currentImage = openIndex !== null ? imageItems[openIndex] : null;

    return (
        <>
            <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                {items.map((it, i) => {
                    if (it.isPdf) {
                        // PDFs → nueva pestaña.
                        return (
                            <a
                                key={i}
                                href={it.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={it.name}
                                className="relative aspect-square bg-muted rounded-md overflow-hidden border hover:border-foreground transition-colors group flex flex-col items-center justify-center p-2 text-center"
                            >
                                <FileText className="h-7 w-7 text-rose-500 mb-1" />
                                <span className="text-[10px] text-muted-foreground line-clamp-2 break-all">
                                    {it.name}
                                </span>
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/15 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                                    <ExternalLink className="h-4 w-4 text-foreground drop-shadow" />
                                </div>
                            </a>
                        );
                    }

                    // Imagen → abrir carrusel en su índice dentro de imageItems.
                    const imageIndex = imageItems.findIndex(im => im.url === it.url);
                    const errored = imgErrored[i];
                    return (
                        <button
                            type="button"
                            key={i}
                            onClick={() => setOpenIndex(imageIndex)}
                            title={it.name}
                            className="relative aspect-square bg-muted rounded-md overflow-hidden border hover:border-foreground transition-colors group cursor-zoom-in"
                        >
                            {errored ? (
                                <div className="flex flex-col items-center justify-center h-full p-2 text-center">
                                    <ImageOff className="h-7 w-7 text-muted-foreground/60 mb-1" />
                                    <span className="text-[10px] text-muted-foreground line-clamp-2 break-all">
                                        {it.name}
                                    </span>
                                </div>
                            ) : (
                                /* eslint-disable-next-line @next/next/no-img-element */
                                <img
                                    src={it.url}
                                    alt={it.name}
                                    className="w-full h-full object-cover"
                                    onError={() => setImgErrored(prev => ({ ...prev, [i]: true }))}
                                />
                            )}
                        </button>
                    );
                })}
            </div>

            <Dialog open={openIndex !== null} onOpenChange={open => !open && closeModal()}>
                <DialogContent
                    className="!w-screen !h-screen !max-w-none !left-0 !top-0 !translate-x-0 !translate-y-0 !rounded-none !border-0 !p-0 bg-black/95 flex flex-col"
                    hideCloseIcon
                >
                    <DialogTitle className="sr-only">Visor de adjuntos del lead</DialogTitle>
                    {currentImage && (
                        <>
                            {/* Top bar */}
                            <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
                                <div className="flex items-center gap-3 min-w-0">
                                    <span className="text-sm font-medium truncate">{currentImage.name}</span>
                                    <span className="text-xs text-white/60 shrink-0">
                                        {openIndex! + 1} / {imageItems.length}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <a
                                        href={currentImage.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white transition-colors"
                                    >
                                        <Download className="h-3.5 w-3.5" />
                                        Descargar
                                    </a>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={closeModal}
                                        className="text-white hover:bg-white/10 hover:text-white"
                                    >
                                        Cerrar
                                    </Button>
                                </div>
                            </div>

                            {/* Image */}
                            <div className="relative flex-1 flex items-center justify-center overflow-hidden px-4 pb-4">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={currentImage.url}
                                    alt={currentImage.name}
                                    className="max-w-full max-h-full object-contain rounded-md shadow-2xl"
                                />

                                {imageItems.length > 1 && (
                                    <>
                                        <button
                                            type="button"
                                            onClick={showPrev}
                                            aria-label="Anterior"
                                            className="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/25 text-white transition-colors"
                                        >
                                            <ChevronLeft className="h-6 w-6" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={showNext}
                                            aria-label="Siguiente"
                                            className="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/25 text-white transition-colors"
                                        >
                                            <ChevronRight className="h-6 w-6" />
                                        </button>
                                    </>
                                )}
                            </div>

                            {/* Thumbnail strip */}
                            {imageItems.length > 1 && (
                                <div className="px-4 pb-4 flex justify-center gap-2 overflow-x-auto">
                                    {imageItems.map((im, i) => (
                                        <button
                                            type="button"
                                            key={i}
                                            onClick={() => setOpenIndex(i)}
                                            className={`shrink-0 h-14 w-14 rounded-md overflow-hidden border-2 transition-all ${
                                                i === openIndex
                                                    ? 'border-white opacity-100'
                                                    : 'border-transparent opacity-50 hover:opacity-90'
                                            }`}
                                        >
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img
                                                src={im.url}
                                                alt=""
                                                className="w-full h-full object-cover"
                                            />
                                        </button>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}
