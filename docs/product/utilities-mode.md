# Utilities Mode

## Purpose

Utilities mode is a domain-specific workspace layered on top of the general GIS platform.

The intent is to support utility network modeling without forcing every non-utility workflow to carry utility-specific UI all the time.

## Conceptual model

The application separates two concerns:

- `workMode`: layout behavior and docked editing panels
- `appMode = utilities`: domain behavior and utility-specific workflows

That separation allows these combinations:

- standard GIS mode
- standard GIS mode + work mode
- utilities mode
- utilities mode + work mode

## Current backend model

Current utility entities:

- networks
- nodes
- edges
- service points

Current API surface:

- `GET/POST /api/v1/utilities/networks`
- `GET /api/v1/utilities/networks/<network_id>`
- `GET /api/v1/utilities/networks/<network_id>/summary`
- `GET/POST /api/v1/utilities/networks/<network_id>/nodes`
- `GET/POST /api/v1/utilities/networks/<network_id>/edges`
- `GET/POST /api/v1/utilities/networks/<network_id>/service-points`

Implementation:

- [utility_api.py](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/utility_api.py)
- [database/migrations/005_utility_network_v1.sql](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/database/migrations/005_utility_network_v1.sql)

## Current frontend behavior

When utilities mode is enabled:

- the left drawer shows the utility network panel
- users can create and select utility networks
- users can create nodes, edges, and service points
- the selected network is rendered as a dedicated overlay on the map
- work mode can show a utility workbench summary on the right

Implementation:

- [client/src/App.tsx](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/client/src/App.tsx)
- [client/src/components/UtilityModePanel.tsx](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/client/src/components/UtilityModePanel.tsx)
- [client/src/components/MapCanvas.tsx](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/client/src/components/MapCanvas.tsx)

## Why this matters

This mode is the bridge between a general web GIS and vertical operational GIS products.

If expanded correctly, it can support:

- electric distribution modeling
- water and wastewater networks
- telecom network assets
- outage and trace operations
- service point/customer association

## Near-term next steps

Utilities mode should evolve in this order:

1. map-based asset creation, not only form-based creation
2. connectivity and trace tools
3. outage or isolation workflows
4. utility-specific symbology by asset type/status
5. utility-focused attribute and inspection panels

The current implementation is a foundation, not the final utility workflow experience.
