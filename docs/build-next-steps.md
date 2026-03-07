# Enterprise GIS Frontend Roadmap (20 Steps)

1. Implement React + MapLibre + deck.gl foundation. `DONE`
2. Implement JWT login/register flow in React. `DONE`
3. Implement authenticated layer creation UI. `DONE`
4. Add per-layer actions: upload, export, delete. `DONE`
5. Add feature-level drawing and editing UI. `DONE`
6. Add feature attribute editor panel. `DONE`
7. Add optimistic-lock conflict handling UX. `DONE`
8. Add layer style editor (color, opacity, stroke, point size). `DONE`
9. Add layer zoom-to-extent action. `DONE`
10. Add attribute table with filter and sort. `DONE`
11. Add search/geocoding control with result pins. `DONE`
12. Add measurement tools (distance/area) in React UI. `DONE`
13. Add spatial analysis panel (buffer/intersect/within). `DONE`
14. Add async job UX for long analyses (progress + status). `DONE`
15. Add robust RBAC handling in UI (ownership and permissions). `DONE`
16. Add audit-friendly activity feed in UI. `DONE`
17. Add offline-ready shell (PWA + cached basemaps metadata). `DONE`
18. Add frontend test suite (unit + integration + e2e smoke). `DONE`
19. Add performance hardening (code splitting, memoization, tile strategy). `DONE`
20. Add production observability hooks (error reporting + telemetry). `DONE`

## Current Sprint Focus

- Expand e2e coverage for advanced attribute table flows (query, bulk update, history rollback)
- Add map tile strategy tuning for high-density datasets
- Add org/workspace admin UI over existing RBAC backend primitives
