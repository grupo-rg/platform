'use client';

/**
 * Perf (LCP/TBT): usa `m` + `LazyMotion` en lugar de `motion.*`.
 *
 * `motion.div` empaqueta TODO el runtime de framer-motion de forma *eager* en el
 * bundle inicial (parte de los ~253 KiB de JS sin usar + TBT alto en móvil). Los
 * componentes `m.*` son ligeros y `LazyMotion` carga el motor de animación de
 * forma *diferida* (chunk aparte, tras la hidratación) → mismas animaciones,
 * mucho menos JS inicial.
 *
 * Uso: envuelve el árbol animado de cada sección en <MotionProvider> y sustituye
 * `motion.X` por `m.X` (importando `m` de aquí). Se pueden tener varias instancias
 * de <MotionProvider> (una por sección): framer cachea las features, no se
 * recargan. `domMax` incluye animaciones + layout + gestos (equivalente a
 * `motion.*`), así que no rompe ninguna animación existente.
 */

import { LazyMotion, domMax, m } from 'framer-motion';
import type { ReactNode } from 'react';

export { m };

export function MotionProvider({ children }: { children: ReactNode }) {
    return <LazyMotion features={domMax}>{children}</LazyMotion>;
}
