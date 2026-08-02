import type { Feature as GeoJsonFeature, FeatureCollection as GeoJsonFeatureCollection, Geometry, GeoJsonProperties } from 'geojson'

export interface Layer {
  id: string
  name: string
  description: string | null
  geometry_type: string | null
  crs: string
  style: Record<string, unknown>
  min_zoom: number
  max_zoom: number
  is_public: boolean
  group_name?: string | null
  z_index?: number
  workspace_id?: string | null
  geodatabase_id?: string | null
  feature_dataset_id?: string | null
  catalog_status?: 'draft' | 'authoritative' | 'deprecated'
  tags?: string[]
  thumbnail_key?: string | null
  metadata?: Record<string, unknown>
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface CatalogMapLayer {
  id: string
  map_id: string
  source_layer_id: string | null
  parent_id: string | null
  layer_kind: 'feature' | 'group'
  title: string
  draw_order: number
  visible: boolean
  min_zoom: number
  max_zoom: number
  opacity: number
  style_override: Record<string, unknown> | null
  effective_style: Record<string, unknown>
  source_accessible: boolean
  source_error: string | null
  label_override: Record<string, unknown> | null
  popup_config: Record<string, unknown>
  definition_filter: Record<string, unknown>
  selection_enabled: boolean
  source: {
    id: string
    name: string
    description: string | null
    geometry_type: string | null
    crs: string
    style: Record<string, unknown>
    is_public: boolean
    catalog_status: 'draft' | 'authoritative' | 'deprecated'
    created_by: string | null
    created_at: string
    updated_at: string
  } | null
  created_at: string
  updated_at: string
}

export interface CatalogMap {
  id: string
  workspace_id: string | null
  name: string
  description: string | null
  basemap: Record<string, unknown>
  initial_view: Record<string, unknown>
  spatial_reference: string
  settings: Record<string, unknown>
  thumbnail_key: string | null
  is_public: boolean
  is_default: boolean
  revision: number
  created_by: string | null
  owner_name: string | null
  layer_count: number
  layers?: CatalogMapLayer[]
  created_at: string
  updated_at: string
}

export interface CatalogItem {
  id: string
  item_type: 'layer'
  name: string
  description: string | null
  geometry_type: string | null
  crs: string
  owner_name: string | null
  workspace_id: string | null
  geodatabase_id: string | null
  geodatabase_name: string | null
  feature_dataset_id: string | null
  feature_dataset_name: string | null
  catalog_status: 'draft' | 'authoritative' | 'deprecated'
  tags: string[]
  thumbnail_key: string | null
  metadata: Record<string, unknown>
  is_public: boolean
  is_favorite: boolean
  feature_count: number
  extent: Geometry | null
  updated_at: string
}

export interface CatalogSearchResult {
  items: CatalogItem[]
  total: number
  limit: number
  offset: number
}

export interface Geodatabase {
  id: string
  workspace_id: string | null
  name: string
  alias: string | null
  description: string | null
  database_type: 'enterprise' | 'project' | 'external'
  default_crs: string
  status: 'active' | 'read_only' | 'archived'
  created_by: string | null
  dataset_count: number
  created_at: string
  updated_at: string
}

export interface FeatureDataset {
  id: string
  geodatabase_id: string
  name: string
  alias: string | null
  description: string | null
  crs: string
  created_at: string
  updated_at: string
}

export type LayerFieldType = 'string' | 'integer' | 'double' | 'boolean' | 'date' | 'datetime'
export type LayerDomainType = 'codedValue' | 'range'

export interface LayerDomain {
  id: string
  layer_id: string
  name: string
  description: string | null
  domain_type: LayerDomainType
  coded_values: Array<{ code: unknown; label?: string } | unknown> | null
  min_value: number | null
  max_value: number | null
  created_at: string
  updated_at: string
}

export interface LayerFieldDomain {
  id: string
  name: string | null
  domain_type: LayerDomainType
  coded_values: Array<{ code: unknown; label?: string } | unknown> | null
  min_value: number | null
  max_value: number | null
  description: string | null
}

export interface LayerField {
  id: string
  layer_id: string
  name: string
  alias: string | null
  field_type: LayerFieldType
  nullable: boolean
  default_value: unknown
  length: number | null
  precision: number | null
  scale: number | null
  sort_order: number
  domain: LayerFieldDomain | null
  created_at: string
  updated_at: string
}

export type LayerRendererType = 'simple' | 'uniqueValue' | 'classBreaks'
export type LayerPointSymbol = 'circle' | 'square' | 'icon'
export type PolygonPatternStyle = 'solid' | 'hatch' | 'crosshatch' | 'diagonal' | 'diagonalCross' | 'dots' | 'grid'
export type PolygonPatternLibrary = 'builtin' | 'hero'
export type LayerIconLibrary =
  | 'maki'
  | 'tabler'
  | 'lucide'
  | 'heroicons_outline'
  | 'heroicons_solid'
  | 'material_symbols'
  | 'iconify'

export interface UniqueValueStop {
  value: string
  color: string
  opacity: number
}

export interface ClassBreakStop {
  min: number
  max: number
  color: string
  opacity: number
}

export interface ScaleSymbolOverride {
  minZoom: number
  maxZoom: number
  color: string
  opacity: number
  strokeWidth: number
  pointRadius: number
}

export interface LineSymbolLayer {
  id: string
  color: string
  opacity: number
  width: number
  dashArray: [number, number]
  level: number
}

export interface LabelClass {
  id: string
  name: string
  filterField: string
  filterValue: string
  labelField: string
  color: string
  size: number
  minZoom: number
  maxZoom: number
  priority: number
}

export interface LayerStyleDraft {
  rendererType: LayerRendererType
  color: string
  opacity: number
  strokeColor: string
  strokeWidth: number
  lineCasingEnabled: boolean
  lineCasingColor: string
  lineCasingWidth: number
  scaleOverrides: ScaleSymbolOverride[]
  symbolLevel: number
  lineSymbolLayers: LineSymbolLayer[]
  lineMarkerEnabled: boolean
  lineMarkerLibrary: LayerIconLibrary
  lineMarkerIcon: string
  lineMarkerSpacingMeters: number
  lineMarkerSize: number
  lineMarkerRotateWithLine: boolean
  polygonMarkerEnabled: boolean
  polygonMarkerPlacement: 'centroid' | 'interior'
  polygonMarkerLibrary: LayerIconLibrary
  polygonMarkerIcon: string
  polygonMarkerSize: number
  legendPatchShape: 'auto' | 'circle' | 'square' | 'line' | 'area'
  pointRadius: number
  lineDashArray: [number, number]
  pointShape: LayerPointSymbol
  iconLibrary: LayerIconLibrary
  iconifyPrefix: string
  iconName: string
  iconField: string
  iconSize: number
  iconRotation: number
  iconRotationField: string
  iconAllowOverlap: boolean
  labelField: string
  labelColor: string
  labelSize: number
  labelHaloColor: string
  labelHaloWidth: number
  labelMinZoom: number
  labelMaxZoom: number
  labelPriorityField: string
  labelAnchor: 'center' | 'top' | 'bottom' | 'left' | 'right'
  labelMaxCount: number
  labelCollisionEnabled: boolean
  labelWrapLength: number
  labelMaxLength: number
  labelClasses: LabelClass[]
  labelRepeatDistanceMeters: number
  labelRotateWithLine: boolean
  labelPolygonFitEnabled: boolean
  labelTextExpression: string
  sizeField: string
  sizeMin: number
  sizeMax: number
  opacityField: string
  opacityMin: number
  opacityMax: number
  polygonPatternLibrary: PolygonPatternLibrary
  polygonPattern: string
  polygonPatternColor: string
  polygonPatternOpacity: number
  polygonPatternScale: number
  fillColorExpression: string
  lineColorExpression: string
  pointRadiusExpression: string
  opacityExpression: string
  topologyNoOverlap: boolean
  snapEnabled: boolean
  snapToleranceMeters: number
  uniqueValueField: string
  uniqueValueStops: UniqueValueStop[]
  uniqueDefaultColor: string
  uniqueDefaultOpacity: number
  uniqueNullColor: string
  uniqueNullOpacity: number
  classBreakField: string
  classBreakStops: ClassBreakStop[]
  classBreakDefaultColor: string
  classBreakDefaultOpacity: number
  classBreakNullColor: string
  classBreakNullOpacity: number
}

export type Feature = GeoJsonFeature<Geometry, GeoJsonProperties> & { id?: string }

export type FeatureCollection = GeoJsonFeatureCollection<Geometry, GeoJsonProperties>

export interface AuthUser {
  id: string
  username: string
  email: string
  roles?: string[]
  created_at?: string
}

export interface AuthResponse {
  user: AuthUser
  access_token: string
  refresh_token?: string
}

export interface QueryFilter {
  field: string
  op: 'eq' | 'neq' | 'contains' | 'startswith' | 'endswith' | 'gt' | 'gte' | 'lt' | 'lte' | 'isnull' | 'notnull'
  value?: unknown
}

export interface QueryResultRow {
  id: string
  properties: Record<string, unknown>
  version: number
  created_at: string
  updated_at: string
}

export interface MapView {
  id: string
  user_id: string
  name: string
  center: { lng: number; lat: number }
  zoom: number
  bearing: number
  pitch: number
  created_at: string
  updated_at: string
}

export type UtilityType =
  | 'electric'
  | 'water'
  | 'wastewater'
  | 'stormwater'
  | 'gas'
  | 'telecom'
  | 'district_energy'
  | 'other'

export type UtilityNetworkStatus = 'planning' | 'active' | 'maintenance' | 'retired'

export interface UtilityNetwork {
  id: string
  name: string
  utility_type: UtilityType
  description: string | null
  status: UtilityNetworkStatus
  is_public: boolean
  workspace_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface UtilityNetworkSummary {
  network_id: string
  node_count: number
  edge_count: number
  service_point_count: number
  total_length_m: number
}

export interface AsyncJob {
  id: string
  job_type: string
  status: 'queued' | 'running' | 'success' | 'error' | 'cancelled'
  progress: number
  payload: Record<string, unknown>
  result?: Record<string, unknown> | null
  error?: string | null
  created_by?: string | null
  created_at?: string | null
  started_at?: string | null
  finished_at?: string | null
}

export interface LayerJoin {
  id: string
  source_layer_id: string
  target_layer_id: string
  source_field: string
  target_field: string
  join_type: 'left' | 'inner'
  name?: string | null
  created_by?: string | null
  created_at: string
  updated_at: string
}

export interface LayerShareLink {
  id: string
  layer_id: string
  token: string
  can_edit: boolean
  expires_at: string | null
  created_by: string | null
  created_at: string
  url: string
}

export interface LayerView {
  id: string
  source_layer_id: string
  name: string
  description: string | null
  definition: Record<string, unknown>
  field_whitelist: string[] | null
  is_public: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export type LayerRelationshipCardinality = 'one_to_one' | 'one_to_many' | 'many_to_one' | 'many_to_many'

export interface LayerRelationship {
  id: string
  origin_layer_id: string
  destination_layer_id: string
  origin_field: string
  destination_field: string
  cardinality: LayerRelationshipCardinality
  name: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type EditSessionStatus = 'draft' | 'in_review' | 'published' | 'abandoned'

export interface EditSession {
  id: string
  layer_id: string
  name: string
  status: EditSessionStatus
  notes: string | null
  created_by: string | null
  assigned_reviewer: string | null
  created_at: string
  updated_at: string
  submitted_at: string | null
  published_at: string | null
  change_count: number
}

export interface EditSessionChange {
  id: string
  session_id: string
  layer_id: string
  feature_id: string | null
  change_type: 'create' | 'update' | 'delete'
  geometry: Geometry | null
  properties: Record<string, unknown>
  version: number | null
  created_by: string | null
  created_at: string
}

export interface FeatureHistoryEntry {
  id: string
  feature_id: string
  layer_id: string
  version: number
  geometry: Geometry | null
  properties: Record<string, unknown>
  change_type: 'create' | 'update' | 'delete' | 'rollback'
  changed_by: string | null
  changed_at: string
}
