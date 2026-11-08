import { requireSession } from '@/lib/auth';
import { totalPrintHours } from '@/lib/maintenance';
import { getPrinter } from '@/lib/printer';
import { publicSettings, saveSettings, validateCameras, validateHa, validatePrintHours } from '@/lib/settings';
import type { Settings } from '@/lib/types';

export const dynamic = 'force-dynamic';

function response() {
  const p = getPrinter();
  const serial = p.config?.serial ?? '';
  return {
    ...publicSettings(),
    totalPrintHours: totalPrintHours(),
    countedPrintHours: Math.round(p.countedPrintHours * 10) / 10,
    printer: {
      ...p.info,
      demo: p.demo,
      ip: p.config?.printerIp ?? null,
      serial: serial ? `${serial.slice(0, 3)}••••••${serial.slice(-3)}` : null,
      connection: p.connection,
    },
  };
}

export async function GET(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;
  return Response.json(response());
}

// Only the keys present in the body are changed.
export async function PUT(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;
  try {
    const body = await req.json();
    const patch: Partial<Settings> = {};
    if ('cameras' in body) {
      patch.cameras = validateCameras(body.cameras);
      const ids = new Set(['printer', ...patch.cameras.map((c) => c.id)]);
      patch.defaultCamera = typeof body.defaultCamera === 'string' && ids.has(body.defaultCamera) ? body.defaultCamera : undefined;
    }
    if ('ha' in body) patch.ha = validateHa(body.ha);
    if ('printHoursOffset' in body) patch.printHoursOffset = validatePrintHours(body.printHoursOffset);
    saveSettings(patch);
    return Response.json({ ok: true, ...response() });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
