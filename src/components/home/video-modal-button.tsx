'use client';

import * as React from 'react';
import { Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface VideoModalButtonProps {
    /** Texto del botón. */
    label: string;
    /** Ruta del vídeo dentro de /public. */
    src?: string;
    /** Fotograma de portada; evita el rectángulo negro antes de reproducir. */
    poster?: string;
    /** Título accesible del diálogo. */
    title?: string;
    className?: string;
}

/**
 * Botón que abre el vídeo corporativo en un modal.
 *
 * El `<video>` sólo se monta cuando el diálogo está abierto: así el fichero
 * (varios MB) no se descarga en cada visita al home, únicamente cuando alguien
 * pulsa el botón. Al cerrar se desmonta y la reproducción se detiene.
 */
export function VideoModalButton({
    label,
    src = '/video/home.mp4',
    poster = '/video/home-poster.jpg',
    title,
    className,
}: VideoModalButtonProps) {
    const [open, setOpen] = React.useState(false);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button
                    variant="outline"
                    size="xl"
                    className={cn(
                        'group border-white/40 bg-black/20 text-white hover:bg-white/20 hover:text-white rounded-full px-8 h-14 text-lg backdrop-blur-md transition-all font-medium',
                        className
                    )}
                >
                    <Play className="mr-2 w-5 h-5 fill-white/80 group-hover:fill-white transition-colors" />
                    {label}
                </Button>
            </DialogTrigger>

            <DialogContent className="max-w-5xl w-[95vw] p-0 overflow-hidden border-white/10 bg-black">
                <DialogTitle className="sr-only">{title ?? label}</DialogTitle>
                {open && (
                    <video
                        src={src}
                        poster={poster}
                        controls
                        autoPlay
                        playsInline
                        preload="none"
                        className="w-full aspect-video bg-black"
                    >
                        Tu navegador no puede reproducir este vídeo.
                    </video>
                )}
            </DialogContent>
        </Dialog>
    );
}
