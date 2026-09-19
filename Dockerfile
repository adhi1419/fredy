FROM node:22-trixie-slim

# System dependencies for CloakBrowser. Trixie uses the 64-bit time_t library names.
# fonts-* packages below are CloakBrowser's recommended Linux font set
# (https://github.com/CloakHQ/cloakbrowser#font-setup-on-linux): sites like
# Kasada/Akamai render emoji/CJK glyphs on hidden canvases and hash the pixel
# output, so missing fonts produce hashes a minimal Linux image can't match.
# NOTE: Real Windows fonts (Segoe UI, Calibri, etc.) can't be bundled here since
# they require copying licensed files off an actual Windows install; the
# resulting CLOAKBROWSER_SUPPRESS_FONT_WARNING startup notice is expected.
# tini is the container's init (see ENTRYPOINT below) and must survive the build-tool purge.
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates tini fonts-liberation libasound2t64 \
    libatk-bridge2.0-0t64 libatk1.0-0t64 libcups2t64 libdbus-1-3 \
    libdrm2 libgbm1 libgtk-3-0t64 libnspr4 libnss3 \
    libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 xdg-utils \
    fonts-noto-color-emoji fonts-freefont-ttf fonts-unifont \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-tlwg-loma-otf \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /conf /fredy \
  && ln -s /conf /fredy/conf

WORKDIR /fredy

ENV NODE_ENV=production \
    IS_DOCKER=true \
    CLOAKBROWSER_SUPPRESS_FONT_WARNING=1

COPY package.json yarn.lock ./

# Install only backend runtime dependencies. The frontend is built and deployed by
# GitHub Pages, so this image must not copy UI sources or install frontend tooling.
RUN yarn config set network-timeout 600000 \
  && yarn install --frozen-lockfile --production=true --ignore-scripts

# Pre-download the CloakBrowser stealth Chromium binary (supports x86_64 and arm64).
# CloakBrowser remains part of the API runtime for browser-based providers.
RUN node --input-type=module -e "import { ensureBinary } from 'cloakbrowser'; await ensureBinary();" \
  && yarn cache clean

# --link keeps application code in independent layers. BuildKit can attach changed
# code to the cached browser/runtime manifest without downloading and extracting
# the large parent filesystem on every pull request.
COPY --link lib ./lib
COPY --link index.js ./

EXPOSE 9998
VOLUME /conf

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:9998/health || exit 1

# Run node under tini instead of as pid 1.
#
# Chromium spawns helper processes (crashpad handler, gpu, and - because of --no-zygote - one
# process per renderer). Whenever the browser process dies before them, e.g. when a page crashes
# it or Puppeteer has to kill it, those helpers are reparented to pid 1. libuv only waits for
# the pids node itself spawned, so a node running as pid 1 never reaps them and every failed scrape
# left two more `[chrome] <defunct>` entries behind until the container hit the pid limit.
# tini reaps whatever it inherits and forwards signals (-g: to the whole process group), so
# shutdown keeps working as before.
ENTRYPOINT ["/usr/bin/tini", "-g", "--"]
CMD ["node", "index.js"]
