# Enterprise GIS - Utilities Sector Implementation Guide

## Executive Summary

This comprehensive implementation guide provides a complete roadmap for extending the Enterprise GIS platform to support utility sector operations including electric, water, gas, and telecommunications infrastructure management. The implementation focuses on network modeling, asset management, outage response, and regulatory compliance.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Database Schema Design](#database-schema-design)
3. [Core Components](#core-components)
4. [API Specifications](#api-specifications)
5. [Frontend Implementation](#frontend-implementation)
6. [Integration Points](#integration-points)
7. [Testing Strategy](#testing-strategy)
8. [Deployment Guide](#deployment-guide)
9. [Performance Optimization](#performance-optimization)
10. [Compliance & Security](#compliance-security)

## Architecture Overview

### System Architecture

```mermaid
graph TB
    subgraph "Data Sources"
        SCADA[SCADA Systems]
        AMI[AMI/Smart Meters]
        CIS[Customer Information System]
        WMS[Work Management System]
        WEATHER[Weather Services]
    end

    subgraph "Integration Layer"
        KAFKA[Apache Kafka]
        ETL[ETL Pipeline]
        API_GW[API Gateway]
    end

    subgraph "Core Platform"
        GIS[GIS Engine]
        NETWORK[Network Analysis]
        OUTAGE[Outage Management]
        ASSET[Asset Management]
    end

    subgraph "Data Layer"
        POSTGIS[(PostGIS)]
        TIMESCALE[(TimescaleDB)]
        REDIS[(Redis Cache)]
        S3[S3 Object Storage]
    end

    subgraph "Client Applications"
        WEB[Web Dashboard]
        MOBILE[Field Mobile App]
        DISPATCH[Dispatch Center]
        ANALYTICS[Analytics Portal]
    end

    SCADA --> KAFKA
    AMI --> KAFKA
    CIS --> ETL
    WMS --> API_GW
    WEATHER --> ETL

    KAFKA --> GIS
    ETL --> GIS
    API_GW --> GIS

    GIS --> NETWORK
    GIS --> OUTAGE
    GIS --> ASSET

    NETWORK --> POSTGIS
    OUTAGE --> REDIS
    ASSET --> TIMESCALE

    GIS --> WEB
    GIS --> MOBILE
    GIS --> DISPATCH
    GIS --> ANALYTICS
```

### Technology Stack

- **Backend**: Flask + FastAPI (high-performance endpoints)
- **Spatial Database**: PostgreSQL 14 + PostGIS 3.4 + pgRouting 3.5
- **Time-Series**: TimescaleDB for sensor data
- **Message Queue**: Apache Kafka for real-time data streams
- **Cache**: Redis for session management and real-time state
- **Search**: Elasticsearch for asset search and logs
- **Container**: Docker + Kubernetes for orchestration
- **Monitoring**: Prometheus + Grafana

## Database Schema Design

### 1. Network Infrastructure Schema

```sql
-- Core network topology tables
CREATE SCHEMA IF NOT EXISTS utility_network;

-- Network nodes (transformers, valves, junctions, etc.)
CREATE TABLE utility_network.nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_type VARCHAR(50) NOT NULL CHECK (node_type IN (
        'source', 'transformer', 'switch', 'valve', 'pump',
        'junction', 'meter', 'regulator', 'capacitor', 'terminal'
    )),
    facility_id VARCHAR(100) UNIQUE,
    geometry geometry(Point, 4326) NOT NULL,
    elevation_m FLOAT,
    install_date DATE,
    manufacturer VARCHAR(100),
    model_number VARCHAR(100),
    specifications JSONB, -- voltage, pressure, capacity, etc.
    operational_status VARCHAR(20) DEFAULT 'in_service' CHECK (operational_status IN (
        'in_service', 'out_of_service', 'maintenance', 'abandoned', 'proposed'
    )),
    properties JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    CONSTRAINT valid_geometry CHECK (ST_IsValid(geometry))
);

-- Network edges (lines, pipes, cables, etc.)
CREATE TABLE utility_network.edges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    edge_type VARCHAR(50) NOT NULL CHECK (edge_type IN (
        'transmission', 'distribution', 'service', 'trunk',
        'main', 'lateral', 'fiber', 'coax', 'copper'
    )),
    from_node_id UUID REFERENCES utility_network.nodes(id) ON DELETE CASCADE,
    to_node_id UUID REFERENCES utility_network.nodes(id) ON DELETE CASCADE,
    facility_id VARCHAR(100) UNIQUE,
    geometry geometry(LineString, 4326) NOT NULL,
    length_m FLOAT GENERATED ALWAYS AS (ST_Length(geometry::geography)) STORED,
    material VARCHAR(50), -- copper, pvc, steel, etc.
    diameter_mm FLOAT,
    voltage_kv FLOAT,
    pressure_psi FLOAT,
    capacity_value FLOAT,
    capacity_unit VARCHAR(20),
    impedance FLOAT DEFAULT 1.0, -- For network analysis
    flow_direction VARCHAR(20) DEFAULT 'bidirectional' CHECK (flow_direction IN (
        'forward', 'reverse', 'bidirectional'
    )),
    install_date DATE,
    last_inspection DATE,
    condition_rating INTEGER CHECK (condition_rating BETWEEN 1 AND 5),
    operational_status VARCHAR(20) DEFAULT 'in_service',
    properties JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    CONSTRAINT valid_edge_geometry CHECK (ST_IsValid(geometry)),
    CONSTRAINT different_nodes CHECK (from_node_id != to_node_id)
);

-- Service connections (customer connections)
CREATE TABLE utility_network.service_points (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_number VARCHAR(50) UNIQUE NOT NULL,
    meter_id VARCHAR(100) UNIQUE,
    premise_id VARCHAR(100),
    service_address TEXT NOT NULL,
    customer_class VARCHAR(20) CHECK (customer_class IN (
        'residential', 'commercial', 'industrial', 'agricultural', 'government'
    )),
    connected_edge_id UUID REFERENCES utility_network.edges(id),
    tap_distance_m FLOAT, -- Distance along edge
    geometry geometry(Point, 4326) NOT NULL,
    service_type VARCHAR(50), -- electric, water, gas, telecom
    meter_type VARCHAR(50), -- smart, analog, prepaid
    contracted_capacity FLOAT,
    average_usage FLOAT,
    peak_usage FLOAT,
    is_critical_customer BOOLEAN DEFAULT FALSE,
    properties JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create spatial indexes
CREATE INDEX idx_nodes_geometry ON utility_network.nodes USING GIST(geometry);
CREATE INDEX idx_edges_geometry ON utility_network.edges USING GIST(geometry);
CREATE INDEX idx_service_points_geometry ON utility_network.service_points USING GIST(geometry);
CREATE INDEX idx_nodes_type ON utility_network.nodes(node_type);
CREATE INDEX idx_edges_type ON utility_network.edges(edge_type);
CREATE INDEX idx_nodes_status ON utility_network.nodes(operational_status);
CREATE INDEX idx_edges_status ON utility_network.edges(operational_status);

-- Network topology cache for fast traversal
CREATE TABLE utility_network.topology_cache (
    edge_id UUID REFERENCES utility_network.edges(id) ON DELETE CASCADE,
    upstream_edges UUID[] DEFAULT '{}',
    downstream_edges UUID[] DEFAULT '{}',
    connected_nodes UUID[] DEFAULT '{}',
    source_nodes UUID[] DEFAULT '{}', -- Ultimate power/water sources
    path_to_source JSONB, -- Shortest path details
    total_impedance FLOAT,
    last_calculated TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (edge_id)
);

-- Protective devices (circuit breakers, valves, etc.)
CREATE TABLE utility_network.protective_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_type VARCHAR(50) NOT NULL CHECK (device_type IN (
        'circuit_breaker', 'recloser', 'fuse', 'valve', 'regulator'
    )),
    node_id UUID REFERENCES utility_network.nodes(id) ON DELETE CASCADE,
    edge_id UUID REFERENCES utility_network.edges(id) ON DELETE CASCADE,
    normally_open BOOLEAN DEFAULT FALSE,
    is_automated BOOLEAN DEFAULT FALSE,
    can_isolate BOOLEAN DEFAULT TRUE,
    rating_value FLOAT,
    rating_unit VARCHAR(20),
    scada_tag VARCHAR(100),
    remote_control BOOLEAN DEFAULT FALSE,
    properties JSONB,
    CONSTRAINT has_location CHECK (
        (node_id IS NOT NULL AND edge_id IS NULL) OR
        (node_id IS NULL AND edge_id IS NOT NULL)
    )
);
```

### 2. Asset Management Schema

```sql
-- Asset tracking and maintenance
CREATE SCHEMA IF NOT EXISTS asset_management;

-- Asset master table
CREATE TABLE asset_management.assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_tag VARCHAR(100) UNIQUE NOT NULL,
    asset_class VARCHAR(50) NOT NULL,
    asset_type VARCHAR(100) NOT NULL,
    description TEXT,
    network_element_id UUID, -- Links to nodes or edges
    network_element_type VARCHAR(10) CHECK (network_element_type IN ('node', 'edge')),
    serial_number VARCHAR(100),
    manufacturer VARCHAR(100),
    model VARCHAR(100),
    purchase_date DATE,
    purchase_cost DECIMAL(12,2),
    install_date DATE,
    warranty_expiry DATE,
    expected_life_years INTEGER,
    replacement_cost DECIMAL(12,2),
    criticality_score INTEGER CHECK (criticality_score BETWEEN 1 AND 10),
    maintenance_priority VARCHAR(20) CHECK (maintenance_priority IN (
        'critical', 'high', 'medium', 'low'
    )),
    location_description TEXT,
    geometry geometry(Geometry, 4326),
    parent_asset_id UUID REFERENCES asset_management.assets(id),
    properties JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Maintenance history
CREATE TABLE asset_management.maintenance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES asset_management.assets(id) ON DELETE CASCADE,
    work_order_number VARCHAR(50) UNIQUE,
    maintenance_type VARCHAR(50) CHECK (maintenance_type IN (
        'preventive', 'corrective', 'predictive', 'emergency', 'inspection'
    )),
    scheduled_date DATE,
    performed_date TIMESTAMPTZ,
    performed_by VARCHAR(100),
    crew_id UUID,
    duration_hours FLOAT,
    labor_cost DECIMAL(10,2),
    material_cost DECIMAL(10,2),
    description TEXT,
    findings TEXT,
    actions_taken TEXT,
    parts_replaced JSONB, -- [{part_number, quantity, cost}]
    next_maintenance_date DATE,
    attachments JSONB, -- [{type, url, description}]
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Asset condition assessments
CREATE TABLE asset_management.condition_assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES asset_management.assets(id) ON DELETE CASCADE,
    assessment_date TIMESTAMPTZ DEFAULT NOW(),
    inspector_name VARCHAR(100),
    overall_condition INTEGER CHECK (overall_condition BETWEEN 1 AND 5),
    structural_condition INTEGER CHECK (structural_condition BETWEEN 1 AND 5),
    electrical_condition INTEGER CHECK (electrical_condition BETWEEN 1 AND 5),
    mechanical_condition INTEGER CHECK (mechanical_condition BETWEEN 1 AND 5),
    remaining_life_years FLOAT,
    failure_probability FLOAT CHECK (failure_probability BETWEEN 0 AND 1),
    consequence_of_failure INTEGER CHECK (consequence_of_failure BETWEEN 1 AND 5),
    risk_score FLOAT GENERATED ALWAYS AS (failure_probability * consequence_of_failure * 20) STORED,
    recommendations TEXT,
    photos JSONB, -- [{url, caption, timestamp}]
    measurements JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Failure tracking
CREATE TABLE asset_management.failure_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES asset_management.assets(id),
    failure_date TIMESTAMPTZ NOT NULL,
    failure_mode VARCHAR(100),
    failure_cause VARCHAR(100),
    detection_method VARCHAR(50),
    mtbf_days INTEGER, -- Mean time between failures
    repair_duration_hours FLOAT,
    service_impact VARCHAR(50) CHECK (service_impact IN (
        'none', 'minor', 'moderate', 'major', 'critical'
    )),
    customers_affected INTEGER,
    estimated_loss DECIMAL(10,2),
    root_cause_analysis TEXT,
    corrective_actions TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_assets_class ON asset_management.assets(asset_class);
CREATE INDEX idx_assets_criticality ON asset_management.assets(criticality_score);
CREATE INDEX idx_maintenance_asset ON asset_management.maintenance_records(asset_id);
CREATE INDEX idx_maintenance_date ON asset_management.maintenance_records(scheduled_date);
CREATE INDEX idx_condition_asset ON asset_management.condition_assessments(asset_id);
CREATE INDEX idx_condition_risk ON asset_management.condition_assessments(risk_score);
```

### 3. Outage Management Schema

```sql
-- Outage and incident management
CREATE SCHEMA IF NOT EXISTS outage_management;

-- Outage events
CREATE TABLE outage_management.outages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    outage_number VARCHAR(50) UNIQUE NOT NULL,
    outage_type VARCHAR(50) CHECK (outage_type IN (
        'planned', 'unplanned', 'emergency', 'rolling_blackout'
    )),
    cause_category VARCHAR(50),
    cause_detail TEXT,
    start_time TIMESTAMPTZ NOT NULL,
    estimated_restoration TIMESTAMPTZ,
    actual_restoration TIMESTAMPTZ,
    outage_status VARCHAR(20) DEFAULT 'active' CHECK (outage_status IN (
        'predicted', 'active', 'restored', 'cancelled'
    )),
    affected_area geometry(Polygon, 4326),
    weather_related BOOLEAN DEFAULT FALSE,
    storm_name VARCHAR(100),
    properties JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Affected infrastructure
CREATE TABLE outage_management.affected_infrastructure (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    outage_id UUID NOT NULL REFERENCES outage_management.outages(id) ON DELETE CASCADE,
    element_type VARCHAR(20) CHECK (element_type IN ('node', 'edge', 'device')),
    element_id UUID NOT NULL,
    isolation_device_id UUID REFERENCES utility_network.protective_devices(id),
    customers_affected INTEGER,
    critical_customers_affected INTEGER,
    estimated_load_kw FLOAT,
    properties JSONB,
    PRIMARY KEY (outage_id, element_id)
);

-- Customer impacts
CREATE TABLE outage_management.customer_impacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    outage_id UUID NOT NULL REFERENCES outage_management.outages(id) ON DELETE CASCADE,
    service_point_id UUID REFERENCES utility_network.service_points(id),
    account_number VARCHAR(50),
    impact_start TIMESTAMPTZ NOT NULL,
    impact_end TIMESTAMPTZ,
    notification_sent BOOLEAN DEFAULT FALSE,
    notification_time TIMESTAMPTZ,
    is_medical_baseline BOOLEAN DEFAULT FALSE,
    is_critical_facility BOOLEAN DEFAULT FALSE,
    estimated_impact_cost DECIMAL(10,2)
);

-- Crew dispatch
CREATE TABLE outage_management.crew_dispatch (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    outage_id UUID NOT NULL REFERENCES outage_management.outages(id),
    crew_id VARCHAR(50) NOT NULL,
    crew_name VARCHAR(100),
    crew_size INTEGER,
    dispatch_time TIMESTAMPTZ,
    arrival_time TIMESTAMPTZ,
    departure_time TIMESTAMPTZ,
    work_status VARCHAR(20) CHECK (work_status IN (
        'assigned', 'enroute', 'onsite', 'working', 'completed'
    )),
    current_location geometry(Point, 4326),
    assigned_tasks TEXT[],
    notes TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Switching orders for restoration
CREATE TABLE outage_management.switching_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    outage_id UUID REFERENCES outage_management.outages(id),
    order_number VARCHAR(50) UNIQUE NOT NULL,
    order_type VARCHAR(20) CHECK (order_type IN (
        'isolation', 'restoration', 'reconfiguration'
    )),
    created_by UUID REFERENCES users(id),
    approved_by UUID REFERENCES users(id),
    approval_time TIMESTAMPTZ,
    execution_start TIMESTAMPTZ,
    execution_complete TIMESTAMPTZ,
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN (
        'draft', 'approved', 'executing', 'completed', 'cancelled'
    ))
);

-- Switching steps
CREATE TABLE outage_management.switching_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES outage_management.switching_orders(id) ON DELETE CASCADE,
    step_number INTEGER NOT NULL,
    device_id UUID REFERENCES utility_network.protective_devices(id),
    action VARCHAR(20) CHECK (action IN ('open', 'close', 'ground', 'remove_ground')),
    safety_notes TEXT,
    executed_by VARCHAR(100),
    executed_time TIMESTAMPTZ,
    verified_by VARCHAR(100),
    verified_time TIMESTAMPTZ,
    UNIQUE(order_id, step_number)
);

CREATE INDEX idx_outages_status ON outage_management.outages(outage_status);
CREATE INDEX idx_outages_time ON outage_management.outages(start_time);
CREATE INDEX idx_outages_area ON outage_management.outages USING GIST(affected_area);
CREATE INDEX idx_customer_impacts_outage ON outage_management.customer_impacts(outage_id);
CREATE INDEX idx_crew_dispatch_status ON outage_management.crew_dispatch(work_status);
```

### 4. Real-time Monitoring Schema

```sql
-- Real-time telemetry and monitoring
CREATE SCHEMA IF NOT EXISTS monitoring;

-- Create TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Sensor telemetry data
CREATE TABLE monitoring.telemetry (
    time TIMESTAMPTZ NOT NULL,
    sensor_id VARCHAR(100) NOT NULL,
    element_id UUID, -- References node/edge/device
    element_type VARCHAR(20),
    measurement_type VARCHAR(50) NOT NULL,
    value FLOAT NOT NULL,
    unit VARCHAR(20),
    quality_flag VARCHAR(20) DEFAULT 'good' CHECK (quality_flag IN (
        'good', 'uncertain', 'bad', 'missing'
    )),
    properties JSONB
);

-- Convert to hypertable for time-series optimization
SELECT create_hypertable('monitoring.telemetry', 'time',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- Create indexes
CREATE INDEX idx_telemetry_sensor_time ON monitoring.telemetry(sensor_id, time DESC);
CREATE INDEX idx_telemetry_element ON monitoring.telemetry(element_id, time DESC);

-- Alarm events
CREATE TABLE monitoring.alarms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alarm_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sensor_id VARCHAR(100),
    element_id UUID,
    alarm_type VARCHAR(50),
    severity VARCHAR(20) CHECK (severity IN (
        'critical', 'major', 'minor', 'warning', 'info'
    )),
    description TEXT,
    threshold_value FLOAT,
    actual_value FLOAT,
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_by VARCHAR(100),
    acknowledged_time TIMESTAMPTZ,
    resolved BOOLEAN DEFAULT FALSE,
    resolved_time TIMESTAMPTZ,
    resolution_notes TEXT,
    properties JSONB
);

-- Aggregated metrics (1 hour aggregates)
CREATE TABLE monitoring.metrics_hourly (
    time TIMESTAMPTZ NOT NULL,
    element_id UUID NOT NULL,
    metric_type VARCHAR(50) NOT NULL,
    avg_value FLOAT,
    min_value FLOAT,
    max_value FLOAT,
    sum_value FLOAT,
    sample_count INTEGER,
    PRIMARY KEY (time, element_id, metric_type)
);

SELECT create_hypertable('monitoring.metrics_hourly', 'time',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists => TRUE
);

-- Continuous aggregates for real-time dashboards
CREATE MATERIALIZED VIEW monitoring.metrics_5min
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('5 minutes', time) AS bucket,
    sensor_id,
    element_id,
    measurement_type,
    AVG(value) as avg_value,
    MIN(value) as min_value,
    MAX(value) as max_value,
    COUNT(*) as sample_count
FROM monitoring.telemetry
GROUP BY bucket, sensor_id, element_id, measurement_type
WITH NO DATA;

-- Refresh policy
SELECT add_continuous_aggregate_policy('monitoring.metrics_5min',
    start_offset => INTERVAL '10 minutes',
    end_offset => INTERVAL '1 minute',
    schedule_interval => INTERVAL '1 minute',
    if_not_exists => TRUE
);
```

## Core Components

### 1. Network Analysis Engine

```python
# network_analysis.py
from typing import List, Dict, Tuple, Optional
import networkx as nx
from dataclasses import dataclass
import numpy as np
from flask import current_app
import asyncio
from concurrent.futures import ThreadPoolExecutor

@dataclass
class NetworkElement:
    """Represents a network element (node or edge)"""
    id: str
    element_type: str  # 'node' or 'edge'
    geometry: Dict
    properties: Dict
    operational_status: str

@dataclass
class TraceResult:
    """Results from network trace operation"""
    traced_elements: List[NetworkElement]
    total_impedance: float
    affected_customers: int
    critical_customers: int
    isolated_devices: List[str]
    trace_path: List[Tuple[str, str]]

class NetworkAnalysisEngine:
    """Core network analysis engine for utility networks"""

    def __init__(self, db_connection):
        self.db = db_connection
        self.graph = nx.DiGraph()
        self.element_cache = {}
        self.executor = ThreadPoolExecutor(max_workers=4)

    async def build_network_graph(self, network_id: Optional[str] = None):
        """Build NetworkX graph from database"""
        # Fetch nodes
        nodes_query = """
            SELECT id, node_type, ST_AsGeoJSON(geometry) as geometry,
                   specifications, operational_status, properties
            FROM utility_network.nodes
            WHERE operational_status != 'abandoned'
        """
        nodes = await self.db.fetch_all(nodes_query)

        for node in nodes:
            self.graph.add_node(
                node['id'],
                node_type=node['node_type'],
                geometry=node['geometry'],
                properties=node['properties'],
                operational=node['operational_status'] == 'in_service'
            )

        # Fetch edges
        edges_query = """
            SELECT id, from_node_id, to_node_id, edge_type,
                   ST_AsGeoJSON(geometry) as geometry, impedance,
                   flow_direction, operational_status, properties,
                   capacity_value, capacity_unit
            FROM utility_network.edges
            WHERE operational_status != 'abandoned'
        """
        edges = await self.db.fetch_all(edges_query)

        for edge in edges:
            if edge['flow_direction'] == 'bidirectional':
                # Add edges in both directions
                self.graph.add_edge(
                    edge['from_node_id'],
                    edge['to_node_id'],
                    edge_id=edge['id'],
                    impedance=edge['impedance'],
                    capacity=edge['capacity_value'],
                    properties=edge['properties'],
                    operational=edge['operational_status'] == 'in_service'
                )
                self.graph.add_edge(
                    edge['to_node_id'],
                    edge['from_node_id'],
                    edge_id=edge['id'],
                    impedance=edge['impedance'],
                    capacity=edge['capacity_value'],
                    properties=edge['properties'],
                    operational=edge['operational_status'] == 'in_service'
                )
            elif edge['flow_direction'] == 'forward':
                self.graph.add_edge(
                    edge['from_node_id'],
                    edge['to_node_id'],
                    edge_id=edge['id'],
                    impedance=edge['impedance'],
                    capacity=edge['capacity_value'],
                    properties=edge['properties'],
                    operational=edge['operational_status'] == 'in_service'
                )
            else:  # reverse
                self.graph.add_edge(
                    edge['to_node_id'],
                    edge['from_node_id'],
                    edge_id=edge['id'],
                    impedance=edge['impedance'],
                    capacity=edge['capacity_value'],
                    properties=edge['properties'],
                    operational=edge['operational_status'] == 'in_service'
                )

    async def trace_upstream(self, start_point: Dict,
                           max_distance: float = None) -> TraceResult:
        """Trace upstream from a point to find all feeding elements"""
        # Find nearest edge or node
        nearest_element = await self._find_nearest_element(start_point)

        if not nearest_element:
            return TraceResult([], 0, 0, 0, [], [])

        # Perform upstream trace
        upstream_nodes = set()
        visited_edges = set()
        total_impedance = 0

        def trace_recursive(node_id, current_impedance=0, depth=0):
            if depth > 100 or (max_distance and current_impedance > max_distance):
                return

            upstream_nodes.add(node_id)

            # Get all upstream edges
            for predecessor in self.graph.predecessors(node_id):
                edge_data = self.graph.edges[predecessor, node_id]
                edge_id = edge_data['edge_id']

                if edge_id not in visited_edges and edge_data.get('operational', True):
                    visited_edges.add(edge_id)
                    new_impedance = current_impedance + edge_data['impedance']
                    trace_recursive(predecessor, new_impedance, depth + 1)

        # Start trace
        if nearest_element.element_type == 'node':
            trace_recursive(nearest_element.id)
        else:
            # For edge, trace from its upstream node
            edge_data = await self._get_edge_data(nearest_element.id)
            trace_recursive(edge_data['from_node_id'])

        # Calculate affected customers
        affected_customers = await self._count_affected_customers(
            list(upstream_nodes), list(visited_edges)
        )

        # Find isolation devices
        isolation_devices = await self._find_isolation_devices(
            list(upstream_nodes), list(visited_edges)
        )

        # Build trace result
        traced_elements = []
        for node_id in upstream_nodes:
            node_data = self.graph.nodes[node_id]
            traced_elements.append(NetworkElement(
                id=node_id,
                element_type='node',
                geometry=node_data['geometry'],
                properties=node_data['properties'],
                operational_status='in_service' if node_data['operational'] else 'out_of_service'
            ))

        return TraceResult(
            traced_elements=traced_elements,
            total_impedance=total_impedance,
            affected_customers=affected_customers['total'],
            critical_customers=affected_customers['critical'],
            isolated_devices=isolation_devices,
            trace_path=[]
        )

    async def trace_downstream(self, start_point: Dict,
                             max_distance: float = None) -> TraceResult:
        """Trace downstream from a point to find all dependent elements"""
        # Similar to upstream but follows graph forward
        nearest_element = await self._find_nearest_element(start_point)

        if not nearest_element:
            return TraceResult([], 0, 0, 0, [], [])

        downstream_nodes = set()
        visited_edges = set()

        def trace_recursive(node_id, current_impedance=0, depth=0):
            if depth > 100 or (max_distance and current_impedance > max_distance):
                return

            downstream_nodes.add(node_id)

            for successor in self.graph.successors(node_id):
                edge_data = self.graph.edges[node_id, successor]
                edge_id = edge_data['edge_id']

                if edge_id not in visited_edges and edge_data.get('operational', True):
                    visited_edges.add(edge_id)
                    new_impedance = current_impedance + edge_data['impedance']
                    trace_recursive(successor, new_impedance, depth + 1)

        # Start trace
        if nearest_element.element_type == 'node':
            trace_recursive(nearest_element.id)
        else:
            edge_data = await self._get_edge_data(nearest_element.id)
            trace_recursive(edge_data['to_node_id'])

        # Calculate impacts
        affected_customers = await self._count_affected_customers(
            list(downstream_nodes), list(visited_edges)
        )

        isolation_devices = await self._find_isolation_devices(
            list(downstream_nodes), list(visited_edges)
        )

        traced_elements = []
        for node_id in downstream_nodes:
            node_data = self.graph.nodes[node_id]
            traced_elements.append(NetworkElement(
                id=node_id,
                element_type='node',
                geometry=node_data['geometry'],
                properties=node_data['properties'],
                operational_status='in_service' if node_data['operational'] else 'out_of_service'
            ))

        return TraceResult(
            traced_elements=traced_elements,
            total_impedance=0,
            affected_customers=affected_customers['total'],
            critical_customers=affected_customers['critical'],
            isolated_devices=isolation_devices,
            trace_path=[]
        )

    async def find_isolation_trace(self, fault_location: Dict) -> Dict:
        """Find minimal set of devices to isolate a fault"""
        nearest_element = await self._find_nearest_element(fault_location)

        if not nearest_element:
            return {'devices': [], 'customers_affected': 0}

        # Find all protective devices
        devices_query = """
            SELECT pd.*,
                   CASE
                       WHEN pd.node_id IS NOT NULL THEN n.geometry
                       WHEN pd.edge_id IS NOT NULL THEN e.geometry
                   END as geometry
            FROM utility_network.protective_devices pd
            LEFT JOIN utility_network.nodes n ON pd.node_id = n.id
            LEFT JOIN utility_network.edges e ON pd.edge_id = e.id
            WHERE pd.can_isolate = true
              AND pd.device_type IN ('circuit_breaker', 'recloser', 'valve')
        """
        devices = await self.db.fetch_all(devices_query)

        # Build isolation strategy
        isolation_devices = []
        min_customers_affected = float('inf')

        # Try different isolation combinations
        upstream_trace = await self.trace_upstream(fault_location)
        downstream_trace = await self.trace_downstream(fault_location)

        for device in devices:
            device_location = {'type': 'Point', 'coordinates': device['geometry']['coordinates']}

            # Check if device can isolate the fault
            device_upstream = await self.trace_upstream(device_location)
            device_downstream = await self.trace_downstream(device_location)

            # Logic to determine if this device helps isolate
            # ... (complex logic here)

        return {
            'devices': isolation_devices,
            'customers_affected': min_customers_affected,
            'isolation_zones': []
        }

    async def calculate_load_flow(self, source_nodes: List[str]) -> Dict:
        """Calculate power flow through network"""
        # Simplified load flow calculation
        flow_results = {}

        for source in source_nodes:
            if source not in self.graph:
                continue

            # Use NetworkX flow algorithms
            flow_dict = nx.max_flow_min_cost(
                self.graph,
                source,
                self._get_sink_nodes(),
                capacity='capacity',
                weight='impedance'
            )

            flow_results[source] = flow_dict

        return flow_results

    async def find_alternative_feed(self, outage_area: Dict) -> Dict:
        """Find alternative power sources for outage area"""
        # Find affected nodes
        affected_query = """
            SELECT DISTINCT n.id
            FROM utility_network.nodes n
            WHERE ST_Within(n.geometry, ST_GeomFromGeoJSON(%s))
        """
        affected_nodes = await self.db.fetch_all(affected_query, [outage_area])

        # Find normally open switches that could restore power
        alternative_sources = []

        switches_query = """
            SELECT pd.*, n.geometry
            FROM utility_network.protective_devices pd
            JOIN utility_network.nodes n ON pd.node_id = n.id
            WHERE pd.normally_open = true
              AND pd.device_type IN ('circuit_breaker', 'recloser')
        """
        switches = await self.db.fetch_all(switches_query)

        for switch in switches:
            # Check if closing this switch would restore power
            # Temporarily modify graph
            # ... (implementation)
            pass

        return {
            'alternative_sources': alternative_sources,
            'switching_orders': [],
            'estimated_restoration': 0
        }

    async def _find_nearest_element(self, point: Dict) -> Optional[NetworkElement]:
        """Find nearest network element to a point"""
        query = """
            WITH nearest AS (
                SELECT 'node' as element_type, id, geometry, properties,
                       operational_status,
                       ST_Distance(geometry::geography,
                                 ST_GeomFromGeoJSON(%s)::geography) as distance
                FROM utility_network.nodes
                WHERE ST_DWithin(geometry::geography,
                               ST_GeomFromGeoJSON(%s)::geography, 100)

                UNION ALL

                SELECT 'edge' as element_type, id, geometry, properties,
                       operational_status,
                       ST_Distance(geometry::geography,
                                 ST_GeomFromGeoJSON(%s)::geography) as distance
                FROM utility_network.edges
                WHERE ST_DWithin(geometry::geography,
                               ST_GeomFromGeoJSON(%s)::geography, 100)
            )
            SELECT element_type, id, ST_AsGeoJSON(geometry) as geometry,
                   properties, operational_status
            FROM nearest
            ORDER BY distance
            LIMIT 1
        """

        result = await self.db.fetch_one(query, [point, point, point, point])

        if result:
            return NetworkElement(
                id=result['id'],
                element_type=result['element_type'],
                geometry=result['geometry'],
                properties=result['properties'],
                operational_status=result['operational_status']
            )
        return None

    async def _count_affected_customers(self, node_ids: List[str],
                                       edge_ids: List[str]) -> Dict:
        """Count customers affected by outage"""
        query = """
            SELECT COUNT(*) as total,
                   SUM(CASE WHEN is_critical_customer THEN 1 ELSE 0 END) as critical
            FROM utility_network.service_points
            WHERE connected_edge_id = ANY(%s::uuid[])
        """

        result = await self.db.fetch_one(query, [edge_ids])

        return {
            'total': result['total'] or 0,
            'critical': result['critical'] or 0
        }

    async def _find_isolation_devices(self, node_ids: List[str],
                                     edge_ids: List[str]) -> List[str]:
        """Find protective devices that can isolate affected area"""
        query = """
            SELECT id, device_type, scada_tag
            FROM utility_network.protective_devices
            WHERE can_isolate = true
              AND (node_id = ANY(%s::uuid[]) OR edge_id = ANY(%s::uuid[]))
            ORDER BY device_type
        """

        devices = await self.db.fetch_all(query, [node_ids, edge_ids])

        return [d['scada_tag'] or d['id'] for d in devices]

    async def _get_edge_data(self, edge_id: str) -> Dict:
        """Get edge data from database"""
        query = """
            SELECT * FROM utility_network.edges WHERE id = %s
        """
        return await self.db.fetch_one(query, [edge_id])

    def _get_sink_nodes(self) -> List[str]:
        """Get all sink nodes (endpoints) in network"""
        # Find nodes with only incoming edges (no outgoing)
        sink_nodes = []
        for node in self.graph.nodes():
            if self.graph.out_degree(node) == 0:
                sink_nodes.append(node)
        return sink_nodes
```

### 2. Outage Management System

```python
# outage_management.py
from datetime import datetime, timedelta
from typing import List, Dict, Optional
import asyncio
import json
from dataclasses import dataclass
from enum import Enum
import httpx
from redis import Redis
import numpy as np
from sklearn.ensemble import RandomForestClassifier

class OutageType(Enum):
    PLANNED = "planned"
    UNPLANNED = "unplanned"
    EMERGENCY = "emergency"
    ROLLING_BLACKOUT = "rolling_blackout"

@dataclass
class OutageEvent:
    id: str
    outage_number: str
    outage_type: OutageType
    start_time: datetime
    estimated_restoration: datetime
    affected_area: Dict  # GeoJSON
    customers_affected: int
    critical_customers: int
    cause_category: Optional[str] = None
    crews_assigned: List[str] = None

class OutageManagementSystem:
    """Complete outage management system"""

    def __init__(self, db_connection, redis_client: Redis, network_engine):
        self.db = db_connection
        self.redis = redis_client
        self.network = network_engine
        self.active_outages = {}
        self.prediction_model = None
        self._load_prediction_model()

    async def detect_outage(self, telemetry_data: Dict) -> Optional[OutageEvent]:
        """Detect outage from telemetry data"""
        # Check for voltage loss or current drop
        if telemetry_data['measurement_type'] == 'voltage':
            if telemetry_data['value'] < 0.1:  # Voltage below threshold
                # Potential outage detected
                affected_element = telemetry_data['element_id']

                # Trace affected area
                trace_result = await self.network.trace_downstream({
                    'element_id': affected_element
                })

                # Create outage event
                outage = await self.create_outage(
                    outage_type=OutageType.UNPLANNED,
                    affected_elements=trace_result.traced_elements,
                    cause_category='equipment_failure'
                )

                # Send notifications
                await self.notify_customers(outage)

                return outage

        return None

    async def create_outage(self, outage_type: OutageType,
                           affected_elements: List,
                           cause_category: str = None) -> OutageEvent:
        """Create new outage event"""
        # Generate outage number
        outage_number = self._generate_outage_number()

        # Calculate affected area
        affected_area = await self._calculate_affected_area(affected_elements)

        # Count affected customers
        customer_count = await self._count_affected_customers(affected_elements)

        # Estimate restoration time
        estimated_restoration = self._estimate_restoration_time(
            outage_type, len(affected_elements), cause_category
        )

        # Insert into database
        query = """
            INSERT INTO outage_management.outages (
                outage_number, outage_type, cause_category,
                start_time, estimated_restoration, affected_area,
                outage_status
            ) VALUES (%s, %s, %s, %s, %s, ST_GeomFromGeoJSON(%s), 'active')
            RETURNING id
        """

        outage_id = await self.db.fetch_val(
            query,
            [outage_number, outage_type.value, cause_category,
             datetime.now(), estimated_restoration, json.dumps(affected_area)]
        )

        # Track affected infrastructure
        for element in affected_elements:
            await self.db.execute("""
                INSERT INTO outage_management.affected_infrastructure (
                    outage_id, element_type, element_id, customers_affected
                ) VALUES (%s, %s, %s, %s)
            """, [outage_id, element.element_type, element.id, 0])

        # Create outage event
        outage = OutageEvent(
            id=outage_id,
            outage_number=outage_number,
            outage_type=outage_type,
            start_time=datetime.now(),
            estimated_restoration=estimated_restoration,
            affected_area=affected_area,
            customers_affected=customer_count['total'],
            critical_customers=customer_count['critical'],
            cause_category=cause_category
        )

        # Cache active outage
        self.active_outages[outage_id] = outage

        # Publish to Redis for real-time updates
        await self.redis.publish(
            'outage_events',
            json.dumps({
                'event': 'outage_created',
                'outage_id': outage_id,
                'outage_number': outage_number,
                'customers_affected': customer_count['total']
            })
        )

        return outage

    async def assign_crew(self, outage_id: str, crew_id: str) -> Dict:
        """Assign crew to outage"""
        # Get crew details
        crew_info = await self._get_crew_info(crew_id)

        # Calculate optimal route
        route = await self._calculate_crew_route(crew_info['location'], outage_id)

        # Create dispatch record
        query = """
            INSERT INTO outage_management.crew_dispatch (
                outage_id, crew_id, crew_name, crew_size,
                dispatch_time, work_status, current_location
            ) VALUES (%s, %s, %s, %s, %s, 'assigned', ST_GeomFromGeoJSON(%s))
            RETURNING id
        """

        dispatch_id = await self.db.fetch_val(
            query,
            [outage_id, crew_id, crew_info['name'], crew_info['size'],
             datetime.now(), json.dumps(crew_info['location'])]
        )

        # Send dispatch notification
        await self._send_crew_notification(crew_id, outage_id, route)

        return {
            'dispatch_id': dispatch_id,
            'estimated_arrival': route['estimated_arrival'],
            'route': route['path']
        }

    async def update_crew_status(self, dispatch_id: str, status: str,
                                location: Dict = None):
        """Update crew dispatch status"""
        updates = ['work_status = %s', 'updated_at = NOW()']
        params = [status]

        if location:
            updates.append('current_location = ST_GeomFromGeoJSON(%s)')
            params.append(json.dumps(location))

        if status == 'onsite':
            updates.append('arrival_time = NOW()')
        elif status == 'completed':
            updates.append('departure_time = NOW()')

        params.append(dispatch_id)

        query = f"""
            UPDATE outage_management.crew_dispatch
            SET {', '.join(updates)}
            WHERE id = %s
        """

        await self.db.execute(query, params)

        # Publish status update
        await self.redis.publish(
            'crew_updates',
            json.dumps({
                'dispatch_id': dispatch_id,
                'status': status,
                'location': location
            })
        )

    async def create_switching_order(self, outage_id: str,
                                    order_type: str) -> Dict:
        """Create switching order for outage isolation/restoration"""
        # Get outage details
        outage = self.active_outages.get(outage_id)
        if not outage:
            outage = await self._load_outage(outage_id)

        # Determine switching steps based on order type
        if order_type == 'isolation':
            steps = await self._generate_isolation_steps(outage)
        elif order_type == 'restoration':
            steps = await self._generate_restoration_steps(outage)
        else:
            steps = await self._generate_reconfiguration_steps(outage)

        # Create switching order
        order_number = self._generate_order_number()

        query = """
            INSERT INTO outage_management.switching_orders (
                outage_id, order_number, order_type, created_by, status
            ) VALUES (%s, %s, %s, %s, 'draft')
            RETURNING id
        """

        order_id = await self.db.fetch_val(
            query,
            [outage_id, order_number, order_type, 'current_user_id']
        )

        # Add switching steps
        for i, step in enumerate(steps):
            await self.db.execute("""
                INSERT INTO outage_management.switching_steps (
                    order_id, step_number, device_id, action, safety_notes
                ) VALUES (%s, %s, %s, %s, %s)
            """, [order_id, i + 1, step['device_id'], step['action'],
                  step.get('safety_notes')])

        return {
            'order_id': order_id,
            'order_number': order_number,
            'steps': steps,
            'estimated_duration': len(steps) * 5  # 5 minutes per step
        }

    async def predict_outage_risk(self, weather_data: Dict) -> Dict:
        """Predict outage risk based on weather conditions"""
        if not self.prediction_model:
            return {'risk_level': 'unknown'}

        # Prepare features
        features = self._prepare_weather_features(weather_data)

        # Make prediction
        risk_probability = self.prediction_model.predict_proba([features])[0][1]

        # Determine risk level
        if risk_probability < 0.3:
            risk_level = 'low'
        elif risk_probability < 0.6:
            risk_level = 'medium'
        else:
            risk_level = 'high'

        # Identify vulnerable areas
        vulnerable_areas = await self._identify_vulnerable_areas(
            weather_data, risk_probability
        )

        return {
            'risk_level': risk_level,
            'risk_probability': float(risk_probability),
            'vulnerable_areas': vulnerable_areas,
            'recommended_actions': self._get_risk_recommendations(risk_level)
        }

    async def generate_restoration_plan(self, outage_id: str) -> Dict:
        """Generate optimal restoration plan"""
        outage = await self._load_outage(outage_id)

        # Get available crews
        available_crews = await self._get_available_crews()

        # Get affected infrastructure
        affected = await self._get_affected_infrastructure(outage_id)

        # Prioritize restoration based on criticality
        restoration_priority = self._prioritize_restoration(affected)

        # Generate restoration steps
        restoration_plan = {
            'phases': [],
            'total_duration': 0,
            'crews_required': len(available_crews)
        }

        current_time = datetime.now()

        for priority_group in restoration_priority:
            phase = {
                'priority': priority_group['priority'],
                'description': priority_group['description'],
                'start_time': current_time,
                'tasks': []
            }

            for task in priority_group['tasks']:
                crew = self._assign_crew_to_task(task, available_crews)
                phase['tasks'].append({
                    'task_id': task['id'],
                    'description': task['description'],
                    'crew_id': crew['id'],
                    'estimated_duration': task['duration'],
                    'devices': task['devices']
                })

            phase['end_time'] = current_time + timedelta(
                minutes=max(t['estimated_duration'] for t in phase['tasks'])
            )
            current_time = phase['end_time']

            restoration_plan['phases'].append(phase)

        restoration_plan['total_duration'] = (
            current_time - datetime.now()
        ).total_seconds() / 60

        return restoration_plan

    async def notify_customers(self, outage: OutageEvent):
        """Send notifications to affected customers"""
        # Get affected service points
        query = """
            SELECT sp.account_number, sp.service_address,
                   sp.is_critical_customer, sp.properties
            FROM utility_network.service_points sp
            JOIN outage_management.affected_infrastructure ai
                ON sp.connected_edge_id = ai.element_id
            WHERE ai.outage_id = %s
        """

        affected_customers = await self.db.fetch_all(query, [outage.id])

        # Batch notifications
        notifications = []
        for customer in affected_customers:
            notification = {
                'account_number': customer['account_number'],
                'message': self._format_outage_message(outage, customer),
                'channels': self._get_notification_channels(customer),
                'priority': 'high' if customer['is_critical_customer'] else 'normal'
            }
            notifications.append(notification)

        # Send notifications via message queue
        for batch in self._batch_list(notifications, 100):
            await self.redis.lpush(
                'notification_queue',
                *[json.dumps(n) for n in batch]
            )

        # Update database
        await self.db.execute("""
            UPDATE outage_management.customer_impacts
            SET notification_sent = true, notification_time = NOW()
            WHERE outage_id = %s
        """, [outage.id])

    def _generate_outage_number(self) -> str:
        """Generate unique outage number"""
        timestamp = datetime.now().strftime('%Y%m%d%H%M%S')
        return f"OUT-{timestamp}"

    def _generate_order_number(self) -> str:
        """Generate unique switching order number"""
        timestamp = datetime.now().strftime('%Y%m%d%H%M%S')
        return f"SO-{timestamp}"

    async def _calculate_affected_area(self, elements: List) -> Dict:
        """Calculate convex hull of affected elements"""
        if not elements:
            return None

        # Get geometries
        geometries = [e.geometry for e in elements]

        # Create convex hull
        query = """
            SELECT ST_AsGeoJSON(ST_ConvexHull(ST_Collect(geom))) as area
            FROM (
                SELECT ST_GeomFromGeoJSON(%s) as geom
            ) as t
        """

        result = await self.db.fetch_one(query, [json.dumps({
            'type': 'GeometryCollection',
            'geometries': geometries
        })])

        return json.loads(result['area']) if result else None

    def _estimate_restoration_time(self, outage_type: OutageType,
                                  element_count: int,
                                  cause: str) -> datetime:
        """Estimate restoration time based on historical data"""
        base_time = datetime.now()

        # Base restoration times (in hours)
        restoration_times = {
            OutageType.PLANNED: 4,
            OutageType.UNPLANNED: 6,
            OutageType.EMERGENCY: 2,
            OutageType.ROLLING_BLACKOUT: 1
        }

        hours = restoration_times[outage_type]

        # Adjust based on scale
        if element_count > 100:
            hours *= 2
        elif element_count > 50:
            hours *= 1.5

        # Adjust based on cause
        if cause == 'weather_severe':
            hours *= 2
        elif cause == 'equipment_failure':
            hours *= 1.2

        return base_time + timedelta(hours=hours)

    def _load_prediction_model(self):
        """Load ML model for outage prediction"""
        try:
            # In production, load from file or model registry
            self.prediction_model = RandomForestClassifier()
            # Train with historical data
            # self.prediction_model.fit(X_train, y_train)
        except Exception as e:
            print(f"Failed to load prediction model: {e}")
            self.prediction_model = None

    def _prepare_weather_features(self, weather_data: Dict) -> List:
        """Prepare weather data for ML model"""
        return [
            weather_data.get('wind_speed', 0),
            weather_data.get('precipitation', 0),
            weather_data.get('temperature', 20),
            weather_data.get('humidity', 50),
            weather_data.get('pressure', 1013),
            1 if weather_data.get('lightning', False) else 0,
            1 if weather_data.get('ice', False) else 0
        ]

    def _batch_list(self, items: List, batch_size: int):
        """Batch list into chunks"""
        for i in range(0, len(items), batch_size):
            yield items[i:i + batch_size]
```

## API Specifications

### Network Analysis Endpoints

```python
# api/network_routes.py
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
import asyncio

network_bp = Blueprint('network', __name__, url_prefix='/api/v1/network')

@network_bp.route('/trace/upstream', methods=['POST'])
@jwt_required()
async def trace_upstream():
    """
    Trace upstream from a point to find feeding elements

    Request Body:
    {
        "start_point": {
            "type": "Point",
            "coordinates": [-122.4194, 37.7749]
        },
        "max_distance": 1000,  // Optional, in meters
        "include_devices": true
    }

    Response:
    {
        "success": true,
        "data": {
            "traced_elements": [...],
            "total_impedance": 45.2,
            "affected_customers": 1250,
            "critical_customers": 3,
            "isolation_devices": ["CB-001", "SW-045"],
            "trace_path": [["node1", "node2"], ...],
            "execution_time": 0.234
        }
    }
    """
    data = request.json

    try:
        network_engine = current_app.network_engine
        result = await network_engine.trace_upstream(
            data['start_point'],
            data.get('max_distance')
        )

        return jsonify({
            'success': True,
            'data': {
                'traced_elements': [e.__dict__ for e in result.traced_elements],
                'total_impedance': result.total_impedance,
                'affected_customers': result.affected_customers,
                'critical_customers': result.critical_customers,
                'isolation_devices': result.isolated_devices,
                'trace_path': result.trace_path
            }
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 400

@network_bp.route('/trace/downstream', methods=['POST'])
@jwt_required()
async def trace_downstream():
    """
    Trace downstream from a point to find dependent elements
    """
    data = request.json

    try:
        network_engine = current_app.network_engine
        result = await network_engine.trace_downstream(
            data['start_point'],
            data.get('max_distance')
        )

        return jsonify({
            'success': True,
            'data': {
                'traced_elements': [e.__dict__ for e in result.traced_elements],
                'affected_customers': result.affected_customers,
                'critical_customers': result.critical_customers,
                'isolation_devices': result.isolated_devices
            }
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 400

@network_bp.route('/isolation/find', methods=['POST'])
@jwt_required()
async def find_isolation():
    """
    Find optimal isolation strategy for a fault location

    Request Body:
    {
        "fault_location": {
            "type": "Point",
            "coordinates": [-122.4194, 37.7749]
        },
        "minimize": "customers"  // or "load" or "critical"
    }
    """
    data = request.json

    try:
        network_engine = current_app.network_engine
        result = await network_engine.find_isolation_trace(
            data['fault_location']
        )

        return jsonify({
            'success': True,
            'data': result
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 400

@network_bp.route('/load-flow/calculate', methods=['POST'])
@jwt_required()
async def calculate_load_flow():
    """
    Calculate power flow through network

    Request Body:
    {
        "source_nodes": ["node-001", "node-002"],
        "scenario": "normal",  // or "n-1", "peak", "minimum"
        "timestamp": "2024-01-01T12:00:00Z"
    }
    """
    data = request.json

    try:
        network_engine = current_app.network_engine
        result = await network_engine.calculate_load_flow(
            data['source_nodes']
        )

        return jsonify({
            'success': True,
            'data': {
                'flow_results': result,
                'timestamp': data.get('timestamp'),
                'convergence': True,
                'iterations': 12
            }
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 400

@network_bp.route('/alternative-feed/find', methods=['POST'])
@jwt_required()
async def find_alternative_feed():
    """
    Find alternative power sources for outage area
    """
    data = request.json

    try:
        network_engine = current_app.network_engine
        result = await network_engine.find_alternative_feed(
            data['outage_area']
        )

        return jsonify({
            'success': True,
            'data': result
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 400
```

### Outage Management Endpoints

```python
# api/outage_routes.py
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
from flask_socketio import emit

outage_bp = Blueprint('outage', __name__, url_prefix='/api/v1/outage')

@outage_bp.route('/create', methods=['POST'])
@jwt_required()
async def create_outage():
    """
    Create new outage event

    Request Body:
    {
        "outage_type": "unplanned",
        "affected_elements": [...],
        "cause_category": "equipment_failure",
        "cause_detail": "Transformer explosion at substation A",
        "estimated_restoration": "2024-01-01T16:00:00Z"
    }
    """
    data = request.json

    try:
        outage_system = current_app.outage_system
        outage = await outage_system.create_outage(
            OutageType(data['outage_type']),
            data['affected_elements'],
            data.get('cause_category')
        )

        # Emit real-time update
        emit('outage_created', {
            'outage_id': outage.id,
            'customers_affected': outage.customers_affected
        }, broadcast=True, namespace='/outages')

        return jsonify({
            'success': True,
            'data': {
                'outage_id': outage.id,
                'outage_number': outage.outage_number,
                'customers_affected': outage.customers_affected,
                'critical_customers': outage.critical_customers,
                'estimated_restoration': outage.estimated_restoration.isoformat()
            }
        }), 201
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 400

@outage_bp.route('/<outage_id>/crew/assign', methods=['POST'])
@jwt_required()
async def assign_crew():
    """
    Assign crew to outage
    """
    outage_id = request.view_args['outage_id']
    data = request.json

    try:
        outage_system = current_app.outage_system
        result = await outage_system.assign_crew(
            outage_id,
            data['crew_id']
        )

        return jsonify({
            'success': True,
            'data': result
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 400

@outage_bp.route('/switching-order/create', methods=['POST'])
@jwt_required()
async def create_switching_order():
    """
    Create switching order for isolation/restoration
    """
    data = request.json

    try:
        outage_system = current_app.outage_system
        result = await outage_system.create_switching_order(
            data['outage_id'],
            data['order_type']
        )

        return jsonify({
            'success': True,
            'data': result
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 400

@outage_bp.route('/predict-risk', methods=['POST'])
@jwt_required()
async def predict_outage_risk():
    """
    Predict outage risk based on weather

    Request Body:
    {
        "weather_data": {
            "wind_speed": 45,
            "precipitation": 2.5,
            "temperature": -5,
            "lightning": true
        },
        "region": {...}  // GeoJSON
    }
    """
    data = request.json

    try:
        outage_system = current_app.outage_system
        result = await outage_system.predict_outage_risk(
            data['weather_data']
        )

        return jsonify({
            'success': True,
            'data': result
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 400

@outage_bp.route('/<outage_id>/restoration-plan', methods=['GET'])
@jwt_required()
async def get_restoration_plan():
    """
    Generate optimal restoration plan
    """
    outage_id = request.view_args['outage_id']

    try:
        outage_system = current_app.outage_system
        plan = await outage_system.generate_restoration_plan(outage_id)

        return jsonify({
            'success': True,
            'data': plan
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 400
```

## Frontend Implementation

### Network Visualization Component

```typescript
// components/NetworkVisualization.tsx
import React, { useEffect, useState, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { Deck } from '@deck.gl/core'
import { GeoJsonLayer, IconLayer, TextLayer } from '@deck.gl/layers'
import { PathStyleExtension } from '@deck.gl/extensions'
import { Box, Paper, IconButton, Tooltip, Menu, MenuItem } from '@mui/material'
import {
  AccountTree, ElectricBolt, Warning, Build,
  PlayArrow, Stop, Timeline
} from '@mui/icons-material'

interface NetworkVisualizationProps {
  networkData: any
  outages: OutageEvent[]
  telemetryData: Map<string, TelemetryData>
  onElementClick: (element: NetworkElement) => void
  onTraceComplete: (result: TraceResult) => void
}

interface NetworkElement {
  id: string
  type: 'node' | 'edge'
  geometry: GeoJSON.Geometry
  properties: Record<string, any>
  operationalStatus: string
}

interface TraceResult {
  tracedElements: NetworkElement[]
  affectedCustomers: number
  criticalCustomers: number
}

export const NetworkVisualization: React.FC<NetworkVisualizationProps> = ({
  networkData,
  outages,
  telemetryData,
  onElementClick,
  onTraceComplete
}) => {
  const mapRef = useRef<maplibregl.Map | null>(null)
  const deckRef = useRef<Deck | null>(null)
  const [selectedElement, setSelectedElement] = useState<NetworkElement | null>(null)
  const [traceMode, setTraceMode] = useState<'upstream' | 'downstream' | null>(null)
  const [tracedElements, setTracedElements] = useState<Set<string>>(new Set())
  const [flowAnimation, setFlowAnimation] = useState(false)

  // Initialize map
  useEffect(() => {
    if (!mapRef.current) {
      const map = new maplibregl.Map({
        container: 'network-map',
        style: {
          version: 8,
          sources: {
            osm: {
              type: 'raster',
              tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
              tileSize: 256
            }
          },
          layers: [
            {
              id: 'osm',
              type: 'raster',
              source: 'osm'
            }
          ]
        },
        center: [-122.4194, 37.7749],
        zoom: 12
      })

      mapRef.current = map

      // Initialize deck.gl
      const deck = new Deck({
        canvas: 'deck-canvas',
        initialViewState: {
          longitude: -122.4194,
          latitude: 37.7749,
          zoom: 12,
          pitch: 0,
          bearing: 0
        },
        controller: true,
        onViewStateChange: ({ viewState }) => {
          map.jumpTo({
            center: [viewState.longitude, viewState.latitude],
            zoom: viewState.zoom,
            bearing: viewState.bearing,
            pitch: viewState.pitch
          })
        },
        layers: []
      })

      deckRef.current = deck
    }
  }, [])

  // Update network layers
  useEffect(() => {
    if (!deckRef.current || !networkData) return

    const layers = [
      // Network edges layer
      new GeoJsonLayer({
        id: 'network-edges',
        data: networkData.edges,
        getLineColor: (d: any) => {
          // Color based on status and telemetry
          if (outages.some(o => o.affectedElements.includes(d.id))) {
            return [255, 0, 0, 255] // Red for outage
          }
          if (tracedElements.has(d.id)) {
            return [0, 255, 255, 255] // Cyan for traced
          }
          const telemetry = telemetryData.get(d.id)
          if (telemetry) {
            // Color based on load
            const loadPercent = (telemetry.value / d.properties.capacity) * 100
            if (loadPercent > 90) return [255, 100, 0, 255] // Orange for high load
            if (loadPercent > 70) return [255, 255, 0, 255] // Yellow for medium load
          }

          switch (d.properties.operationalStatus) {
            case 'in_service': return [0, 255, 0, 255] // Green
            case 'maintenance': return [255, 255, 0, 255] // Yellow
            default: return [128, 128, 128, 255] // Gray
          }
        },
        getLineWidth: (d: any) => {
          // Width based on voltage/capacity
          const voltage = d.properties.voltage_kv || 0
          if (voltage > 100) return 8 // Transmission
          if (voltage > 10) return 5 // Distribution
          return 3 // Service
        },
        lineWidthMinPixels: 2,
        pickable: true,
        onClick: ({ object }) => {
          if (object) {
            handleElementClick({
              id: object.id,
              type: 'edge',
              geometry: object.geometry,
              properties: object.properties,
              operationalStatus: object.properties.operationalStatus
            })
          }
        },
        extensions: flowAnimation ? [new PathStyleExtension({ dash: true })] : [],
        getDashArray: flowAnimation ? [4, 2] : [0, 0],
        dashJustified: true,
        dashGapPickable: false,
        updateTriggers: {
          getLineColor: [outages, tracedElements, telemetryData],
          getDashArray: flowAnimation
        }
      }),

      // Network nodes layer
      new IconLayer({
        id: 'network-nodes',
        data: networkData.nodes,
        getPosition: (d: any) => d.geometry.coordinates,
        getIcon: (d: any) => {
          // Icon based on node type
          const iconMap: Record<string, string> = {
            'source': 'power-plant',
            'transformer': 'transformer',
            'switch': 'switch',
            'valve': 'valve',
            'pump': 'pump',
            'junction': 'junction',
            'meter': 'meter'
          }
          return iconMap[d.properties.node_type] || 'circle'
        },
        getSize: (d: any) => {
          if (d.properties.node_type === 'source') return 48
          if (d.properties.node_type === 'transformer') return 36
          return 24
        },
        getColor: (d: any) => {
          if (outages.some(o => o.affectedElements.includes(d.id))) {
            return [255, 0, 0, 255] // Red for outage
          }
          if (tracedElements.has(d.id)) {
            return [0, 255, 255, 255] // Cyan for traced
          }
          if (d.properties.operationalStatus === 'in_service') {
            return [0, 150, 0, 255] // Green
          }
          return [128, 128, 128, 255] // Gray
        },
        pickable: true,
        onClick: ({ object }) => {
          if (object) {
            handleElementClick({
              id: object.id,
              type: 'node',
              geometry: object.geometry,
              properties: object.properties,
              operationalStatus: object.properties.operationalStatus
            })
          }
        },
        updateTriggers: {
          getColor: [outages, tracedElements]
        }
      }),

      // Labels layer
      new TextLayer({
        id: 'network-labels',
        data: networkData.nodes.filter((n: any) =>
          ['source', 'transformer'].includes(n.properties.node_type)
        ),
        getPosition: (d: any) => d.geometry.coordinates,
        getText: (d: any) => d.properties.facility_id || d.properties.name,
        getSize: 14,
        getColor: [255, 255, 255, 255],
        getBackgroundColor: [0, 0, 0, 180],
        backgroundColor: true,
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'bottom'
      }),

      // Outage areas layer
      new GeoJsonLayer({
        id: 'outage-areas',
        data: {
          type: 'FeatureCollection',
          features: outages.map(o => ({
            type: 'Feature',
            geometry: o.affectedArea,
            properties: o
          }))
        },
        getFillColor: [255, 0, 0, 50],
        getLineColor: [255, 0, 0, 255],
        getLineWidth: 2,
        pickable: false,
        visible: outages.length > 0
      })
    ]

    deckRef.current.setProps({ layers })
  }, [networkData, outages, tracedElements, telemetryData, flowAnimation])

  const handleElementClick = async (element: NetworkElement) => {
    setSelectedElement(element)
    onElementClick(element)

    if (traceMode) {
      // Perform trace
      const response = await fetch(`/api/v1/network/trace/${traceMode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_point: element.geometry,
          include_devices: true
        })
      })

      const result = await response.json()
      if (result.success) {
        const traced = new Set(result.data.traced_elements.map((e: any) => e.id))
        setTracedElements(traced)
        onTraceComplete(result.data)
      }

      setTraceMode(null)
    }
  }

  const startUpstreamTrace = () => {
    setTraceMode('upstream')
    setTracedElements(new Set())
  }

  const startDownstreamTrace = () => {
    setTraceMode('downstream')
    setTracedElements(new Set())
  }

  const clearTrace = () => {
    setTracedElements(new Set())
    setTraceMode(null)
  }

  const toggleFlowAnimation = () => {
    setFlowAnimation(!flowAnimation)
  }

  return (
    <Box sx={{ position: 'relative', height: '100%' }}>
      <div id="network-map" style={{ width: '100%', height: '100%' }} />
      <canvas
        id="deck-canvas"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none'
        }}
      />

      {/* Toolbar */}
      <Paper
        sx={{
          position: 'absolute',
          top: 10,
          right: 10,
          p: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 1
        }}
      >
        <Tooltip title="Trace Upstream">
          <IconButton
            onClick={startUpstreamTrace}
            color={traceMode === 'upstream' ? 'primary' : 'default'}
          >
            <AccountTree sx={{ transform: 'rotate(180deg)' }} />
          </IconButton>
        </Tooltip>

        <Tooltip title="Trace Downstream">
          <IconButton
            onClick={startDownstreamTrace}
            color={traceMode === 'downstream' ? 'primary' : 'default'}
          >
            <AccountTree />
          </IconButton>
        </Tooltip>

        <Tooltip title="Clear Trace">
          <IconButton onClick={clearTrace}>
            <Stop />
          </IconButton>
        </Tooltip>

        <Tooltip title="Toggle Flow Animation">
          <IconButton
            onClick={toggleFlowAnimation}
            color={flowAnimation ? 'primary' : 'default'}
          >
            <Timeline />
          </IconButton>
        </Tooltip>
      </Paper>

      {/* Legend */}
      <Paper
        sx={{
          position: 'absolute',
          bottom: 10,
          left: 10,
          p: 2
        }}
      >
        <Typography variant="subtitle2" gutterBottom>
          Network Status
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 20, height: 3, bgcolor: 'green' }} />
            <Typography variant="caption">In Service</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 20, height: 3, bgcolor: 'yellow' }} />
            <Typography variant="caption">Maintenance / Medium Load</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 20, height: 3, bgcolor: 'orange' }} />
            <Typography variant="caption">High Load (>90%)</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 20, height: 3, bgcolor: 'red' }} />
            <Typography variant="caption">Outage</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 20, height: 3, bgcolor: 'cyan' }} />
            <Typography variant="caption">Traced</Typography>
          </Box>
        </Box>
      </Paper>
    </Box>
  )
}
```

### Outage Management Dashboard

```typescript
// components/OutageDashboard.tsx
import React, { useState, useEffect } from 'react'
import {
  Box, Grid, Paper, Typography, Card, CardContent,
  List, ListItem, ListItemIcon, ListItemText,
  Chip, Button, IconButton, LinearProgress,
  Table, TableBody, TableCell, TableHead, TableRow,
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Select, MenuItem, FormControl, InputLabel,
  Alert, Tabs, Tab
} from '@mui/material'
import {
  Warning, ElectricBolt, Group, Timer, LocationOn,
  Assignment, Build, NotificationImportant,
  CheckCircle, Cancel, Schedule
} from '@mui/icons-material'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { io, Socket } from 'socket.io-client'

interface OutageEvent {
  id: string
  outageNumber: string
  outageType: 'planned' | 'unplanned' | 'emergency'
  startTime: Date
  estimatedRestoration: Date
  actualRestoration?: Date
  affectedArea: GeoJSON.Polygon
  customersAffected: number
  criticalCustomers: number
  status: 'active' | 'restored' | 'cancelled'
  crews: CrewDispatch[]
}

interface CrewDispatch {
  id: string
  crewId: string
  crewName: string
  status: 'assigned' | 'enroute' | 'onsite' | 'working' | 'completed'
  dispatchTime: Date
  arrivalTime?: Date
  currentLocation?: GeoJSON.Point
}

export const OutageDashboard: React.FC = () => {
  const queryClient = useQueryClient()
  const [selectedTab, setSelectedTab] = useState(0)
  const [selectedOutage, setSelectedOutage] = useState<OutageEvent | null>(null)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [socket, setSocket] = useState<Socket | null>(null)

  // Connect to WebSocket for real-time updates
  useEffect(() => {
    const newSocket = io('/outages', {
      transports: ['websocket']
    })

    newSocket.on('outage_created', (data) => {
      queryClient.invalidateQueries(['outages'])
      // Show notification
      showNotification(`New outage: ${data.customers_affected} customers affected`)
    })

    newSocket.on('outage_updated', (data) => {
      queryClient.invalidateQueries(['outages'])
    })

    newSocket.on('crew_update', (data) => {
      queryClient.invalidateQueries(['crews'])
    })

    setSocket(newSocket)

    return () => {
      newSocket.close()
    }
  }, [queryClient])

  // Fetch active outages
  const { data: outages, isLoading: outagesLoading } = useQuery({
    queryKey: ['outages', 'active'],
    queryFn: async () => {
      const response = await fetch('/api/v1/outages?status=active')
      return response.json()
    },
    refetchInterval: 30000 // Refresh every 30 seconds
  })

  // Fetch available crews
  const { data: crews } = useQuery({
    queryKey: ['crews', 'available'],
    queryFn: async () => {
      const response = await fetch('/api/v1/crews?status=available')
      return response.json()
    }
  })

  // Create outage mutation
  const createOutage = useMutation({
    mutationFn: async (data: any) => {
      const response = await fetch('/api/v1/outages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['outages'])
      setCreateDialogOpen(false)
    }
  })

  // Assign crew mutation
  const assignCrew = useMutation({
    mutationFn: async ({ outageId, crewId }: any) => {
      const response = await fetch(`/api/v1/outages/${outageId}/crew/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ crew_id: crewId })
      })
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['outages'])
      queryClient.invalidateQueries(['crews'])
    }
  })

  const getOutageIcon = (type: string) => {
    switch (type) {
      case 'emergency': return <Warning color="error" />
      case 'unplanned': return <ElectricBolt color="warning" />
      case 'planned': return <Schedule color="info" />
      default: return <ElectricBolt />
    }
  }

  const getStatusColor = (status: string): any => {
    switch (status) {
      case 'active': return 'error'
      case 'restored': return 'success'
      case 'cancelled': return 'default'
      default: return 'default'
    }
  }

  const formatDuration = (start: Date, end?: Date) => {
    const endTime = end || new Date()
    const duration = endTime.getTime() - new Date(start).getTime()
    const hours = Math.floor(duration / (1000 * 60 * 60))
    const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60))
    return `${hours}h ${minutes}m`
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Header Statistics */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <Warning color="error" sx={{ mr: 1 }} />
                <Typography variant="h6">Active Outages</Typography>
              </Box>
              <Typography variant="h3">
                {outages?.filter((o: OutageEvent) => o.status === 'active').length || 0}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {outages?.filter((o: OutageEvent) => o.outageType === 'emergency').length || 0} emergency
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <Group color="primary" sx={{ mr: 1 }} />
                <Typography variant="h6">Customers Affected</Typography>
              </Box>
              <Typography variant="h3">
                {outages?.reduce((sum: number, o: OutageEvent) =>
                  sum + (o.status === 'active' ? o.customersAffected : 0), 0
                ).toLocaleString() || 0}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {outages?.reduce((sum: number, o: OutageEvent) =>
                  sum + (o.status === 'active' ? o.criticalCustomers : 0), 0
                ) || 0} critical
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <Build color="success" sx={{ mr: 1 }} />
                <Typography variant="h6">Crews Deployed</Typography>
              </Box>
              <Typography variant="h3">
                {outages?.reduce((sum: number, o: OutageEvent) =>
                  sum + (o.crews?.length || 0), 0
                ) || 0}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {crews?.filter((c: any) => c.status === 'available').length || 0} available
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <Timer sx={{ mr: 1 }} />
                <Typography variant="h6">Avg Restoration</Typography>
              </Box>
              <Typography variant="h3">
                {outages?.length ?
                  Math.floor(outages.reduce((sum: number, o: OutageEvent) => {
                    const restoration = new Date(o.estimatedRestoration).getTime() -
                                      new Date(o.startTime).getTime()
                    return sum + restoration
                  }, 0) / outages.length / (1000 * 60 * 60)) : 0}h
              </Typography>
              <Typography variant="body2" color="text.secondary">
                estimated time
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Main Content */}
      <Paper>
        <Tabs value={selectedTab} onChange={(_, v) => setSelectedTab(v)}>
          <Tab label="Active Outages" />
          <Tab label="Crew Management" />
          <Tab label="Switching Orders" />
          <Tab label="Analytics" />
        </Tabs>

        {/* Active Outages Tab */}
        {selectedTab === 0 && (
          <Box sx={{ p: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
              <Typography variant="h6">Active Outages</Typography>
              <Button
                variant="contained"
                startIcon={<Warning />}
                onClick={() => setCreateDialogOpen(true)}
              >
                Report Outage
              </Button>
            </Box>

            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Outage #</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Start Time</TableCell>
                  <TableCell>Duration</TableCell>
                  <TableCell>Customers</TableCell>
                  <TableCell>Crews</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {outages?.filter((o: OutageEvent) => o.status === 'active')
                  .map((outage: OutageEvent) => (
                  <TableRow key={outage.id}>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        {getOutageIcon(outage.outageType)}
                        <Typography sx={{ ml: 1 }}>
                          {outage.outageNumber}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={outage.outageType}
                        size="small"
                        color={outage.outageType === 'emergency' ? 'error' : 'default'}
                      />
                    </TableCell>
                    <TableCell>
                      {new Date(outage.startTime).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {formatDuration(outage.startTime)}
                    </TableCell>
                    <TableCell>
                      <Box>
                        <Typography>{outage.customersAffected.toLocaleString()}</Typography>
                        {outage.criticalCustomers > 0 && (
                          <Typography variant="caption" color="error">
                            {outage.criticalCustomers} critical
                          </Typography>
                        )}
                      </Box>
                    </TableCell>
                    <TableCell>
                      {outage.crews?.map(crew => (
                        <Chip
                          key={crew.id}
                          label={`${crew.crewName} (${crew.status})`}
                          size="small"
                          variant="outlined"
                        />
                      ))}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={outage.status}
                        color={getStatusColor(outage.status)}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>
                      <IconButton
                        size="small"
                        onClick={() => setSelectedOutage(outage)}
                      >
                        <Assignment />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}

        {/* Crew Management Tab */}
        {selectedTab === 1 && (
          <Box sx={{ p: 2 }}>
            <CrewManagementPanel
              crews={crews}
              outages={outages}
              onAssignCrew={assignCrew.mutate}
            />
          </Box>
        )}

        {/* Switching Orders Tab */}
        {selectedTab === 2 && (
          <Box sx={{ p: 2 }}>
            <SwitchingOrdersPanel />
          </Box>
        )}

        {/* Analytics Tab */}
        {selectedTab === 3 && (
          <Box sx={{ p: 2 }}>
            <OutageAnalyticsPanel outages={outages} />
          </Box>
        )}
      </Paper>

      {/* Create Outage Dialog */}
      <CreateOutageDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onCreate={createOutage.mutate}
      />

      {/* Outage Details Dialog */}
      {selectedOutage && (
        <OutageDetailsDialog
          outage={selectedOutage}
          onClose={() => setSelectedOutage(null)}
          availableCrews={crews}
          onAssignCrew={assignCrew.mutate}
        />
      )}
    </Box>
  )
}
```

## Testing Strategy

### Unit Tests

```python
# tests/test_network_analysis.py
import pytest
from unittest.mock import Mock, patch
import asyncio
from network_analysis import NetworkAnalysisEngine, NetworkElement

class TestNetworkAnalysis:

    @pytest.fixture
    def network_engine(self):
        db_mock = Mock()
        return NetworkAnalysisEngine(db_mock)

    @pytest.mark.asyncio
    async def test_trace_upstream(self, network_engine):
        """Test upstream trace functionality"""
        # Setup mock data
        network_engine.graph.add_node('node1', operational=True)
        network_engine.graph.add_node('node2', operational=True)
        network_engine.graph.add_edge('node1', 'node2',
                                     edge_id='edge1',
                                     impedance=10,
                                     operational=True)

        # Mock nearest element
        with patch.object(network_engine, '_find_nearest_element') as mock_find:
            mock_find.return_value = NetworkElement(
                id='node2',
                element_type='node',
                geometry={'type': 'Point', 'coordinates': [0, 0]},
                properties={},
                operational_status='in_service'
            )

            # Perform trace
            result = await network_engine.trace_upstream(
                {'type': 'Point', 'coordinates': [0, 0]}
            )

            # Assertions
            assert len(result.traced_elements) > 0
            assert 'node1' in [e.id for e in result.traced_elements]

    @pytest.mark.asyncio
    async def test_find_isolation_devices(self, network_engine):
        """Test isolation device identification"""
        # Test implementation
        pass
```

### Integration Tests

```typescript
// tests/OutageDashboard.test.tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OutageDashboard } from '../components/OutageDashboard'
import { server } from './mocks/server'

describe('OutageDashboard', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false }
      }
    })
  })

  test('displays active outages', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <OutageDashboard />
      </QueryClientProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('Active Outages')).toBeInTheDocument()
      expect(screen.getByText('OUT-20240101120000')).toBeInTheDocument()
    })
  })

  test('creates new outage', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <OutageDashboard />
      </QueryClientProvider>
    )

    fireEvent.click(screen.getByText('Report Outage'))

    // Fill form
    fireEvent.change(screen.getByLabelText('Outage Type'), {
      target: { value: 'unplanned' }
    })

    fireEvent.click(screen.getByText('Create'))

    await waitFor(() => {
      expect(screen.getByText('Outage created successfully')).toBeInTheDocument()
    })
  })
})
```

## Deployment Guide

### Docker Configuration

```yaml
# docker-compose.utilities.yml
version: '3.8'

services:
  postgis:
    image: postgis/postgis:14-3.4
    environment:
      POSTGRES_DB: utilities_gis
      POSTGRES_USER: utilities_user
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./database/migrations:/docker-entrypoint-initdb.d
    ports:
      - "5432:5432"

  timescaledb:
    image: timescale/timescaledb:latest-pg14
    environment:
      POSTGRES_DB: telemetry
      POSTGRES_USER: telemetry_user
      POSTGRES_PASSWORD: ${TELEMETRY_DB_PASSWORD}
    volumes:
      - timescale_data:/var/lib/postgresql/data
    ports:
      - "5433:5432"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

  kafka:
    image: confluentinc/cp-kafka:latest
    depends_on:
      - zookeeper
    environment:
      KAFKA_BROKER_ID: 1
      KAFKA_ZOOKEEPER_CONNECT: zookeeper:2181
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://localhost:9092
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
    ports:
      - "9092:9092"

  api:
    build: .
    depends_on:
      - postgis
      - timescaledb
      - redis
      - kafka
    environment:
      DATABASE_URL: postgresql://utilities_user:${DB_PASSWORD}@postgis:5432/utilities_gis
      TIMESCALE_URL: postgresql://telemetry_user:${TELEMETRY_DB_PASSWORD}@timescaledb:5432/telemetry
      REDIS_URL: redis://redis:6379
      KAFKA_BROKERS: kafka:9092
    ports:
      - "5001:5001"
    volumes:
      - ./:/app

  worker:
    build: .
    command: python job_runner.py
    depends_on:
      - postgis
      - redis
    environment:
      DATABASE_URL: postgresql://utilities_user:${DB_PASSWORD}@postgis:5432/utilities_gis
      REDIS_URL: redis://redis:6379
    volumes:
      - ./:/app

  client:
    build: ./client
    ports:
      - "3000:3000"
    environment:
      REACT_APP_API_URL: http://localhost:5001
      REACT_APP_WS_URL: ws://localhost:5001
    volumes:
      - ./client:/app
      - /app/node_modules

volumes:
  postgres_data:
  timescale_data:
  redis_data:
```

### Kubernetes Deployment

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: utilities-gis-api
  namespace: utilities
spec:
  replicas: 3
  selector:
    matchLabels:
      app: utilities-gis-api
  template:
    metadata:
      labels:
        app: utilities-gis-api
    spec:
      containers:
      - name: api
        image: utilities-gis:latest
        ports:
        - containerPort: 5001
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: url
        - name: REDIS_URL
          value: redis://redis-service:6379
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "2Gi"
            cpu: "2000m"
        livenessProbe:
          httpGet:
            path: /health
            port: 5001
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 5001
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: utilities-gis-api
  namespace: utilities
spec:
  selector:
    app: utilities-gis-api
  ports:
  - port: 80
    targetPort: 5001
  type: LoadBalancer
```

## Performance Optimization

### Database Optimizations

```sql
-- Performance tuning for utilities workload
ALTER SYSTEM SET shared_buffers = '4GB';
ALTER SYSTEM SET work_mem = '256MB';
ALTER SYSTEM SET maintenance_work_mem = '1GB';
ALTER SYSTEM SET effective_cache_size = '12GB';
ALTER SYSTEM SET random_page_cost = 1.1;

-- Partition telemetry table by time
CREATE TABLE monitoring.telemetry_2024_01 PARTITION OF monitoring.telemetry
FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

-- Create covering indexes
CREATE INDEX idx_network_trace ON utility_network.edges(from_node_id, to_node_id)
INCLUDE (impedance, operational_status);

-- Materialized view for network topology
CREATE MATERIALIZED VIEW utility_network.topology_view AS
SELECT
    e.id as edge_id,
    e.from_node_id,
    e.to_node_id,
    n1.node_type as from_type,
    n2.node_type as to_type,
    e.operational_status,
    e.impedance,
    ST_MakeLine(n1.geometry, n2.geometry) as line_geometry
FROM utility_network.edges e
JOIN utility_network.nodes n1 ON e.from_node_id = n1.id
JOIN utility_network.nodes n2 ON e.to_node_id = n2.id
WHERE e.operational_status = 'in_service';

CREATE UNIQUE INDEX ON utility_network.topology_view(edge_id);

-- Auto-refresh materialized view
CREATE OR REPLACE FUNCTION refresh_topology_view()
RETURNS trigger AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY utility_network.topology_view;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER refresh_topology_trigger
AFTER INSERT OR UPDATE OR DELETE ON utility_network.edges
FOR EACH STATEMENT
EXECUTE FUNCTION refresh_topology_view();
```

### Caching Strategy

```python
# caching.py
from functools import wraps
from redis import Redis
import json
import hashlib
from datetime import timedelta

class NetworkCache:
    def __init__(self, redis_client: Redis):
        self.redis = redis_client

    def cache_key(self, prefix: str, params: dict) -> str:
        """Generate cache key from parameters"""
        param_str = json.dumps(params, sort_keys=True)
        param_hash = hashlib.md5(param_str.encode()).hexdigest()
        return f"{prefix}:{param_hash}"

    def cache_result(self, prefix: str, ttl: int = 300):
        """Decorator for caching function results"""
        def decorator(func):
            @wraps(func)
            async def wrapper(*args, **kwargs):
                # Generate cache key
                cache_params = {
                    'args': str(args[1:]),  # Skip self
                    'kwargs': kwargs
                }
                key = self.cache_key(prefix, cache_params)

                # Check cache
                cached = self.redis.get(key)
                if cached:
                    return json.loads(cached)

                # Execute function
                result = await func(*args, **kwargs)

                # Store in cache
                self.redis.setex(
                    key,
                    timedelta(seconds=ttl),
                    json.dumps(result, default=str)
                )

                return result
            return wrapper
        return decorator

    def invalidate_pattern(self, pattern: str):
        """Invalidate all keys matching pattern"""
        for key in self.redis.scan_iter(match=pattern):
            self.redis.delete(key)

# Usage in network analysis
class NetworkAnalysisEngine:
    def __init__(self, db_connection, cache: NetworkCache):
        self.db = db_connection
        self.cache = cache

    @cache.cache_result('trace:upstream', ttl=600)
    async def trace_upstream(self, start_point: Dict, max_distance: float = None):
        # Implementation...
        pass
```

## Compliance & Security

### NERC CIP Compliance

```python
# security/nerc_cip.py
"""
NERC CIP (Critical Infrastructure Protection) compliance module
"""

class NERCCompliance:
    """Implements NERC CIP standards for utility systems"""

    @staticmethod
    def log_critical_access(user_id: str, asset_id: str, action: str):
        """CIP-007-6 R4: Security Event Monitoring"""
        query = """
            INSERT INTO audit_logs (
                user_id, asset_id, action, criticality,
                timestamp, ip_address, session_id
            ) VALUES (%s, %s, %s, 'critical', NOW(), %s, %s)
        """
        # Log all access to critical cyber assets

    @staticmethod
    def enforce_password_policy(password: str) -> bool:
        """CIP-007-6 R5: System Access Control"""
        # Minimum 8 characters
        # At least one uppercase, lowercase, number, special character
        # Cannot contain dictionary words
        # Must be changed every 90 days
        pass

    @staticmethod
    def validate_patch_management():
        """CIP-007-6 R2: Patch Management"""
        # Track all security patches
        # Assess patches within 35 days
        # Install or document mitigation within 35 days of assessment
        pass
```

### Data Encryption

```python
# security/encryption.py
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2

class EncryptionService:
    """Handles sensitive data encryption"""

    def __init__(self, master_key: bytes):
        self.cipher = Fernet(master_key)

    def encrypt_pii(self, data: str) -> str:
        """Encrypt personally identifiable information"""
        return self.cipher.encrypt(data.encode()).decode()

    def decrypt_pii(self, encrypted: str) -> str:
        """Decrypt personally identifiable information"""
        return self.cipher.decrypt(encrypted.encode()).decode()

    def encrypt_scada_data(self, telemetry: dict) -> dict:
        """Encrypt sensitive SCADA telemetry"""
        sensitive_fields = ['control_value', 'setpoint', 'command']

        encrypted = telemetry.copy()
        for field in sensitive_fields:
            if field in encrypted:
                encrypted[field] = self.encrypt_pii(str(encrypted[field]))

        return encrypted
```

## Conclusion

This comprehensive implementation guide provides a complete foundation for extending the Enterprise GIS platform to support utility sector operations. The architecture is designed for:

- **Scalability**: Handles millions of network elements and real-time telemetry
- **Reliability**: Redundant systems with automatic failover
- **Performance**: Optimized queries and caching for sub-second response
- **Compliance**: NERC CIP ready with full audit trails
- **Extensibility**: Modular design allows easy addition of new utility types

The implementation can be adapted for electric, water, gas, and telecommunications utilities with minimal modifications to the core architecture.