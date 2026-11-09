import { requireSession } from '@/lib/auth';
import { totalPrintHours } from '@/lib/maintenance';
import { getPrinter } from '@/lib/printer';
import { status as affineStatus } from '@/lib/affine-sync';
import { getSettings, publicSettings, saveSettings, validateAffine, validateCameras, validateHa, validateNotify, validatePrintHours } from '@/lib/settings';
import { forgetSession } from '@/lib/affine';
import type { Settings } from '@/lib/types';

export const dynamic = 'force-dynamic';

function response() {
  const p = getPrinter();
  const serial = p.config?.serial ?? '';
  return {
    ...publicSettings(),
    affineStatus: affineStatus(),
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
    if ('notify' in body) patch.notify = validateNotify(body.notify);
    if ('affine' in body) {
      const old = getSettings().affine;
      patch.affine = validateAffine(body.affine);
      if (old && (old.email !== patch.affine?.email || old.password !== patch.affine?.password || old.url !== patch.affine?.url)) forgetSession(old);
    }
    if ('printHoursOffset' in body) patch.printHoursOffset = validatePrintHours(body.printHoursOffset);
    saveSettings(patch);
    return Response.json({ ok: true, ...response() });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
