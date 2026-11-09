import { Readable } from 'stream';
import { requireSession } from '@/lib/auth';
import { backupFileName, backupStream } from '@/lib/backup';

export const dynamic = 'force-dynamic';

// GET /api/backup: downloads everything in data/ (except the password) as one ZIP, streamed.
export async function GET(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;
  const stream = Readable.toWeb(Readable.from(backupStream())) as ReadableStream<Uint8Array>;
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${backupFileName()}"`,
      'Cache-Control': 'no-store',
    },
  });
}
