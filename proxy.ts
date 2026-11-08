// Runs before every request (Next.js 16 "proxy", formerly middleware; Node.js runtime).
// Everything requires a login except the login page and the login/setup endpoints.
//
// /api/upload/* is excluded from the matcher on purpose: when a proxy runs, Next.js buffers the
// request body in memory (and cuts it off at 10 MB), which breaks large model uploads. That route
// does the same login and origin checks itself and streams the file straight to disk.
import { NextResponse, type NextRequest } from 'next/server';
import { isSameOrigin, SESSION_COOKIE, verifySessionToken } from './lib/auth';

const PUBLIC_PATHS = new Set(['/login', '/api/auth/login', '/api/auth/setup']);

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false, error: 'Cross-origin request blocked' }, { status: 403 });
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
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/upload/).*)'],
};
