FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
COPY migrations ./migrations

ENV NODE_ENV=production
ENV PORT=8787

EXPOSE 8787

CMD ["sh", "-c", "node src/migrate.js && node src/server.js"]
