import { handle } from '@/lib/api';
import { status, syncAllNow } from '@/lib/affine-sync';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

// Whether AFFiNE is set up, so pages can show their "Send to AFFiNE" buttons.
export const GET = (req: Request) => handle(req, () => ({ configured: !!getSettings().affine, status: status() }));

export const POST = (req: Request) => handle(req, async () => ({ status: await syncAllNow() }));
