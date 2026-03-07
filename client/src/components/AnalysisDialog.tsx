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
  LinearProgress,
  MenuItem,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import type { Layer } from '../types/gis'

export type AnalysisTab = 'buffer' | 'intersect' | 'within'
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
  onClose: () => void
  onRunBuffer: (payload: { layerId: string; distance: number; outputName: string }) => void
  onRunIntersect: (payload: { layerA: string; layerB: string; outputName: string }) => void
  onRunWithin: (payload: { layerId: string; polygon: string }) => void
}

export function AnalysisDialog({
  open,
  layers,
  running,
  error,
  withinCount,
  job,
  onClose,
  onRunBuffer,
  onRunIntersect,
  onRunWithin,
}: AnalysisDialogProps) {
  const [tab, setTab] = useState<AnalysisTab>('buffer')
  const [bufferLayerId, setBufferLayerId] = useState('')
  const [bufferDistance, setBufferDistance] = useState('100')
  const [bufferName, setBufferName] = useState('Buffer')

  const [intersectA, setIntersectA] = useState('')
  const [intersectB, setIntersectB] = useState('')
  const [intersectName, setIntersectName] = useState('Intersection')

  const [withinLayerId, setWithinLayerId] = useState('')
  const [withinPolygon, setWithinPolygon] = useState(
    '{\n  "type": "Polygon",\n  "coordinates": [[[5.58,6.29],[5.62,6.29],[5.62,6.31],[5.58,6.31],[5.58,6.29]]]\n}',
  )

  const layerOptions = useMemo(
    () => layers.map((layer) => ({ label: layer.name, value: layer.id })),
    [layers],
  )

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Spatial Analysis</DialogTitle>
      <DialogContent>
        <Tabs value={tab} onChange={(_, value) => setTab(value as AnalysisTab)} sx={{ mb: 2 }}>
          <Tab value="buffer" label="Buffer" />
          <Tab value="intersect" label="Intersect" />
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
                <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>
              ))}
            </TextField>
            <TextField
              label="Output layer name"
              value={intersectName}
              onChange={(event) => setIntersectName(event.target.value)}
              size="small"
              fullWidth
            />
            <Button
              variant="contained"
              disabled={running || !intersectA || !intersectB}
              onClick={() => onRunIntersect({ layerA: intersectA, layerB: intersectB, outputName: intersectName || 'Intersection' })}
            >
              Run Intersect
            </Button>
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
