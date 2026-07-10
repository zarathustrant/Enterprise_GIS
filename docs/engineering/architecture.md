# Architecture

## High-level shape

Enterprise GIS is a three-tier web GIS application:

- React client for map interaction and UI workflows
- Flask API for business logic and spatial endpoints
- PostgreSQL/PostGIS plus Redis for persistence and queue support

## Backend structure

Application entry point:

- [app.py](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/app.py)

Registered blueprint groups:

- auth: [auth.py](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/auth.py)
- layers: [layers.py](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/layers.py)
- features: [features.py](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/features.py)
- ingestion: [ingestion.py](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/ingestion.py)
- schema: [schema_api.py](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/schema_api.py)
- analysis: [analysis.py](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/analysis.py)
- enterprise: [enterprise_api.py](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/enterprise_api.py)
- utilities: [utility_api.py](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/utility_api.py)

Cross-cutting support modules:

- configuration: [config.py](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/config.py)
- DB connection handling: [db.py](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/db.py)
- shared enterprise helpers: [enterprise_utils.py](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/enterprise_utils.py)
- queue/worker support: [job_queue.py](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/job_queue.py), [worker.py](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/worker.py), [job_runner.py](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/job_runner.py)

## Frontend structure

Frontend entry and orchestration:

- root app: [client/src/App.tsx](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/client/src/App.tsx)
- map canvas: [client/src/components/MapCanvas.tsx](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/client/src/components/MapCanvas.tsx)
- API client: [client/src/api/services.ts](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/client/src/api/services.ts)
- auth store: [client/src/store/auth.ts](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/client/src/store/auth.ts)

Major functional surfaces:

- styling: `LayerStyleDialog`
- attribute table: `AttributeTablePanel`
- schema management: `FieldsManagerDialog`
- layer operations: `LayerOpsDialog`
- views and jobs: `MapViewsDialog`, `JobsDialog`
- utility mode: `UtilityModePanel`

## Data flow model

### General GIS flow

1. React queries API endpoints through TanStack Query
2. API reads/writes PostGIS-backed layers and features
3. MapCanvas receives feature collections and styles them with MapLibre and deck.gl
4. edits flow back through feature CRUD endpoints

### Utility flow

1. Utility mode loads accessible utility networks
2. selected network loads nodes, edges, and service points
3. utility asset collections render as overlay layers
4. utility asset creation posts to the utilities API

## Deployment shape

Docker Compose services:

- db
- redis
- api
- worker
- client

Compose file:

- [docker-compose.yml](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/docker-compose.yml)

Current host port choices are intentionally isolated from another local stack:

- Postgres: `5433`
- Redis: `6380`
- API: `5001`
- Frontend: `5173`
