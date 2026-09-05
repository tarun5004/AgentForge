FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY auth-service/package.json auth-service/package.json
COPY project-service/package.json project-service/package.json
COPY nextjs-boilerplate/package.json nextjs-boilerplate/package.json
COPY execution-service/package.json execution-service/package.json

RUN npm ci --workspace execution-service --include-workspace-root

COPY execution-service execution-service

RUN npm run build --workspace execution-service
RUN npm prune --omit=dev --workspace execution-service --include-workspace-root

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/execution-service/package.json ./package.json
COPY --from=build /app/execution-service/dist ./dist

USER node
EXPOSE 5000

CMD ["node", "dist/server.js"]
