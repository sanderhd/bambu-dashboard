import { requireSession } from '@/lib/auth';
import { getPrinter } from '@/lib/printer';

export const dynamic = 'force-dynamic';

// Server-Sent Events: a full snapshot first, then every update.
export async function GET(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;
  const printer = getPrinter();
  const enc = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try { controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { cleanup(); }
      };
      const onState = (d: unknown) => send('state', d);
      const onHistory = (d: unknown) => send('history', d);
      send('init', printer.snapshot());
      printer.on('state', onState);
      printer.on('history', onHistory);
      const ping = setInterval(() => { try { controller.enqueue(enc.encode(': ping\n\n')); } catch { cleanup(); } }, 25000);
      cleanup = () => {
        clearInterval(ping);
        printer.off('state', onState);
        printer.off('history', onHistory);
      };
      req.signal.addEventListener('abort', () => { cleanup(); try { controller.close(); } catch {} });
    },
    cancel() { cleanup(); },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  });
}
