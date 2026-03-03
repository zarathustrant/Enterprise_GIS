# Enterprise GIS

A production-grade web GIS application built with Flask + PostGIS.
Supports real-time mapping, spatial querying, JWT authentication, and layer management.

## Stack

| Layer | Technology |
|---|---|
| Frontend | Leaflet.js, vanilla JS (SPA) |
| Backend | Flask, Flask-JWT-Extended |
| Database | PostgreSQL + PostGIS |
| Auth | OAuth2-ready JWT (access + refresh tokens) |
| Deployment | Gunicorn, Docker-ready |

## Quick Start

**1. Set up environment**
```bash
cp .env.example .env
# edit .env with your DB credentials and secret keys
```

**2. Create the database**
```bash
createdb enterprise_gis
psql enterprise_gis < database/migrations/001_initial.sql
```

**3. Install dependencies and run**
```bash
pip install -r requirements.txt
python app.py
```

Open `http://localhost:5000` — you'll see the map viewer with a login prompt.

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
templates/
  index.html        Map viewer SPA (Leaflet)
database/
  migrations/
    001_initial.sql PostGIS schema (users, roles, layers, features)
docs/
  enterprise-gis.md Full architecture & roadmap documentation
```

## Security
- JWT access tokens expire in 15 minutes; refresh tokens in 30 days
- Passwords hashed with Werkzeug (PBKDF2-SHA256)
- Spatial RBAC schema ready (`user_regions` table) for geographic access control
- Row-level security and audit logging designed for Phase 2

## Roadmap

See [docs/enterprise-gis.md](docs/enterprise-gis.md) for the full blueprint.

- **Phase 1 (current):** Map viewer, JWT auth, layer CRUD, spatial queries
- **Phase 2:** Feature editing UI, GeoJSON upload, geocoding, measurement tools
- **Phase 3:** Buffer/overlay analysis, routing, dashboards, time slider
- **Phase 4:** Real-time tracking, 3D visualization, workflow engine, offline PWA
