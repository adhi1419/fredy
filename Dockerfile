FROM node:22-trixie-slim

# Minimal runtime dependencies. Fredy reads every provider over plain HTTP, so the image ships no
# headless browser, none of the browser system libraries and no fonts.
# tini is the container's init (see ENTRYPOINT below) and must survive the build-tool purge.
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates tini \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /conf /fredy \
  && ln -s /conf /fredy/conf

WORKDIR /fredy

ENV NODE_ENV=production \
    IS_DOCKER=true

COPY package.json yarn.lock ./

# Install only backend runtime dependencies. The frontend is built and deployed by
# GitHub Pages, so this image must not copy UI sources or install frontend tooling.
#
# The yarn cache is cleaned in the SAME layer. Yarn 1 downloads every package in the lockfile,
# devDependencies included, even with --production, and a layer is never shrunk by a later
# RUN: cleaning it one step later left ~1.5 GB of tarballs (most of the image) in this layer.
RUN yarn config set network-timeout 600000 \
  && yarn install --frozen-lockfile --production=true --ignore-scripts \
  && yarn cache clean

# --link keeps application code in independent layers. BuildKit can attach changed
# code to the cached runtime manifest without downloading and extracting
# the large parent filesystem on every pull request.
COPY --link lib ./lib
COPY --link index.js ./

EXPOSE 9998
VOLUME /conf

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:9998/health || exit 1

# Run node under tini instead of as pid 1, so signals are forwarded (-g: to the whole process
# group) and any orphaned child is reaped. Keeps container shutdown clean.
ENTRYPOINT ["/usr/bin/tini", "-g", "--"]
CMD ["node", "index.js"]
