import { requireSession } from '@/lib/auth';
import { send, snapshotFor } from '@/lib/notify';
import { DISCORD_WEBHOOK, getSettings, PUSHBULLET_TOKEN } from '@/lib/settings';

export const dynamic = 'force-dynamic';

// Sends a test notification before saving. Empty fields use the saved token / webhook.
export async function POST(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;
  const b = await req.json().catch(() => ({}));
  const saved = getSettings().notify;
  const pushbullet = String(b.pushbullet ?? '').trim() || saved?.pushbullet;
  const discord = String(b.discord ?? '').trim() || saved?.discord;

  const results = [];
  if (pushbullet && !PUSHBULLET_TOKEN.test(pushbullet)) results.push({ service: 'Pushbullet', ok: false, message: 'That doesn\'t look like an access token' });
  if (discord && !DISCORD_WEBHOOK.test(discord)) results.push({ service: 'Discord', ok: false, message: 'URL must look like https://discord.com/api/webhooks/…' });
  if (results.length) return Response.json({ ok: false, results });
  if (!pushbullet && !discord) return Response.json({ ok: false, results: [{ service: 'Notifications', ok: false, message: 'Enter a Pushbullet token or a Discord webhook URL' }] });

  const image = await snapshotFor({ snapshot: !!b.snapshot, camera: String(b.camera ?? '') || undefined });
  const sent = await send({
    title: '🔔 Test notification',
    lines: ['Notifications from your Bambu Dashboard work.', b.snapshot && !image ? 'No camera image available right now.' : ''].filter(Boolean),
    color: 0x3b82f6,
    image,
  }, { pushbullet, discord });
  return Response.json({ ok: sent.every((r) => r.ok), results: sent });
}
