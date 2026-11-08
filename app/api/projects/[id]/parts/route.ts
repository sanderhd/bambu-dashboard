import { body, handle } from '@/lib/api';
import { createPart } from '@/lib/projects';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

// A part without a file (e.g. something you print from Bambu Studio or MakerWorld directly).
export const POST = (req: Request, { params }: Ctx) =>
  handle(req, async () => ({ part: createPart((await params).id, await body(req)) }));
