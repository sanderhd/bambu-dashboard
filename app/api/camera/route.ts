import { getPrinter } from '@/lib/printer';

export const dynamic = 'force-dynamic';

// MJPEG stream: works directly in an <img src="/api/camera">.
export async function GET(req: Request) {
  const printer = getPrinter();
  const reason = printer.cameraUnavailableReason();
  if (reason) return new Response(reason, { status: 503 });

  const enc = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const push = (jpg: Buffer) => {
        try {
          controller.enqueue(enc.encode(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpg.length}\r\n\r\n`));
          controller.enqueue(new Uint8Array(jpg));
          controller.enqueue(enc.encode('\r\n'));
        } catch { stop(); }
      };
      if (printer.lastFrame) push(printer.lastFrame);
      const unwatch = printer.watchCamera(push);
      let stopped = false;
      stop = () => { if (!stopped) { stopped = true; unwatch(); } };
      req.signal.addEventListener('abort', () => { stop(); try { controller.close(); } catch {} });
    },
    cancel() { stop(); },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'multipart/x-mixed-replace; boundary=frame', 'Cache-Control': 'no-cache, no-store' },
  });
}
