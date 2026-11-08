import { body, handle } from '@/lib/api';
import { addTask, listTasks, restoreDefaults, totalPrintHours } from '@/lib/maintenance';

export const dynamic = 'force-dynamic';

export const GET = (req: Request) => handle(req, () => ({ tasks: listTasks(), totalPrintHours: totalPrintHours() }));

// { restoreDefaults: true } re-adds missing A1 starter tasks; otherwise the body is a new task.
export const POST = (req: Request) =>
  handle(req, async () => {
    const b = await body(req);
    if (b.restoreDefaults) restoreDefaults(); else addTask(b);
    return { tasks: listTasks() };
  });
