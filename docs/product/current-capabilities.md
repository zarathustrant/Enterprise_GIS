# Current Capabilities

This document summarizes what the application currently supports in the codebase.

## Authentication

Implemented in the Flask API and client auth store:

- register
- login
- refresh token flow
- current user lookup
- JWT-protected actions

Key modules:

- [auth.py](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/auth.py)
- [client/src/store/auth.ts](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/client/src/store/auth.ts)
- [client/src/api/http.ts](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/client/src/api/http.ts)

## Layer management

Implemented capabilities:

- create, list, update, delete layers
- layer visibility toggles
- layer zoom-to-extent
- export GeoJSON
- upload GeoJSON into a layer

Key modules:

- [layers.py](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/layers.py)
- [ingestion.py](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/ingestion.py)
- [client/src/App.tsx](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/client/src/App.tsx)

## Styling and legend

Implemented capabilities:

- simple styling controls
- unique values and class breaks
- icon libraries for point layers
- polygon pattern support
- label controls
- legend rendering and filtering

Key modules:

- [client/src/components/LayerStyleDialog.tsx](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/client/src/components/LayerStyleDialog.tsx)
- [client/src/components/PatternPickerDialog.tsx](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/client/src/components/PatternPickerDialog.tsx)
- [client/src/components/LayerLegend.tsx](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/client/src/components/LayerLegend.tsx)
- [client/src/utils/polygonPatterns.ts](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/client/src/utils/polygonPatterns.ts)

## Feature editing

Implemented capabilities:

- create features on editable layers
- update and delete features
- measurement tools
- work mode aware editing layout
- advanced edit mode framework

Advanced edit modes present in the client:

- reshape
- split
- trace
- rotate-scale
- grid-lock
- alignment variants

Important status note:

- the advanced editing UI is extensive
- some modes still need more rigorous geometry-level implementation and testing, especially split behavior

Key modules:

- [client/src/components/MapCanvas.tsx](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/client/src/components/MapCanvas.tsx)
- [features.py](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/features.py)

## Attribute table and schema management

Implemented capabilities:

- bottom attribute table panel
- row selection and export
- inline property editing
- feature query endpoint support
- field management
- domain management

Key modules:

- [client/src/components/AttributeTablePanel.tsx](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/client/src/components/AttributeTablePanel.tsx)
- [client/src/components/FieldsManagerDialog.tsx](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/client/src/components/FieldsManagerDialog.tsx)
- [schema_api.py](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/schema_api.py)

## Analysis

Implemented capabilities:

- buffer
- intersect
- within
- async job support through enterprise job endpoints

Key modules:

- [analysis.py](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/analysis.py)
- [enterprise_api.py](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/enterprise_api.py)

## Enterprise layer operations

Implemented capabilities:

- share links
- joins
- map views
- layer views
- relationships
- async job listing and inspection
- vector tile endpoint

Key modules:

- [enterprise_api.py](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/enterprise_api.py)
- [client/src/components/LayerOpsDialog.tsx](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/client/src/components/LayerOpsDialog.tsx)

## Utility mode

Implemented capabilities:

- utility mode toggle in the main app
- utility network CRUD basics
- utility nodes, edges, and service points APIs
- utility asset creation panel
- utility overlay rendering on the map

Key modules:

- [utility_api.py](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/utility_api.py)
- [client/src/components/UtilityModePanel.tsx](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/client/src/components/UtilityModePanel.tsx)
- [database/migrations/005_utility_network_v1.sql](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/database/migrations/005_utility_network_v1.sql)

## Work mode

Implemented capabilities:

- persistent work mode toggle
- docked right-side workbench behavior
- dialog variants that avoid covering the map unnecessarily

Key modules:

- [client/src/components/workModeDialog.ts](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/client/src/components/workModeDialog.ts)
- [client/src/App.tsx](/Users/oluseyioyetunde/Downloads/Enterprise%20GIS/client/src/App.tsx)
