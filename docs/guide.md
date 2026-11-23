# TakaWeb guide

Everything beyond the basics in the [README](../README.md): how TakaWeb fits together, how to configure and secure it, and how to work on it.

- [How it works](#how-it-works)
- [Configuration](#configuration)
- [Reaching MongoDB from other machines](#reaching-mongodb-from-other-machines)
- [Running behind a reverse proxy](#running-behind-a-reverse-proxy)
- [Your account](#your-account)
- [Settings](#settings)
- [Importing from WakaTime](#importing-from-wakatime)
- [Backups](#backups)
- [Security](#security)
- [Operations](#operations)
- [Development](#development)
- [Releasing](#releasing)

## How it works

```
editors ──(TakaTime plugins)──▶ MongoDB ──(read-only)──▶ TakaWeb ──▶ your browser
                                                           │
                                                      SQLite (data dir)
```

- **MongoDB** holds your TakaTime logs. Editors write to it, TakaWeb only reads it, through a user that has the `read` role on the `takatime` database and nothing else.
- **SQLite** holds everything TakaWeb owns: the account, sessions, settings and imported history. It lives in the data directory (`/data` in the container, `./data` when run from source) and never touches MongoDB.
- **The dashboard** is rendered on the server, so it opens with your data already in place, then stays live over a server-sent event stream.

### Why MongoDB runs as a replica set

Live updates come from MongoDB change streams, which only exist on replica sets. The bundled `compose.yml` runs a single-node replica set for this, and the `mongo-init` service sets it up, along with the read-only user, on every start.

If you point TakaWeb at a standalone MongoDB instead, it still works, but the dashboard only shows what was there when it loaded and says that live updates are off.

### Keeping up with lots of history

TakaWeb keeps your logs in memory and caches totals per day for each view, so new activity only updates the days it lands in instead of recounting your whole history. Edits and deletions in MongoDB are applied in place. On half a million logs, picking up a burst of new activity takes a few milliseconds.

## Configuration

`compose.yml` reads these from `.env`. `.env.example` lists them with comments.

| Variable                  | Default                 | Description                                                                                                              |
| :------------------------ | :---------------------- | :----------------------------------------------------------------------------------------------------------------------- |
| `MONGO_USERNAME`          | `takatime`              | Root user of the bundled MongoDB. Editors connect with it.                                                               |
| `MONGO_PASSWORD`          |                         | Its password. Required, only applied when the database is first created.                                                 |
| `MONGO_READONLY_USERNAME` | `takaweb`               | The read-only user TakaWeb connects with. Must differ from `MONGO_USERNAME`.                                             |
| `MONGO_READONLY_PASSWORD` |                         | Its password. Required, kept in sync on every start.                                                                     |
| `MONGO_BIND`              | `127.0.0.1`             | Interface MongoDB is published on. Use `0.0.0.0` to reach it from other machines.                                        |
| `MONGO_PORT`              | `27017`                 | Port MongoDB listens and is published on.                                                                                |
| `MONGO_PUBLIC_HOST`       | `127.0.0.1`             | Host other machines reach MongoDB at. See [Reaching MongoDB from other machines](#reaching-mongodb-from-other-machines). |
| `TAKAWEB_URL`             | `http://localhost:4321` | The address TakaWeb is served from. An `https://` address turns on secure cookies and HSTS.                              |
| `TAKAWEB_TRUSTED_PROXIES` | `0`                     | How many reverse proxies sit in front of TakaWeb. See [Running behind a reverse proxy](#running-behind-a-reverse-proxy). |
| `TAKAWEB_BIND`            | `127.0.0.1`             | Interface TakaWeb is published on.                                                                                       |
| `TAKAWEB_PORT`            | `4321`                  | Port TakaWeb is published on.                                                                                            |

When running the image or the server without Compose, two more apply:

| Variable           | Default | Description                                                                          |
| :----------------- | :------ | :----------------------------------------------------------------------------------- |
| `MONGO_URI`        |         | Connection string for the TakaTime MongoDB, ideally as a read-only user.             |
| `TAKAWEB_DATA_DIR` | `data`  | Where the SQLite database lives. The image sets it to `/data`, mount a volume there. |
| `HOST`, `PORT`     |         | Interface and port the server listens on. The image uses `0.0.0.0` and `4321`.       |

## Reaching MongoDB from other machines

To log from editors on other machines:

1. Set `MONGO_BIND=0.0.0.0` so MongoDB is published beyond localhost.
2. Set `MONGO_PUBLIC_HOST` to the hostname or IP those machines use to reach this server.
3. Use that host in the connection string, and keep `directConnection=true` in it.

MongoDB hands clients the replica set member's address, which is why `MONGO_PUBLIC_HOST` has to be reachable from your editors. With `directConnection=true` they skip that step and connect straight to the host you gave them.

Only expose MongoDB on networks you trust, or behind a VPN.

## Running behind a reverse proxy

Put TakaWeb behind a reverse proxy such as Caddy or nginx to serve it over HTTPS:

1. Proxy to `TAKAWEB_BIND:TAKAWEB_PORT`. Keep `TAKAWEB_BIND=127.0.0.1` when the proxy runs on the same machine.
2. Set `TAKAWEB_URL` to the public `https://` address.
3. Set `TAKAWEB_TRUSTED_PROXIES` to the number of proxies in front of TakaWeb, usually `1`.
4. Turn off response buffering for `/api/stream`, so live updates arrive right away. TakaWeb already sends `X-Accel-Buffering: no` for nginx.

`TAKAWEB_TRUSTED_PROXIES` tells TakaWeb to read the visitor's address from `X-Forwarded-For`, counting entries from the right, since anything to the left of what your proxies added is up to the visitor. Without it every visitor looks like your proxy, so one person's failed sign ins would lock everyone out, and the session list would only ever show the proxy's address. Leave it at `0` when TakaWeb is reached directly, or anyone could fake their address.

## Your account

TakaWeb has a single account, called `admin`.

### First start

With no account yet, the server prints a one-time setup token to its logs, and every page leads to `/setup`. The token works until it is used or the server restarts, and a restart prints a new one.

### Changing your password

Open **Settings → Account → Password**. You need your current password, and every other session is signed out once it changes.

### Forgotten password

A forgotten password can never be reset from the browser. Run this on the server instead, it asks for the new password twice:

```sh
docker compose exec takaweb takaweb reset-password
```

When running from source:

```sh
bun run takaweb reset-password
```

To pass the password from a script, pipe it in with `--stdin`:

```sh
printf '%s\n' "$NEW_PASSWORD" | docker compose exec -T takaweb takaweb reset-password --stdin
```

A reset signs out every session. It reads the database from `TAKAWEB_DATA_DIR`, so run it where the server runs.

### Two-factor authentication

**Settings → Account → Two-factor authentication → Set up** adds a second step to signing in: after your password, TakaWeb asks for a 6-digit code from an authenticator app, such as 1Password, Bitwarden, Google Authenticator or Aegis.

1. Enter your password.
2. Scan the QR code with your app, or type in the key shown below it.
3. Enter the code the app shows to confirm it works.

Every other session is signed out once it is on. Each code works only once, and codes from 30 seconds either side of now are accepted, to allow for clocks drifting apart. Turning it off takes your password and a current code.

If you lose your authenticator app, turn two-factor authentication off on the server, then set it up again from Settings:

```sh
docker compose exec takaweb takaweb disable-2fa
```

This keeps every session signed in. When running from source, use `bun run takaweb disable-2fa`.

### Sessions

Signing in keeps you signed in for 30 days, renewed as you use TakaWeb. **Settings → Account → Sessions → Manage** lists every browser that is signed in, with its address, browser and when it signed in. You can sign out any of them except the one you are using, or all others at once.

### Rate limits

To slow down password guessing and keep the server responsive, TakaWeb limits how often some things can happen. Limits reset after the time shown, and are kept in memory, so a restart clears them.

| What                            | Limit                                         |
| :------------------------------ | :-------------------------------------------- |
| Wrong passwords or setup tokens | 10 per address per 15 minutes                 |
| Wrong two-factor codes          | 10 per account per 15 minutes                 |
| Sign in attempts                | 30 per address and 300 overall per 15 minutes |
| Wrong current password          | 5 per session per 15 minutes                  |
| WakaTime lookups                | 10 per session per minute                     |
| Import batches                  | 600 per session per minute                    |
| Exports and removing imports    | 10 per session per minute                     |
| Other requests, like settings   | 300 per session per minute                    |

## Settings

Settings are stored with your account, so they follow you to every browser and device, and an open dashboard picks up changes made elsewhere right away. The page is rendered with them, so options like hidden private details apply before anything shows.

### Hiding private details

**Hide private details** is meant for screen sharing. It blurs project names, branches, files and the addresses in the session list. Filters stay out of the address bar too: instead of `?project=TakaWeb`, the URL carries an encrypted `?filter=…` that only your server can read. Links with a plain filter are rewritten before the page shows, and switching the setting off brings the readable form back.

The theme is the one exception: it stays with each browser, so every device can follow its own light or dark mode.

## Importing from WakaTime

**Settings → Data → WakaTime → Import** walks you through it:

1. On WakaTime, export your **Heartbeats** from your account settings.
2. Choose the exported file. TakaWeb reads it in the background, in your browser, so even exports of hundreds of megabytes keep the page responsive.
3. Optionally, give it a WakaTime token from [wakatime.com/oauth](https://wakatime.com/oauth) to name editors and systems. Exports only refer to them by an internal ID, so without a token they show as Unknown. The token is used once and never stored.

Imported time is kept in TakaWeb's own database. Your TakaTime database is never written to, so it only shows on TakaWeb. Importing the same export again changes nothing, overlapping exports can be imported in any order, and time both WakaTime and TakaTime tracked only counts once. You can remove everything you imported from the same place.

WakaTime is the only source for now. Other sources are planned, and the database already keeps track of where imported time came from.

## Backups

**Settings → Data → Export** downloads a backup in one of three formats:

- **JSON**: one file with your TakaTime logs, imported heartbeats and settings.
- **ZIP** or **TAR.GZ**: the same JSON, plus a copy of TakaWeb's SQLite database and a short README.

The database copy is consistent even while TakaWeb is running, and leaves sessions out. It does include your password hash and two-factor secret, so keep backups as private as the server itself.

### Restoring

1. Stop TakaWeb: `docker compose stop takaweb`.
2. Copy `takaweb.db` from the archive into the data volume, replacing the one there.
3. Start it again: `docker compose start takaweb`.

Everyone signs in again afterwards. TakaTime logs live in MongoDB, so back them up and restore them with MongoDB's own tools, such as `mongodump` and `mongorestore`.

## Security

- **Passwords** are hashed with scrypt, and the cost is stored with each hash so it can be raised later.
- **Two-factor authentication** uses standard TOTP codes (RFC 6238). A sign in waiting for its code expires after 5 minutes or 5 wrong codes, and a code that was used once is never accepted again.
- **Sessions** are random tokens in an `HttpOnly`, `SameSite=Lax` cookie, marked `Secure` when served over HTTPS. Only a hash of each token is stored.
- **Cross-site requests** are refused: forms must come from TakaWeb's own pages, and the import endpoint only takes JSON.
- **Content Security Policy**: every page allows only the scripts and styles TakaWeb itself ships, by hash, and may not be framed.
- **Headers**: every response also carries `X-Frame-Options`, `X-Content-Type-Options`, a same-origin `Referrer-Policy`, cross-origin isolation headers and a `Permissions-Policy`, plus `Strict-Transport-Security` when served over HTTPS.

## Operations

- **Health**: `GET /api/health` answers `{"status":"ok"}` without signing in. The image's healthcheck uses it, through `scripts/healthcheck.mjs`. It only reports that TakaWeb is up: a MongoDB outage shows on the dashboard instead, since restarting TakaWeb would not fix it.
- **Shutting down**: on `SIGTERM` or `SIGINT` TakaWeb stops taking new requests, ends live streams so browsers reconnect, waits up to 5 seconds for requests in flight, then closes MongoDB and SQLite cleanly. `docker compose stop` takes well under a second.
- **Logs**: `docker compose logs -f takaweb`.

## Development

You need [Bun](https://bun.sh), Node.js 22.15 or newer, Docker, and optionally [just](https://github.com/casey/just).

```sh
just setup   # install dependencies and create .env with generated passwords
just dev     # start MongoDB and the dev server
```

`just` lists every recipe. Without it, the same steps are in the `justfile`.

| Command           | What it does                                       |
| :---------------- | :------------------------------------------------- |
| `bun run dev`     | Start the dev server                               |
| `bun run build`   | Build the server, the client and the `takaweb` CLI |
| `bun check`       | Typecheck and check formatting                     |
| `bun run test`    | Run the test suite                                 |
| `bun run fmt`     | Format everything with Prettier                    |
| `bun run takaweb` | Run the maintenance CLI from source                |
| `bun release`     | Cut a release, see [Releasing](#releasing)         |

The dev server has no Content Security Policy, Astro only applies it to builds. To try a production build locally, run `bun run build`, then `node dist/server/entry.mjs`.

### Project layout

| Path                   | What lives there                                        |
| :--------------------- | :------------------------------------------------------ |
| `src/pages`            | Pages and API routes                                    |
| `src/actions`          | Form and settings actions                               |
| `src/components`       | React components, `ui` holds the shadcn primitives      |
| `src/lib`              | Code shared by the server and the browser               |
| `src/lib/server`       | Server only: database, auth, imports, exports, shutdown |
| `src/lib/server/stats` | Loading logs from MongoDB and computing the dashboard   |
| `scripts`              | The `takaweb` CLI and the container healthcheck         |
| `tests`                | The test suite                                          |

### Tests

Tests run with Vitest against Astro's own Vite config. Each test file gets a fresh, temporary data directory, and none of them need MongoDB. The stats tests check the cached dashboard against a direct computation from every log, across timezones and daylight saving changes.

## Releasing

Cut a release from a clean `main` with:

```sh
bun release   # or: just release
```

It walks you through it:

1. Checks that your `main` matches GitHub's. It offers to pull when you are behind, to rebase when you have diverged, and pushes your own commits together with the release, so one push starts one workflow.
2. Runs [`@danfq/nextver`](https://www.npmjs.com/package/@danfq/nextver), which picks the next version from the Conventional Commits since the last release and writes the release notes. The very first release is 1.0.0.
3. Shows the new version and its notes, and asks before going on.
4. Commits the version as `chore: release vX.Y.Z`, tags it with the notes, and pushes both together.

The tag starts the **Release** workflow on GitHub. It checks the tag is on `main`, runs CI, publishes a GitHub release with the notes, and pushes a multi-arch image to `ghcr.io/danfq/takaweb`, tagged with the version and `latest`.

## Languages

TakaWeb is in English only for now, other languages are planned. Dates, times and numbers already follow your browser's language, and the time format can be set in settings.
