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
- Projects: upload STL/3MF files, set how many of each part you need and track what's printed,
  with a 3D preview and automatic counting of finished prints
- Stats: prints, success rate, print time, filament and energy per day/week/month
- Maintenance reminders by print hours or days, with an adjustable A1 starter list
- Power and energy per print from a smart plug in Home Assistant
- Installable as an app on your phone (PWA) when served over HTTPS
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

## Projects
Under **Projects** you group the parts of something you're building:

- **Upload** STL, 3MF, OBJ, STEP or G-code files (up to 300 MB each). Each file becomes a part;
  you can also add parts without a file.
- Per part: **pieces needed**, **printed** (−/+ buttons) and **failed**, plus optional material,
  colour, minutes and grams per piece. The project shows overall progress and, when filled in,
  the print time and filament still needed.
- **3D view** of STL files right in the browser.
- **Automatic counting:** when a print finishes, its name is compared with each part's file name
  (or a "print name to match" you set). A unique match adds the part's *pieces per print* to
  *printed*, or to *failed* when the print failed. Only projects with status *Active* count.
  The print history on the dashboard shows where each print was counted.

Files are stored in `data/projects/` (the `bambu-data` volume in Docker).

**Previews:** 3MF files show the plate image they already contain. For a sliced `.gcode.3mf`
(Bambu Studio / OrcaSlicer) the print time, filament weight, material and colour are filled in too,
unless you set them yourself. STL files get a preview rendered once by your browser.

## Stats and maintenance
The **Stats** page shows prints (succeeded/failed), print time, filament and energy per day, week or
month, with a table view under every chart. It only knows prints finished while the dashboard ran.

Maintenance reminders count **print hours** (time actually printing, pauses excluded) and/or days.
The A1 doesn't report its lifetime print time, so enter the hours it already had under
**Settings → Printer**. A starter list of A1 jobs is included; the intervals are suggestions, so adjust
them to how you print. Tasks that are due show on the dashboard with a *Mark done* button.

## Home Assistant (smart plug)
Under **Settings → Home Assistant** enter your Home Assistant URL, a long-lived access token
(profile → Security) and the plug's power (W) and energy (kWh) sensors. The dashboard then shows live
power and records the energy each print used. The token is stored on the server only.

## Using it over HTTPS / as an app
Put the dashboard behind a reverse proxy with HTTPS, such as Nginx Proxy Manager, and open it there.
Your phone can then install it (browser menu → *Install app* / *Add to Home Screen*).

Notes for the proxy:
- Forward the **Host** header unchanged (NPM does this by default). Otherwise saving and uploading
  fail with "Cross-origin request blocked".
- Live updates and camera streams send `X-Accel-Buffering: no`, so nginx doesn't hold them back.
- Login limits are per visitor, based on `X-Real-IP` (set by NPM), plus a shared limit of 50 wrong
  passwords per 15 minutes. If someone hammers your login from the internet, logging in can pause for
  a few minutes for everyone. Consider limiting access (e.g. NPM access lists or a VPN).
- Uploads can be up to 300 MB; raise the proxy's body size limit if uploads fail with *413*.

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
  api/projects/          projects and parts (JSON), model file downloads
  api/upload/            streaming model upload (not behind proxy.ts, see the note there)
  api/stats/             finished prints for the Stats page
  api/maintenance/       maintenance tasks
  login/, settings/      login and settings pages
  projects/              project list and project pages
  stats/                 statistics and maintenance
  manifest.ts            web app manifest (PWA)
public/                  app icons, service worker (sw.js), offline page
components/              the dashboard cards, login form, settings view
hooks/usePrinter.ts      live data in the browser
lib/printer.ts           MQTT connection to the printer (server only)
lib/cameras.ts           camera sources: printer camera, MJPEG/snapshot URLs
lib/auth.ts              password hashing and signed session cookies
lib/settings.ts          settings stored in data/settings.json
lib/projects.ts          projects, parts, file storage and automatic counting
lib/threemf.ts           reads previews and slicing info from 3MF files
lib/maintenance.ts       maintenance tasks and print hours
lib/homeassistant.ts     smart plug power and energy via Home Assistant
lib/types.ts, format.ts  shared types and labels
proxy.ts                 requires a login for every page and API route
instrumentation.ts       connects to the printer when the server starts
```

The app keeps a persistent connection to the printer, so it has to run on your own computer or home
server (`next dev` or `next start`). It won't work on a serverless platform such as Vercel.
