# Product Vision And Goals

## Product vision

Enterprise GIS is intended to become a production-grade web GIS workspace for organizations that need to:

- manage spatial layers and feature data in a browser
- style and publish maps with richer symbology than a standard CRUD GIS app
- edit features with more advanced geometry workflows
- inspect, query, and update attribute data at scale
- support collaborative and domain-specific workflows such as utility network management

The quality bar is explicitly higher than a basic web viewer. The direction is toward a browser-based experience that feels closer to:

- ArcGIS Online for data management and publishing
- ArcGIS Pro for editing workflows and operational panels
- Mapbox Studio for map presentation and styling flexibility

## Core product principles

### 1. The map is the primary workspace

The application should feel map-first. Panels and dialogs must support the map canvas rather than cover it unnecessarily.

### 2. Enterprise GIS features should be operational, not decorative

A feature is only complete when the backend model, client workflow, and map feedback all align. UI that looks advanced but does not execute the real GIS behavior is not considered done.

### 3. Geometry awareness matters

Layer type and geometry family should drive what tools, styling options, and legends are available.

### 4. Domain modes should sit on top of the core GIS platform

The base platform is a general web GIS. Domain workflows such as utilities should activate as a separate mode rather than permanently clutter the default UI.

## Product pillars

### Spatial authoring

- create and manage layers
- draw and edit features
- support advanced edit modes
- preserve geometry and attribute integrity

### Cartography and presentation

- advanced layer styling
- point icons and polygon patterns
- labels and legends
- map layout quality comparable to modern GIS tools

### Data management

- attribute table workflows
- field and domain management
- joins, relationships, and views
- export and sharing

### Operations and collaboration

- work mode for better editing ergonomics
- bookmarks, jobs, and history
- future collaboration and review workflows

### Utility network workflows

- utility mode
- utility network entities and overlays
- future trace/connectivity/outage tooling

## Current product reality

The project already contains a broad surface area, but some advanced editing behaviors still need hardening. The current phase is best described as:

- strong UI and architecture progress
- meaningful enterprise GIS breadth
- selected correctness gaps still to close in advanced editing and table workflows

That means current work should prioritize trustworthiness and completeness over adding more superficial feature breadth.
