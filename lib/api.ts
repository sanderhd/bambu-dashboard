// Small helpers shared by the project API routes.
import 'server-only';
import { requireSession } from './auth';
import { AffineError } from './affine';
import { UserError } from './projects';

/** Runs a route body with a login check and turns thrown errors into JSON responses. */
export async function handle(req: Request, fn: () => unknown | Promise<unknown>): Promise<Response> {
  const denied = requireSession(req);
  if (denied) return denied;
  try {
    const result = await fn();
    return result instanceof Response ? result : Response.json({ ok: true, ...(result as object) });
  } catch (e) {
    // AFFiNE problems (unreachable, wrong password) are shown as they are.
    const status = e instanceof UserError ? e.status : e instanceof AffineError ? 502 : 500;
    if (status === 500) console.error('[api]', e);
    return Response.json({ ok: false, error: status === 500 ? 'Server error' : (e as Error).message }, { status });
  }
}

export const body = async (req: Request): Promise<Record<string, unknown>> => {
  try {
    const b = await req.json();
    return b && typeof b === 'object' ? b : {};
  } catch {
    throw new UserError('Invalid JSON');
  }
};
