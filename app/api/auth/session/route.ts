import { isLoggedIn } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return isLoggedIn(req) ? Response.json({ ok: true }) : Response.json({ ok: false }, { status: 401 });
}
