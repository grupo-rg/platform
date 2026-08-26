'use client';

import * as React from 'react';
import Image, { type ImageProps } from 'next/image';
import { ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils';

type SafeImageProps = Omit<ImageProps, 'onError'> & {
    /** Clases aplicadas al bloque de reserva (no a la imagen). */
    fallbackClassName?: string;
    /** Icono mostrado en el bloque de reserva. */
    fallbackIcon?: React.ReactNode;
};

/**
 * `next/image` que degrada a un bloque de marca en lugar de dejar el icono de
 * imagen rota del navegador.
 *
 * Las imágenes públicas viven en `public/images/**`, pero el logo de empresa y
 * los adjuntos llegan de fuentes remotas que pueden caerse — este componente
 * evita que un 404/402 rompa el diseño de la página.
 */
export function SafeImage({
    className,
    fallbackClassName,
    fallbackIcon,
    alt,
    ...props
}: SafeImageProps) {
    const [failed, setFailed] = React.useState(false);

    // Si cambia el src (navegación entre servicios) hay que reintentar.
    React.useEffect(() => {
        setFailed(false);
    }, [props.src]);

    if (failed) {
        return (
            <div
                role="img"
                aria-label={alt}
                className={cn(
                    'flex items-center justify-center bg-gradient-to-br from-muted via-muted/60 to-background',
                    props.fill ? 'absolute inset-0' : 'h-full w-full',
                    className,
                    fallbackClassName
                )}
            >
                {fallbackIcon ?? <ImageOff className="h-8 w-8 text-muted-foreground/40" />}
            </div>
        );
    }

    return (
        <Image
            {...props}
            alt={alt}
            className={className}
            onError={() => setFailed(true)}
        />
    );
}
