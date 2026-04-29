import 'server-only';
import { headers } from 'next/headers';
import { createHash } from 'crypto';

/**
 * Devuelve un identificador estable del cliente para rate-limiting.
 *
 * En Vercel el header `x-forwarded-for` contiene la IP real (primer valor de
 * la lista). En local viene `::1` / `127.0.0.1`. Combinamos con un hash del
 * User-Agent para reducir colisiones entre clientes detrás del mismo NAT.
 */
export async function getClientIdentity(): Promise<string> {
    try {
        const h = await headers();
        const xff = h.get('x-forwarded-for') || '';
        const realIp = h.get('x-real-ip') || '';
        const ip = (xff.split(',')[0] || realIp || 'unknown').trim();
        const ua = h.get('user-agent') || 'unknown';
        const uaHash = createHash('sha256').update(ua).digest('hex').slice(0, 8);
        return `${ip}_${uaHash}`;
    } catch {
        return 'unknown_unknown';
    }
}
