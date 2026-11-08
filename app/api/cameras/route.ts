import { requireSession } from '@/lib/auth';
import { getCameraHub } from '@/lib/cameras';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

// Cameras for the dashboard dropdown (no URLs; those stay on the server).
export async function GET(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;
  const cameras = getCameraHub().list();
  const def = getSettings().defaultCamera;
  return Response.json({ cameras, defaultCamera: cameras.some((c) => c.id === def) ? def : cameras[0]?.id ?? null });
}
