# Build the interface and the server.
FROM node:22-bookworm-slim AS build
# Build tools, used only if the SQLite driver has no ready-made binary for this machine.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Install only what the server needs to run.
FROM node:22-bookworm-slim AS deps
# Build tools, used only if the SQLite driver has no ready-made binary for this machine.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
COPY --from=deps /app/node_modules ./node_modules
# Owned by the user the app runs as, so it can read them whatever their permissions were on the host.
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --chown=node:node package.json ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
CMD ["node", "dist/server.js"]
