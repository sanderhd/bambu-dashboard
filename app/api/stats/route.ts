import { requireSession } from '@/lib/auth';
import { totalPrintHours } from '@/lib/maintenance';
import { getPrinter } from '@/lib/printer';

export const dynamic = 'force-dynamic';

// Raw finished prints; the Stats page groups them per day/week/month in the browser.
export async function GET(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;
  const p = getPrinter();
  return Response.json({
    ok: true,
    jobs: p.printHistory,
    totalPrintHours: totalPrintHours(),
    power: p.power,
  });
}
