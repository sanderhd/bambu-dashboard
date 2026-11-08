import { requireSession } from '@/lib/auth';
import { getCameraHub } from '@/lib/cameras';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { id } = await params;
  const src = getCameraHub().get(id);
  if (!src) return Response.json({ ok: false, error: 'Unknown camera' }, { status: 404 });
  const error = src.unavailableReason() ?? src.error;
  return Response.json({ ok: !error, error, lastFrameAt: src.lastFrameAt || null });
}
