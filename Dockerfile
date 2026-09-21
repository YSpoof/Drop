FROM node:alpine AS base
WORKDIR /app

# Install pnpm globally so we can use the workspace lockfile inside the container
RUN npm i -g pnpm@latest

# Copy lockfiles so installs are reproducible and match local pnpm
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM node:bookworm AS native
WORKDIR /app

RUN npm i -g pnpm@latest

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm i --frozen-lockfile --ignore-scripts

COPY . .
RUN pnpm run native:update && pnpm run native:build \
  && mkdir -p /out \
  && cp dist/Drop/Drop-linux_x64 dist/Drop/Drop-win_x64.exe /out/

FROM base AS prod-deps
# Use pnpm with the frozen lockfile to install only production deps
RUN pnpm i --frozen-lockfile --prod --ignore-scripts

FROM base AS build
# Install all deps using pnpm according to the lockfile
COPY --from=prod-deps /app/node_modules ./node_modules
RUN pnpm i --frozen-lockfile --ignore-scripts
COPY . .
COPY --from=native /out/ ./static/downloads/
RUN pnpm run build

FROM node:alpine AS prodcontainer

WORKDIR /app
VOLUME ["/app/data"]

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build

ENV HOST=0.0.0.0 \
    PORT=4321 \
    TZ=America/Sao_Paulo
    
EXPOSE 4321

ENV NODE_ENV=production

CMD ["node", "build/server.js"]
