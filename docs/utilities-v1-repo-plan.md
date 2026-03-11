# Utilities V1 Repo Plan

This document translates the broader [utilities implementation guide](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/docs/utilities-implementation-guide.md) into a first implementation slice that fits the current Enterprise GIS codebase.

## Current Baseline

The running application is:

- Flask API with blueprint registration in [app.py](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/app.py)
- PostgreSQL + PostGIS via the existing migrations in `database/migrations`
- Redis-backed async job worker
- React + TypeScript frontend running from `client`
- Docker Compose stack in [docker-compose.yml](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/docker-compose.yml)

The repo does not yet have:

- FastAPI
- Kafka
- TimescaleDB
- Elasticsearch
- pgRouting-specific workflows
- Utility-sector schemas or API modules

That means utilities support should start as a vertical slice inside the current stack, not as a parallel platform.

## V1 Scope

V1 adds a foundation for utility-network modeling:

- `utility_network.networks`
- `utility_network.nodes`
- `utility_network.edges`
- `utility_network.service_points`
- A new Flask blueprint at `/api/v1/utilities`

Implemented in this pass:

- Schema migration: [005_utility_network_v1.sql](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/database/migrations/005_utility_network_v1.sql)
- API scaffold: [utility_api.py](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/utility_api.py)
- App registration: [app.py](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/app.py)

## V1 API Surface

Networks:

- `GET /api/v1/utilities/networks`
- `POST /api/v1/utilities/networks`
- `GET /api/v1/utilities/networks/:network_id`
- `GET /api/v1/utilities/networks/:network_id/summary`

Assets:

- `GET /api/v1/utilities/networks/:network_id/nodes`
- `POST /api/v1/utilities/networks/:network_id/nodes`
- `GET /api/v1/utilities/networks/:network_id/edges`
- `POST /api/v1/utilities/networks/:network_id/edges`
- `GET /api/v1/utilities/networks/:network_id/service-points`
- `POST /api/v1/utilities/networks/:network_id/service-points`

Access model:

- Public networks can be listed anonymously
- Private networks are visible to owners and workspace members
- Mutations are owner-only for now

## Why This Shape

This is the minimum viable utility-network layer that still fits the current product:

- It uses the existing auth model
- It uses the existing workspace access pattern
- It keeps geometry in PostGIS, not in a separate service
- It gives the frontend concrete endpoints to build against
- It leaves room to link network assets back to existing GIS features through `source_feature_id`

## Immediate Frontend Follow-Up

The next UI pass should not try to implement the full utilities guide. It should focus on:

1. Utility Network Manager
2. Network summary cards
3. Node and edge table panels
4. Utility-aware styles and icons
5. Service point editing forms

Recommended order:

1. Add client service methods for `/api/v1/utilities`
2. Add a Utilities panel in the left drawer
3. Add create-network dialog
4. Add node/edge list and create forms
5. Add map rendering for selected utility networks

## Next Backend Steps

The next backend milestones should be:

1. `PUT` and `DELETE` routes for networks, nodes, edges, and service points
2. Upstream and downstream trace endpoints
3. Connectivity validation for edges and orphan detection
4. Outage events tied to service points and edges
5. Import tools that convert line and point layers into utility-network assets

## What Stays Out Of V1

These are intentionally deferred:

- Kafka ingestion
- TimescaleDB telemetry streams
- SCADA integrations
- Elasticsearch asset search
- Kubernetes-specific deployment work
- Full outage-management orchestration
- Regulatory compliance modules

Those belong after the current utility-network core is real and used.

## Execution Standard

To keep this effort credible, each utilities phase should meet all of these before expanding scope:

- database migration applied
- API routes reachable
- at least one end-to-end smoke path
- map visualization for the new data
- test coverage for the new workflow

If a utility feature is visible in the UI but not fully implemented in geometry or backend behavior, it should be clearly labeled as preview instead of presented as complete.
