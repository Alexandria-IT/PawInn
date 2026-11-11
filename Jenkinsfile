// PawInn - CI/CD on your own machine
//   CI: Checkout -> Install -> Build -> Test -> Service tests
//   CD: Deploy (docker compose on this computer) -> Smoke test
// After a green build the website is at http://localhost:8080
// Jenkins checks GitHub every 2 minutes (a webhook cannot reach localhost).

pipeline {
    agent any

    triggers {
        pollSCM('H/2 * * * *')
    }

    options {
        timestamps()
        disableConcurrentBuilds()
        timeout(time: 20, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '20'))
    }

    environment {
        COMPOSE_PROJECT_NAME = 'pawinn'   // fixed name, so each deploy replaces the previous one
        APP_URL = 'http://host.docker.internal:8080'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
                sh 'git log -1 --pretty="Commit %h by %an: %s"'
                sh 'node --version && docker --version && docker compose version'
            }
        }

        stage('Install') {
            steps {
                dir('frontend') { sh 'npm ci --no-audit --no-fund' }
            }
        }

        stage('Build') {
            steps {
                dir('frontend') { sh 'npm run build' }
            }
        }

        stage('Test') {
            steps {
                dir('frontend') {
                    sh '''
                        mkdir -p test-results
                        node --test \
                          --test-reporter=spec  --test-reporter-destination=stdout \
                          --test-reporter=junit --test-reporter-destination=test-results/frontend.xml \
                          tests/*.test.js
                    '''
                }
            }
        }

        stage('Service tests') {
            steps {
                sh '''
                    for svc in account room booking; do
                        dir=services/$svc
                        if ls $dir/tests/*.test.js >/dev/null 2>&1; then
                            echo "== $svc"
                            (cd $dir && npm ci --no-audit --no-fund && npm test)
                        else
                            echo "== $svc: no tests yet, skipped"
                        fi
                    done
                '''
            }
        }

        stage('Deploy') {
            steps {
                // Local demo only: uses the demo password from .env.example.
                // The database volume is kept between deploys (no "down -v").
                sh '''
                    set -eu
                    [ -f .env ] || cp .env.example .env
                    docker compose build
                    docker compose up -d --remove-orphans --wait --wait-timeout 180
                    docker compose ps
                '''
            }
        }

        stage('Smoke test') {
            steps {
                sh '''
                    set -eu
                    curl -fsS -o /dev/null --retry 10 --retry-delay 3 --retry-all-errors \
                         -w "website $APP_URL -> %{http_code}\\n" "$APP_URL/"
                    ROOMS=$(docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "SELECT count(*) FROM rooms"')
                    echo "database -> $ROOMS rooms"
                    [ "$ROOMS" -gt 0 ]
                '''
            }
        }
    }

    post {
        always {
            junit allowEmptyResults: true, testResults: 'frontend/test-results/*.xml'
        }
        success {
            echo 'Deployed ✓  Open http://localhost:8080'
        }
        failure {
            sh 'docker compose logs --no-color --tail=100 || true'
        }
    }
}
