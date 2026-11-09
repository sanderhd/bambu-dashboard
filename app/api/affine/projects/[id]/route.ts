import { handle } from '@/lib/api';
import { projectPage, syncProjectNow } from '@/lib/affine-sync';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

// The project's AFFiNE page and notes.
export const GET = (req: Request, { params }: Ctx) =>
  handle(req, async () => ({ page: await projectPage((await params).id) }));

// Creates or updates the page now.
export const POST = (req: Request, { params }: Ctx) =>
  handle(req, async () => ({ page: await syncProjectNow((await params).id) }));
