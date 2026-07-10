# Local Development And Docker Operations

## Recommended path

The default local development path is Docker Compose.

Main command:

```bash
make github-web
```

## What `make github-web` does

Current behavior:

1. creates `.env` from `.env.example` if missing
2. checks that the working tree is clean
3. fetches from `origin`
4. fast-forwards to the latest pushed commit with `git pull --ff-only`
5. rebuilds and starts the Docker stack

This is designed for developers who are working from a GitHub clone and want a repeatable local run path.

## Why it is safe for local Postgres

Enterprise GIS is intentionally isolated from another local Docker stack by host ports.

Enterprise GIS host ports:

- frontend: `5173`
- API: `5001`
- Postgres: `5433`
- Redis: `6380`

The compose stack preserves its Postgres volume during normal start/stop operations.

Commands that preserve data:

```bash
make github-web
make docker-up
make docker-up-build
make docker-down
```

## What not to run if data preservation matters

Avoid destructive volume operations unless you intentionally want a fresh database.

Examples:

```bash
docker compose down -v
docker volume rm enterprisegis_pg_data
```

## Useful commands

```bash
make docker-ps
make docker-logs
make docker-down
make github-sync
make health
```

## Environment defaults

Safe local defaults are configured to match the isolated Docker setup:

- [config.py](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/config.py)
- [.env.example](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/.env.example)
- [job_queue.py](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/job_queue.py)

## Recommended teammate handoff

For a new developer:

1. clone the branch from GitHub
2. run `make github-web`
3. access the app at `http://localhost:5173`
4. do not share or reuse another developer's Docker volume directly
