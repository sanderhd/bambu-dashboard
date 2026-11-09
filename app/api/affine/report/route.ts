import { body, handle } from '@/lib/api';
import { createReport } from '@/lib/affine-sync';

export const dynamic = 'force-dynamic';

// Creates a report page in AFFiNE from content built in the browser.
export const POST = (req: Request) => handle(req, async () => createReport(await body(req)));
