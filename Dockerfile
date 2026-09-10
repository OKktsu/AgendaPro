FROM node:24-alpine AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json

RUN npm ci

FROM dependencies AS build

COPY backend ./backend

RUN npm run db:generate -w @agendapro/backend && npm run build -w @agendapro/backend

FROM node:24-alpine AS production

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/package.json ./backend/package.json

EXPOSE 3000

CMD ["node", "backend/dist/server.js"]
