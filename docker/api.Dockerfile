FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/core/package.json packages/core/package.json
RUN pnpm install --frozen-lockfile
COPY apps/api apps/api
COPY packages/core packages/core
RUN pnpm --filter @vibe/core build && pnpm --filter @vibe/api build

FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/apps/api/dist /app/apps/api/dist
COPY --from=build /app/apps/api/package.json /app/apps/api/package.json
COPY --from=build /app/packages/core/dist /app/packages/core/dist
COPY --from=build /app/packages/core/package.json /app/packages/core/package.json
CMD ["node", "apps/api/dist/server.js"]
