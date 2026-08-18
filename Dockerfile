# Wayfare - full-stack travel planner.
#
# ONE container serves everything: the tRPC API, the Razorpay webhook, the
# server-rendered social preview cards, AND the built frontend (see
# serveStaticFiles in api/lib/vite.ts). There is no separate static host, and
# after r29 there cannot be one - the per-trip Open Graph tags are generated
# by this server, so a static-only deploy would hand every crawler the generic
# card again.
FROM node:22-slim AS build
WORKDIR /app

# r29: `npm ci` and a COPY of package-lock.json used to be here, and BOTH were
# broken. The lockfile shipped in the Kimi export was corrupt - npm ci rejected
# it outright - so it was deleted and gitignored back in 7f60f3f, and CI has
# used `npm install` ever since. This Dockerfile was never updated to match, so
# `COPY package.json package-lock.json ./` failed on a missing file and the
# image could not build AT ALL. Every Docker host (Railway, Render, Fly, Koyeb)
# would have failed on the first deploy.
COPY package.json ./
RUN npm install --include=dev --no-audit --no-fund

COPY . .
# vite build -> dist/public (the frontend), esbuild -> dist/boot.js (the server)
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY --from=build /app/dist ./dist
# Migration scripts + the corpus loader, so a shell into the running container
# can bring a fresh database up without a second toolchain.
COPY --from=build /app/db ./db
COPY --from=build /app/api ./api
COPY --from=build /app/contracts ./contracts

EXPOSE 3000
# Matches the /healthz route in api/boot.ts.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Run as the non-root user the node image already provides.
USER node
CMD ["node", "dist/boot.js"]
