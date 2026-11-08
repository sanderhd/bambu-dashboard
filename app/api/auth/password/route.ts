import { createSessionToken, requireSession, sessionCookie, setPassword, verifyPassword } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Change the password. Logs out all other sessions; this browser gets a fresh session.
export async function POST(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { current, next } = await req.json().catch(() => ({}));
  if (typeof current !== 'string' || !(await verifyPassword(current))) {
    return Response.json({ ok: false, error: 'Current password is wrong' }, { status: 400 });
  }
  try {
    await setPassword(String(next ?? ''));
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie(req, createSessionToken()) } });
}
