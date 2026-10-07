import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isWellFormedInvitationToken } from '@/backend/auth/invitation-token';
import InvitationClient from './invitation-client';

/**
 * Aceptación de invitación. Es la ÚNICA vía de alta en la plataforma: no hay
 * página de registro pública. Un token mal formado da 404 para no revelar
 * que la ruta existe; la validez real (hash, caducidad, uso) la comprueba
 * `getInvitationPreviewAction` en servidor.
 */
export const metadata: Metadata = {
    title: 'Invitación',
    robots: { index: false, follow: false },
    // El token va en la URL: que no se filtre en el Referer a terceros.
    referrer: 'no-referrer',
};

export default async function InvitationPage({
    params,
}: {
    params: Promise<{ locale: string; token: string }>;
}) {
    const { locale, token } = await params;
    if (!isWellFormedInvitationToken(token)) notFound();
    return <InvitationClient locale={locale} token={token} />;
}
