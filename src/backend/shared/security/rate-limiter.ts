import 'server-only';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/backend/shared/infrastructure/firebase/admin-app';

/**
 * Rate limiter con sliding window basado en Firestore.
 *
 * Usa una colección `rate_limits/{key}` donde key = `${action}:${identity}`.
 * Mantiene un array de timestamps recientes y rechaza si en la ventana hay
 * más de `max` eventos.
 *
 * Trade-offs vs Upstash Redis:
 *  - Latencia ~50-100ms vs ~5-10ms.
 *  - Costo: 1 read + 1 write por intento (Firestore es barato pero no gratis).
 *  - Cuando el volumen pase de ~100 req/s sostenidas conviene migrar a Upstash.
 *
 * No es 100% atómico (race condition en alta concurrencia, ~milésimas) pero
 * es suficiente para el caso público — defensa en profundidad, no la única
 * barrera.
 */

initFirebaseAdminApp();

export interface RateLimitConfig {
    /** Máximo de eventos permitidos en la ventana. */
    max: number;
    /** Duración de la ventana en milisegundos. */
    windowMs: number;
}

export interface RateLimitResult {
    allowed: boolean;
    remaining: number;
    /** Segundos hasta que el primer slot quede libre, si está bloqueado. */
    retryAfterSeconds: number;
}

/**
 * Configuraciones por defecto para acciones públicas.
 */
export const RATE_LIMITS = {
    /** Mensaje en el chat público. Por IP. */
    publicChatMessage: { max: 30, windowMs: 15 * 60 * 1000 } satisfies RateLimitConfig, // 30 / 15min
    /** Solicitud de OTP. Por email. Más restrictivo. */
    leadOtpRequest: { max: 5, windowMs: 60 * 60 * 1000 } satisfies RateLimitConfig, // 5 / hora
    /** Submit de formulario de presupuesto. Por IP. */
    leadIntakeSubmit: { max: 10, windowMs: 60 * 60 * 1000 } satisfies RateLimitConfig, // 10 / hora
} as const;

/**
 * Comprueba si una acción está permitida y registra el evento si lo está.
 * Devuelve `allowed: false` si se excedió el límite.
 */
export async function checkRateLimit(
    action: string,
    identity: string,
    config: RateLimitConfig
): Promise<RateLimitResult> {
    if (!identity) {
        // Sin identidad no podemos rate-limitar — permitimos pero logueamos.
        console.warn(`[RateLimiter] Acción '${action}' sin identity — permitiendo`);
        return { allowed: true, remaining: config.max, retryAfterSeconds: 0 };
    }

    const db = getFirestore();
    const key = `${action}:${sanitizeKey(identity)}`;
    const docRef = db.collection('rate_limits').doc(key);
    const now = Date.now();
    const windowStart = now - config.windowMs;

    try {
        const result = await db.runTransaction(async tx => {
            const snap = await tx.get(docRef);
            const existing: number[] = (snap.exists ? snap.data()?.timestamps : []) || [];
            // Eliminar timestamps fuera de la ventana
            const recent = existing.filter((t: number) => t > windowStart);

            if (recent.length >= config.max) {
                const oldest = recent[0];
                const retryAfterSeconds = Math.max(1, Math.ceil((oldest + config.windowMs - now) / 1000));
                return {
                    allowed: false,
                    remaining: 0,
                    retryAfterSeconds,
                } satisfies RateLimitResult;
            }

            const newTimestamps = [...recent, now];
            tx.set(docRef, {
                timestamps: newTimestamps,
                updatedAt: FieldValue.serverTimestamp(),
                action,
                identity: sanitizeKey(identity),
            });

            return {
                allowed: true,
                remaining: config.max - newTimestamps.length,
                retryAfterSeconds: 0,
            } satisfies RateLimitResult;
        });

        return result;
    } catch (err) {
        // Si Firestore falla, fail-open (permitimos) y logueamos. No queremos
        // que un fallo del rate-limiter rompa el flujo entero.
        console.error('[RateLimiter] Firestore error, fail-open:', err);
        return { allowed: true, remaining: 0, retryAfterSeconds: 0 };
    }
}

function sanitizeKey(s: string): string {
    return s.replace(/[\/\.\#\$\[\]]/g, '_').slice(0, 200);
}
