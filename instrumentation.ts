// Connect to the printer as soon as the server starts, so temperatures, print history,
// print hours, energy, filament, project counting, notifications and AFFiNE pages work even when no browser is open.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getPrinter } = await import('./lib/printer');
    const { initProjects } = await import('./lib/projects');
    const { initHomeAssistant } = await import('./lib/homeassistant');
    const { initNotifications } = await import('./lib/notify');
    const { initFilament } = await import('./lib/filament');
    const { initAffine } = await import('./lib/affine-sync');
    const { cleanRestoreLeftovers } = await import('./lib/backup');
    cleanRestoreLeftovers();
    const p = getPrinter();
    initProjects();
    initHomeAssistant();
    initNotifications();
    initFilament();
    initAffine();
    console.log(p.demo
      ? '[bambu] Demo mode (fake data). Fill in .env or config.json to connect to your printer.'
      : `[bambu] Connecting to ${p.info.name} (${p.info.model}) at ${p.config!.printerIp}`);
  }
}
