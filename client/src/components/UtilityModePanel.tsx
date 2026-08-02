import { useMemo, useState } from 'react'
import type { Feature } from 'geojson'
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import AccountTreeIcon from '@mui/icons-material/AccountTree'
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline'
import type { FeatureCollection, UtilityNetwork, UtilityNetworkSummary } from '../types/gis'
import type {
  CreateUtilityEdgePayload,
  CreateUtilityNetworkPayload,
  CreateUtilityNodePayload,
  CreateUtilityServicePointPayload,
} from '../api/services'

interface UtilityModePanelProps {
  userId: string | null
  networks: UtilityNetwork[]
  selectedNetworkId: string | null
  summary: UtilityNetworkSummary | null
  nodes: FeatureCollection | null
  edges: FeatureCollection | null
  servicePoints: FeatureCollection | null
  loading: boolean
  detailLoading: boolean
  creating: boolean
  creatingNode: boolean
  creatingEdge: boolean
  creatingServicePoint: boolean
  error: string | null
  onSelectNetwork: (networkId: string) => void
  onCreateNetwork: (payload: CreateUtilityNetworkPayload) => void
  onCreateNode: (payload: CreateUtilityNodePayload) => void
  onCreateEdge: (payload: CreateUtilityEdgePayload) => void
  onCreateServicePoint: (payload: CreateUtilityServicePointPayload) => void
}

type UtilityTypeOption = CreateUtilityNetworkPayload['utility_type']
type UtilityStatusOption = NonNullable<CreateUtilityNetworkPayload['status']>
type AssetFormType = 'node' | 'edge' | 'service-point'

const DEFAULT_NETWORK_DRAFT: CreateUtilityNetworkPayload = {
  name: '',
  utility_type: 'electric',
  description: '',
  status: 'active',
  is_public: false,
}

const DEFAULT_NODE_DRAFT = {
  asset_id: '',
  name: '',
  node_type: 'substation' as CreateUtilityNodePayload['node_type'],
  status: 'in_service' as NonNullable<CreateUtilityNodePayload['status']>,
  lng: '',
  lat: '',
}

const DEFAULT_EDGE_DRAFT = {
  asset_id: '',
  name: '',
  edge_type: 'feeder' as CreateUtilityEdgePayload['edge_type'],
  status: 'in_service' as NonNullable<CreateUtilityEdgePayload['status']>,
  from_node_id: '',
  to_node_id: '',
  coordinates: '',
}

const DEFAULT_SERVICE_POINT_DRAFT = {
  asset_id: '',
  name: '',
  status: 'active' as NonNullable<CreateUtilityServicePointPayload['status']>,
  node_id: '',
  connected_edge_id: '',
  customer_count: '1',
  lng: '',
  lat: '',
}

function formatUtilityType(value: string): string {
  return value
    .split('_')
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ')
}

function countFeatures(collection: FeatureCollection | null): number {
  return collection?.features.length ?? 0
}

function featurePreview(collection: FeatureCollection | null): string[] {
  return (collection?.features ?? [])
    .slice(0, 4)
    .map((feature) => {
      const properties = (feature.properties ?? {}) as Record<string, unknown>
      return String(properties.name ?? properties.asset_id ?? feature.id ?? 'Unnamed asset')
    })
}

function featureLabel(feature: Feature): string {
  const properties = (feature.properties ?? {}) as Record<string, unknown>
  return String(properties.name ?? properties.asset_id ?? feature.id ?? 'Unnamed asset')
}

function parsePoint(lng: string, lat: string): [number, number] | null {
  const x = Number(lng)
  const y = Number(lat)
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null
  }
  return [x, y]
}

function parseLineCoordinates(raw: string): Array<[number, number]> | null {
  const parts = raw
    .split(/\n|\|/)
    .map((token) => token.trim())
    .filter(Boolean)
  if (parts.length < 2) {
    return null
  }

  const coordinates: Array<[number, number]> = []
  for (const part of parts) {
    const [lng, lat] = part.split(',').map((token) => token.trim())
    const point = parsePoint(lng ?? '', lat ?? '')
    if (!point) {
      return null
    }
    coordinates.push(point)
  }
  return coordinates
}

export function UtilityModePanel({
  userId,
  networks,
  selectedNetworkId,
  summary,
  nodes,
  edges,
  servicePoints,
  loading,
  detailLoading,
  creating,
  creatingNode,
  creatingEdge,
  creatingServicePoint,
  error,
  onSelectNetwork,
  onCreateNetwork,
  onCreateNode,
  onCreateEdge,
  onCreateServicePoint,
}: UtilityModePanelProps) {
  const [showCreateNetworkForm, setShowCreateNetworkForm] = useState(false)
  const [assetFormType, setAssetFormType] = useState<AssetFormType | null>(null)
  const [draft, setDraft] = useState<CreateUtilityNetworkPayload>(DEFAULT_NETWORK_DRAFT)
  const [nodeDraft, setNodeDraft] = useState(DEFAULT_NODE_DRAFT)
  const [edgeDraft, setEdgeDraft] = useState(DEFAULT_EDGE_DRAFT)
  const [servicePointDraft, setServicePointDraft] = useState(DEFAULT_SERVICE_POINT_DRAFT)
  const [localError, setLocalError] = useState<string | null>(null)

  const selectedNetwork = useMemo(
    () => networks.find((network) => network.id === selectedNetworkId) ?? null,
    [networks, selectedNetworkId],
  )
  const canEditSelectedNetwork = Boolean(userId && selectedNetwork?.created_by === userId)

  const nodePreview = featurePreview(nodes)
  const edgePreview = featurePreview(edges)
  const servicePointPreview = featurePreview(servicePoints)

  const nodeFeatures = useMemo(() => nodes?.features ?? [], [nodes])
  const edgeFeatures = edges?.features ?? []
  const nodeLookup = useMemo(() => {
    const next = new Map<string, [number, number]>()
    for (const feature of nodeFeatures) {
      if (feature.id == null || feature.geometry?.type !== 'Point') {
        continue
      }
      next.set(String(feature.id), [feature.geometry.coordinates[0], feature.geometry.coordinates[1]])
    }
    return next
  }, [nodeFeatures])

  const handleCreateNetwork = () => {
    const name = String(draft.name ?? '').trim()
    if (!name) {
      setLocalError('Network name is required.')
      return
    }

    setLocalError(null)
    onCreateNetwork({
      ...draft,
      name,
      description: draft.description?.trim() ?? '',
    })
    setDraft(DEFAULT_NETWORK_DRAFT)
    setShowCreateNetworkForm(false)
  }

  const handleCreateNode = () => {
    const point = parsePoint(nodeDraft.lng, nodeDraft.lat)
    if (!point) {
      setLocalError('Node requires valid longitude and latitude values.')
      return
    }

    setLocalError(null)
    onCreateNode({
      asset_id: nodeDraft.asset_id || undefined,
      name: nodeDraft.name || undefined,
      node_type: nodeDraft.node_type,
      status: nodeDraft.status,
      geometry: {
        type: 'Point',
        coordinates: point,
      },
    })
    setNodeDraft(DEFAULT_NODE_DRAFT)
    setAssetFormType(null)
  }

  const handleCreateEdge = () => {
    let coordinates = parseLineCoordinates(edgeDraft.coordinates)

    if (!coordinates && edgeDraft.from_node_id && edgeDraft.to_node_id) {
      const start = nodeLookup.get(edgeDraft.from_node_id)
      const end = nodeLookup.get(edgeDraft.to_node_id)
      if (start && end) {
        coordinates = [start, end]
      }
    }

    if (!coordinates) {
      setLocalError('Edge requires at least two coordinates, or both from/to nodes.')
      return
    }

    setLocalError(null)
    onCreateEdge({
      asset_id: edgeDraft.asset_id || undefined,
      name: edgeDraft.name || undefined,
      edge_type: edgeDraft.edge_type,
      status: edgeDraft.status,
      from_node_id: edgeDraft.from_node_id || undefined,
      to_node_id: edgeDraft.to_node_id || undefined,
      geometry: {
        type: 'LineString',
        coordinates,
      },
    })
    setEdgeDraft(DEFAULT_EDGE_DRAFT)
    setAssetFormType(null)
  }

  const handleCreateServicePoint = () => {
    const point = parsePoint(servicePointDraft.lng, servicePointDraft.lat)
    if (!point) {
      setLocalError('Service point requires valid longitude and latitude values.')
      return
    }

    setLocalError(null)
    onCreateServicePoint({
      asset_id: servicePointDraft.asset_id || undefined,
      name: servicePointDraft.name || undefined,
      status: servicePointDraft.status,
      node_id: servicePointDraft.node_id || undefined,
      connected_edge_id: servicePointDraft.connected_edge_id || undefined,
      customer_count: Math.max(0, Number(servicePointDraft.customer_count) || 0),
      geometry: {
        type: 'Point',
        coordinates: point,
      },
    })
    setServicePointDraft(DEFAULT_SERVICE_POINT_DRAFT)
    setAssetFormType(null)
  }

  return (
    <Paper
      variant="outlined"
      sx={{
        mt: 1.5,
        borderRadius: 2,
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          px: 1.5,
          py: 1.25,
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: 'rgba(16, 94, 73, 0.04)',
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
          <Stack direction="row" spacing={1} alignItems="center">
            <AccountTreeIcon color="primary" fontSize="small" />
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                Utility Mode
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Network models, assets, and infrastructure workflows
              </Typography>
            </Box>
          </Stack>
          <Chip label={`${networks.length} networks`} size="small" color="primary" variant="outlined" />
        </Stack>
      </Box>

      <Box sx={{ p: 1.5 }}>
        {!userId && (
          <Alert severity="info" sx={{ mb: 1.25 }}>
            Sign in to create and manage utility networks. Public utility networks can still be viewed.
          </Alert>
        )}

        {(error || localError) && (
          <Alert severity="error" sx={{ mb: 1.25 }}>
            {error || localError}
          </Alert>
        )}

        <Stack direction="row" spacing={1} sx={{ mb: 1.25 }}>
          <Button
            size="small"
            variant={showCreateNetworkForm ? 'contained' : 'outlined'}
            startIcon={<AddCircleOutlineIcon fontSize="small" />}
            disabled={!userId}
            onClick={() => {
              setShowCreateNetworkForm((current) => !current)
              setLocalError(null)
            }}
          >
            New Network
          </Button>
          {selectedNetwork && (
            <Chip
              size="small"
              color="success"
              variant="outlined"
              label={`${formatUtilityType(selectedNetwork.utility_type)} · ${selectedNetwork.status}`}
            />
          )}
        </Stack>

        {showCreateNetworkForm && (
          <Box
            sx={{
              display: 'grid',
              gap: 1,
              mb: 1.5,
              p: 1.25,
              border: 1,
              borderColor: 'divider',
              borderRadius: 1.5,
            }}
          >
            <TextField
              size="small"
              label="Network name"
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            />
            <Box display="grid" gridTemplateColumns="1fr 1fr" gap={1}>
              <TextField
                select
                size="small"
                label="Utility type"
                value={draft.utility_type}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    utility_type: event.target.value as UtilityTypeOption,
                  }))
                }
              >
                {(
                  [
                    'electric',
                    'water',
                    'wastewater',
                    'stormwater',
                    'gas',
                    'telecom',
                    'district_energy',
                    'other',
                  ] as UtilityTypeOption[]
                ).map((option) => (
                  <MenuItem key={option} value={option}>
                    {formatUtilityType(option)}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                size="small"
                label="Status"
                value={draft.status ?? 'active'}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    status: event.target.value as UtilityStatusOption,
                  }))
                }
              >
                {(['planning', 'active', 'maintenance', 'retired'] as UtilityStatusOption[]).map((option) => (
                  <MenuItem key={option} value={option}>
                    {formatUtilityType(option)}
                  </MenuItem>
                ))}
              </TextField>
            </Box>
            <TextField
              size="small"
              multiline
              minRows={2}
              label="Description"
              value={draft.description}
              onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
            />
            <Stack direction="row" spacing={1}>
              <Button size="small" variant="contained" disabled={creating} onClick={handleCreateNetwork}>
                {creating ? 'Creating...' : 'Create Network'}
              </Button>
              <Button
                size="small"
                variant="text"
                onClick={() => {
                  setShowCreateNetworkForm(false)
                  setDraft(DEFAULT_NETWORK_DRAFT)
                  setLocalError(null)
                }}
              >
                Cancel
              </Button>
            </Stack>
          </Box>
        )}

        {loading ? (
          <Typography variant="body2" color="text.secondary">
            Loading utility networks...
          </Typography>
        ) : !networks.length ? (
          <Alert severity="info">No utility networks yet. Create one to start modeling utility infrastructure.</Alert>
        ) : (
          <List dense disablePadding sx={{ mb: selectedNetwork ? 1.5 : 0 }}>
            {networks.map((network, index) => {
              const selected = network.id === selectedNetworkId
              const ownershipLabel = network.created_by && network.created_by === userId ? 'Owner' : network.is_public ? 'Public' : 'Shared'

              return (
                <Box key={network.id}>
                  <ListItemButton
                    selected={selected}
                    onClick={() => onSelectNetwork(network.id)}
                    sx={{ borderRadius: 1.5 }}
                  >
                    <ListItemText
                      primary={network.name}
                      secondary={`${formatUtilityType(network.utility_type)} · ${network.status}`}
                      primaryTypographyProps={{ fontWeight: 700, fontSize: '0.9rem' }}
                      secondaryTypographyProps={{ fontSize: '0.78rem' }}
                    />
                    <Chip label={ownershipLabel} size="small" color={selected ? 'primary' : 'default'} variant="outlined" />
                  </ListItemButton>
                  {index < networks.length - 1 && <Divider sx={{ my: 0.5 }} />}
                </Box>
              )
            })}
          </List>
        )}

        {selectedNetwork && (
          <Box
            sx={{
              border: 1,
              borderColor: 'divider',
              borderRadius: 1.5,
              p: 1.25,
              bgcolor: 'background.default',
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  {selectedNetwork.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {selectedNetwork.description || 'No description yet.'}
                </Typography>
              </Box>
              <Chip size="small" label={formatUtilityType(selectedNetwork.utility_type)} color="primary" />
            </Stack>

            <Box display="grid" gridTemplateColumns="repeat(2, minmax(0, 1fr))" gap={1} sx={{ mb: 1.25 }}>
              <Chip
                label={`${summary?.node_count ?? countFeatures(nodes)} nodes`}
                variant="outlined"
                color="success"
                sx={{ justifyContent: 'flex-start' }}
              />
              <Chip
                label={`${summary?.edge_count ?? countFeatures(edges)} edges`}
                variant="outlined"
                color="info"
                sx={{ justifyContent: 'flex-start' }}
              />
              <Chip
                label={`${summary?.service_point_count ?? countFeatures(servicePoints)} service points`}
                variant="outlined"
                color="warning"
                sx={{ justifyContent: 'flex-start' }}
              />
              <Chip
                label={`${Math.round(summary?.total_length_m ?? 0).toLocaleString()} m network`}
                variant="outlined"
                sx={{ justifyContent: 'flex-start' }}
              />
            </Box>

            {!canEditSelectedNetwork && (
              <Alert severity="info" sx={{ mb: 1.25 }}>
                This network is visible, but only its owner can add or change utility assets.
              </Alert>
            )}

            {canEditSelectedNetwork && (
              <Box
                sx={{
                  mb: 1.25,
                  p: 1,
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1.5,
                }}
              >
                <Typography variant="caption" sx={{ fontWeight: 700 }} display="block" gutterBottom>
                  Add Utility Assets
                </Typography>
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={assetFormType}
                  onChange={(_, nextValue: AssetFormType | null) => {
                    setAssetFormType(nextValue)
                    setLocalError(null)
                  }}
                  sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: assetFormType ? 1 : 0 }}
                >
                  <ToggleButton value="node">Node</ToggleButton>
                  <ToggleButton value="edge">Edge</ToggleButton>
                  <ToggleButton value="service-point">Service Point</ToggleButton>
                </ToggleButtonGroup>

                {assetFormType === 'node' && (
                  <Box sx={{ display: 'grid', gap: 1 }}>
                    <Box display="grid" gridTemplateColumns="1fr 1fr" gap={1}>
                      <TextField
                        size="small"
                        label="Asset ID"
                        value={nodeDraft.asset_id}
                        onChange={(event) => setNodeDraft((current) => ({ ...current, asset_id: event.target.value }))}
                      />
                      <TextField
                        size="small"
                        label="Name"
                        value={nodeDraft.name}
                        onChange={(event) => setNodeDraft((current) => ({ ...current, name: event.target.value }))}
                      />
                    </Box>
                    <Box display="grid" gridTemplateColumns="1fr 1fr" gap={1}>
                      <TextField
                        select
                        size="small"
                        label="Node type"
                        value={nodeDraft.node_type}
                        onChange={(event) =>
                          setNodeDraft((current) => ({
                            ...current,
                            node_type: event.target.value as CreateUtilityNodePayload['node_type'],
                          }))
                        }
                      >
                        {(
                          [
                            'source',
                            'substation',
                            'transformer',
                            'switch',
                            'valve',
                            'pump',
                            'junction',
                            'meter',
                            'regulator',
                            'tank',
                            'manhole',
                            'service_point',
                            'other',
                          ] as CreateUtilityNodePayload['node_type'][]
                        ).map((option) => (
                          <MenuItem key={option} value={option}>
                            {formatUtilityType(option)}
                          </MenuItem>
                        ))}
                      </TextField>
                      <TextField
                        select
                        size="small"
                        label="Status"
                        value={nodeDraft.status}
                        onChange={(event) =>
                          setNodeDraft((current) => ({
                            ...current,
                            status: event.target.value as NonNullable<CreateUtilityNodePayload['status']>,
                          }))
                        }
                      >
                        {(['planned', 'in_service', 'out_of_service', 'maintenance', 'retired'] as const).map((option) => (
                          <MenuItem key={option} value={option}>
                            {formatUtilityType(option)}
                          </MenuItem>
                        ))}
                      </TextField>
                    </Box>
                    <Box display="grid" gridTemplateColumns="1fr 1fr" gap={1}>
                      <TextField
                        size="small"
                        label="Longitude"
                        value={nodeDraft.lng}
                        onChange={(event) => setNodeDraft((current) => ({ ...current, lng: event.target.value }))}
                      />
                      <TextField
                        size="small"
                        label="Latitude"
                        value={nodeDraft.lat}
                        onChange={(event) => setNodeDraft((current) => ({ ...current, lat: event.target.value }))}
                      />
                    </Box>
                    <Stack direction="row" spacing={1}>
                      <Button size="small" variant="contained" disabled={creatingNode} onClick={handleCreateNode}>
                        {creatingNode ? 'Creating...' : 'Create Node'}
                      </Button>
                      <Button size="small" variant="text" onClick={() => setAssetFormType(null)}>
                        Cancel
                      </Button>
                    </Stack>
                  </Box>
                )}

                {assetFormType === 'edge' && (
                  <Box sx={{ display: 'grid', gap: 1 }}>
                    <Box display="grid" gridTemplateColumns="1fr 1fr" gap={1}>
                      <TextField
                        size="small"
                        label="Asset ID"
                        value={edgeDraft.asset_id}
                        onChange={(event) => setEdgeDraft((current) => ({ ...current, asset_id: event.target.value }))}
                      />
                      <TextField
                        size="small"
                        label="Name"
                        value={edgeDraft.name}
                        onChange={(event) => setEdgeDraft((current) => ({ ...current, name: event.target.value }))}
                      />
                    </Box>
                    <Box display="grid" gridTemplateColumns="1fr 1fr" gap={1}>
                      <TextField
                        select
                        size="small"
                        label="Edge type"
                        value={edgeDraft.edge_type}
                        onChange={(event) =>
                          setEdgeDraft((current) => ({
                            ...current,
                            edge_type: event.target.value as CreateUtilityEdgePayload['edge_type'],
                          }))
                        }
                      >
                        {(
                          [
                            'feeder',
                            'main',
                            'lateral',
                            'transmission',
                            'distribution',
                            'service_line',
                            'fiber',
                            'coax',
                            'duct',
                            'pipe',
                            'conduit',
                            'other',
                          ] as CreateUtilityEdgePayload['edge_type'][]
                        ).map((option) => (
                          <MenuItem key={option} value={option}>
                            {formatUtilityType(option)}
                          </MenuItem>
                        ))}
                      </TextField>
                      <TextField
                        select
                        size="small"
                        label="Status"
                        value={edgeDraft.status}
                        onChange={(event) =>
                          setEdgeDraft((current) => ({
                            ...current,
                            status: event.target.value as NonNullable<CreateUtilityEdgePayload['status']>,
                          }))
                        }
                      >
                        {(['planned', 'in_service', 'out_of_service', 'maintenance', 'retired'] as const).map((option) => (
                          <MenuItem key={option} value={option}>
                            {formatUtilityType(option)}
                          </MenuItem>
                        ))}
                      </TextField>
                    </Box>
                    <Box display="grid" gridTemplateColumns="1fr 1fr" gap={1}>
                      <TextField
                        select
                        size="small"
                        label="From node"
                        value={edgeDraft.from_node_id}
                        onChange={(event) => setEdgeDraft((current) => ({ ...current, from_node_id: event.target.value }))}
                      >
                        <MenuItem value="">None</MenuItem>
                        {nodeFeatures.map((feature) => (
                          <MenuItem key={String(feature.id)} value={String(feature.id)}>
                            {featureLabel(feature)}
                          </MenuItem>
                        ))}
                      </TextField>
                      <TextField
                        select
                        size="small"
                        label="To node"
                        value={edgeDraft.to_node_id}
                        onChange={(event) => setEdgeDraft((current) => ({ ...current, to_node_id: event.target.value }))}
                      >
                        <MenuItem value="">None</MenuItem>
                        {nodeFeatures.map((feature) => (
                          <MenuItem key={String(feature.id)} value={String(feature.id)}>
                            {featureLabel(feature)}
                          </MenuItem>
                        ))}
                      </TextField>
                    </Box>
                    <TextField
                      size="small"
                      multiline
                      minRows={2}
                      label="Coordinates"
                      placeholder="3.35,6.58 | 3.36,6.59 | 3.37,6.60"
                      value={edgeDraft.coordinates}
                      onChange={(event) => setEdgeDraft((current) => ({ ...current, coordinates: event.target.value }))}
                    />
                    <Typography variant="caption" color="text.secondary">
                      If coordinates are empty, the line will use the selected from/to node positions.
                    </Typography>
                    <Stack direction="row" spacing={1}>
                      <Button size="small" variant="contained" disabled={creatingEdge} onClick={handleCreateEdge}>
                        {creatingEdge ? 'Creating...' : 'Create Edge'}
                      </Button>
                      <Button size="small" variant="text" onClick={() => setAssetFormType(null)}>
                        Cancel
                      </Button>
                    </Stack>
                  </Box>
                )}

                {assetFormType === 'service-point' && (
                  <Box sx={{ display: 'grid', gap: 1 }}>
                    <Box display="grid" gridTemplateColumns="1fr 1fr" gap={1}>
                      <TextField
                        size="small"
                        label="Asset ID"
                        value={servicePointDraft.asset_id}
                        onChange={(event) => setServicePointDraft((current) => ({ ...current, asset_id: event.target.value }))}
                      />
                      <TextField
                        size="small"
                        label="Name"
                        value={servicePointDraft.name}
                        onChange={(event) => setServicePointDraft((current) => ({ ...current, name: event.target.value }))}
                      />
                    </Box>
                    <Box display="grid" gridTemplateColumns="1fr 1fr" gap={1}>
                      <TextField
                        select
                        size="small"
                        label="Node"
                        value={servicePointDraft.node_id}
                        onChange={(event) => setServicePointDraft((current) => ({ ...current, node_id: event.target.value }))}
                      >
                        <MenuItem value="">None</MenuItem>
                        {nodeFeatures.map((feature) => (
                          <MenuItem key={String(feature.id)} value={String(feature.id)}>
                            {featureLabel(feature)}
                          </MenuItem>
                        ))}
                      </TextField>
                      <TextField
                        select
                        size="small"
                        label="Connected edge"
                        value={servicePointDraft.connected_edge_id}
                        onChange={(event) => setServicePointDraft((current) => ({ ...current, connected_edge_id: event.target.value }))}
                      >
                        <MenuItem value="">None</MenuItem>
                        {edgeFeatures.map((feature) => (
                          <MenuItem key={String(feature.id)} value={String(feature.id)}>
                            {featureLabel(feature)}
                          </MenuItem>
                        ))}
                      </TextField>
                    </Box>
                    <Box display="grid" gridTemplateColumns="1fr 1fr 1fr" gap={1}>
                      <TextField
                        size="small"
                        label="Longitude"
                        value={servicePointDraft.lng}
                        onChange={(event) => setServicePointDraft((current) => ({ ...current, lng: event.target.value }))}
                      />
                      <TextField
                        size="small"
                        label="Latitude"
                        value={servicePointDraft.lat}
                        onChange={(event) => setServicePointDraft((current) => ({ ...current, lat: event.target.value }))}
                      />
                      <TextField
                        size="small"
                        label="Customers"
                        value={servicePointDraft.customer_count}
                        onChange={(event) => setServicePointDraft((current) => ({ ...current, customer_count: event.target.value }))}
                      />
                    </Box>
                    <Stack direction="row" spacing={1}>
                      <Button
                        size="small"
                        variant="contained"
                        disabled={creatingServicePoint}
                        onClick={handleCreateServicePoint}
                      >
                        {creatingServicePoint ? 'Creating...' : 'Create Service Point'}
                      </Button>
                      <Button size="small" variant="text" onClick={() => setAssetFormType(null)}>
                        Cancel
                      </Button>
                    </Stack>
                  </Box>
                )}
              </Box>
            )}

            {detailLoading && (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                Loading network details...
              </Typography>
            )}

            <Stack spacing={1}>
              <Box>
                <Typography variant="caption" sx={{ fontWeight: 700 }}>
                  Nodes
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  {nodePreview.length ? nodePreview.join(', ') : 'No nodes yet.'}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" sx={{ fontWeight: 700 }}>
                  Edges
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  {edgePreview.length ? edgePreview.join(', ') : 'No edges yet.'}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" sx={{ fontWeight: 700 }}>
                  Service Points
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  {servicePointPreview.length ? servicePointPreview.join(', ') : 'No service points yet.'}
                </Typography>
              </Box>
            </Stack>
          </Box>
        )}
      </Box>
    </Paper>
  )
}
