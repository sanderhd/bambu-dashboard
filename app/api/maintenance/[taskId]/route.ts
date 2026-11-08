import { body, handle } from '@/lib/api';
import { deleteTask, listTasks, markDone, updateTask } from '@/lib/maintenance';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ taskId: string }> };

// { done: true } marks the task as done now; otherwise the body holds the fields to change.
export const PATCH = (req: Request, { params }: Ctx) =>
  handle(req, async () => {
    const { taskId } = await params;
    const b = await body(req);
    if (b.done) markDone(taskId); else updateTask(taskId, b);
    return { tasks: listTasks() };
  });

export const DELETE = (req: Request, { params }: Ctx) =>
  handle(req, async () => {
    deleteTask((await params).taskId);
    return { tasks: listTasks() };
  });
