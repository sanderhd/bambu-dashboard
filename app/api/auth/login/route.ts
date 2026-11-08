import { createSessionToken, isConfigured, sessionCookie, verifyPassword } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Brute-force protection, two layers:
// - per client: after 5 wrong passwords, wait 30 s, doubling up to 15 min;
// - for everyone together: after 50 wrong passwords within 15 min, pause logins for 5 min.
// The per-client key comes from X-Real-IP (set by Nginx Proxy Manager / nginx). It can be faked
// by someone who reaches the dashboard directly, which is why the shared limit exists.
type Fail = { count: number; until: number };
const g = globalThis as unknown as { __bambuLogin?: { perClient: Map<string, Fail>; recent: number[]; globalUntil: number } };
const st = (g.__bambuLogin ??= { perClient: new Map(), recent: [], globalUntil: 0 });

function clientKey(req: Request) {
  const real = req.headers.get('x-real-ip')?.trim();
  if (real) return real;
  const xff = req.headers.get('x-forwarded-for');
  return xff ? xff.split(',').pop()!.trim() : 'direct';
}

const wait = (until: number) => Response.json(
  { ok: false, error: `Too many attempts. Try again in ${Math.ceil((until - Date.now()) / 1000)} seconds.` }, { status: 429 },
);

export async function POST(req: Request) {
  if (!isConfigured()) return Response.json({ ok: false, error: 'No password set yet' }, { status: 409 });
  const now = Date.now();
  if (st.globalUntil > now) return wait(st.globalUntil);
  const key = clientKey(req);
  const f = st.perClient.get(key);
  if (f && f.until > now) return wait(f.until);

  const { password } = await req.json().catch(() => ({}));
  if (typeof password !== 'string' || !(await verifyPassword(password))) {
    const count = (f?.count ?? 0) + 1;
    st.perClient.set(key, { count, until: count >= 5 ? now + Math.min(15 * 60_000, 30_000 * 2 ** (count - 5)) : 0 });
    st.recent = [...st.recent.filter((t) => t > now - 15 * 60_000), now];
    if (st.recent.length >= 50) { st.globalUntil = now + 5 * 60_000; st.recent = []; }
    if (st.perClient.size > 10_000) st.perClient.clear(); // never grow without bound
    return Response.json({ ok: false, error: 'Wrong password' }, { status: 401 });
  }

  st.perClient.delete(key);
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie(req, createSessionToken()) } });
}
