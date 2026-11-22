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
    # portless gives the dev server a stable local url, plain localhost otherwise
    url="http://localhost:4321"
    if command -v portless >/dev/null; then url="$(portless get takaweb)"; fi
    sed \
        -e "s|^MONGO_PASSWORD=.*|MONGO_PASSWORD=$(openssl rand -hex 24)|" \
        -e "s|^MONGO_READONLY_PASSWORD=.*|MONGO_READONLY_PASSWORD=$(openssl rand -hex 24)|" \
        -e "s|^TAKAWEB_URL=.*|TAKAWEB_URL=${url}|" \
        .env.example > .env
    echo "created .env"

# start backing services (mongo), wait until healthy, set up the replica set and sync the read-only user
up: env
    docker compose up -d --wait mongo
    docker compose run --rm mongo-init

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
    docker compose exec mongo mongosh --port "${MONGO_PORT:-27017}" -u "$MONGO_USERNAME" -p "$MONGO_PASSWORD" --authenticationDatabase admin

# start services and the astro dev server with hmr
dev: up
    #!/usr/bin/env bash
    set -euo pipefail
    # reload .env in case it was just created by up
    set -a; source .env; set +a
    # point the dev server at the published mongo as the read-only user
    export MONGO_URI="mongodb://${MONGO_READONLY_USERNAME:-takaweb}:${MONGO_READONLY_PASSWORD}@127.0.0.1:${MONGO_PORT:-27017}/takatime?authSource=admin&directConnection=true"
    if command -v portless >/dev/null; then exec portless takaweb bun run dev; fi
    exec bun run dev

# build for production
build:
    bun run build

# format with prettier
fmt:
    bun run fmt

# typecheck and check formatting
check:
    bun check

# run the test suite
test:
    bun run test
