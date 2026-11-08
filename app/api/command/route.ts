import { requireSession } from '@/lib/auth';
import { getPrinter } from '@/lib/printer';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;
  try {
    const { action, value } = await req.json();
    getPrinter().command(String(action), value);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
