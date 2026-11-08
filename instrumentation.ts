// Connect to the printer as soon as the server starts, so temperatures and
// print history are recorded even when no browser is open.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getPrinter } = await import('./lib/printer');
    const p = getPrinter();
    console.log(p.demo
      ? '[bambu] Demo mode (fake data). Fill in .env or config.json to connect to your printer.'
      : `[bambu] Connecting to ${p.info.name} (${p.info.model}) at ${p.config!.printerIp}`);
  }
}
