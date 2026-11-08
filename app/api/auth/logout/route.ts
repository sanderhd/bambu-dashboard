import { requireSession, rotateSecret, sessionCookie } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// { everywhere: true } also logs out every other browser and device.
export async function POST(req: Request) {
  const { everywhere } = await req.json().catch(() => ({}));
  if (everywhere) {
    const denied = requireSession(req);
    if (denied) return denied;
    rotateSecret();
  }
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie(req, null) } });
}
