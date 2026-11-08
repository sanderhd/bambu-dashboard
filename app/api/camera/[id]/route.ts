import { requireSession } from '@/lib/auth';
import { getCameraHub } from '@/lib/cameras';

export const dynamic = 'force-dynamic';

// MJPEG stream of one camera: works directly in an <img src="/api/camera/<id>">.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { id } = await params;
  const src = getCameraHub().get(id);
  if (!src) return new Response('Unknown camera', { status: 404 });
  const reason = src.unavailableReason();
  if (reason) return new Response(reason, { status: 503 });

  const enc = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream({
    start(controller) {
      let stopped = false;
      const push = (jpg: Buffer) => {
        try {
          controller.enqueue(enc.encode(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpg.length}\r\n\r\n`));
          controller.enqueue(new Uint8Array(jpg));
          controller.enqueue(enc.encode('\r\n'));
        } catch { stop(); }
      };
      // End the response on failure, so the browser's <img> fires its error event
      // and the dashboard can show why (via /api/camera/<id>/status).
      const fail = () => { stop(); try { controller.close(); } catch {} };
      const unwatch = src.watch(push, fail);
      stop = () => { if (!stopped) { stopped = true; unwatch(); } };
      if (src.lastFrame && Date.now() - src.lastFrameAt < 5000) push(src.lastFrame);
      req.signal.addEventListener('abort', fail);
    },
    cancel() { stop(); },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'multipart/x-mixed-replace; boundary=frame', 'Cache-Control': 'no-cache, no-store', 'X-Accel-Buffering': 'no' },
  });
}
