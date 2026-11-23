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
    #!/usr/bin/env bash
    set -euo pipefail
    # reload .env in case it was just created by env
    set -a; source .env; set +a
    port="${MONGO_PORT:-27017}"
    host="${MONGO_PUBLIC_HOST:-127.0.0.1}:${port}"
    # anything else on the port would make compose fail with a vague bind error
    if [ -z "$(docker compose ps --status running -q mongo)" ]; then
        # a wildcard bind clashes with any listener, so probe loopback for it
        bind="${MONGO_BIND:-127.0.0.1}"
        if [ "$bind" = "0.0.0.0" ]; then bind="127.0.0.1"; fi
        if (exec 3<>"/dev/tcp/${bind}/${port}") 2>/dev/null; then
            owner="$(docker ps --filter "publish=${port}" --format '{{{{.Names}}' | head -n1)"
            echo "port ${bind}:${port} is already in use${owner:+ by container ${owner}}, stop it or set MONGO_PORT in .env" >&2
            exit 1
        fi
    fi
    # always run, compose leaves an unchanged container alone and recreates one whose config changed
    docker compose up -d --wait mongo
    # init is done once the read-only user can sign in, holds only its role and the member sits at the public address
    check='const h = db.hello();
    const roles = db.runCommand({ connectionStatus: 1 }).authInfo.authenticatedUserRoles;
    print(h.setName === "rs0" && h.me === "'"${host}"'" && h.isWritablePrimary && roles.length === 1 && roles[0].role === "read" && roles[0].db === "takatime");'
    if [ "$(docker compose exec -T mongo mongosh --port "$port" -u "${MONGO_READONLY_USERNAME:-takaweb}" -p "$MONGO_READONLY_PASSWORD" --authenticationDatabase admin --quiet --eval "$check" 2>/dev/null)" = "true" ]; then
        echo "mongo already initialized, skipping"
    else
        docker compose run --rm mongo-init
    fi

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

# cut a release from main, see docs/guide.md
release:
    bun release
