import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  LinearProgress,
  ListItemText,
  MenuItem,
  Tab,
  Tabs,
  TextField,
  Typography,
  Switch,
} from '@mui/material'
import type { Layer } from '../types/gis'
import type { AnalysisStatistic } from '../api/services'
import { fetchLayerFields } from '../api/services'
import { useAuthStore } from '../store/auth'
import { WORK_MODE_DIALOG_PROPS, normalModeDialogSx, workModeDialogSx } from './workModeDialog'

export type AnalysisTab = 'buffer' | 'multi_ring_buffer' | 'intersect' | 'clip' | 'erase' | 'dissolve' | 'spatial_join' | 'summarize_within' | 'near' | 'polygonize' | 'within'
export type AnalysisJobStatus = 'queued' | 'running' | 'success' | 'error'

export interface AnalysisJobState {
  status: AnalysisJobStatus
  progress: number
  message: string
}

interface AnalysisDialogProps {
  open: boolean
  layers: Layer[]
  running: boolean
  error: string | null
  withinCount: number | null
  job: AnalysisJobState | null
  workMode?: boolean
  onClose: () => void
  onRunBuffer: (payload: { layerId: string; distance: number; outputName: string }) => void
  onRunMultiRingBuffer: (payload: { layerId: string; distances: number[]; outputName: string; ringType: 'rings' | 'disks' }) => void
  onRunIntersect: (payload: {
    layerA: string
    layerB: string
    outputName: string
    outputType: 'auto' | 'point' | 'line' | 'polygon'
    prefixA: string
    prefixB: string
  }) => void
  onRunClip: (payload: { inputLayer: string; maskLayer: string; outputName: string; dissolveMask: boolean }) => void
  onRunErase: (payload: { inputLayer: string; maskLayer: string; outputName: string }) => void
  onRunDissolve: (payload: {
    layerId: string
    outputName: string
    dissolveFields: string[]
    statistics: AnalysisStatistic[]
    multipart: boolean
    nullPolicy: 'group' | 'exclude'
  }) => void
  onRunSpatialJoin: (payload: {
    targetLayer: string
    joinLayer: string
    outputName: string
    predicate: 'intersects' | 'within' | 'contains' | 'touches' | 'crosses' | 'overlaps' | 'equals' | 'within_distance'
    outputMode: 'one_to_one' | 'one_to_many'
    keepAll: boolean
    distance: number | null
    targetPrefix: string
    joinPrefix: string
  }) => void
  onRunSummarizeWithin: (payload: {
    zoneLayer: string
    summaryLayer: string
    outputName: string
    groupField: string
    statistics: AnalysisStatistic[]
    includeEmpty: boolean
    boundaryPredicate: 'intersects' | 'within'
  }) => void
  onRunNear: (payload: {
    sourceLayer: string
    nearLayer: string
    outputName: string
    nearestCount: number
    maxDistance: number | null
    excludeSelf: boolean
    outputGeometry: 'connecting_line' | 'source_point' | 'near_point'
    sourcePrefix: string
    nearPrefix: string
  }) => void
  onRunPolygonize: (payload: {
    lineLayer: string
    outputName: string
    snapTolerance: number | null
    attributeTransfer: 'none' | 'first_intersecting' | 'majority_boundary'
    createDiagnostics: boolean
  }) => void
  onRunWithin: (payload: { layerId: string; polygon: string }) => void
}

export function AnalysisDialog({
  open,
  layers,
  running,
  error,
  withinCount,
  job,
  workMode = false,
  onClose,
  onRunBuffer,
  onRunMultiRingBuffer,
  onRunIntersect,
  onRunClip,
  onRunErase,
  onRunDissolve,
  onRunSpatialJoin,
  onRunSummarizeWithin,
  onRunNear,
  onRunPolygonize,
  onRunWithin,
}: AnalysisDialogProps) {
  const [tab, setTab] = useState<AnalysisTab>('buffer')
  const [bufferLayerId, setBufferLayerId] = useState('')
  const [bufferDistance, setBufferDistance] = useState('100')
  const [bufferName, setBufferName] = useState('Buffer')
  const [multiRingLayerId, setMultiRingLayerId] = useState('')
  const [multiRingDistances, setMultiRingDistances] = useState('100, 250, 500')
  const [multiRingName, setMultiRingName] = useState('Multi-Ring Buffer')
  const [multiRingType, setMultiRingType] = useState<'rings' | 'disks'>('rings')

  const [intersectA, setIntersectA] = useState('')
  const [intersectB, setIntersectB] = useState('')
  const [intersectName, setIntersectName] = useState('Intersection')
  const [intersectOutputType, setIntersectOutputType] = useState<'auto' | 'point' | 'line' | 'polygon'>('auto')
  const [intersectPrefixA, setIntersectPrefixA] = useState('a_')
  const [intersectPrefixB, setIntersectPrefixB] = useState('b_')

  const [overlayInputLayerId, setOverlayInputLayerId] = useState('')
  const [overlayMaskLayerId, setOverlayMaskLayerId] = useState('')
  const [clipName, setClipName] = useState('Clip')
  const [eraseName, setEraseName] = useState('Erase')
  const [dissolveMask, setDissolveMask] = useState(true)

  const token = useAuthStore((state) => state.token)
  const [dissolveLayerId, setDissolveLayerId] = useState('')
  const [dissolveName, setDissolveName] = useState('Dissolve')
  const [dissolveFields, setDissolveFields] = useState<string[]>([])
  const [dissolveStatistics, setDissolveStatistics] = useState<AnalysisStatistic[]>([])
  const [statisticField, setStatisticField] = useState('')
  const [statisticType, setStatisticType] = useState<AnalysisStatistic['statistic']>('count')
  const [dissolveMultipart, setDissolveMultipart] = useState(true)
  const [dissolveNullPolicy, setDissolveNullPolicy] = useState<'group' | 'exclude'>('group')

  const [spatialJoinTarget, setSpatialJoinTarget] = useState('')
  const [spatialJoinLayer, setSpatialJoinLayer] = useState('')
  const [spatialJoinName, setSpatialJoinName] = useState('Spatial Join')
  const [spatialJoinPredicate, setSpatialJoinPredicate] = useState<'intersects' | 'within' | 'contains' | 'touches' | 'crosses' | 'overlaps' | 'equals' | 'within_distance'>('intersects')
  const [spatialJoinMode, setSpatialJoinMode] = useState<'one_to_one' | 'one_to_many'>('one_to_one')
  const [spatialJoinKeepAll, setSpatialJoinKeepAll] = useState(true)
  const [spatialJoinDistance, setSpatialJoinDistance] = useState('100')
  const [spatialJoinTargetPrefix, setSpatialJoinTargetPrefix] = useState('target_')
  const [spatialJoinFieldPrefix, setSpatialJoinFieldPrefix] = useState('join_')

  const [summaryZoneLayer, setSummaryZoneLayer] = useState('')
  const [summaryFeatureLayer, setSummaryFeatureLayer] = useState('')
  const [summaryOutputName, setSummaryOutputName] = useState('Summarize Within')
  const [summaryGroupField, setSummaryGroupField] = useState('')
  const [summaryStatistics, setSummaryStatistics] = useState<AnalysisStatistic[]>([])
  const [summaryStatisticField, setSummaryStatisticField] = useState('')
  const [summaryStatisticType, setSummaryStatisticType] = useState<'sum' | 'minimum' | 'maximum' | 'mean'>('sum')
  const [summaryIncludeEmpty, setSummaryIncludeEmpty] = useState(true)
  const [summaryBoundaryPredicate, setSummaryBoundaryPredicate] = useState<'intersects' | 'within'>('intersects')

  const [nearSourceLayer, setNearSourceLayer] = useState('')
  const [nearCandidateLayer, setNearCandidateLayer] = useState('')
  const [nearOutputName, setNearOutputName] = useState('Near')
  const [nearCount, setNearCount] = useState('1')
  const [nearMaxDistance, setNearMaxDistance] = useState('')
  const [nearExcludeSelf, setNearExcludeSelf] = useState(true)
  const [nearOutputGeometry, setNearOutputGeometry] = useState<'connecting_line' | 'source_point' | 'near_point'>('connecting_line')
  const [nearSourcePrefix, setNearSourcePrefix] = useState('source_')
  const [nearFieldPrefix, setNearFieldPrefix] = useState('near_')

  const [polygonizeLayer, setPolygonizeLayer] = useState('')
  const [polygonizeName, setPolygonizeName] = useState('Polygonized Lines')
  const [polygonizeTolerance, setPolygonizeTolerance] = useState('')
  const [polygonizeTransfer, setPolygonizeTransfer] = useState<'none' | 'first_intersecting' | 'majority_boundary'>('majority_boundary')
  const [polygonizeDiagnostics, setPolygonizeDiagnostics] = useState(true)

  const [withinLayerId, setWithinLayerId] = useState('')
  const [withinPolygon, setWithinPolygon] = useState(
    '{\n  "type": "Polygon",\n  "coordinates": [[[5.58,6.29],[5.62,6.29],[5.62,6.31],[5.58,6.31],[5.58,6.29]]]\n}',
  )

  const layerOptions = useMemo(
    () => layers.map((layer) => ({ label: layer.name, value: layer.id })),
    [layers],
  )
  const polygonLayerOptions = useMemo(
    () => layerOptions.filter((item) => {
      const layer = layers.find((candidate) => candidate.id === item.value)
      return (layer?.geometry_type ?? '').toLowerCase().includes('polygon')
    }),
    [layerOptions, layers],
  )
  const lineLayerOptions = useMemo(
    () => layerOptions.filter((item) => {
      const layer = layers.find((candidate) => candidate.id === item.value)
      return (layer?.geometry_type ?? '').toLowerCase().includes('line')
    }),
    [layerOptions, layers],
  )
  const dissolveFieldsQuery = useQuery({
    queryKey: ['analysis-dissolve-fields', dissolveLayerId],
    queryFn: () => fetchLayerFields(dissolveLayerId, token as string),
    enabled: Boolean(open && token && dissolveLayerId),
  })
  const availableDissolveFields = dissolveFieldsQuery.data ?? []
  const selectedStatisticField = availableDissolveFields.find((field) => field.name === statisticField)
  const statisticOptions: AnalysisStatistic['statistic'][] = statisticField
    ? selectedStatisticField?.field_type === 'integer' || selectedStatisticField?.field_type === 'double'
      ? ['sum', 'minimum', 'maximum', 'mean', 'first', 'last']
      : ['first', 'last']
    : ['count']
  const summaryFieldsQuery = useQuery({
    queryKey: ['analysis-summary-fields', summaryFeatureLayer],
    queryFn: () => fetchLayerFields(summaryFeatureLayer, token as string),
    enabled: Boolean(open && token && summaryFeatureLayer),
  })
  const availableSummaryFields = summaryFieldsQuery.data ?? []
  const numericSummaryFields = availableSummaryFields.filter((field) => field.field_type === 'integer' || field.field_type === 'double')

  const renderMaskOverlayForm = (operation: 'clip' | 'erase') => (
    <Box display="grid" gap={2}>
      <TextField
        label="Input layer"
        value={overlayInputLayerId}
        onChange={(event) => setOverlayInputLayerId(event.target.value)}
        size="small"
        select
        fullWidth
      >
        {layerOptions.map((item) => (
          <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>
        ))}
      </TextField>
      <TextField
        label="Polygon mask layer"
        value={overlayMaskLayerId}
        onChange={(event) => setOverlayMaskLayerId(event.target.value)}
        size="small"
        select
        fullWidth
        helperText={polygonLayerOptions.length ? 'Only polygon layers can be used as masks.' : 'Create or import a polygon layer to use as a mask.'}
      >
        {polygonLayerOptions.map((item) => (
          <MenuItem key={item.value} value={item.value} disabled={item.value === overlayInputLayerId}>
            {item.label}
          </MenuItem>
        ))}
      </TextField>
      {overlayInputLayerId && overlayInputLayerId === overlayMaskLayerId && (
        <Alert severity="warning">Choose different input and mask layers.</Alert>
      )}
      {operation === 'clip' && (
        <FormControlLabel
          control={<Switch checked={dissolveMask} onChange={(event) => setDissolveMask(event.target.checked)} />}
          label="Dissolve mask before clipping"
        />
      )}
      <TextField
        label="Output layer name"
        value={operation === 'clip' ? clipName : eraseName}
        onChange={(event) => operation === 'clip' ? setClipName(event.target.value) : setEraseName(event.target.value)}
        size="small"
        fullWidth
      />
      <Button
        variant="contained"
        disabled={running || !overlayInputLayerId || !overlayMaskLayerId || overlayInputLayerId === overlayMaskLayerId}
        onClick={() => {
          if (operation === 'clip') {
            onRunClip({
              inputLayer: overlayInputLayerId,
              maskLayer: overlayMaskLayerId,
              outputName: clipName || 'Clip',
              dissolveMask,
            })
          } else {
            onRunErase({
              inputLayer: overlayInputLayerId,
              maskLayer: overlayMaskLayerId,
              outputName: eraseName || 'Erase',
            })
          }
        }}
      >
        Run {operation === 'clip' ? 'Clip' : 'Erase'}
      </Button>
    </Box>
  )

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      {...(workMode ? WORK_MODE_DIALOG_PROPS : {})}
      sx={workMode ? workModeDialogSx('min(560px, 96vw)') : normalModeDialogSx('min(560px, 96vw)')}
    >
      <DialogTitle>Spatial Analysis</DialogTitle>
      <DialogContent>
        <Tabs
          value={tab}
          onChange={(_, value) => setTab(value as AnalysisTab)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ mb: 2 }}
        >
          <Tab value="buffer" label="Buffer" />
          <Tab value="multi_ring_buffer" label="Multi-Ring" />
          <Tab value="intersect" label="Intersect" />
          <Tab value="clip" label="Clip" />
          <Tab value="erase" label="Erase" />
          <Tab value="dissolve" label="Dissolve" />
          <Tab value="spatial_join" label="Spatial Join" />
          <Tab value="summarize_within" label="Summarize Within" />
          <Tab value="near" label="Near" />
          <Tab value="polygonize" label="Polygonize" />
          <Tab value="within" label="Within" />
        </Tabs>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {job && (
          <Box sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
              <Chip
                size="small"
                label={job.status.toUpperCase()}
                color={job.status === 'error' ? 'error' : job.status === 'success' ? 'success' : 'primary'}
              />
              <Typography variant="body2" color="text.secondary">
                {Math.round(job.progress)}%
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={job.progress}
              color={job.status === 'error' ? 'error' : job.status === 'success' ? 'success' : 'primary'}
              sx={{ mb: 0.75 }}
            />
            <Typography variant="body2" color="text.secondary">
              {job.message}
            </Typography>
          </Box>
        )}

        {tab === 'buffer' && (
          <Box display="grid" gap={2}>
            <TextField
              label="Source layer"
              value={bufferLayerId}
              onChange={(event) => setBufferLayerId(event.target.value)}
              size="small"
              select
              fullWidth
            >
              {layerOptions.map((item) => (
                <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>
              ))}
            </TextField>
            <TextField
              label="Distance (meters)"
              type="number"
              value={bufferDistance}
              onChange={(event) => setBufferDistance(event.target.value)}
              size="small"
              fullWidth
            />
            <TextField
              label="Output layer name"
              value={bufferName}
              onChange={(event) => setBufferName(event.target.value)}
              size="small"
              fullWidth
            />
            <Button
              variant="contained"
              disabled={running || !bufferLayerId || !bufferDistance}
              onClick={() => onRunBuffer({ layerId: bufferLayerId, distance: Number(bufferDistance), outputName: bufferName || 'Buffer' })}
            >
              Run Buffer
            </Button>
          </Box>
        )}

        {tab === 'multi_ring_buffer' && (
          <Box display="grid" gap={2}>
            <TextField label="Source layer" value={multiRingLayerId} onChange={(event) => setMultiRingLayerId(event.target.value)} size="small" select>
              {layerOptions.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}
            </TextField>
            <TextField
              label="Distances (metres)"
              value={multiRingDistances}
              onChange={(event) => setMultiRingDistances(event.target.value)}
              size="small"
              helperText="Comma-separated positive distances; duplicates are removed and values are sorted."
            />
            <TextField label="Band behavior" value={multiRingType} onChange={(event) => setMultiRingType(event.target.value as 'rings' | 'disks')} size="small" select>
              <MenuItem value="rings">Non-overlapping rings</MenuItem>
              <MenuItem value="disks">Cumulative buffer disks</MenuItem>
            </TextField>
            <TextField label="Output layer name" value={multiRingName} onChange={(event) => setMultiRingName(event.target.value)} size="small" />
            <Button
              variant="contained"
              disabled={running || !multiRingLayerId || !multiRingDistances.trim()}
              onClick={() => onRunMultiRingBuffer({
                layerId: multiRingLayerId,
                distances: multiRingDistances.split(',').map((value) => Number(value.trim())).filter((value) => Number.isFinite(value) && value > 0),
                outputName: multiRingName || 'Multi-Ring Buffer',
                ringType: multiRingType,
              })}
            >Run Multi-Ring Buffer</Button>
          </Box>
        )}

        {tab === 'intersect' && (
          <Box display="grid" gap={2}>
            <TextField
              label="Layer A"
              value={intersectA}
              onChange={(event) => setIntersectA(event.target.value)}
              size="small"
              select
              fullWidth
            >
              {layerOptions.map((item) => (
                <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>
              ))}
            </TextField>
            <TextField
              label="Layer B"
              value={intersectB}
              onChange={(event) => setIntersectB(event.target.value)}
              size="small"
              select
              fullWidth
            >
              {layerOptions.map((item) => (
                <MenuItem key={item.value} value={item.value} disabled={item.value === intersectA}>
                  {item.label}
                </MenuItem>
              ))}
            </TextField>
            {intersectA && intersectA === intersectB && (
              <Alert severity="warning">Choose two different layers. Self-intersection is a separate operation.</Alert>
            )}
            <TextField
              label="Output geometry"
              value={intersectOutputType}
              onChange={(event) => setIntersectOutputType(event.target.value as typeof intersectOutputType)}
              size="small"
              select
              fullWidth
              helperText="Auto uses the lowest input dimension. Explicit types retain only matching components."
            >
              <MenuItem value="auto">Automatic</MenuItem>
              <MenuItem value="polygon">Polygon components</MenuItem>
              <MenuItem value="line">Line components</MenuItem>
              <MenuItem value="point">Point components</MenuItem>
            </TextField>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
              <TextField
                label="Layer A prefix"
                value={intersectPrefixA}
                onChange={(event) => setIntersectPrefixA(event.target.value)}
                size="small"
                inputProps={{ maxLength: 16 }}
              />
              <TextField
                label="Layer B prefix"
                value={intersectPrefixB}
                onChange={(event) => setIntersectPrefixB(event.target.value)}
                size="small"
                inputProps={{ maxLength: 16 }}
              />
            </Box>
            <TextField
              label="Output layer name"
              value={intersectName}
              onChange={(event) => setIntersectName(event.target.value)}
              size="small"
              fullWidth
            />
            <Button
              variant="contained"
              disabled={running || !intersectA || !intersectB || intersectA === intersectB || !intersectPrefixA || !intersectPrefixB}
              onClick={() => onRunIntersect({
                layerA: intersectA,
                layerB: intersectB,
                outputName: intersectName || 'Intersection',
                outputType: intersectOutputType,
                prefixA: intersectPrefixA,
                prefixB: intersectPrefixB,
              })}
            >
              Run Intersect
            </Button>
          </Box>
        )}

        {tab === 'clip' && renderMaskOverlayForm('clip')}
        {tab === 'erase' && renderMaskOverlayForm('erase')}

        {tab === 'dissolve' && (
          <Box display="grid" gap={2}>
            <TextField
              label="Input layer"
              value={dissolveLayerId}
              onChange={(event) => {
                setDissolveLayerId(event.target.value)
                setDissolveFields([])
                setDissolveStatistics([])
                setStatisticField('')
                setStatisticType('count')
              }}
              size="small"
              select
              fullWidth
            >
              {layerOptions.map((item) => (
                <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>
              ))}
            </TextField>
            <TextField
              label="Dissolve fields"
              value={dissolveFields}
              onChange={(event) => setDissolveFields(event.target.value as unknown as string[])}
              size="small"
              select
              fullWidth
              disabled={!dissolveLayerId || dissolveFieldsQuery.isFetching}
              SelectProps={{
                multiple: true,
                renderValue: (selected) => (selected as string[]).join(', ') || 'Dissolve all',
              }}
              helperText="Leave empty to dissolve all features into one group."
            >
              {availableDissolveFields.map((field) => (
                <MenuItem key={field.id} value={field.name}>
                  <Checkbox checked={dissolveFields.includes(field.name)} size="small" />
                  <ListItemText primary={field.alias || field.name} secondary={field.name} />
                </MenuItem>
              ))}
            </TextField>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 1 }}>
              <TextField
                label="Statistic field"
                value={statisticField}
                onChange={(event) => {
                  const value = event.target.value
                  setStatisticField(value)
                  const field = availableDissolveFields.find((candidate) => candidate.name === value)
                  setStatisticType(!value ? 'count' : field?.field_type === 'integer' || field?.field_type === 'double' ? 'sum' : 'first')
                }}
                size="small"
                select
              >
                <MenuItem value="">Feature count</MenuItem>
                {availableDissolveFields.map((field) => (
                  <MenuItem key={field.id} value={field.name}>{field.alias || field.name}</MenuItem>
                ))}
              </TextField>
              <TextField
                label="Statistic"
                value={statisticType}
                onChange={(event) => setStatisticType(event.target.value as AnalysisStatistic['statistic'])}
                size="small"
                select
              >
                {statisticOptions.map((option) => (
                  <MenuItem key={option} value={option}>{option}</MenuItem>
                ))}
              </TextField>
              <Button
                variant="outlined"
                onClick={() => {
                  const next = { field: statisticField || null, statistic: statisticType }
                  if (!dissolveStatistics.some((item) => item.field === next.field && item.statistic === next.statistic)) {
                    setDissolveStatistics((current) => [...current, next])
                  }
                }}
              >
                Add
              </Button>
            </Box>
            {dissolveStatistics.length > 0 && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {dissolveStatistics.map((statistic, index) => (
                  <Chip
                    key={`${statistic.field ?? 'features'}-${statistic.statistic}`}
                    label={`${statistic.statistic}: ${statistic.field ?? 'features'}`}
                    onDelete={() => setDissolveStatistics((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                  />
                ))}
              </Box>
            )}
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
              <FormControlLabel
                control={<Switch checked={dissolveMultipart} onChange={(event) => setDissolveMultipart(event.target.checked)} />}
                label="Multipart output"
              />
              <TextField
                label="Null groups"
                value={dissolveNullPolicy}
                onChange={(event) => setDissolveNullPolicy(event.target.value as 'group' | 'exclude')}
                size="small"
                select
              >
                <MenuItem value="group">Keep as group</MenuItem>
                <MenuItem value="exclude">Exclude</MenuItem>
              </TextField>
            </Box>
            <TextField
              label="Output layer name"
              value={dissolveName}
              onChange={(event) => setDissolveName(event.target.value)}
              size="small"
            />
            <Button
              variant="contained"
              disabled={running || !dissolveLayerId}
              onClick={() => onRunDissolve({
                layerId: dissolveLayerId,
                outputName: dissolveName || 'Dissolve',
                dissolveFields,
                statistics: dissolveStatistics,
                multipart: dissolveMultipart,
                nullPolicy: dissolveNullPolicy,
              })}
            >
              Run Dissolve
            </Button>
          </Box>
        )}

        {tab === 'spatial_join' && (
          <Box display="grid" gap={2}>
            <TextField label="Target layer" value={spatialJoinTarget} onChange={(event) => setSpatialJoinTarget(event.target.value)} size="small" select>
              {layerOptions.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}
            </TextField>
            <TextField label="Join layer" value={spatialJoinLayer} onChange={(event) => setSpatialJoinLayer(event.target.value)} size="small" select>
              {layerOptions.map((item) => <MenuItem key={item.value} value={item.value} disabled={item.value === spatialJoinTarget}>{item.label}</MenuItem>)}
            </TextField>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
              <TextField label="Spatial relationship" value={spatialJoinPredicate} onChange={(event) => setSpatialJoinPredicate(event.target.value as typeof spatialJoinPredicate)} size="small" select>
                {['intersects', 'within', 'contains', 'touches', 'crosses', 'overlaps', 'equals', 'within_distance'].map((predicate) => (
                  <MenuItem key={predicate} value={predicate}>{predicate.replace('_', ' ')}</MenuItem>
                ))}
              </TextField>
              <TextField label="Cardinality" value={spatialJoinMode} onChange={(event) => setSpatialJoinMode(event.target.value as typeof spatialJoinMode)} size="small" select>
                <MenuItem value="one_to_one">One to one</MenuItem>
                <MenuItem value="one_to_many">One to many</MenuItem>
              </TextField>
            </Box>
            {spatialJoinPredicate === 'within_distance' && (
              <TextField label="Search distance (metres)" type="number" value={spatialJoinDistance} onChange={(event) => setSpatialJoinDistance(event.target.value)} size="small" />
            )}
            <FormControlLabel control={<Switch checked={spatialJoinKeepAll} onChange={(event) => setSpatialJoinKeepAll(event.target.checked)} />} label="Keep unmatched target features" />
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
              <TextField label="Target prefix" value={spatialJoinTargetPrefix} onChange={(event) => setSpatialJoinTargetPrefix(event.target.value)} size="small" inputProps={{ maxLength: 16 }} />
              <TextField label="Join prefix" value={spatialJoinFieldPrefix} onChange={(event) => setSpatialJoinFieldPrefix(event.target.value)} size="small" inputProps={{ maxLength: 16 }} />
            </Box>
            <TextField label="Output layer name" value={spatialJoinName} onChange={(event) => setSpatialJoinName(event.target.value)} size="small" />
            <Button
              variant="contained"
              disabled={running || !spatialJoinTarget || !spatialJoinLayer || spatialJoinTarget === spatialJoinLayer || !spatialJoinTargetPrefix || !spatialJoinFieldPrefix || (spatialJoinPredicate === 'within_distance' && Number(spatialJoinDistance) <= 0)}
              onClick={() => onRunSpatialJoin({
                targetLayer: spatialJoinTarget,
                joinLayer: spatialJoinLayer,
                outputName: spatialJoinName || 'Spatial Join',
                predicate: spatialJoinPredicate,
                outputMode: spatialJoinMode,
                keepAll: spatialJoinKeepAll,
                distance: spatialJoinPredicate === 'within_distance' ? Number(spatialJoinDistance) : null,
                targetPrefix: spatialJoinTargetPrefix,
                joinPrefix: spatialJoinFieldPrefix,
              })}
            >
              Run Spatial Join
            </Button>
          </Box>
        )}

        {tab === 'summarize_within' && (
          <Box display="grid" gap={2}>
            <TextField label="Polygon zone layer" value={summaryZoneLayer} onChange={(event) => setSummaryZoneLayer(event.target.value)} size="small" select>
              {polygonLayerOptions.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}
            </TextField>
            <TextField
              label="Features to summarize"
              value={summaryFeatureLayer}
              onChange={(event) => {
                setSummaryFeatureLayer(event.target.value)
                setSummaryGroupField('')
                setSummaryStatistics([])
                setSummaryStatisticField('')
              }}
              size="small"
              select
            >
              {layerOptions.map((item) => <MenuItem key={item.value} value={item.value} disabled={item.value === summaryZoneLayer}>{item.label}</MenuItem>)}
            </TextField>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
              <TextField label="Boundary relationship" value={summaryBoundaryPredicate} onChange={(event) => setSummaryBoundaryPredicate(event.target.value as 'intersects' | 'within')} size="small" select>
                <MenuItem value="intersects">Intersects zone</MenuItem>
                <MenuItem value="within">Completely within zone</MenuItem>
              </TextField>
              <TextField label="Group summaries by" value={summaryGroupField} onChange={(event) => setSummaryGroupField(event.target.value)} size="small" select disabled={!summaryFeatureLayer}>
                <MenuItem value="">No categorical grouping</MenuItem>
                {availableSummaryFields.map((field) => <MenuItem key={field.id} value={field.name}>{field.alias || field.name}</MenuItem>)}
              </TextField>
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 1 }}>
              <TextField label="Numeric field" value={summaryStatisticField} onChange={(event) => setSummaryStatisticField(event.target.value)} size="small" select>
                {numericSummaryFields.map((field) => <MenuItem key={field.id} value={field.name}>{field.alias || field.name}</MenuItem>)}
              </TextField>
              <TextField label="Statistic" value={summaryStatisticType} onChange={(event) => setSummaryStatisticType(event.target.value as typeof summaryStatisticType)} size="small" select>
                {['sum', 'minimum', 'maximum', 'mean'].map((statistic) => <MenuItem key={statistic} value={statistic}>{statistic}</MenuItem>)}
              </TextField>
              <Button
                variant="outlined"
                disabled={!summaryStatisticField}
                onClick={() => {
                  const next: AnalysisStatistic = { field: summaryStatisticField, statistic: summaryStatisticType }
                  if (!summaryStatistics.some((item) => item.field === next.field && item.statistic === next.statistic)) {
                    setSummaryStatistics((current) => [...current, next])
                  }
                }}
              >Add</Button>
            </Box>
            {summaryStatistics.length > 0 && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {summaryStatistics.map((statistic, index) => (
                  <Chip key={`${statistic.field}-${statistic.statistic}`} label={`${statistic.statistic}: ${statistic.field}`} onDelete={() => setSummaryStatistics((current) => current.filter((_, itemIndex) => itemIndex !== index))} />
                ))}
              </Box>
            )}
            <FormControlLabel control={<Switch checked={summaryIncludeEmpty} onChange={(event) => setSummaryIncludeEmpty(event.target.checked)} />} label="Include zones without matching features" />
            <TextField label="Output layer name" value={summaryOutputName} onChange={(event) => setSummaryOutputName(event.target.value)} size="small" />
            <Button
              variant="contained"
              disabled={running || !summaryZoneLayer || !summaryFeatureLayer || summaryZoneLayer === summaryFeatureLayer}
              onClick={() => onRunSummarizeWithin({
                zoneLayer: summaryZoneLayer,
                summaryLayer: summaryFeatureLayer,
                outputName: summaryOutputName || 'Summarize Within',
                groupField: summaryGroupField,
                statistics: summaryStatistics,
                includeEmpty: summaryIncludeEmpty,
                boundaryPredicate: summaryBoundaryPredicate,
              })}
            >Run Summarize Within</Button>
          </Box>
        )}

        {tab === 'near' && (
          <Box display="grid" gap={2}>
            <TextField label="Source features" value={nearSourceLayer} onChange={(event) => setNearSourceLayer(event.target.value)} size="small" select>
              {layerOptions.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}
            </TextField>
            <TextField label="Near candidates" value={nearCandidateLayer} onChange={(event) => setNearCandidateLayer(event.target.value)} size="small" select>
              {layerOptions.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}
            </TextField>
            <Alert severity="info">
              Results are ranked per source using indexed nearest candidates, then measured on the WGS84 spheroid.
            </Alert>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
              <TextField label="Nearest per source" type="number" value={nearCount} onChange={(event) => setNearCount(event.target.value)} inputProps={{ min: 1, max: 100, step: 1 }} size="small" />
              <TextField label="Maximum distance (m)" type="number" value={nearMaxDistance} onChange={(event) => setNearMaxDistance(event.target.value)} helperText="Optional" size="small" />
            </Box>
            <TextField label="Map output geometry" value={nearOutputGeometry} onChange={(event) => setNearOutputGeometry(event.target.value as typeof nearOutputGeometry)} size="small" select>
              <MenuItem value="connecting_line">Connection line</MenuItem>
              <MenuItem value="source_point">Closest point on source</MenuItem>
              <MenuItem value="near_point">Closest point on near feature</MenuItem>
            </TextField>
            <FormControlLabel control={<Switch checked={nearExcludeSelf} onChange={(event) => setNearExcludeSelf(event.target.checked)} />} label="Exclude the same feature ID when layers match" />
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
              <TextField label="Source field prefix" value={nearSourcePrefix} onChange={(event) => setNearSourcePrefix(event.target.value)} size="small" />
              <TextField label="Near field prefix" value={nearFieldPrefix} onChange={(event) => setNearFieldPrefix(event.target.value)} size="small" />
            </Box>
            <TextField label="Output layer name" value={nearOutputName} onChange={(event) => setNearOutputName(event.target.value)} size="small" />
            <Button
              variant="contained"
              disabled={running || !nearSourceLayer || !nearCandidateLayer || Number(nearCount) < 1 || Number(nearCount) > 100}
              onClick={() => onRunNear({
                sourceLayer: nearSourceLayer,
                nearLayer: nearCandidateLayer,
                outputName: nearOutputName || 'Near',
                nearestCount: Number(nearCount),
                maxDistance: nearMaxDistance ? Number(nearMaxDistance) : null,
                excludeSelf: nearExcludeSelf,
                outputGeometry: nearOutputGeometry,
                sourcePrefix: nearSourcePrefix,
                nearPrefix: nearFieldPrefix,
              })}
            >Run Near</Button>
          </Box>
        )}

        {tab === 'polygonize' && (
          <Box display="grid" gap={2}>
            <TextField label="Line network" value={polygonizeLayer} onChange={(event) => setPolygonizeLayer(event.target.value)} size="small" select>
              {lineLayerOptions.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}
            </TextField>
            <Alert severity="info">
              Intersections are noded before polygonization. Source lines are never modified.
            </Alert>
            <TextField label="Snap tolerance (decimal degrees)" type="number" value={polygonizeTolerance} onChange={(event) => setPolygonizeTolerance(event.target.value)} helperText="Optional. Use a small value appropriate to the source CRS precision." size="small" />
            <TextField label="Transfer source attributes" value={polygonizeTransfer} onChange={(event) => setPolygonizeTransfer(event.target.value as typeof polygonizeTransfer)} size="small" select>
              <MenuItem value="majority_boundary">Line with greatest boundary coverage</MenuItem>
              <MenuItem value="first_intersecting">First intersecting line (deterministic)</MenuItem>
              <MenuItem value="none">No source attributes</MenuItem>
            </TextField>
            <FormControlLabel control={<Switch checked={polygonizeDiagnostics} onChange={(event) => setPolygonizeDiagnostics(event.target.checked)} />} label="Create diagnostics layer for unconsumed edges" />
            <TextField label="Output polygon layer name" value={polygonizeName} onChange={(event) => setPolygonizeName(event.target.value)} size="small" />
            <Button
              variant="contained"
              disabled={running || !polygonizeLayer}
              onClick={() => onRunPolygonize({
                lineLayer: polygonizeLayer,
                outputName: polygonizeName || 'Polygonized Lines',
                snapTolerance: polygonizeTolerance ? Number(polygonizeTolerance) : null,
                attributeTransfer: polygonizeTransfer,
                createDiagnostics: polygonizeDiagnostics,
              })}
            >Run Polygonize</Button>
          </Box>
        )}

        {tab === 'within' && (
          <Box display="grid" gap={2}>
            <TextField
              label="Source layer"
              value={withinLayerId}
              onChange={(event) => setWithinLayerId(event.target.value)}
              size="small"
              select
              fullWidth
            >
              {layerOptions.map((item) => (
                <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>
              ))}
            </TextField>
            <TextField
              label="Polygon GeoJSON"
              value={withinPolygon}
              onChange={(event) => setWithinPolygon(event.target.value)}
              multiline
              minRows={6}
              fullWidth
            />
            {withinCount != null && (
              <Typography variant="body2" color="text.secondary">
                Within result count: {withinCount}
              </Typography>
            )}
            <Button
              variant="contained"
              disabled={running || !withinLayerId || !withinPolygon.trim()}
              onClick={() => onRunWithin({ layerId: withinLayerId, polygon: withinPolygon })}
            >
              Run Within
            </Button>
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit" disabled={running}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
