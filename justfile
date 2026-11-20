set dotenv-load
set shell := ["bash", "-euo", "pipefail", "-c"]

# list recipes
default:
    @just --list

# install deps and create .env
setup: env
    bun install

# create .env from .env.example with generated secrets
env:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -f .env ]; then
        echo ".env already exists, skipping"
        exit 0
    fi
    sed \
        -e "s|^MONGO_PASSWORD=.*|MONGO_PASSWORD=$(openssl rand -hex 24)|" \
        -e "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=$(openssl rand -base64 32)|" \
        -e "s|^TAKAWEB_URL=.*|TAKAWEB_URL=$(portless get takaweb)|" \
        .env.example > .env
    echo "created .env"

# start backing services (mongo) and wait until healthy
up: env
    docker compose up -d --wait mongo

# stop the compose stack
down:
    docker compose down

# stop the compose stack and wipe its volumes
reset:
    docker compose down -v

# follow compose logs
logs *services:
    docker compose logs -f {{ services }}

# open a mongo shell
mongosh:
    docker compose exec mongo mongosh -u "$MONGO_USERNAME" -p "$MONGO_PASSWORD" --authenticationDatabase admin

# start services and the astro dev server with hmr
dev: up
    #!/usr/bin/env bash
    set -euo pipefail
    # reload .env in case it was just created by up
    set -a; source .env; set +a
    # point the dev server at the published mongo instead of the compose network
    export MONGO_URI="mongodb://${MONGO_USERNAME:-takatime}:${MONGO_PASSWORD}@127.0.0.1:${MONGO_PORT:-27017}/?authSource=admin"
    exec bun run dev

# build for production
build:
    bun run build

# format with prettier
fmt:
    bunx prettier --write .
