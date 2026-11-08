// Runs before every request (Next.js 16 "proxy", formerly middleware; Node.js runtime).
// Everything requires a login except the login page and the login/setup endpoints.
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from './lib/auth';

const PUBLIC_PATHS = new Set(['/login', '/api/auth/login', '/api/auth/setup']);

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // CSRF protection: state-changing requests must come from the dashboard itself.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.get('origin');
    if (origin) {
      let originHost = '';
      try { originHost = new URL(origin).host; } catch { /* invalid origin */ }
      if (originHost !== req.headers.get('host')) {
        return NextResponse.json({ ok: false, error: 'Cross-origin request blocked' }, { status: 403 });
      }
    }
  }

  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
  if (verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ ok: false, error: 'Not logged in' }, { status: 401 });
  }
  // nextUrl carries the host the browser used, so this also works behind Docker.
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
