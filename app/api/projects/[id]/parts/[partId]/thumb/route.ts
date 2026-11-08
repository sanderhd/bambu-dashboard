import fs from 'fs';
import { handle } from '@/lib/api';
import { getPart, MAX_THUMB_BYTES, setThumbnail, thumbPath, UserError } from '@/lib/projects';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string; partId: string }> };

export const GET = (req: Request, { params }: Ctx) =>
  handle(req, async () => {
    const { id, partId } = await params;
    const { part } = getPart(id, partId);
    const file = thumbPath(id, part);
    if (!part.thumbnail || !fs.existsSync(file)) throw new UserError('No preview', 404);
    // URLs carry ?v=<version>, so the image can be cached for a long time.
    return new Response(fs.readFileSync(file), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' },
    });
  });

// The browser renders STL previews and uploads them here as a PNG.
export const POST = (req: Request, { params }: Ctx) =>
  handle(req, async () => {
    const { id, partId } = await params;
    if (Number(req.headers.get('content-length') ?? 0) > MAX_THUMB_BYTES) throw new UserError('Image is too large', 413);
    const png = Buffer.from(await req.arrayBuffer());
    return { part: setThumbnail(id, partId, png) };
  });
