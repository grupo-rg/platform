/**
 * Server-side session cookie management.
 *
 * The app uses Firebase Auth client SDK to authenticate users in the browser.
 * Server-side code (Server Actions, Server Components) needs a way to identify
 * the user — for that we exchange the client's short-lived ID Token for a
 * long-lived session cookie that Firebase Admin SDK can verify.
 *
 * - POST {idToken}: create a 5-day session cookie. Called by AuthContext right
 *   after Firebase client signs the user in.
 * - DELETE: clear the cookie. Called on signOut so server-side guards stop
 *   recognising the user immediately.
 *
 * Without this endpoint, every server action calling verifyAuth() returns null
 * because cookies().get('session') is undefined.
 */

import { adminAuth } from '@/backend/shared/infrastructure/firebase/admin-app';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const SESSION_COOKIE_NAME = 'session';
// Firebase max session cookie lifetime is 14 days. We use 5 days as a balance
// between user convenience and revocation latency.
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 5;

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const idToken = typeof body.idToken === 'string' ? body.idToken : null;

        if (!idToken) {
            return NextResponse.json({ error: 'idToken required' }, { status: 400 });
        }

        const sessionCookie = await adminAuth.createSessionCookie(idToken, {
            expiresIn: SESSION_MAX_AGE_SECONDS * 1000,
        });

        const cookieStore = await cookies();
        cookieStore.set(SESSION_COOKIE_NAME, sessionCookie, {
            maxAge: SESSION_MAX_AGE_SECONDS,
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
        });

        return NextResponse.json({ ok: true });
    } catch (error: any) {
        console.error('[api/auth/session][POST] failed:', error?.code, error?.message);
        return NextResponse.json(
            { error: error?.message || 'failed to create session cookie' },
            { status: 401 },
        );
    }
}

export async function DELETE() {
    const cookieStore = await cookies();
    cookieStore.delete(SESSION_COOKIE_NAME);
    return NextResponse.json({ ok: true });
}
