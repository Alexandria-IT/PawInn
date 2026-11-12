// PawInn CI/CD (Jenkins)
//
//   Checkout -> Frontend unit tests -> Build and verify -> Deploy tested images -> Smoke test
//
// - "Build and verify" runs scripts/verify.sh (the same check as GitHub Actions): builds every
//   image tagged with this commit, starts a disposable stack, runs SQL + HTTP tests, removes it.
// - "Deploy" starts exactly those tested images as project "pawinn" -> http://localhost:8080
//   Settings come from the Jenkins credential "pawinn-env" (Secret file) when it exists,
//   otherwise from a local demo env (.env.example + a generated JWT_SECRET kept in JENKINS_HOME).
// - Triggers: GitHub webhook when Jenkins is reachable, otherwise polling every 2 minutes.

pipeline {
    agent any

    triggers {
        githubPush()
        pollSCM('H/2 * * * *')
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
                    } catch (err) {
                        echo 'No pawinn-env credential: using the local demo env (.env.example + generated JWT_SECRET)'
                        sh '''
                            set -eu
                            LOCAL_ENV="$JENKINS_HOME/pawinn-local.env"
                            if [ ! -f "$LOCAL_ENV" ]; then
                                SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
                                sed "s/^JWT_SECRET=.*/JWT_SECRET=$SECRET/" .env.example > "$LOCAL_ENV"
                                chmod 600 "$LOCAL_ENV"
                            fi
                            cp "$LOCAL_ENV" deploy.env
                        '''
                    }
                }
                sh '''
                    set -eu
                    docker compose --env-file deploy.env -p pawinn up -d --no-build --wait --remove-orphans
                    docker compose --env-file deploy.env -p pawinn ps
                '''
            }
        }

        stage('Smoke test') {
            when { expression { env.BRANCH_NAME == null || env.BRANCH_NAME == 'main' } }
            steps {
                // Checked from inside the "pawinn" network, so it works whether Jenkins
                // runs on the host or in a container.
                sh '''
                    set -eu
                    for path in /pages/rooms.html /api/room-types; do
                        docker run --rm --network pawinn_default curlimages/curl:latest \
                            -fsS -o /dev/null --retry 10 --retry-delay 3 --retry-all-errors \
                            -w "http://frontend$path -> %{http_code}\\n" "http://frontend$path"
                    done
                '''
            }
        }
    }

    post {
        always {
            junit allowEmptyResults: true, testResults: 'frontend/test-results/*.xml'
        }
        success {
            echo 'PawInn is running at http://localhost:8080'
        }
        failure {
            sh '[ -f deploy.env ] && docker compose --env-file deploy.env -p pawinn logs --no-color --tail=100 || true'
        }
        cleanup {
            sh 'rm -f deploy.env'
        }
    }
}
