# Database image with the SQL baked in (no bind mount needed).
# Local/demo uses init.sql (schemas + demo data).
FROM postgres:17-alpine
ARG INIT_SQL=init.sql
COPY . /opt/pawinn-sql/
RUN printf '\\i /opt/pawinn-sql/%s\n' "$INIT_SQL" > /docker-entrypoint-initdb.d/00-pawinn.sql
