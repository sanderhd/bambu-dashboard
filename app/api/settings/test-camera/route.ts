import { requireSession } from '@/lib/auth';
import { probeCameraUrl } from '@/lib/cameras';

export const dynamic = 'force-dynamic';

// Checks a camera URL from the server's point of view (that's where the stream is fetched from).
export async function POST(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { url } = await req.json().catch(() => ({}));
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error();
  } catch {
    return Response.json({ ok: false, message: 'Enter a URL starting with http:// or https://' }, { status: 400 });
  }
  return Response.json(await probeCameraUrl(String(url)));
}
