import { requireSession } from '@/lib/auth';
import { readEntity } from '@/lib/homeassistant';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

// Tests a Home Assistant URL + token + sensors before saving. An empty token uses the saved one.
export async function POST(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;
  const b = await req.json().catch(() => ({}));
  const url = String(b.url ?? '').trim().replace(/\/+$/, '');
  const token = String(b.token ?? '').trim() || getSettings().ha?.token;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error();
  } catch {
    return Response.json({ ok: false, results: [{ entity: 'URL', ok: false, message: 'Enter a URL starting with http:// or https://' }] });
  }
  if (!token) return Response.json({ ok: false, results: [{ entity: 'Token', ok: false, message: 'Enter a long-lived access token' }] });

  const results = [];
  for (const entity of [b.powerEntity, b.energyEntity].map((e) => String(e ?? '').trim()).filter(Boolean)) {
    try {
      const s = await readEntity({ url, token }, entity);
      results.push({ entity, ok: true, message: `${s.value} ${s.unit}`.trim() });
    } catch (e) {
      results.push({ entity, ok: false, message: (e as Error).message });
    }
  }
  return Response.json({ ok: results.length > 0 && results.every((r) => r.ok), results });
}
