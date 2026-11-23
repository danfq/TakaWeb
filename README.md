<div align="center">

<img src="public/logo.svg" alt="TakaWeb logo" width="112" height="112" />

# TakaWeb

A self-hosted dashboard for your [TakaTime](https://github.com/Rtarun3606k/TakaTime) coding activity.

[![Build](https://img.shields.io/github/actions/workflow/status/danfq/TakaWeb/ci.yml?branch=main&style=flat-square&label=build)](https://github.com/danfq/TakaWeb/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/danfq/TakaWeb?style=flat-square&color=58a6ff)](https://github.com/danfq/TakaWeb/releases/latest)
[![License](https://img.shields.io/github/license/danfq/TakaWeb?style=flat-square&color=2ea043)](LICENSE)
[![Docker image](https://img.shields.io/badge/ghcr.io-danfq%2Ftakaweb-0d1117?style=flat-square&logo=docker&logoColor=white)](https://github.com/danfq/TakaWeb/pkgs/container/takaweb)

</div>

> [!NOTE]
> TakaWeb is an unofficial companion project. It is not made or endorsed by the TakaTime maintainers.

TakaTime's editor plugins log your coding time to a MongoDB database you own. TakaWeb reads those logs and turns them into a live dashboard: what you are working on right now, how your time splits across projects, languages and editors, your streaks, and your sessions over any range.

## Features

- **Live**: new activity shows up the moment your editor logs it, no refreshing.
- **Any range**: today, the last 7 or 30 days, the past year or all time, and details for any day or month.
- **Filters**: narrow everything down to one project, language, editor or system.
- **Private by default**: runs on your own server, behind your own password and optional two-factor authentication. TakaWeb only ever reads your TakaTime data.
- **Settings that follow you**: preferences are saved to your account and sync across devices.
- **Import from WakaTime**: bring your older coding history along.
- **Backups**: download everything as JSON, ZIP or TAR.GZ.

## Getting started

You need [Docker](https://docs.docker.com/get-docker/) with Docker Compose.

1. Get `compose.yml` and `.env.example` from this repository, and copy `.env.example` to `.env`.
2. Fill in the two passwords in `.env`. You can generate each one with:

   ```sh
   openssl rand -hex 24
   ```

3. Start everything:

   ```sh
   docker compose up -d
   ```

4. Find your one-time setup token in the logs:

   ```sh
   docker compose logs takaweb
   ```

5. Open [http://localhost:4321](http://localhost:4321), paste the token and choose your password.

### Connect your editors

Point the TakaTime plugin in each editor at the bundled database, using the values from your `.env`:

```
mongodb://<MONGO_USERNAME>:<MONGO_PASSWORD>@<host>:<MONGO_PORT>/?authSource=admin&directConnection=true
```

Use `localhost` as the host on the same machine. To log from other machines, see [Reaching MongoDB from other machines](docs/guide.md#reaching-mongodb-from-other-machines).

## Everyday use

**Settings** open from the gear icon, or with <kbd>Cmd</kbd>+<kbd>,</kbd> (<kbd>Ctrl</kbd>+<kbd>,</kbd> on Windows and Linux). From there you can change how times are shown, hide private details for screen sharing, change your password, turn on two-factor authentication, see and sign out your sessions, import from WakaTime and download a backup.

**Forgot your password?** For safety it can only be reset on the server itself:

```sh
docker compose exec takaweb takaweb reset-password
```

This signs out every session, so you sign in again with the new password.

**Lost your authenticator app?** Turn two-factor authentication off on the server, then set it up again from Settings:

```sh
docker compose exec takaweb takaweb disable-2fa
```

**Updating** to the latest version:

```sh
docker compose pull
docker compose up -d
```

## Good to know

- TakaWeb is in **English only** for now. Other languages are planned. Dates and numbers already follow your browser's language.
- **WakaTime** is the only import source for now. Other sources are planned.
- There is one account, called `admin`.

## Learn more

The [guide](docs/guide.md) covers configuration, running behind a reverse proxy, backups and restoring, security, and development.

## License

TakaWeb is licensed under the [GNU Affero General Public License v3.0](LICENSE). If you run a modified version for other people over a network, you have to share your changes with them.
