import { body, handle } from '@/lib/api';
import { createProject, listProjects } from '@/lib/projects';

export const dynamic = 'force-dynamic';

export const GET = (req: Request) => handle(req, () => ({ projects: listProjects() }));

export const POST = (req: Request) => handle(req, async () => ({ project: createProject(await body(req)) }));
