import { useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  Tab,
  Tabs,
  TextField,
  Typography,
  Switch,
} from '@mui/material'
import type { Layer } from '../types/gis'
import { WORK_MODE_DIALOG_PROPS, normalModeDialogSx, workModeDialogSx } from './workModeDialog'

export type AnalysisTab = 'buffer' | 'intersect' | 'clip' | 'erase' | 'within'
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
  onRunIntersect,
  onRunClip,
  onRunErase,
  onRunWithin,
}: AnalysisDialogProps) {
  const [tab, setTab] = useState<AnalysisTab>('buffer')
  const [bufferLayerId, setBufferLayerId] = useState('')
  const [bufferDistance, setBufferDistance] = useState('100')
  const [bufferName, setBufferName] = useState('Buffer')

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
          <Tab value="intersect" label="Intersect" />
          <Tab value="clip" label="Clip" />
          <Tab value="erase" label="Erase" />
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
