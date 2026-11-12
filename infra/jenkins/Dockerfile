# Jenkins for PawInn, ready to use with no setup wizard:
#   - Node.js 24, Docker CLI + Compose, SSH client
#   - plugins installed at build time
#   - admin user + the "pawinn" pipeline job created from casc.yaml (Configuration as Code)
FROM jenkins/jenkins:lts-jdk21

USER root
RUN apt-get update && apt-get install -y --no-install-recommends openssh-client \
 && rm -rf /var/lib/apt/lists/*
COPY --from=node:24-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:24-bookworm-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
COPY --from=docker:cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker:cli /usr/local/libexec/docker/cli-plugins/ /usr/local/libexec/docker/cli-plugins/
RUN node --version && npm --version && docker --version && docker compose version

USER jenkins
RUN jenkins-plugin-cli --plugins \
      git workflow-aggregator pipeline-stage-view credentials-binding junit timestamper \
      github ssh-agent configuration-as-code job-dsl

COPY casc.yaml /usr/share/jenkins/casc.yaml
ENV CASC_JENKINS_CONFIG=/usr/share/jenkins/casc.yaml \
    JAVA_OPTS="-Djenkins.install.runSetupWizard=false"
