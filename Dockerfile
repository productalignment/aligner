# Aligner as Railway runs it (docs/install.md): the server and its single-file UI, built from this
# repo. Railway builds this file by itself, and gives the server its PORT, its domain, and the
# volume that keeps the PM's drafts. Railway mounts volumes as root, so the server runs as root.
FROM node:22-slim AS build
WORKDIR /aligner
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /aligner
COPY --from=build /aligner/apps/web/dist ./
EXPOSE 8080
CMD ["node", "server.js"]
