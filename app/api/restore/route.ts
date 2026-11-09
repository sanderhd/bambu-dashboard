// Restore a backup ZIP. Like /api/upload, this route is not behind proxy.ts (which would buffer
// the body in memory and cut it off at 10 MB), so it checks login and origin itself and streams
// the upload straight to disk.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { once } from 'events';
import { isSameOrigin, requireSession } from '@/lib/auth';
import { restoreBackup } from '@/lib/backup';
import { UserError } from '@/lib/projects';

export const dynamic = 'force-dynamic';
const MAX_BYTES = 50 * 1024 * 1024 * 1024; // 50 GB: projects with many model files

const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status });

// POST /api/restore   body: the backup ZIP
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return fail(403, 'Cross-origin request blocked');
  const denied = requireSession(req);
  if (denied) return denied;
  if (!req.body) return fail(400, 'Empty upload');

  const dir = path.join(process.cwd(), 'data');
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.restore-upload-${crypto.randomBytes(6).toString('hex')}.zip`);
  const out = fs.createWriteStream(tmp);
  try {
    let size = 0;
    for await (const chunk of req.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > MAX_BYTES) throw new UserError('Backup is too large', 413);
      if (!out.write(chunk)) await once(out, 'drain');
    }
    out.end();
    await once(out, 'finish');
    if (!size) throw new UserError('Empty upload');
    const result = await restoreBackup(tmp); // removes tmp when done
    return Response.json({ ok: true, ...result });
  } catch (e) {
    out.destroy();
    fs.rmSync(tmp, { force: true });
    const status = e instanceof UserError ? e.status : 500;
    if (status === 500) console.error('[restore]', e);
    return fail(status, status === 500 ? 'Restore failed: ' + (e as Error).message : (e as Error).message);
  }
}
