FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server ./server
COPY public ./public
ENV PORT=8080 DATABASE_PATH=/data/cookie-tin.db
EXPOSE 8080
CMD ["node", "server/index.js"]
