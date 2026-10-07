import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { routing } from './i18n/routing';
import { PATHNAME_HEADER } from './backend/auth/roles';

const handleI18nRouting = createMiddleware(routing);

// `/signup` ya no existe (alta solo por invitación). Los enlaces enviados
// antes del cambio (`/signup?invite=<token>`) se redirigen a la ruta nueva;
// sin `invite`, la petición sigue su curso y acaba en 404.
const LEGACY_SIGNUP_PATH = new RegExp(`^/(?:(${routing.locales.join('|')})/)?signup/?$`);

const DASHBOARD_PATH = new RegExp(`^/(?:(${routing.locales.join('|')})/)?dashboard(?:/|$)`);

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const legacySignup = LEGACY_SIGNUP_PATH.exec(pathname);
  const legacyInvite = request.nextUrl.searchParams.get('invite');
  if (legacySignup && legacyInvite && /^[A-Za-z0-9_-]{43}$/.test(legacyInvite)) {
    const locale = legacySignup[1] || routing.defaultLocale;
    const inviteUrl = request.nextUrl.clone();
    inviteUrl.pathname = `/${locale}/invitacion/${legacyInvite}`;
    inviteUrl.search = '';
    return NextResponse.redirect(inviteUrl);
  }

  // Chequeo barato: sin cookie `session` no se entra al panel. NO verifica la
  // firma (edge runtime, sin admin SDK); la verificación real está en
  // src/app/[locale]/dashboard/layout.tsx con verifyAuth().
  const dashboardMatch = DASHBOARD_PATH.exec(pathname);
  if (dashboardMatch && !request.cookies.get('session')?.value) {
    const locale = dashboardMatch[1] || routing.defaultLocale;
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = `/${locale}/login`;
    loginUrl.search = '';
    return NextResponse.redirect(loginUrl);
  }

  // Pasamos el pathname al árbol de server components (los layouts no lo
  // reciben). Se sobreescribe siempre para que el cliente no pueda inyectarlo.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(PATHNAME_HEADER, pathname);
  const forwarded = new NextRequest(request.url, {
    headers: requestHeaders,
    method: request.method,
  });

  return handleI18nRouting(forwarded);
}

export const config = {
  // Match all pathnames except for
  // - … if they start with `/api`, `/_next` or `/_vercel`
  // - … the ones containing a dot (e.g. `favicon.ico`)
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)']
};
