# Jenkins with Node.js 24 and the Docker CLI + Compose built in.
FROM jenkins/jenkins:lts-jdk21

USER root
COPY --from=node:24-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:24-bookworm-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
COPY --from=docker:cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker:cli /usr/local/libexec/docker/cli-plugins/ /usr/local/libexec/docker/cli-plugins/
RUN node --version && npm --version && docker --version && docker compose version

USER jenkins
RUN jenkins-plugin-cli --plugins git workflow-aggregator junit timestamper pipeline-stage-view
