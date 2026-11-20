FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . .
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=4s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz >/dev/null || exit 1
# Run node directly (not "npm start") so SIGTERM reaches the app and it can drain and shut down cleanly.
CMD ["node", "server.js"]
