import { AffineError } from '@/lib/affine';
import { testConnection } from '@/lib/affine-sync';
import { requireSession } from '@/lib/auth';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

// Signs in with the details from the form (an empty password uses the saved one) and lists the workspaces.
export async function POST(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;
  const b = await req.json().catch(() => ({}));
  const saved = getSettings().affine;
  const url = String(b.url ?? '').trim().replace(/\/+$/, '');
  const email = String(b.email ?? '').trim();
  const same = saved && saved.url === url && saved.email.toLowerCase() === email.toLowerCase();
  const password = String(b.password ?? '') || (same ? saved.password : '');
  try {
    if (!/^https?:\/\/[^/]+/.test(url)) throw new AffineError('Enter the AFFiNE URL, e.g. http://192.168.178.10:3010');
    if (!email || !password) throw new AffineError('Enter the email and password of the AFFiNE account');
    return Response.json({ ok: true, ...(await testConnection({ url, email, password })) });
  } catch (e) {
    if (!(e instanceof AffineError)) console.error('[affine] test failed:', e);
    return Response.json({ ok: false, error: e instanceof AffineError ? e.message : 'Unexpected error, see the server log' });
  }
}
