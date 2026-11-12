// PawInn CI/CD (Jenkins)
//
//   Checkout -> Frontend unit tests -> Build and verify -> Deploy tested images -> Smoke test
//
// - "Build and verify" runs scripts/verify.sh (the same check as GitHub Actions): builds every
//   image tagged with this commit, starts a disposable stack, runs SQL + HTTP tests, removes it.
// - "Deploy" starts the tested images in the configured Compose project (default: pawinn).
//   Settings come from the Jenkins credential "pawinn-env" (Secret file) when it exists,
//   otherwise from the local settings file in JENKINS_HOME.
// - The local controller polls GitHub once a minute.

pipeline {
    agent any

    environment {
        DEPLOY_PROJECT = "${env.PAWINN_DEPLOY_PROJECT ?: 'pawinn'}"
    }

    triggers {
        githubPush()
        pollSCM('* * * * *')
    }

    options {
        timestamps()
        disableConcurrentBuilds()
        timeout(time: 30, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '20'))
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
                // Reuse the commit-tagged images from verification during deployment.
                script { env.PAWINN_TAG = sh(returnStdout: true, script: 'git rev-parse --short=12 HEAD').trim() }
                sh 'git log -1 --pretty="Commit %h by %an: %s"'
                sh 'node --version && docker --version && docker compose version'
            }
        }

        stage('Frontend unit tests') {
            steps {
                dir('frontend') {
                    sh '''
                        npm ci --no-audit --no-fund
                        npm run build
                        mkdir -p test-results
                        node --test \
                          --test-reporter=spec  --test-reporter-destination=stdout \
                          --test-reporter=junit --test-reporter-destination=test-results/frontend.xml \
                          tests/*.test.js
                    '''
                }
            }
        }

        stage('Build and verify') {
            steps { sh 'sh scripts/verify.sh' }
        }

        stage('Deploy tested images') {
            // Multibranch jobs: only main deploys. Single pipeline job: deploys the branch it builds.
            when { expression { env.BRANCH_NAME == null || env.BRANCH_NAME == 'main' } }
            steps {
                script {
                    try {
                        withCredentials([file(credentialsId: 'pawinn-env', variable: 'DEPLOY_ENV')]) {
                            sh 'cp "$DEPLOY_ENV" deploy.env && chmod 600 deploy.env'
                        }
                        echo 'Using settings from the pawinn-env credential'
                    } catch (org.jenkinsci.plugins.credentialsbinding.impl.CredentialNotFoundException err) {
                        echo 'No pawinn-env credential: using Jenkins local deployment settings'
                        sh '''
                            set +x
                            set -eu
                            umask 077
                            LOCAL_ENV="$JENKINS_HOME/pawinn-local.env"
                            if [ ! -f "$LOCAL_ENV" ]; then
                                if docker volume inspect "${DEPLOY_PROJECT}_postgres_data" >/dev/null 2>&1; then
                                    echo 'PawInn already has a database volume. Configure pawinn-env with its existing settings.' >&2
                                    exit 1
                                fi
                                DB_PASSWORD=$(node -p "require('node:crypto').randomBytes(32).toString('hex')")
                                JWT_SECRET_VALUE=$(node -p "require('node:crypto').randomBytes(32).toString('hex')")
                                sed -e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$DB_PASSWORD/" \
                                    -e "s/^JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET_VALUE/" .env.example > "$LOCAL_ENV.tmp"
                                mv "$LOCAL_ENV.tmp" "$LOCAL_ENV"
                            fi
                            cp "$LOCAL_ENV" deploy.env
                            chmod 600 deploy.env
                        '''
                    }
                }
                sh 'sh scripts/deploy.sh deploy.env "$DEPLOY_PROJECT"'
            }
        }

        stage('Smoke test') {
            when { expression { env.BRANCH_NAME == null || env.BRANCH_NAME == 'main' } }
            steps {
                // Check the deployed frontend from inside its own container.
                sh '''
                    set -eu
                    for path in /pages/rooms.html /api/room-types; do
                        docker compose --env-file deploy.env -p "$DEPLOY_PROJECT" exec -T frontend \
                            wget -q -O /dev/null "http://127.0.0.1$path"
                        echo "$path -> OK"
                    done
                    docker compose --env-file deploy.env -p "$DEPLOY_PROJECT" port frontend 80
                '''
            }
        }
    }

    post {
        always {
            junit allowEmptyResults: true, testResults: 'frontend/test-results/*.xml'
        }
        success {
            echo 'PawInn deployment and smoke checks passed'
        }
        failure {
            sh '[ -f deploy.env ] && docker compose --env-file deploy.env -p "$DEPLOY_PROJECT" logs --no-color --tail=100 || true'
        }
        cleanup {
            sh 'rm -f deploy.env'
        }
    }
}
