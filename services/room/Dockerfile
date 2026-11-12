FROM node:24-alpine
WORKDIR /app/room
ENV NODE_ENV=production SERVICE_HOST=0.0.0.0
COPY room/package*.json ./
RUN npm ci --omit=dev
COPY room/server.js room/routes.js ./
COPY shared/ /app/shared/
USER node
EXPOSE 3002
CMD ["node","server.js"]
