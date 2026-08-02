import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import AddToPhotosIcon from '@mui/icons-material/AddToPhotos'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import FavoriteIcon from '@mui/icons-material/Favorite'
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder'
import SearchIcon from '@mui/icons-material/Search'
import StorageIcon from '@mui/icons-material/Storage'
import AccountTreeIcon from '@mui/icons-material/AccountTree'
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addMapLayers,
  createLayer,
  createFeatureDataset,
  createGeodatabase,
  fetchFeatureDatasets,
  fetchGeodatabases,
  searchCatalog,
  setCatalogFavorite,
  updateLayer,
} from '../api/services'
import type { CatalogMap } from '../types/gis'

interface CatalogBrowserProps {
  token: string
  activeMap: CatalogMap | null
  onLayersAdded: () => void
}

type Collection = 'organization' | 'mine' | 'shared' | 'favorites'

function geometryLabel(value: string | null): string {
  if (!value) return 'Table'
  if (value.includes('Point')) return 'Point'
  if (value.includes('Line')) return 'Line'
  if (value.includes('Polygon')) return 'Polygon'
  return value
}

export function CatalogBrowser({ token, activeMap, onLayersAdded }: CatalogBrowserProps) {
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [collection, setCollection] = useState<Collection>('organization')
  const [geometryType, setGeometryType] = useState('')
  const [status, setStatus] = useState('')
  const [catalogGeodatabaseId, setCatalogGeodatabaseId] = useState('')
  const [activeGeodatabaseId, setActiveGeodatabaseId] = useState('')
  const [selectedDatasetId, setSelectedDatasetId] = useState('')
  const [creatingGeodatabase, setCreatingGeodatabase] = useState(false)
  const [geodatabaseName, setGeodatabaseName] = useState('')
  const [geodatabaseCrs, setGeodatabaseCrs] = useState('EPSG:4326')
  const [creatingDataset, setCreatingDataset] = useState(false)
  const [datasetName, setDatasetName] = useState('')
  const [datasetCrs, setDatasetCrs] = useState('')
  const [creatingLayer, setCreatingLayer] = useState(false)
  const [layerName, setLayerName] = useState('')
  const [layerDescription, setLayerDescription] = useState('')
  const [layerGeometryType, setLayerGeometryType] = useState('Point')
  const [addCreatedLayerToMap, setAddCreatedLayerToMap] = useState(true)
  const [storageMessage, setStorageMessage] = useState<string | null>(null)
  const [organizeGeodatabaseId, setOrganizeGeodatabaseId] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [detailsItemId, setDetailsItemId] = useState<string | null>(null)
  const [targetGroupId, setTargetGroupId] = useState('')

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedQuery(query.trim()), 250)
    return () => window.clearTimeout(handle)
  }, [query])

  const catalogQuery = useQuery({
    queryKey: ['catalog-items', token, debouncedQuery, collection, geometryType, status, catalogGeodatabaseId],
    queryFn: () => searchCatalog({ q: debouncedQuery, collection, geometry_type: geometryType, status, geodatabase_id: catalogGeodatabaseId, limit: 100 }, token),
    staleTime: 15_000,
  })

  const geodatabasesQuery = useQuery({
    queryKey: ['geodatabases', token],
    queryFn: () => fetchGeodatabases(token),
    staleTime: 30_000,
  })

  const workingGeodatabaseId = geodatabasesQuery.data?.some((item) => item.id === activeGeodatabaseId)
    ? activeGeodatabaseId
    : (geodatabasesQuery.data?.[0]?.id ?? '')

  const createGeodatabaseMutation = useMutation({
    mutationFn: () => createGeodatabase({
      name: geodatabaseName.trim(),
      default_crs: geodatabaseCrs.trim() || 'EPSG:4326',
    }, token),
    onSuccess: (created) => {
      setGeodatabaseName('')
      setGeodatabaseCrs('EPSG:4326')
      setCreatingGeodatabase(false)
      setActiveGeodatabaseId(created.id)
      setSelectedDatasetId('')
      setStorageMessage(`Created geodatabase “${created.name}”. Choose a feature dataset or create layers at its root.`)
      queryClient.invalidateQueries({ queryKey: ['geodatabases'] })
    },
  })

  const featureDatasetsQuery = useQuery({
    queryKey: ['feature-datasets', workingGeodatabaseId, token],
    queryFn: () => fetchFeatureDatasets(workingGeodatabaseId, token),
    enabled: Boolean(workingGeodatabaseId),
  })

  const organizeDatasetsQuery = useQuery({
    queryKey: ['feature-datasets', organizeGeodatabaseId, token],
    queryFn: () => fetchFeatureDatasets(organizeGeodatabaseId, token),
    enabled: Boolean(organizeGeodatabaseId),
  })

  const createDatasetMutation = useMutation({
    mutationFn: () => {
      const geodatabase = geodatabasesQuery.data?.find((item) => item.id === workingGeodatabaseId)
      return createFeatureDataset(
        workingGeodatabaseId,
        { name: datasetName.trim(), crs: datasetCrs.trim() || geodatabase?.default_crs },
        token,
      )
    },
    onSuccess: (created) => {
      setDatasetName('')
      setDatasetCrs('')
      setCreatingDataset(false)
      setSelectedDatasetId(created.id)
      setStorageMessage(`Created feature dataset “${created.name}”. New layers here must use ${created.crs}.`)
      queryClient.invalidateQueries({ queryKey: ['feature-datasets', workingGeodatabaseId] })
      queryClient.invalidateQueries({ queryKey: ['geodatabases'] })
    },
  })

  const createLayerMutation = useMutation({
    mutationFn: async () => {
      const geodatabase = geodatabasesQuery.data?.find((item) => item.id === workingGeodatabaseId)
      const dataset = featureDatasetsQuery.data?.find((item) => item.id === selectedDatasetId)
      if (!geodatabase) throw new Error('Select a working geodatabase first.')
      const created = await createLayer({
        name: layerName.trim(),
        description: layerDescription.trim() || undefined,
        geometry_type: layerGeometryType,
        crs: dataset?.crs ?? geodatabase.default_crs,
        geodatabase_id: geodatabase.id,
        feature_dataset_id: dataset?.id ?? null,
      }, token)
      if (activeMap && addCreatedLayerToMap) {
        await addMapLayers(activeMap.id, [created.id], token)
      }
      return { created, dataset, addedToMap: Boolean(activeMap && addCreatedLayerToMap) }
    },
    onSuccess: ({ created, dataset, addedToMap }) => {
      setLayerName('')
      setLayerDescription('')
      setCreatingLayer(false)
      setStorageMessage(
        `Created layer “${created.name}” in ${dataset?.name ?? 'the geodatabase root'}${addedToMap ? ' and added it to the active map' : ''}.`,
      )
      queryClient.invalidateQueries({ queryKey: ['catalog-items'] })
      queryClient.invalidateQueries({ queryKey: ['layers'] })
      queryClient.invalidateQueries({ queryKey: ['geodatabases'] })
      queryClient.invalidateQueries({ queryKey: ['feature-datasets', workingGeodatabaseId] })
      if (addedToMap) {
        queryClient.invalidateQueries({ queryKey: ['catalog-map', activeMap?.id] })
        queryClient.invalidateQueries({ queryKey: ['catalog-maps'] })
        onLayersAdded()
      }
    },
  })

  const organizeLayerMutation = useMutation({
    mutationFn: ({ itemId, featureDatasetId }: { itemId: string; featureDatasetId: string | null }) =>
      updateLayer(itemId, {
        geodatabase_id: organizeGeodatabaseId || null,
        feature_dataset_id: featureDatasetId,
      }, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['catalog-items'] })
      queryClient.invalidateQueries({ queryKey: ['layers'] })
      queryClient.invalidateQueries({ queryKey: ['geodatabases'] })
      queryClient.invalidateQueries({ queryKey: ['feature-datasets'] })
    },
  })

  const currentSourceIds = useMemo(
    () => new Set((activeMap?.layers ?? []).map((item) => item.source_layer_id).filter(Boolean)),
    [activeMap?.layers],
  )

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!activeMap) throw new Error('Create or select a map before adding data.')
      return addMapLayers(activeMap.id, selected, token, targetGroupId || null)
    },
    onSuccess: () => {
      setSelected([])
      queryClient.invalidateQueries({ queryKey: ['catalog-map', activeMap?.id] })
      queryClient.invalidateQueries({ queryKey: ['catalog-maps'] })
      onLayersAdded()
    },
  })

  const favoriteMutation = useMutation({
    mutationFn: ({ itemId, favorite }: { itemId: string; favorite: boolean }) =>
      setCatalogFavorite(itemId, favorite, token),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['catalog-items'] }),
  })

  const items = catalogQuery.data?.items ?? []
  const activeGeodatabase = geodatabasesQuery.data?.find((item) => item.id === workingGeodatabaseId) ?? null
  const selectedDataset = featureDatasetsQuery.data?.find((item) => item.id === selectedDatasetId) ?? null
  const workingCrs = selectedDataset?.crs ?? activeGeodatabase?.default_crs ?? 'EPSG:4326'

  return (
    <Stack spacing={1.25}>
      <TextField
        size="small"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search layers, tags, or descriptions"
        inputProps={{ 'aria-label': 'Search catalog' }}
        InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
      />

      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, p: 1.25, bgcolor: 'background.paper' }}>
        <Stack direction="row" spacing={0.75} alignItems="center">
          <StorageIcon fontSize="small" color="primary" />
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="subtitle2">Data storage</Typography>
            <Typography variant="caption" color="text.secondary">Choose where source layers are stored.</Typography>
          </Box>
          <Button size="small" onClick={() => setCreatingGeodatabase((value) => !value)}>
            {creatingGeodatabase ? 'Cancel' : 'New geodatabase'}
          </Button>
        </Stack>
        <Collapse in={creatingGeodatabase}>
          <Stack spacing={0.75} mt={1}>
            <TextField
              autoFocus
              size="small"
              fullWidth
              label="Geodatabase name"
              value={geodatabaseName}
              onChange={(event) => setGeodatabaseName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && geodatabaseName.trim()) createGeodatabaseMutation.mutate()
              }}
            />
            <TextField
              size="small"
              fullWidth
              label="Default coordinate system"
              value={geodatabaseCrs}
              onChange={(event) => setGeodatabaseCrs(event.target.value)}
              helperText="Used by layers created at the geodatabase root. Example: EPSG:4326."
            />
            <Stack direction="row" justifyContent="flex-end">
              <Button
                variant="contained"
                size="small"
                disabled={!geodatabaseName.trim() || createGeodatabaseMutation.isPending}
                onClick={() => createGeodatabaseMutation.mutate()}
              >
                Create geodatabase
              </Button>
            </Stack>
          </Stack>
          {createGeodatabaseMutation.error instanceof Error && (
            <Alert severity="error" sx={{ mt: 1 }}>{createGeodatabaseMutation.error.message}</Alert>
          )}
        </Collapse>

        <TextField
          select
          size="small"
          fullWidth
          sx={{ mt: 1 }}
          label="Working geodatabase"
          value={workingGeodatabaseId}
          onChange={(event) => {
            setActiveGeodatabaseId(event.target.value)
            setSelectedDatasetId('')
            setCreatingDataset(false)
            setCreatingLayer(false)
            setDatasetCrs('')
            setStorageMessage(null)
          }}
          inputProps={{ 'aria-label': 'Working geodatabase' }}
          slotProps={{ inputLabel: { shrink: true } }}
        >
          {(geodatabasesQuery.data ?? []).map((geodatabase) => (
            <MenuItem key={geodatabase.id} value={geodatabase.id}>
              {geodatabase.name}
            </MenuItem>
          ))}
        </TextField>

        {activeGeodatabase && (
          <>
            <Stack direction="row" spacing={0.5} mt={0.75} sx={{ flexWrap: 'wrap' }}>
              <Chip size="small" label={activeGeodatabase.default_crs} />
              <Chip size="small" variant="outlined" label={`${activeGeodatabase.layer_count} layers`} />
              <Chip size="small" variant="outlined" label={`${activeGeodatabase.feature_dataset_count} feature datasets`} />
            </Stack>

            <Divider sx={{ my: 1 }} />
            <Stack direction="row" spacing={0.75} alignItems="center">
              <AccountTreeIcon fontSize="small" color="action" />
              <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>Feature datasets</Typography>
              <Button size="small" startIcon={<CreateNewFolderIcon />} onClick={() => setCreatingDataset((value) => !value)}>
                {creatingDataset ? 'Cancel' : 'New dataset'}
              </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.25 }}>
              Feature datasets group related layers that share one coordinate system.
            </Typography>
            <Collapse in={creatingDataset}>
              <Stack spacing={0.75} mt={0.75}>
                <TextField
                  size="small"
                  fullWidth
                  label="Feature dataset name"
                  value={datasetName}
                  onChange={(event) => setDatasetName(event.target.value)}
                />
                <TextField
                  size="small"
                  fullWidth
                  label="Coordinate system"
                  value={datasetCrs || activeGeodatabase.default_crs}
                  onChange={(event) => setDatasetCrs(event.target.value)}
                  helperText="Layers assigned to this dataset must use this CRS."
                />
                <Stack direction="row" justifyContent="flex-end">
                  <Button
                    size="small"
                    variant="contained"
                    disabled={!datasetName.trim() || createDatasetMutation.isPending}
                    onClick={() => createDatasetMutation.mutate()}
                  >
                    Create feature dataset
                  </Button>
                </Stack>
              </Stack>
              {createDatasetMutation.error instanceof Error && (
                <Alert severity="error" sx={{ mt: 0.75 }}>{createDatasetMutation.error.message}</Alert>
              )}
            </Collapse>

            <TextField
              select
              size="small"
              fullWidth
              sx={{ mt: 1 }}
              label="Layer location"
              value={selectedDatasetId}
              onChange={(event) => {
                setSelectedDatasetId(event.target.value)
                setStorageMessage(null)
              }}
              inputProps={{ 'aria-label': 'Layer location' }}
              slotProps={{ inputLabel: { shrink: true } }}
            >
              <MenuItem value="">Geodatabase root · {activeGeodatabase.default_crs}</MenuItem>
              {(featureDatasetsQuery.data ?? []).map((dataset) => (
                <MenuItem key={dataset.id} value={dataset.id}>
                  {dataset.name} · {dataset.crs} · {dataset.layer_count} layers
                </MenuItem>
              ))}
            </TextField>
            {!featureDatasetsQuery.isLoading && !(featureDatasetsQuery.data ?? []).length && (
              <Alert severity="info" sx={{ mt: 0.75 }}>
                This geodatabase has no feature datasets yet. Create one above, or store layers at the geodatabase root.
              </Alert>
            )}

            <Box sx={{ mt: 1, p: 1, borderRadius: 1, bgcolor: 'action.hover' }}>
              <Typography variant="caption" color="text.secondary">Selected location</Typography>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                {activeGeodatabase.name} / {selectedDataset?.name ?? 'Root'}
              </Typography>
              <Typography variant="caption" color="text.secondary">Coordinate system: {workingCrs}</Typography>
              <Stack direction="row" justifyContent="flex-end" mt={0.5}>
                <Button size="small" variant="outlined" onClick={() => setCreatingLayer((value) => !value)}>
                  {creatingLayer ? 'Cancel' : 'New layer here'}
                </Button>
              </Stack>
            </Box>

            <Collapse in={creatingLayer}>
              <Stack spacing={0.75} mt={0.75}>
                <TextField size="small" label="Layer name" value={layerName} onChange={(event) => setLayerName(event.target.value)} />
                <TextField size="small" label="Description" value={layerDescription} onChange={(event) => setLayerDescription(event.target.value)} />
                <TextField select size="small" label="Geometry type" value={layerGeometryType} onChange={(event) => setLayerGeometryType(event.target.value)}>
                  <MenuItem value="Point">Point</MenuItem>
                  <MenuItem value="LineString">Line</MenuItem>
                  <MenuItem value="Polygon">Polygon</MenuItem>
                  <MenuItem value="MultiPolygon">Multipart polygon</MenuItem>
                </TextField>
                <FormControlLabel
                  control={<Checkbox checked={addCreatedLayerToMap} onChange={(_, checked) => setAddCreatedLayerToMap(checked)} />}
                  label={activeMap ? `Add to active map “${activeMap.name}”` : 'Add to active map (no map selected)'}
                  disabled={!activeMap}
                />
                <Button
                  size="small"
                  variant="contained"
                  disabled={!layerName.trim() || createLayerMutation.isPending}
                  onClick={() => createLayerMutation.mutate()}
                >
                  Create layer in {selectedDataset?.name ?? 'geodatabase root'}
                </Button>
                {createLayerMutation.error instanceof Error && <Alert severity="error">{createLayerMutation.error.message}</Alert>}
              </Stack>
            </Collapse>
            {storageMessage && <Alert severity="success" sx={{ mt: 0.75 }}>{storageMessage}</Alert>}
          </>
        )}
      </Box>

      <TextField
        select
        size="small"
        fullWidth
        label="Filter catalog by geodatabase"
        value={catalogGeodatabaseId}
        onChange={(event) => setCatalogGeodatabaseId(event.target.value)}
        inputProps={{ 'aria-label': 'Catalog geodatabase filter' }}
        slotProps={{ inputLabel: { shrink: true } }}
      >
        <MenuItem value="">All geodatabases</MenuItem>
        {(geodatabasesQuery.data ?? []).map((geodatabase) => (
          <MenuItem key={geodatabase.id} value={geodatabase.id}>{geodatabase.name}</MenuItem>
        ))}
      </TextField>

      <Stack direction="row" spacing={0.75}>
        <FormControl size="small" fullWidth>
          <Select value={collection} onChange={(event) => setCollection(event.target.value as Collection)} aria-label="Catalog collection">
            <MenuItem value="organization">Organization</MenuItem>
            <MenuItem value="mine">My Content</MenuItem>
            <MenuItem value="shared">Shared With Me</MenuItem>
            <MenuItem value="favorites">Favorites</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 105 }}>
          <Select value={geometryType} onChange={(event) => setGeometryType(event.target.value)} displayEmpty aria-label="Geometry filter">
            <MenuItem value="">All types</MenuItem>
            <MenuItem value="Point">Point</MenuItem>
            <MenuItem value="LineString">Line</MenuItem>
            <MenuItem value="Polygon">Polygon</MenuItem>
          </Select>
        </FormControl>
      </Stack>

      <Stack direction="row" spacing={0.75} alignItems="center">
        <FormControl size="small" sx={{ minWidth: 145 }}>
          <Select value={status} onChange={(event) => setStatus(event.target.value)} displayEmpty aria-label="Catalog status filter">
            <MenuItem value="">Any status</MenuItem>
            <MenuItem value="authoritative">Authoritative</MenuItem>
            <MenuItem value="draft">Draft</MenuItem>
            <MenuItem value="deprecated">Deprecated</MenuItem>
          </Select>
        </FormControl>
        <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1 }}>
          {catalogQuery.data ? `${catalogQuery.data.total} items` : 'Searching catalog'}
        </Typography>
        <Button
          size="small"
          variant="contained"
          startIcon={addMutation.isPending ? <CircularProgress size={14} color="inherit" /> : <AddToPhotosIcon />}
          disabled={!selected.length || !activeMap || addMutation.isPending}
          onClick={() => addMutation.mutate()}
        >
          Add {selected.length || ''}
        </Button>
      </Stack>

      {(activeMap?.layers ?? []).some((item) => item.layer_kind === 'group') && (
        <FormControl size="small" fullWidth>
          <Select
            value={targetGroupId}
            onChange={(event) => setTargetGroupId(event.target.value)}
            displayEmpty
            aria-label="Target map group"
          >
            <MenuItem value="">Add to map root</MenuItem>
            {(activeMap?.layers ?? []).filter((item) => item.layer_kind === 'group').map((group) => (
              <MenuItem key={group.id} value={group.id}>Add to {group.title}</MenuItem>
            ))}
          </Select>
        </FormControl>
      )}

      {addMutation.error instanceof Error && <Alert severity="error">{addMutation.error.message}</Alert>}
      {organizeLayerMutation.error instanceof Error && <Alert severity="error">{organizeLayerMutation.error.message}</Alert>}
      {catalogQuery.error instanceof Error && <Alert severity="error">{catalogQuery.error.message}</Alert>}
      {catalogQuery.isLoading && <Box display="flex" justifyContent="center" py={3}><CircularProgress size={24} /></Box>}
      {!catalogQuery.isLoading && !items.length && <Alert severity="info">No catalog items match these filters.</Alert>}

      <Stack spacing={0.75}>
        {items.map((item) => {
          const inMap = currentSourceIds.has(item.id)
          const checked = selected.includes(item.id)
          return (
            <Box key={item.id} sx={{ border: 1, borderColor: checked ? 'primary.main' : 'divider', borderRadius: 1.5, p: 1, bgcolor: checked ? 'action.selected' : 'background.paper' }}>
              <Stack direction="row" spacing={0.75} alignItems="flex-start">
                <Checkbox
                  size="small"
                  checked={checked}
                  disabled={inMap}
                  onChange={(_, next) => setSelected((previous) => next ? [...previous, item.id] : previous.filter((id) => id !== item.id))}
                  inputProps={{ 'aria-label': `Select ${item.name}` }}
                  sx={{ p: 0.25 }}
                />
                <StorageIcon fontSize="small" color={item.catalog_status === 'authoritative' ? 'success' : 'action'} sx={{ mt: 0.35 }} />
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>{item.name}</Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {geometryLabel(item.geometry_type)} · {item.feature_count.toLocaleString()} features · {item.owner_name ?? 'Unknown owner'}
                  </Typography>
                  {item.description && <Typography variant="caption" color="text.secondary" sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{item.description}</Typography>}
                  <Stack direction="row" spacing={0.5} mt={0.5} sx={{ flexWrap: 'wrap' }}>
                    <Chip size="small" label={item.catalog_status} color={item.catalog_status === 'authoritative' ? 'success' : item.catalog_status === 'deprecated' ? 'warning' : 'default'} />
                    {item.geodatabase_name && <Chip size="small" variant="outlined" label={item.geodatabase_name} />}
                    {inMap && <Chip size="small" color="primary" icon={<CheckCircleIcon />} label="In map" />}
                  </Stack>
                </Box>
                <Tooltip title={item.is_favorite ? 'Remove from favorites' : 'Add to favorites'}>
                  <IconButton size="small" onClick={() => favoriteMutation.mutate({ itemId: item.id, favorite: !item.is_favorite })}>
                    {item.is_favorite ? <FavoriteIcon fontSize="small" color="error" /> : <FavoriteBorderIcon fontSize="small" />}
                  </IconButton>
                </Tooltip>
                <Tooltip title="Item details">
                  <IconButton size="small" onClick={() => {
                    setDetailsItemId((current) => current === item.id ? null : item.id)
                    setOrganizeGeodatabaseId(item.geodatabase_id ?? '')
                  }}>
                    <InfoOutlinedIcon fontSize="small" color={detailsItemId === item.id ? 'primary' : 'inherit'} />
                  </IconButton>
                </Tooltip>
              </Stack>
              <Collapse in={detailsItemId === item.id}>
                <Box sx={{ mt: 1, ml: 4.5, p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
                  <Typography variant="caption" display="block"><strong>Spatial reference:</strong> {item.crs}</Typography>
                  <Typography variant="caption" display="block"><strong>Geodatabase:</strong> {item.geodatabase_name ?? 'Unassigned'}</Typography>
                  <Typography variant="caption" display="block"><strong>Feature dataset:</strong> {item.feature_dataset_name ?? 'None'}</Typography>
                  <Typography variant="caption" display="block"><strong>Updated:</strong> {new Date(item.updated_at).toLocaleString()}</Typography>
                  <Typography variant="caption" display="block"><strong>Extent:</strong> {item.extent ? 'Available' : 'No spatial extent'}</Typography>
                  <Stack spacing={0.75} mt={1}>
                    <FormControl size="small" fullWidth>
                      <Select
                        value={organizeGeodatabaseId || item.geodatabase_id || ''}
                        displayEmpty
                        onChange={(event) => setOrganizeGeodatabaseId(event.target.value)}
                        aria-label={`Destination geodatabase for ${item.name}`}
                      >
                        <MenuItem value="">No geodatabase</MenuItem>
                        {(geodatabasesQuery.data ?? []).map((geodatabase) => (
                          <MenuItem key={geodatabase.id} value={geodatabase.id}>{geodatabase.name}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={organizeLayerMutation.isPending || organizeGeodatabaseId === (item.geodatabase_id ?? '')}
                      onClick={() => organizeLayerMutation.mutate({ itemId: item.id, featureDatasetId: null })}
                    >
                      {organizeGeodatabaseId ? 'Move to geodatabase root' : 'Remove geodatabase assignment'}
                    </Button>
                  </Stack>
                  {(organizeGeodatabaseId || item.geodatabase_id) && (
                    <Stack spacing={0.75} mt={1}>
                      <FormControl size="small" fullWidth>
                        <Select
                          value={(organizeGeodatabaseId || item.geodatabase_id) === item.geodatabase_id ? (item.feature_dataset_id ?? '') : ''}
                          displayEmpty
                          disabled={organizeLayerMutation.isPending}
                          onChange={(event) => organizeLayerMutation.mutate({ itemId: item.id, featureDatasetId: event.target.value || null })}
                          aria-label={`Feature dataset for ${item.name}`}
                        >
                          <MenuItem value="">Move to geodatabase root</MenuItem>
                          {(organizeDatasetsQuery.data ?? []).map((dataset) => (
                            <MenuItem key={dataset.id} value={dataset.id}>{dataset.name} · {dataset.crs}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      {organizeGeodatabaseId && item.geodatabase_id !== organizeGeodatabaseId && (
                        <Typography variant="caption" color="warning.main">
                          Selecting a destination moves this owned catalog item to that geodatabase.
                        </Typography>
                      )}
                    </Stack>
                  )}
                  {item.tags.length > 0 && (
                    <Stack direction="row" spacing={0.5} mt={0.75} sx={{ flexWrap: 'wrap' }}>
                      {item.tags.map((tag) => <Chip key={tag} size="small" label={tag} />)}
                    </Stack>
                  )}
                </Box>
              </Collapse>
            </Box>
          )
        })}
      </Stack>
    </Stack>
  )
}
