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
- Live camera
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

## Running
| Command                     | What it does                                       |
|-----------------------------|----------------------------------------------------|
| `npm run dev`               | Development server with hot reload                 |
| `npm run demo`              | Development server with fake data (no printer)     |
| `npm run build`, then `npm start` | Production build: faster and lighter        |

Then open http://localhost:3000, or `http://<your-computer's-ip>:3000` from your phone.
Without a `.env` or `config.json` the dashboard starts in demo mode.

## Project structure
```
app/
  page.tsx               dashboard page
  api/events/route.ts    live state (Server-Sent Events)
  api/command/route.ts   controls (only a fixed set of allowed actions)
  api/camera/route.ts    camera as an MJPEG stream
components/              the dashboard cards
hooks/usePrinter.ts      live data in the browser
lib/printer.ts           MQTT and camera connection to the printer (server only)
lib/types.ts, format.ts  shared types and labels
instrumentation.ts       connects to the printer when the server starts
```

The app keeps a persistent connection to the printer, so it has to run on your own computer or home
server (`next dev` or `next start`). It won't work on a serverless platform such as Vercel.
