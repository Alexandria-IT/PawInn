pipeline {
    agent any
    options { disableConcurrentBuilds() }
    stages {
        stage('Checkout') {
            steps {
                checkout scm
                // Reuse the commit-tagged images from verification during deployment.
                script { env.PAWINN_TAG = sh(returnStdout: true, script: 'git rev-parse --short=12 HEAD').trim() }
            }
        }
        stage('Build and verify') {
            steps { sh 'sh scripts/verify.sh' }
        }
        stage('Deploy tested images') {
            when { branch 'main' }
            steps {
                withCredentials([file(credentialsId: 'pawinn-env', variable: 'DEPLOY_ENV')]) {
                    sh '''
                        set -eu
                        docker compose --env-file "$DEPLOY_ENV" -p pawinn up -d --no-build --wait
                        endpoint=$(docker compose --env-file "$DEPLOY_ENV" -p pawinn port frontend 80)
                        curl -fsS "http://$endpoint/pages/rooms.html" >/dev/null
                        curl -fsS "http://$endpoint/api/room-types" >/dev/null
                    '''
                }
            }
        }
    }
}
