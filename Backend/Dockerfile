# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma.config.ts tsconfig.json tsconfig.build.json ./
COPY prisma ./prisma
RUN npx prisma generate
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
# Çalışma anında `prisma migrate deploy` için Prisma CLI (devDependency) gerekir.
# NODE_ENV=production bu yüzden kurulumdan SONRA ayarlanır, yoksa npm devDependency'leri atlar.
COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force
ENV NODE_ENV=production
COPY prisma.config.ts ./
COPY prisma ./prisma
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
# Önce şema güncellenir, sonra sunucu başlar. Migration başarısızsa sunucu açılmaz.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
