import fs from 'fs';
import { Readable } from 'stream';
import { handle } from '@/lib/api';
import { getPart, partFilePath, UserError } from '@/lib/projects';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string; partId: string }> };

const TYPES: Record<string, string> = { stl: 'model/stl', '3mf': 'model/3mf', obj: 'model/obj', step: 'model/step', gcode: 'text/x-gcode' };

// Streams the model file from disk. ?download=1 saves it instead of opening it.
export const GET = (req: Request, { params }: Ctx) =>
  handle(req, async () => {
    const { id, partId } = await params;
    const { part } = getPart(id, partId);
    if (!part.file) throw new UserError('This part has no file', 404);
    const file = partFilePath(id, part);
    if (!fs.existsSync(file)) throw new UserError('File missing on disk', 404);
    const download = new URL(req.url).searchParams.has('download');
    const encoded = encodeURIComponent(part.file.name);
    return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, {
      headers: {
        'Content-Type': TYPES[part.file.kind] ?? 'application/octet-stream',
        'Content-Length': String(fs.statSync(file).size),
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encoded}`,
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });
