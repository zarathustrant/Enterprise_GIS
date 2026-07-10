# Enterprise GIS

A production-grade web GIS application built with Flask + PostGIS.
Supports real-time mapping, spatial querying, JWT authentication, and layer management.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript + Vite, MapLibre GL JS, deck.gl, MUI |
| Backend | Flask, Flask-JWT-Extended |
| Database | PostgreSQL + PostGIS |
| Auth | OAuth2-ready JWT (access + refresh tokens) |
| State & Data | Zustand, TanStack Query |
| Deployment | Gunicorn + Docker Compose |

## Quick Start

### Docker (recommended)

```bash
docker compose up --build
```

- Frontend: `http://localhost:5173`
- API health: `http://localhost:5001/health`
- API root (`http://localhost:5001/`) redirects to frontend in Docker mode

### Deploy From GitHub To Local Docker

Clone the repo and start the local web stack with one command:

```bash
git clone -b claude/enterprise-gis-docs-gatfp https://github.com/zarathustrant/Enterprise_GIS.git
cd Enterprise_GIS
make github-web
```

What `make github-web` does:

- creates `.env` from `.env.example` if needed
- checks that the clone has no local uncommitted changes
- fast-forwards the clone to the latest pushed commit on GitHub
- rebuilds and starts the Docker stack from that latest code
- serves the web app at `http://localhost:5173`
- preserves the local Postgres volume and does not delete database data

Local ports used by this repo:

- Frontend: `5173`
- API: `5001`
- Postgres: `5433`
- Redis: `6380`

Useful follow-up commands:

```bash
make github-sync
make docker-ps
make docker-logs
make docker-down
```

### Advanced GIS UI (now available)

After sign-in, use these controls in the app:

- `Palette` on a layer: advanced symbology (unique values, class breaks, labels, visual variables, line dash, edit rules).
- `Table` on a layer: advanced attribute table (server query/sort/pagination, bulk update, feature history, rollback).
- `Columns` on a layer: field and domain management (field types, defaults, coded/range domains).
- `Settings` on a layer: advanced layer operations (group/z-order, share links, joins).
- Top bar `Bookmark` icon: save and restore map bookmarks.
- Top bar `History` icon: monitor async jobs.

If you still see an old UI, make sure you opened `http://localhost:5173` and hard-refresh the browser.

### Local Python only (legacy path)

**1. Set up environment**
```bash
cp .env.example .env
# edit .env with your DB credentials and secret keys
```

**2. Create the database**
```bash
createdb enterprise_gis
psql enterprise_gis < database/migrations/001_initial.sql
psql enterprise_gis < database/migrations/002_layer_schema.sql
```

**3. Install dependencies and run**
```bash
pip install -r requirements.txt
python app.py
```

Open `http://localhost:5000`.

## API Reference

### Auth  (`/api/v1/auth`)
| Method | Path | Description |
|---|---|---|
| `POST` | `/register` | Create account → returns JWT pair |
| `POST` | `/login` | Login → returns JWT pair |
| `POST` | `/refresh` | Exchange refresh token for new access token |
| `GET`  | `/me` | Get current user + roles |

### Layers  (`/api/v1/layers`)
| Method | Path | Auth | Description |
|---|---|---|---|
| `GET`    | `/`          | Optional | List accessible layers |
| `POST`   | `/`          | Required | Create a layer |
| `GET`    | `/{id}`      | Optional | Get layer metadata |
| `PUT`    | `/{id}`      | Required | Update layer |
| `DELETE` | `/{id}`      | Required | Delete layer |

### Layer Schema  (`/api/v1/layers/{layer_id}`)
| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/fields` | Optional | List layer fields |
| `POST` | `/fields` | Required (owner) | Add field to layer schema |
| `PUT` | `/fields/{field_id}` | Required (owner) | Update field definition |
| `DELETE` | `/fields/{field_id}` | Required (owner) | Delete field definition |
| `GET` | `/domains` | Optional | List layer domains |
| `POST` | `/domains` | Required (owner) | Create coded/range domain |
| `PUT` | `/domains/{domain_id}` | Required (owner) | Update domain |
| `DELETE` | `/domains/{domain_id}` | Required (owner) | Delete domain |

### Features  (`/api/v1/layers/{layer_id}/features`)
| Method | Path | Auth | Description |
|---|---|---|---|
| `GET`    | `/`      | Optional | Get features (GeoJSON FeatureCollection) |
| `POST`   | `/`      | Required | Create a feature |
| `PUT`    | `/{fid}` | Required | Update feature (supports optimistic locking via `version`) |
| `DELETE` | `/{fid}` | Required | Delete feature |

**Spatial filters on `GET /features`:**
```
?bbox=minX,minY,maxX,maxY          bounding box pre-filter (uses spatial index)
?intersects=<GeoJSON geometry>     exact spatial intersection
?limit=1000&offset=0               pagination
```

### Health
```
GET /health     → { status, postgis version }
```

## Architecture

```
app.py              Flask app factory + route registration
config.py           Environment-driven configuration
db.py               Per-request psycopg2 connection (Flask g)
auth.py             /api/v1/auth blueprint
layers.py           /api/v1/layers blueprint
features.py         /api/v1/layers/<id>/features blueprint
analysis.py         /api/v1/analysis blueprint
ingestion.py        /api/v1/layers/<id>/upload blueprint
client/             React + Vite frontend (MapLibre + deck.gl)
templates/
  index.html        Legacy Flask template UI
database/
  migrations/
    001_initial.sql PostGIS schema (users, roles, layers, features)
docker-compose.yml  Docker orchestration (client + api + postgis)
docs/
  enterprise-gis.md Full architecture & roadmap documentation
```

## Security
- JWT access tokens expire in 15 minutes; refresh tokens in 30 days
- Passwords hashed with Werkzeug (PBKDF2-SHA256)
- Spatial RBAC schema ready (`user_regions` table) for geographic access control
- Row-level security and audit logging designed for Phase 2

## Documentation

Start with [docs/README.md](docs/README.md) for the structured documentation set covering product goals, architecture, local operations, and next engineering priorities.

## Roadmap

See [docs/enterprise-gis.md](docs/enterprise-gis.md) for the full blueprint.

- **Phase 1 (current):** Map viewer, JWT auth, layer CRUD, spatial queries
- **Phase 2:** Feature editing UI, GeoJSON upload, geocoding, measurement tools
- **Phase 3:** Buffer/overlay analysis, routing, dashboards, time slider
- **Phase 4:** Real-time tracking, 3D visualization, workflow engine, offline PWA
