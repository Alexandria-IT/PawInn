FROM node:24-alpine
WORKDIR /app/booking
ENV NODE_ENV=production SERVICE_HOST=0.0.0.0
COPY booking/package*.json ./
RUN npm ci --omit=dev
COPY booking/server.js booking/routes.js booking/reschedule-schema.sql ./
COPY shared/ /app/shared/
USER node
EXPOSE 3003
CMD ["node","server.js"]
