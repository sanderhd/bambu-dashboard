import { createSessionToken, isConfigured, sessionCookie, setPassword } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// First run only: choose the dashboard password. Refused once a password exists.
export async function POST(req: Request) {
  if (isConfigured()) return Response.json({ ok: false, error: 'A password is already set' }, { status: 409 });
  const { password } = await req.json().catch(() => ({}));
  try {
    await setPassword(String(password ?? ''));
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie(req, createSessionToken()) } });
}
