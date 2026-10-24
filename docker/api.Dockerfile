FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/core/package.json packages/core/package.json
RUN pnpm install --frozen-lockfile
COPY apps/api apps/api
COPY packages/core packages/core
RUN pnpm --filter @vibeplan/core build && pnpm --filter @vibeplan/api build

FROM node:22-alpine
WORKDIR /app
ARG APP_VERSION=dev
ARG BUILD_COMMIT=unknown
ENV APP_VERSION=$APP_VERSION
ENV BUILD_COMMIT=$BUILD_COMMIT
LABEL org.opencontainers.image.version=$APP_VERSION
LABEL org.opencontainers.image.revision=$BUILD_COMMIT
RUN corepack enable
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/apps/api/dist /app/apps/api/dist
COPY --from=build /app/apps/api/package.json /app/apps/api/package.json
COPY --from=build /app/packages/core/dist /app/packages/core/dist
COPY --from=build /app/packages/core/package.json /app/packages/core/package.json
# pnpm keeps dependency links under each workspace package. Recreate both
# package links in the runtime image so Node resolves API and core imports.
RUN ln -s /app/node_modules/.pnpm/node_modules /app/apps/api/node_modules
RUN ln -s /app/node_modules/.pnpm/node_modules /app/packages/core/node_modules
CMD ["sh", "-c", "node apps/api/dist/db/migrate.js && node apps/api/dist/server.js"]
