import { body, handle } from '@/lib/api';
import { deleteProject, getProject, updateProject } from '@/lib/projects';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export const GET = (req: Request, { params }: Ctx) =>
  handle(req, async () => ({ project: getProject((await params).id) }));

export const PATCH = (req: Request, { params }: Ctx) =>
  handle(req, async () => ({ project: updateProject((await params).id, await body(req)) }));

export const DELETE = (req: Request, { params }: Ctx) =>
  handle(req, async () => { deleteProject((await params).id); return {}; });
