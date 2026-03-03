# Flask GIS Application

A Flask-based web GIS application for real-time location tracking and GeoJSON layer management, backed by MongoDB Atlas.

## Features

- Real-time GPS location tracking (iOS app integration)
- GeoJSON layer upload and management
- Interactive Leaflet map viewer
- Persistent map view state (center + zoom)
- Layer styling via MongoDB

## Quick Start

```bash
pip install -r requirements.txt
python app.py
```

Open `http://localhost:5000` in your browser.

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Serve the map viewer |
| `POST` | `/api/location` | Receive GPS location from iOS app |
| `GET` | `/api/location` | Get the latest tracked location |
| `POST` | `/upload_geojson` | Upload a GeoJSON layer with styles |
| `GET` | `/layers` | List all layers with their styles |
| `PUT` | `/update_styles` | Update styles for an existing layer |
| `POST` | `/update_map_view` | Persist the current map center and zoom |
| `GET` | `/get_map_view` | Retrieve the last saved map view |

## Documentation

For comprehensive architecture and implementation guidance, see:

- [Enterprise Web GIS — Full Documentation](docs/enterprise-gis.md)

This covers system architecture, technology stack decisions, spatial querying, data ingestion, security, performance, OGC standards, advanced capabilities (3D, real-time, ML), API design, DevOps, testing strategy, and a phased implementation roadmap.

## Dependencies

- Flask + Flask-CORS
- PyMongo (MongoDB Atlas)
- psycopg2 / postgis (PostGIS support)
- Gunicorn (production server)
