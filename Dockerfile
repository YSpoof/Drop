FROM node:alpine AS base
WORKDIR /app

# Install pnpm globally so we can use the workspace lockfile inside the container
RUN npm i -g pnpm@latest

# Copy lockfiles so installs are reproducible and match local pnpm
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM golang:1.27.3-alpine AS go-clients
WORKDIR /src

COPY native ./native
WORKDIR /src/native
RUN mkdir -p /out/downloads \
  && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o /out/downloads/Drop-linux_x64 ./desktop \
  && CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o /out/downloads/Drop-win_x64.exe ./desktop \
  && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o /out/downloads/Drop-cli-linux_x64 ./cli/cmd/dropcli \
  && CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o /out/downloads/Drop-cli-win_x64.exe ./cli/cmd/dropcli

FROM base AS prod-deps
# Use pnpm with the frozen lockfile to install only production deps
RUN pnpm i --frozen-lockfile --prod --ignore-scripts

FROM base AS build
# Install all deps using pnpm according to the lockfile
COPY --from=prod-deps /app/node_modules ./node_modules
RUN pnpm i --frozen-lockfile --ignore-scripts
COPY . .
COPY --from=go-clients /out/downloads/ ./static/downloads/
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
