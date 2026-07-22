# Railway deploy image. node:24 is required — the server runs TypeScript
# natively (no build step, no dependencies); only the client needs a build.
FROM node:24-slim

WORKDIR /app

# Client deps first so the layer caches independently of source changes.
COPY client/package.json client/package-lock.json ./client/
RUN npm --prefix client ci

COPY . .
RUN npm --prefix client run build

ENV NODE_ENV=production
CMD ["node", "server/server.ts"]
