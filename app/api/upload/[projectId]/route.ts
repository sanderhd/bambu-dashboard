// Model upload. Not behind proxy.ts (see the note there), so this route checks login and
// origin itself, and streams the body to disk in chunks: a 200 MB STL never sits in memory.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { once } from 'events';
import { isSameOrigin, requireSession } from '@/lib/auth';
import { attachFile, fileKind, getProject, MAX_UPLOAD_BYTES, projectDir, safeFileName, UserError } from '@/lib/projects';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ projectId: string }> };

const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status });

// POST /api/upload/<projectId>[?part=<partId>]   headers: X-File-Name   body: the raw file
export async function POST(req: Request, { params }: Ctx) {
  if (!isSameOrigin(req)) return fail(403, 'Cross-origin request blocked');
  const denied = requireSession(req);
  if (denied) return denied;

  const { projectId } = await params;
  const partId = new URL(req.url).searchParams.get('part');
  let name: string;
  try { name = safeFileName(decodeURIComponent(req.headers.get('x-file-name') ?? '')); } catch { return fail(400, 'Bad file name'); }
  if (!fileKind(name)) return fail(400, 'Only STL, 3MF, OBJ, STEP and G-code files are supported');
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_UPLOAD_BYTES) return fail(413, `File is too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB)`);
  if (!req.body) return fail(400, 'Empty upload');

  try { getProject(projectId); } catch (e) { return fail((e as UserError).status ?? 404, (e as Error).message); }

  const dir = projectDir(projectId);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.upload-${crypto.randomBytes(6).toString('hex')}`);
  const out = fs.createWriteStream(tmp);
  let size = 0;
  try {
    for await (const chunk of req.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) throw new UserError(`File is too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB)`, 413);
      if (!out.write(chunk)) await once(out, 'drain');
    }
    out.end();
    await once(out, 'finish');
    if (!size) throw new UserError('Empty upload');
    const part = attachFile(projectId, partId, name, tmp, size);
    return Response.json({ ok: true, part });
  } catch (e) {
    out.destroy();
    fs.rmSync(tmp, { force: true });
    const status = e instanceof UserError ? e.status : 500;
    if (status === 500) console.error('[upload]', e);
    return fail(status, status === 500 ? 'Upload failed' : (e as Error).message);
  }
}
