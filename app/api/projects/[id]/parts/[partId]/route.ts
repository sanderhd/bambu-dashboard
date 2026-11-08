import { body, handle } from '@/lib/api';
import { deletePart, updatePart } from '@/lib/projects';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string; partId: string }> };

// Body: any part fields, and/or { inc: { printed: 1 } } for relative changes.
export const PATCH = (req: Request, { params }: Ctx) =>
  handle(req, async () => {
    const { id, partId } = await params;
    return { part: updatePart(id, partId, await body(req)) };
  });

export const DELETE = (req: Request, { params }: Ctx) =>
  handle(req, async () => {
    const { id, partId } = await params;
    deletePart(id, partId);
    return {};
  });
