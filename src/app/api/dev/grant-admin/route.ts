/**
 * TEMP DEV ENDPOINT — grants admin custom claim to a user by email.
 *
 * Wraps the existing setAdminClaim() helper in an HTTP-callable surface so the
 * operator can promote themselves without standing up a Service Account JSON
 * for `scripts/set-admin.js`. Protected by ADMIN_SECRET (defaults to the dev
 * fallback string already encoded in fix-account.action.ts).
 *
 * Usage (local dev):
 *   GET /api/dev/grant-admin?email=you@example.com&secret=grupo-rg-admin-dev-secret
 *
 * Returns the result of setAdminClaim. After success the user must logout +
 * login again so the AuthContext re-fetches an ID Token with the new claim.
 *
 * DELETE THIS FILE once auth is sorted out (or move the secret to a hardened
 * value in env). This endpoint MUST NOT ship to production unprotected.
 */

import { setAdminClaim } from '@/actions/debug/fix-account.action';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
    const url = new URL(request.url);
    const email = url.searchParams.get('email');
    const secret = url.searchParams.get('secret');

    if (!email || !secret) {
        return NextResponse.json(
            { error: 'email and secret query params are required' },
            { status: 400 },
        );
    }

    const result = await setAdminClaim(email, secret);
    return NextResponse.json(result);
}
