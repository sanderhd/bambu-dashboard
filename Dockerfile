# Bambu Dashboard: builds and runs entirely on the Docker host, including a Raspberry Pi 2B
# (armv7, 1 GB RAM + swap). node:22-bookworm-slim is available for armv7, arm64 and amd64.
#
# Turbopack and the native SWC compiler don't exist for 32-bit ARM, so the build uses
# webpack with the WebAssembly version of SWC. That works everywhere, but it is slow on a Pi.

# ---------------------------------------------------------------- dependencies
FROM node:22-bookworm-slim AS deps
WORKDIR /src
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund \
 # The WebAssembly compiler is the fallback on armv7. Install it up front so the build
 # doesn't have to download it, and on other CPUs it is simply never used.
 && npm install --no-save --no-audit --no-fund "@next/swc-wasm-nodejs@$(node -p "require('next/package.json').version")"

# ---------------------------------------------------------------- build
FROM node:22-bookworm-slim AS build
WORKDIR /src
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_OUTPUT=standalone \
    BAMBU_LOW_MEMORY=1 \
    BAMBU_DEMO=1 \
    NODE_OPTIONS=--max-old-space-size=1024
COPY --from=deps /src/node_modules ./node_modules
COPY . .
RUN npx next build --webpack

# ---------------------------------------------------------------- runtime
FROM node:22-bookworm-slim AS runtime

# X1 / H2 printers stream their camera over RTSP, which needs ffmpeg.
# A1 / P1 printers don't need it: leave this off to keep the image small.
ARG INSTALL_FFMPEG=false
RUN if [ "$INSTALL_FFMPEG" = "true" ]; then \
      apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*; \
    fi

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    NODE_OPTIONS=--max-old-space-size=256

WORKDIR /app
COPY --from=build --chown=node:node /src/.next/standalone ./
COPY --from=build --chown=node:node /src/.next/static ./.next/static
RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=10s --start-period=60s \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
