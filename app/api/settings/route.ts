import { requireSession } from '@/lib/auth';
import { getPrinter } from '@/lib/printer';
import { getSettings, saveSettings, validateCameras } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;
  const p = getPrinter();
  const serial = p.config?.serial ?? '';
  return Response.json({
    ...getSettings(),
    printer: {
      ...p.info,
      demo: p.demo,
      ip: p.config?.printerIp ?? null,
      serial: serial ? `${serial.slice(0, 3)}••••••${serial.slice(-3)}` : null,
      connection: p.connection,
    },
  });
}

export async function PUT(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;
  try {
    const body = await req.json();
    const cameras = validateCameras(body.cameras);
    const ids = new Set(['printer', ...cameras.map((c) => c.id)]);
    const defaultCamera = typeof body.defaultCamera === 'string' && ids.has(body.defaultCamera) ? body.defaultCamera : undefined;
    return Response.json({ ok: true, ...saveSettings({ cameras, defaultCamera }) });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
