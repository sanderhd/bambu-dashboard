# Bambu Dashboard

A local web dashboard for Bambu Lab 3D printers, built with Next.js. It talks directly to your
printer over your own network (LAN), with no cloud involved.

Works with the **A1, A1 mini, P1P, P1S, X1, X1 Carbon, X1E and H2D**. Other Bambu printers that speak
the same LAN protocol will usually work too; they show up as "Bambu Lab printer".

## Features
- Progress, layer, time remaining, estimated finish time and current stage (e.g. "Auto bed leveling")
- Nozzle and bed temperature with a 30-minute chart, plus chamber temperature on printers that report it
- AMS and AMS lite: colour, type, temperature range and remaining filament per slot, the active slot,
  multiple AMS units (A1–D4), humidity and temperature for a full AMS, and the external spool
- Fans, Wi-Fi signal, nozzle type, SD card and firmware versions
- HMS alerts and print errors
- Live camera: the printer's own camera plus any USB webcam or IP camera, with a camera picker
- Password login (set on first visit) and a Settings page
- Print history, saved to `data/print-history.json`
- All raw printer data
- Controls: pause, resume, stop, light on/off and print speed

## Setup
1. On the printer, note the **IP address** and **Access Code** from the network/LAN settings,
   and the **serial number** from the device info.
2. Turn on **LAN mode**. On recent firmware, controls (pause, light, speed) also need **Developer Mode**.
   Monitoring usually works without it.
3. Copy `.env.example` to `.env` and fill in your details.
   (Alternatively, copy `config.example.json` to `config.json`. If both exist, `.env` wins.)
4. X1 and H2 printers only: install [ffmpeg](https://ffmpeg.org/download.html) and make sure it is on your
   PATH. These printers stream video over RTSP, which browsers can't play directly.

Tip: give the printer a fixed IP address in your router so the configuration stays valid.

## Login
On the first visit you choose a password. After that every page and API call requires a login
(sessions last 30 days). Change the password or log out every device under **Settings**.
Forgot the password? Delete `data/auth.json` on the server; the next visit asks for a new one.

The password is stored as a scrypt hash. Sessions are signed, HttpOnly cookies. After 5 wrong
attempts, logging in is paused (30 seconds, doubling up to 15 minutes).

## Cameras
- **Printer camera (A1, A1 mini, P1P, P1S):** on the printer, turn on **LAN Only Liveview** in the
  network settings. Without it the printer doesn't open its camera port (6000) and the dashboard
  shows that as an error.
- **Printer camera (X1, H2):** needs ffmpeg, see Setup.
- **USB webcam or IP camera:** add it under **Settings → Cameras** with a URL that serves an MJPEG
  stream or a JPEG snapshot, e.g. from picam, mjpg-streamer, ustreamer or motionEye
  (`http://<pi-ip>:8080/stream.mjpg`). Use **Test** to check it. The dashboard fetches the stream on
  the server, so camera URLs are never exposed to the browser.

Pick the camera with the dropdown on the dashboard. Your choice is remembered per browser; the
default for new browsers is set in Settings.

## Running
| Command                     | What it does                                       |
|-----------------------------|----------------------------------------------------|
| `npm run dev`               | Development server with hot reload                 |
| `npm run demo`              | Development server with fake data (no printer)     |
| `npm run build`, then `npm start` | Production build: faster and lighter        |

Then open http://localhost:3000, or `http://<your-computer's-ip>:3000` from your phone.
Without a `.env` or `config.json` the dashboard starts in demo mode.

## Running with Docker (e.g. on a Raspberry Pi)
The image is built and run entirely on the Docker host. It works on a Raspberry Pi 2B
(32-bit ARM, 1 GB RAM) as well as on 64-bit Pis and regular PCs.

1. **Install Docker on the Pi** (Raspberry Pi OS):
   ```sh
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker $USER   # then log out and back in
   docker compose version          # check that Compose is available
   ```
2. **Make sure the Pi has swap** (at least 1 GB); the build needs it on a 1 GB Pi. Check with `free -h`.
3. **Copy the project to the Pi**, without `node_modules` and `.next`. From this folder on your PC:
   ```sh
   tar --exclude=node_modules --exclude=.next --exclude=data -czf - . | ssh pi@raspberrypi.local "mkdir -p ~/bambu-dashboard && tar -xzf - -C ~/bambu-dashboard"
   ```
   This copies your `.env` too. If you don't have one on the Pi yet: `cp .env.example .env` and edit it.
4. **Build and start, on the Pi:**
   ```sh
   cd ~/bambu-dashboard
   docker compose up -d --build
   docker compose logs -f          # follow progress / see the "[bambu] Connecting…" line
   ```
   The first build is slow on a Pi 2B: there is no native compiler for 32-bit ARM, so Next.js
   falls back to a WebAssembly compiler. Later builds reuse the cached dependency layer.
5. Open `http://raspberrypi.local:3000` (or the Pi's IP address).

**Updating:** copy the project again (step 3), then run `docker compose up -d --build`.
The password, settings and print history live in the `bambu-data` Docker volume and survive rebuilds.

**Forgot the password (Docker):** `docker compose exec bambu-dashboard rm /app/data/auth.json`

**X1 / H2 printers:** set `INSTALL_FFMPEG: "true"` in `docker-compose.yml` for the camera. Converting
the RTSP stream is heavy work for a Pi 2B, so expect a low frame rate.

`.env`, `config.json` and `data/` are excluded from the image (`.dockerignore`); the container reads
`.env` at runtime through `env_file`.

## Project structure
```
app/
  page.tsx               dashboard page
  api/events/route.ts    live state (Server-Sent Events)
  api/command/route.ts   controls (only a fixed set of allowed actions)
  api/camera/[id]/       camera as an MJPEG stream (+ /status)
  api/cameras/           camera list for the dropdown
  api/auth/              login, first-run setup, logout, password change
  api/settings/          settings (cameras) and camera URL test
  login/, settings/      login and settings pages
components/              the dashboard cards, login form, settings view
hooks/usePrinter.ts      live data in the browser
lib/printer.ts           MQTT connection to the printer (server only)
lib/cameras.ts           camera sources: printer camera, MJPEG/snapshot URLs
lib/auth.ts              password hashing and signed session cookies
lib/settings.ts          settings stored in data/settings.json
lib/types.ts, format.ts  shared types and labels
proxy.ts                 requires a login for every page and API route
instrumentation.ts       connects to the printer when the server starts
```

The app keeps a persistent connection to the printer, so it has to run on your own computer or home
server (`next dev` or `next start`). It won't work on a serverless platform such as Vercel.
