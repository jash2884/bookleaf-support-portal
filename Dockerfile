# Single image: Express API + the built React SPA, served from one origin
# (so the session cookie and Server-Sent Events need no CORS).

FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci
COPY server server
COPY client client
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production PORT=4000
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/server/package.json server/package.json
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/prisma server/prisma
COPY --from=build /app/server/data server/data
COPY --from=build /app/server/openapi.yaml server/openapi.yaml
COPY --from=build /app/client/dist client/dist
WORKDIR /app/server
RUN npx prisma generate
EXPOSE 4000
# Applies migrations, seeds the sample dataset (idempotent), then starts the server.
CMD ["npm", "start"]
