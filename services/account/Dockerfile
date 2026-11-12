FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production ACCOUNT_HOST=0.0.0.0
COPY package*.json ./
RUN npm ci --omit=dev
COPY --chown=node:node server.js routes.js db.js http.js admin.js admin-schema.sql bootstrap-admin.js ./
USER node
EXPOSE 3001
CMD ["node", "server.js"]
