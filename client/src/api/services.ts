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

export interface FeaturesQueryPayload {
  page?: number
  page_size?: number
  sort?: { field: string; direction?: 'asc' | 'desc' }
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
  filters: QueryFilter[]
}

export interface BulkUpdatePayload {
  feature_ids?: string[]
  filters?: QueryFilter[]
  updates?: Record<string, unknown>
  session_id?: string
  calculator?: {
    type: 'copy' | 'concat' | 'math'
    field: string
    source_field?: string
    fields?: string[]
    separator?: string
    operator?: '+' | '-' | '*' | '/'
    value?: number
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
}

export interface AnalysisIntersectPayload {
  layer_a: string
  layer_b: string
  output_name: string
}

export interface AnalysisWithinPayload {
  layer_id: string
  polygon: Geometry
}

export interface AnalysisLayerResponse {
  layer: Layer
  count: number
}

export interface CreateViewPayload {
  name: string
  center: { lng: number; lat: number }
  zoom: number
  bearing?: number
  pitch?: number
}

export interface CreateJobPayload {
  job_type: 'analysis.buffer' | 'analysis.intersect' | 'analysis.within'
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

export function uploadLayerGeoJson(layerId: string, file: File, token: string): Promise<UploadLayerResult> {
  const body = new FormData()
  body.append('file', file)

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
): Promise<{ feature_ids: string[]; count: number; features?: FeatureCollection['features'] | null }> {
  return apiRequest<{ feature_ids: string[]; count: number; features?: FeatureCollection['features'] | null }>(
    `/layers/${layerId}/features/select`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
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
