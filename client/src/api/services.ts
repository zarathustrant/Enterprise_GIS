import { apiBlobRequest, apiRequest } from './http'
import type {
  AuthResponse,
  AuthUser,
  EditSession,
  EditSessionChange,
  FeatureCollection,
  Layer,
  LayerDomain,
  LayerField,
  LayerJoin,
  LayerRelationship,
  LayerShareLink,
  LayerView,
  MapView,
  QueryFilter,
  QueryResultRow,
  AsyncJob,
  FeatureHistoryEntry,
  UtilityNetwork,
  UtilityNetworkSummary,
} from '../types/gis'
import type { Feature, Geometry } from 'geojson'

interface LoginPayload {
  username: string
  password: string
}

interface RegisterPayload {
  username: string
  email: string
  password: string
}

export interface CreateLayerPayload {
  name: string
  description?: string
  geometry_type?: string
  is_public?: boolean
}

export interface UploadLayerResult {
  inserted: number
  errors: number
  diagnostics?: Array<{ feature: number; error: string }>
  source_file?: string
  source_layer?: string | null
  source_crs?: string
  target_crs?: string
  fields_created?: number
  field_mapping?: Record<string, string>
}

export interface UpdateLayerPayload {
  name?: string
  description?: string
  geometry_type?: string
  style?: Record<string, unknown>
  min_zoom?: number
  max_zoom?: number
  is_public?: boolean
}

export interface CreateFeaturePayload {
  geometry: Geometry
  properties?: Record<string, unknown>
  session_id?: string
}

export interface UpdateFeaturePayload {
  geometry?: Geometry
  properties?: Record<string, unknown>
  version?: number
  session_id?: string
}

export interface DistinctFeatureValuesResponse {
  field: string
  values: Array<{ value: string; count: number }>
  null_count: number
  limit: number
  truncated: boolean
}

export interface GeometryValidationResult {
  valid: boolean
  geometry_type: string
  geometry: Geometry
}

export interface SplitFeaturesResult {
  preview: boolean
  source_count: number
  part_count: number
  features: FeatureCollection
}

export interface FeaturesQueryPayload {
  page?: number
  page_size?: number
  sort?: { field: string; direction?: 'asc' | 'desc' }
  sorts?: Array<{ field: string; direction: 'asc' | 'desc' }>
  filters?: QueryFilter[]
  bbox?: string
  polygon?: Geometry
  join_id?: string
}

export interface FeaturesQueryResponse {
  rows: QueryResultRow[]
  total: number
  page: number
  page_size: number
  sort: { field: string; direction: string }
  sorts?: Array<{ field: string; direction: string }>
  filters: QueryFilter[]
}

export interface BulkUpdatePayload {
  feature_ids?: string[]
  filters?: QueryFilter[]
  updates?: Record<string, unknown>
  session_id?: string
  calculator?: {
    type: 'copy' | 'concat' | 'math' | 'expression'
    field: string
    source_field?: string
    fields?: string[]
    separator?: string
    operator?: '+' | '-' | '*' | '/'
    value?: number
    expression?: string
  }
}

export interface CreateLayerDomainPayload {
  name: string
  description?: string
  domain_type: 'codedValue' | 'range'
  coded_values?: Array<{ code: unknown; label?: string } | unknown>
  min_value?: number
  max_value?: number
}

export interface UpdateLayerDomainPayload {
  name?: string
  description?: string
  domain_type?: 'codedValue' | 'range'
  coded_values?: Array<{ code: unknown; label?: string } | unknown>
  min_value?: number
  max_value?: number
}

export interface CreateLayerFieldPayload {
  name: string
  alias?: string
  field_type: 'string' | 'integer' | 'double' | 'boolean' | 'date' | 'datetime'
  nullable: boolean
  default_value?: unknown
  domain_id?: string | null
  length?: number | null
  precision?: number | null
  scale?: number | null
  sort_order?: number
}

export interface UpdateLayerFieldPayload {
  name?: string
  alias?: string
  field_type?: 'string' | 'integer' | 'double' | 'boolean' | 'date' | 'datetime'
  nullable?: boolean
  default_value?: unknown
  domain_id?: string | null
  length?: number | null
  precision?: number | null
  scale?: number | null
  sort_order?: number
}

export interface AnalysisBufferPayload {
  layer_id: string
  distance: number
  output_name: string
  async?: boolean
  execution_mode?: 'automatic' | 'synchronous' | 'asynchronous'
  environments?: AnalysisEnvironments
}

export interface AnalysisEnvironments {
  scope?: 'all' | 'selected'
  selected_feature_ids?: string[]
  scope_a?: 'all' | 'selected'
  scope_b?: 'all' | 'selected'
  selected_feature_ids_a?: string[]
  selected_feature_ids_b?: string[]
  precision_grid?: number | null
  output_crs?: 'EPSG:4326'
}

export interface VectorToolParameter {
  name: string
  label: string
  type: 'layer' | 'number' | 'string' | 'geometry' | 'choice'
  required: boolean
  default: unknown
  minimum: number | null
  choices: string[]
}

export interface VectorToolSpec {
  id: string
  version: number
  title: string
  category: string
  description: string
  input_geometry_families: string[]
  output_geometry_family: string | null
  parameters: VectorToolParameter[]
  supports_async: boolean
  migrated: boolean
  keywords: string[]
}

export interface AnalysisRun {
  id: string
  tool_id: string
  tool_version: number
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  execution_mode: 'automatic' | 'synchronous' | 'asynchronous'
  parameters: Record<string, unknown>
  environments: AnalysisEnvironments
  input_layer_ids: string[]
  input_layer_revisions: Record<string, string>
  output_layer_ids: string[]
  warnings: string[]
  metrics: Record<string, unknown>
  progress: number
  progress_stage: string | null
  error: string | null
  async_job_id: string | null
  created_by: string | null
  created_at: string | null
  started_at: string | null
  finished_at: string | null
}

export interface AnalysisIntersectPayload {
  layer_a: string
  layer_b: string
  output_name: string
  output_type?: 'auto' | 'point' | 'line' | 'polygon'
  prefix_a?: string
  prefix_b?: string
  async?: boolean
  execution_mode?: 'automatic' | 'synchronous' | 'asynchronous'
  environments?: AnalysisEnvironments
}

export interface AnalysisClipPayload {
  input_layer: string
  mask_layer: string
  output_name: string
  dissolve_mask?: boolean
  async?: boolean
  execution_mode?: 'automatic' | 'synchronous' | 'asynchronous'
  environments?: AnalysisEnvironments
}

export interface AnalysisErasePayload {
  input_layer: string
  mask_layer: string
  output_name: string
  async?: boolean
  execution_mode?: 'automatic' | 'synchronous' | 'asynchronous'
  environments?: AnalysisEnvironments
}

export interface AnalysisStatistic {
  field?: string | null
  statistic: 'count' | 'sum' | 'minimum' | 'maximum' | 'mean' | 'first' | 'last'
  output_field?: string
}

export interface AnalysisDissolvePayload {
  layer_id: string
  output_name: string
  dissolve_fields?: string[]
  statistics?: AnalysisStatistic[]
  multipart?: boolean
  null_policy?: 'group' | 'exclude'
  async?: boolean
  execution_mode?: 'automatic' | 'synchronous' | 'asynchronous'
  environments?: AnalysisEnvironments
}

export interface AnalysisSpatialJoinPayload {
  target_layer: string
  join_layer: string
  output_name: string
  predicate?: 'intersects' | 'within' | 'contains' | 'touches' | 'crosses' | 'overlaps' | 'equals' | 'within_distance'
  output_mode?: 'one_to_one' | 'one_to_many'
  keep_all?: boolean
  distance?: number | null
  target_prefix?: string
  join_prefix?: string
  async?: boolean
  execution_mode?: 'automatic' | 'synchronous' | 'asynchronous'
  environments?: AnalysisEnvironments
}

export interface AnalysisSummarizeWithinPayload {
  zone_layer: string
  summary_layer: string
  output_name: string
  group_field?: string
  statistics?: AnalysisStatistic[]
  include_empty?: boolean
  boundary_predicate?: 'intersects' | 'within'
  async?: boolean
  execution_mode?: 'automatic' | 'synchronous' | 'asynchronous'
  environments?: AnalysisEnvironments
}

export interface AnalysisWithinPayload {
  layer_id: string
  polygon: Geometry
}

export interface AnalysisLayerResponse {
  layer: Layer
  count: number
  warnings?: string[]
  analysis_run?: AnalysisRun
}

export interface CreateViewPayload {
  name: string
  center: { lng: number; lat: number }
  zoom: number
  bearing?: number
  pitch?: number
}

export interface CreateJobPayload {
  job_type: 'analysis.buffer' | 'analysis.intersect' | 'analysis.clip' | 'analysis.erase' | 'analysis.dissolve' | 'analysis.spatial_join' | 'analysis.summarize_within' | 'analysis.within'
  payload: Record<string, unknown>
}

export interface CreateLayerJoinPayload {
  target_layer_id: string
  source_field: string
  target_field: string
  join_type?: 'left' | 'inner'
  name?: string
}

export interface CreateShareLinkPayload {
  can_edit?: boolean
  expires_at?: string
}

export interface CreateLayerViewPayload {
  name: string
  description?: string
  definition?: Record<string, unknown>
  field_whitelist?: string[] | null
  is_public?: boolean
}

export interface UpdateLayerViewPayload {
  name?: string
  description?: string
  definition?: Record<string, unknown>
  field_whitelist?: string[] | null
  is_public?: boolean
}

export interface CreateLayerRelationshipPayload {
  destination_layer_id: string
  origin_field: string
  destination_field: string
  cardinality?: 'one_to_one' | 'one_to_many' | 'many_to_one' | 'many_to_many'
  name?: string
}

export interface CreateEditSessionPayload {
  name: string
  notes?: string
  assigned_reviewer?: string | null
}

export interface CreateUtilityNetworkPayload {
  name: string
  utility_type: UtilityNetwork['utility_type']
  description?: string
  status?: UtilityNetwork['status']
  is_public?: boolean
  workspace_id?: string | null
}

export interface CreateUtilityNodePayload {
  asset_id?: string
  name?: string
  node_type:
    | 'source'
    | 'substation'
    | 'transformer'
    | 'switch'
    | 'valve'
    | 'pump'
    | 'junction'
    | 'meter'
    | 'regulator'
    | 'tank'
    | 'manhole'
    | 'service_point'
    | 'other'
  status?: 'planned' | 'in_service' | 'out_of_service' | 'maintenance' | 'retired'
  elevation_m?: number
  properties?: Record<string, unknown>
  source_feature_id?: string | null
  geometry: Geometry
}

export interface CreateUtilityEdgePayload {
  asset_id?: string
  name?: string
  edge_type:
    | 'feeder'
    | 'main'
    | 'lateral'
    | 'transmission'
    | 'distribution'
    | 'service_line'
    | 'fiber'
    | 'coax'
    | 'duct'
    | 'pipe'
    | 'conduit'
    | 'other'
  status?: 'planned' | 'in_service' | 'out_of_service' | 'maintenance' | 'retired'
  from_node_id?: string | null
  to_node_id?: string | null
  length_m?: number
  properties?: Record<string, unknown>
  source_feature_id?: string | null
  geometry: Geometry
}

export interface CreateUtilityServicePointPayload {
  asset_id?: string
  name?: string
  status?: 'planned' | 'active' | 'inactive' | 'disconnected'
  node_id?: string | null
  connected_edge_id?: string | null
  customer_count?: number
  properties?: Record<string, unknown>
  source_feature_id?: string | null
  geometry: Geometry
}

export function login(payload: LoginPayload): Promise<AuthResponse> {
  return apiRequest<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function register(payload: RegisterPayload): Promise<AuthResponse> {
  return apiRequest<AuthResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function fetchCurrentUser(token: string): Promise<AuthUser> {
  return apiRequest<AuthUser>('/auth/me', {}, token)
}

export function fetchLayers(token?: string | null): Promise<Layer[]> {
  return apiRequest<Layer[]>('/layers', {}, token)
}

export function fetchLayerFeatures(layerId: string, token?: string | null): Promise<FeatureCollection> {
  return apiRequest<FeatureCollection>(`/layers/${layerId}/features`, {}, token)
}

export function fetchUtilityNetworks(token?: string | null): Promise<UtilityNetwork[]> {
  return apiRequest<UtilityNetwork[]>('/utilities/networks', {}, token)
}

export function createUtilityNetwork(payload: CreateUtilityNetworkPayload, token: string): Promise<UtilityNetwork> {
  return apiRequest<UtilityNetwork>(
    '/utilities/networks',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token,
  )
}

export function fetchUtilityNetworkSummary(networkId: string, token?: string | null): Promise<UtilityNetworkSummary> {
  return apiRequest<UtilityNetworkSummary>(`/utilities/networks/${networkId}/summary`, {}, token)
}

export function fetchUtilityNetworkNodes(networkId: string, token?: string | null, limit = 50): Promise<FeatureCollection> {
  return apiRequest<FeatureCollection>(`/utilities/networks/${networkId}/nodes?limit=${limit}`, {}, token)
}

export function fetchUtilityNetworkEdges(networkId: string, token?: string | null, limit = 50): Promise<FeatureCollection> {
  return apiRequest<FeatureCollection>(`/utilities/networks/${networkId}/edges?limit=${limit}`, {}, token)
}

export function fetchUtilityNetworkServicePoints(
  networkId: string,
  token?: string | null,
  limit = 50,
): Promise<FeatureCollection> {
  return apiRequest<FeatureCollection>(`/utilities/networks/${networkId}/service-points?limit=${limit}`, {}, token)
}

export function createUtilityNetworkNode(
  networkId: string,
  payload: CreateUtilityNodePayload,
  token: string,
): Promise<Feature> {
  return apiRequest<Feature>(
    `/utilities/networks/${networkId}/nodes`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token,
  )
}

export function createUtilityNetworkEdge(
  networkId: string,
  payload: CreateUtilityEdgePayload,
  token: string,
): Promise<Feature> {
  return apiRequest<Feature>(
    `/utilities/networks/${networkId}/edges`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token,
  )
}

export function createUtilityNetworkServicePoint(
  networkId: string,
  payload: CreateUtilityServicePointPayload,
  token: string,
): Promise<Feature> {
  return apiRequest<Feature>(
    `/utilities/networks/${networkId}/service-points`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token,
  )
}

export function queryLayerFeatures(
  layerId: string,
  payload: FeaturesQueryPayload,
  token?: string | null,
): Promise<FeaturesQueryResponse> {
  return apiRequest<FeaturesQueryResponse>(
    `/layers/${layerId}/features/query`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token,
  )
}

export function fetchLayerFields(layerId: string, token?: string | null): Promise<LayerField[]> {
  return apiRequest<LayerField[]>(`/layers/${layerId}/fields`, {}, token)
}

export function fetchLayerDomains(layerId: string, token?: string | null): Promise<LayerDomain[]> {
  return apiRequest<LayerDomain[]>(`/layers/${layerId}/domains`, {}, token)
}

export function createLayer(payload: CreateLayerPayload, token: string): Promise<Layer> {
  return apiRequest<Layer>(
    '/layers',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token,
  )
}

export function deleteLayer(layerId: string, token: string): Promise<{ message: string }> {
  return apiRequest<{ message: string }>(
    `/layers/${layerId}`,
    {
      method: 'DELETE',
    },
    token,
  )
}

export function uploadLayerGeoJson(
  layerId: string,
  file: File,
  token: string,
  options: { sourceCrs?: string; sourceLayer?: string } = {},
): Promise<UploadLayerResult> {
  const body = new FormData()
  body.append('file', file)
  if (options.sourceCrs?.trim()) body.append('source_crs', options.sourceCrs.trim())
  if (options.sourceLayer?.trim()) body.append('source_layer', options.sourceLayer.trim())

  return apiRequest<UploadLayerResult>(
    `/layers/${layerId}/upload`,
    {
      method: 'POST',
      body,
    },
    token,
  )
}

export function exportLayerGeoJson(layerId: string, token: string): Promise<Blob> {
  return apiBlobRequest(`/layers/${layerId}/export`, {}, token)
}

export function updateLayer(layerId: string, payload: UpdateLayerPayload, token: string): Promise<Layer> {
  return apiRequest<Layer>(
    `/layers/${layerId}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
    token,
  )
}

export function createLayerDomain(
  layerId: string,
  payload: CreateLayerDomainPayload,
  token: string,
): Promise<LayerDomain> {
  return apiRequest<LayerDomain>(
    `/layers/${layerId}/domains`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token,
  )
}

export function updateLayerDomain(
  layerId: string,
  domainId: string,
  payload: UpdateLayerDomainPayload,
  token: string,
): Promise<LayerDomain> {
  return apiRequest<LayerDomain>(
    `/layers/${layerId}/domains/${domainId}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
    token,
  )
}

export function deleteLayerDomain(layerId: string, domainId: string, token: string): Promise<{ message: string }> {
  return apiRequest<{ message: string }>(
    `/layers/${layerId}/domains/${domainId}`,
    {
      method: 'DELETE',
    },
    token,
  )
}

export function createLayerField(
  layerId: string,
  payload: CreateLayerFieldPayload,
  token: string,
): Promise<LayerField> {
  return apiRequest<LayerField>(
    `/layers/${layerId}/fields`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token,
  )
}

export function updateLayerField(
  layerId: string,
  fieldId: string,
  payload: UpdateLayerFieldPayload,
  token: string,
): Promise<LayerField> {
  return apiRequest<LayerField>(
    `/layers/${layerId}/fields/${fieldId}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
    token,
  )
}

export function deleteLayerField(layerId: string, fieldId: string, token: string): Promise<{ message: string }> {
  return apiRequest<{ message: string }>(
    `/layers/${layerId}/fields/${fieldId}`,
    {
      method: 'DELETE',
    },
    token,
  )
}

export function createFeature(
  layerId: string,
  payload: CreateFeaturePayload,
  token: string,
): Promise<Feature> {
  return apiRequest<Feature>(
    `/layers/${layerId}/features`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token,
  )
}

export function validateFeatureGeometry(
  layerId: string,
  geometry: Geometry,
  token: string,
  featureId?: string,
): Promise<GeometryValidationResult> {
  return apiRequest<GeometryValidationResult>(
    `/layers/${layerId}/geometry/validate`,
    {
      method: 'POST',
      body: JSON.stringify({ geometry, feature_id: featureId }),
    },
    token,
  )
}

export function splitFeatures(
  layerId: string,
  featureIds: string[],
  splitLine: Geometry,
  token: string,
  preview = false,
): Promise<SplitFeaturesResult> {
  return apiRequest<SplitFeaturesResult>(
    `/layers/${layerId}/features/split`,
    {
      method: 'POST',
      body: JSON.stringify({ feature_ids: featureIds, split_line: splitLine, preview }),
    },
    token,
  )
}

export function updateFeature(
  layerId: string,
  featureId: string,
  payload: UpdateFeaturePayload,
  token: string,
): Promise<Feature> {
  return apiRequest<Feature>(
    `/layers/${layerId}/features/${featureId}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
    token,
  )
}

export function fetchDistinctFeatureValues(
  layerId: string,
  field: string,
  token?: string | null,
  limit = 100,
): Promise<DistinctFeatureValuesResponse> {
  const params = new URLSearchParams({ field, limit: String(limit) })
  return apiRequest<DistinctFeatureValuesResponse>(
    `/layers/${layerId}/features/distinct-values?${params.toString()}`,
    {},
    token,
  )
}

export function bulkUpdateFeatures(
  layerId: string,
  payload: BulkUpdatePayload,
  token: string,
): Promise<{ updated_count: number; message?: string }> {
  return apiRequest<{ updated_count: number; message?: string }>(
    `/layers/${layerId}/features/bulk-update`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token,
  )
}

export function selectFeatures(
  layerId: string,
  payload: {
    filters?: QueryFilter[]
    bbox?: string
    polygon?: Geometry
    include_features?: boolean
    limit?: number
  },
  token?: string | null,
): Promise<{
  feature_ids: string[]
  count: number
  total: number
  truncated: boolean
  limit: number
  features?: FeatureCollection['features'] | null
}> {
  return apiRequest<{
    feature_ids: string[]
    count: number
    total: number
    truncated: boolean
    limit: number
    features?: FeatureCollection['features'] | null
  }>(
    `/layers/${layerId}/features/select`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token,
  )
}

export interface FeatureStatisticsResponse {
  count: number
  fields: Record<string, {
    valid_count: number
    sum: number | null
    avg: number | null
    min: number | null
    max: number | null
  }>
  filters: QueryFilter[]
}

export function fetchFeatureStatistics(
  layerId: string,
  payload: { filters?: QueryFilter[]; feature_ids?: string[] },
  token?: string | null,
): Promise<FeatureStatisticsResponse> {
  return apiRequest<FeatureStatisticsResponse>(
    `/layers/${layerId}/features/statistics`,
    { method: 'POST', body: JSON.stringify(payload) },
    token,
  )
}

export function exportFeatureRows(
  layerId: string,
  payload: { format: 'csv' | 'json'; filters?: QueryFilter[]; feature_ids?: string[] },
  token?: string | null,
): Promise<Blob> {
  return apiBlobRequest(
    `/layers/${layerId}/features/export`,
    { method: 'POST', body: JSON.stringify(payload) },
    token,
  )
}

export function fetchFeatureHistory(
  layerId: string,
  featureId: string,
  token?: string | null,
): Promise<FeatureHistoryEntry[]> {
  return apiRequest<FeatureHistoryEntry[]>(
    `/layers/${layerId}/features/${featureId}/history`,
    {},
    token,
  )
}

export function rollbackFeature(
  layerId: string,
  featureId: string,
  payload: { history_id?: string; version?: number },
  token: string,
): Promise<Feature> {
  return apiRequest<Feature>(
    `/layers/${layerId}/features/${featureId}/rollback`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token,
  )
}

export function fetchLayerJoins(layerId: string, token?: string | null): Promise<LayerJoin[]> {
  return apiRequest<LayerJoin[]>(
    `/layers/${layerId}/joins`,
    {},
    token,
  )
}

export function createLayerJoin(layerId: string, payload: CreateLayerJoinPayload, token: string): Promise<LayerJoin> {
  return apiRequest<LayerJoin>(
    `/layers/${layerId}/joins`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token,
  )
}

export function deleteLayerJoin(layerId: string, joinId: string, token: string): Promise<{ message: string }> {
  return apiRequest<{ message: string }>(
    `/layers/${layerId}/joins/${joinId}`,
    {
      method: 'DELETE',
    },
    token,
  )
}

export function updateLayerOrdering(
  layerId: string,
  payload: { group_name: string; z_index: number },
  token: string,
): Promise<{ id: string; group_name: string; z_index: number }> {
  return apiRequest<{ id: string; group_name: string; z_index: number }>(
    `/layers/${layerId}/ordering`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
    token,
  )
}

export function fetchShareLinks(layerId: string, token: string): Promise<LayerShareLink[]> {
  return apiRequest<LayerShareLink[]>(
    `/layers/${layerId}/share-links`,
    {},
    token,
  )
}

export function createShareLink(layerId: string, payload: CreateShareLinkPayload, token: string): Promise<LayerShareLink> {
  return apiRequest<LayerShareLink>(
    `/layers/${layerId}/share-links`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token,
  )
}

export function deleteShareLink(layerId: string, shareId: string, token: string): Promise<{ message: string }> {
  return apiRequest<{ message: string }>(
    `/layers/${layerId}/share-links/${shareId}`,
    {
      method: 'DELETE',
    },
    token,
  )
}

export function deleteFeature(layerId: string, featureId: string, token: string): Promise<{ message: string }> {
  return deleteFeatureWithSession(layerId, featureId, token)
}

export function deleteFeatureWithSession(
  layerId: string,
  featureId: string,
  token: string,
  sessionId?: string,
): Promise<{ message: string }> {
  const suffix = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ''
  return apiRequest<{ message: string }>(
    `/layers/${layerId}/features/${featureId}${suffix}`,
    {
      method: 'DELETE',
    },
    token,
  )
}

export function fetchLayerViews(layerId: string, token?: string | null): Promise<LayerView[]> {
  return apiRequest<LayerView[]>(
    `/layers/${layerId}/views`,
    {},
    token,
  )
}

export function createLayerView(layerId: string, payload: CreateLayerViewPayload, token: string): Promise<LayerView> {
  return apiRequest<LayerView>(
    `/layers/${layerId}/views`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token,
  )
}

export function updateLayerView(
  layerId: string,
  viewId: string,
  payload: UpdateLayerViewPayload,
  token: string,
): Promise<LayerView> {
  return apiRequest<LayerView>(
    `/layers/${layerId}/views/${viewId}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
    token,
  )
}

export function deleteLayerView(layerId: string, viewId: string, token: string): Promise<{ message: string }> {
  return apiRequest<{ message: string }>(
    `/layers/${layerId}/views/${viewId}`,
    {
      method: 'DELETE',
    },
    token,
  )
}

export function fetchLayerViewFeatures(viewId: string, token?: string | null): Promise<FeatureCollection> {
  return apiRequest<FeatureCollection>(
    `/layer-views/${viewId}/features`,
    {},
    token,
  )
}

export function fetchLayerRelationships(layerId: string, token?: string | null): Promise<LayerRelationship[]> {
  return apiRequest<LayerRelationship[]>(
    `/layers/${layerId}/relationships`,
    {},
    token,
  )
}

export function createLayerRelationship(
  layerId: string,
  payload: CreateLayerRelationshipPayload,
  token: string,
): Promise<LayerRelationship> {
  return apiRequest<LayerRelationship>(
    `/layers/${layerId}/relationships`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token,
  )
}

export function deleteLayerRelationship(
  layerId: string,
  relationshipId: string,
  token: string,
): Promise<{ message: string }> {
  return apiRequest<{ message: string }>(
    `/layers/${layerId}/relationships/${relationshipId}`,
    {
      method: 'DELETE',
    },
    token,
  )
}

export function fetchRelatedRecords(
  layerId: string,
  featureId: string,
  relationshipId: string,
  token?: string | null,
): Promise<QueryResultRow[]> {
  return apiRequest<QueryResultRow[]>(
    `/layers/${layerId}/features/${featureId}/related/${relationshipId}`,
    {},
    token,
  )
}

export function fetchEditSessions(layerId: string, token: string): Promise<EditSession[]> {
  return apiRequest<EditSession[]>(
    `/layers/${layerId}/sessions`,
    {},
    token,
  )
}

export function createEditSession(
  layerId: string,
  payload: CreateEditSessionPayload,
  token: string,
): Promise<EditSession> {
  return apiRequest<EditSession>(
    `/layers/${layerId}/sessions`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token,
  )
}

function transitionEditSession(
  layerId: string,
  sessionId: string,
  action: 'submit' | 'publish' | 'abandon',
  token: string,
): Promise<EditSession> {
  return apiRequest<EditSession>(
    `/layers/${layerId}/sessions/${sessionId}/${action}`,
    {
      method: 'POST',
    },
    token,
  )
}

export function submitEditSession(layerId: string, sessionId: string, token: string): Promise<EditSession> {
  return transitionEditSession(layerId, sessionId, 'submit', token)
}

export function publishEditSession(layerId: string, sessionId: string, token: string): Promise<EditSession> {
  return transitionEditSession(layerId, sessionId, 'publish', token)
}

export function abandonEditSession(layerId: string, sessionId: string, token: string): Promise<EditSession> {
  return transitionEditSession(layerId, sessionId, 'abandon', token)
}

export function fetchEditSessionChanges(layerId: string, sessionId: string, token: string): Promise<EditSessionChange[]> {
  return apiRequest<EditSessionChange[]>(
    `/layers/${layerId}/sessions/${sessionId}/changes`,
    {},
    token,
  )
}

export function runBufferAnalysis(
  payload: AnalysisBufferPayload,
  token: string,
): Promise<AnalysisLayerResponse> {
  return apiRequest<AnalysisLayerResponse>(
    '/analysis/buffer',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token,
  )
}

export function runIntersectAnalysis(
  payload: AnalysisIntersectPayload,
  token: string,
): Promise<AnalysisLayerResponse> {
  return apiRequest<AnalysisLayerResponse>(
    '/analysis/intersect',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token,
  )
}

export function runClipAnalysis(
  payload: AnalysisClipPayload,
  token: string,
): Promise<AnalysisLayerResponse> {
  return apiRequest<AnalysisLayerResponse>(
    '/analysis/clip',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token,
  )
}

export function runEraseAnalysis(
  payload: AnalysisErasePayload,
  token: string,
): Promise<AnalysisLayerResponse> {
  return apiRequest<AnalysisLayerResponse>(
    '/analysis/erase',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token,
  )
}

export function runDissolveAnalysis(
  payload: AnalysisDissolvePayload,
  token: string,
): Promise<AnalysisLayerResponse> {
  return apiRequest<AnalysisLayerResponse>(
    '/analysis/dissolve',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token,
  )
}

export function runSpatialJoinAnalysis(
  payload: AnalysisSpatialJoinPayload,
  token: string,
): Promise<AnalysisLayerResponse> {
  return apiRequest<AnalysisLayerResponse>(
    '/analysis/spatial-join',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token,
  )
}

export function runSummarizeWithinAnalysis(
  payload: AnalysisSummarizeWithinPayload,
  token: string,
): Promise<AnalysisLayerResponse> {
  return apiRequest<AnalysisLayerResponse>(
    '/analysis/summarize-within',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token,
  )
}

export function runWithinAnalysis(
  payload: AnalysisWithinPayload,
  token?: string | null,
): Promise<FeatureCollection> {
  return apiRequest<FeatureCollection>(
    '/analysis/within',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token,
  )
}

export function fetchAnalysisTools(): Promise<VectorToolSpec[]> {
  return apiRequest<{ tools: VectorToolSpec[] }>('/analysis/tools')
    .then((response) => response.tools)
}

export function fetchAnalysisRuns(token: string, limit = 50): Promise<AnalysisRun[]> {
  return apiRequest<{ runs: AnalysisRun[] }>(
    `/analysis/runs?limit=${encodeURIComponent(limit)}`,
    {},
    token,
  ).then((response) => response.runs)
}

export function fetchAnalysisRun(runId: string, token: string): Promise<AnalysisRun> {
  return apiRequest<AnalysisRun>(`/analysis/runs/${runId}`, {}, token)
}

export function fetchViews(token: string): Promise<MapView[]> {
  return apiRequest<MapView[]>(
    '/views',
    {},
    token,
  )
}

export function createView(payload: CreateViewPayload, token: string): Promise<MapView> {
  return apiRequest<MapView>(
    '/views',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token,
  )
}

export function deleteView(viewId: string, token: string): Promise<{ message: string }> {
  return apiRequest<{ message: string }>(
    `/views/${viewId}`,
    {
      method: 'DELETE',
    },
    token,
  )
}

export function createAsyncJob(payload: CreateJobPayload, token: string): Promise<AsyncJob & { queued?: boolean }> {
  return apiRequest<AsyncJob & { queued?: boolean }>(
    '/jobs',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token,
  )
}

export function fetchAsyncJobs(token: string): Promise<AsyncJob[]> {
  return apiRequest<AsyncJob[]>(
    '/jobs',
    {},
    token,
  )
}

export function fetchAsyncJob(jobId: string, token?: string | null): Promise<AsyncJob> {
  return apiRequest<AsyncJob>(
    `/jobs/${jobId}`,
    {},
    token,
  )
}

export function sendTelemetry(
  event_type: string,
  event_payload: Record<string, unknown>,
  token?: string | null,
): Promise<{ message: string }> {
  return apiRequest<{ message: string }>(
    '/telemetry',
    {
      method: 'POST',
      body: JSON.stringify({ event_type, event_payload }),
    },
    token,
  )
}
