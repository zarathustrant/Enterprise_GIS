import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import StarBorderIcon from '@mui/icons-material/StarBorder'
import StarIcon from '@mui/icons-material/Star'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import ReplayIcon from '@mui/icons-material/Replay'
import VisibilityIcon from '@mui/icons-material/Visibility'
import type { Layer } from '../types/gis'
import type { AnalysisEnvironments, VectorToolParameter, VectorToolSpec } from '../api/services'
import { cancelAnalysisRun, fetchAnalysisRuns, fetchAnalysisTools } from '../api/services'
import { useAuthStore } from '../store/auth'

type ExecutionMode = 'automatic' | 'synchronous' | 'asynchronous'

interface AnalysisWorkbenchProps {
  layers: Layer[]
  running: boolean
  selectedFeaturesByLayer: Record<string, string[]>
  visibleExtent?: [number, number, number, number]
  onRun: (toolId: string, payload: Record<string, unknown>) => void
  onOpenOutput: (layerId: string) => void
}

const FAVORITES_KEY = 'enterprise-gis-analysis-favorites'

function initialValues(tool: VectorToolSpec): Record<string, unknown> {
  return Object.fromEntries(tool.parameters.map((parameter) => [parameter.name, parameter.default ?? '']))
}

function allowedLayers(parameter: VectorToolParameter, layers: Layer[]): Layer[] {
  const label = parameter.label.toLowerCase()
  if (label.includes('polygon') || label.includes('zone') || label.includes('coverage') || label.includes('mask')) {
    return layers.filter((layer) => (layer.geometry_type ?? '').toLowerCase().includes('polygon'))
  }
  if (label.includes('line')) {
    return layers.filter((layer) => (layer.geometry_type ?? '').toLowerCase().includes('line'))
  }
  if (label.includes('point')) {
    return layers.filter((layer) => (layer.geometry_type ?? '').toLowerCase().includes('point'))
  }
  return layers
}

function normalizeParameter(parameter: VectorToolParameter, value: unknown): unknown {
  if (parameter.type === 'number' || parameter.type === 'integer') {
    if (value === '' || value == null) return null
    return parameter.type === 'integer' ? Math.trunc(Number(value)) : Number(value)
  }
  if (parameter.type === 'number_list') {
    return String(value).split(',').map((item) => Number(item.trim())).filter(Number.isFinite)
  }
  if (parameter.type === 'string_list') {
    return String(value).split(',').map((item) => item.trim()).filter(Boolean)
  }
  if (parameter.type === 'statistics') {
    if (!String(value).trim()) return []
    return JSON.parse(String(value)) as unknown
  }
  return value
}

export function AnalysisWorkbench({ layers, running, selectedFeaturesByLayer, visibleExtent, onRun, onOpenOutput }: AnalysisWorkbenchProps) {
  const token = useAuthStore((state) => state.token)
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('automatic')
  const [scope, setScope] = useState<'all' | 'selected' | 'filtered' | 'extent'>('all')
  const [precisionGrid, setPrecisionGrid] = useState('')
  const [filterField, setFilterField] = useState('')
  const [filterOperator, setFilterOperator] = useState('equals')
  const [filterValue, setFilterValue] = useState('')
  const [invalidPolicy, setInvalidPolicy] = useState<'reject' | 'repair'>('reject')
  const [multipartPolicy, setMultipartPolicy] = useState<'preserve' | 'explode'>('preserve')
  const [zPolicy, setZPolicy] = useState<'preserve' | 'drop'>('preserve')
  const [collisionPolicy, setCollisionPolicy] = useState<'error' | 'suffix' | 'overwrite'>('suffix')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '[]') as string[]
    } catch {
      return []
    }
  })
  const toolsQuery = useQuery({ queryKey: ['analysis-tools'], queryFn: fetchAnalysisTools })
  const runsQuery = useQuery({
    queryKey: ['analysis-runs', 'workbench'],
    queryFn: () => fetchAnalysisRuns(token as string, 8),
    enabled: Boolean(token),
    refetchInterval: (query) => (
      running || (query.state.data ?? []).some((run) => run.status === 'queued' || run.status === 'running')
        ? 1500
        : false
    ),
  })
  const cancelMutation = useMutation({
    mutationFn: (runId: string) => cancelAnalysisRun(runId, token as string),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['analysis-runs'] })
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
    },
  })
  const tools = useMemo(
    () => (toolsQuery.data ?? []).filter((tool) => tool.migrated),
    [toolsQuery.data],
  )
  const selectedTool = tools.find((tool) => tool.id === selectedToolId) ?? null
  const visibleTools = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return tools
      .filter((tool) => !needle || `${tool.title} ${tool.description} ${tool.keywords.join(' ')}`.toLowerCase().includes(needle))
      .sort((a, b) => {
        const favoriteOrder = Number(favorites.includes(b.id)) - Number(favorites.includes(a.id))
        return favoriteOrder || a.category.localeCompare(b.category) || a.title.localeCompare(b.title)
      })
  }, [favorites, search, tools])
  const groupedTools = useMemo(() => {
    const groups = new Map<string, VectorToolSpec[]>()
    visibleTools.forEach((tool) => groups.set(tool.category, [...(groups.get(tool.category) ?? []), tool]))
    return [...groups.entries()]
  }, [visibleTools])

  useEffect(() => {
    if (!selectedTool) return
    setValues(initialValues(selectedTool))
    setValidationError(null)
  }, [selectedTool])

  const toggleFavorite = (toolId: string) => {
    setFavorites((current) => {
      const next = current.includes(toolId) ? current.filter((id) => id !== toolId) : [...current, toolId]
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next))
      return next
    })
  }

  const runTool = () => {
    if (!selectedTool) return
    try {
      const parameters = Object.fromEntries(selectedTool.parameters.map((parameter) => {
        const normalized = normalizeParameter(parameter, values[parameter.name])
        if (parameter.required && (normalized === '' || normalized == null || (Array.isArray(normalized) && !normalized.length))) {
          throw new Error(`${parameter.label} is required.`)
        }
        if (typeof normalized === 'number' && !Number.isFinite(normalized)) {
          throw new Error(`${parameter.label} must be a number.`)
        }
        return [parameter.name, normalized]
      }))
      const layerParameters = selectedTool.parameters.filter((parameter) => parameter.type === 'layer')
      const environments: AnalysisEnvironments = {
        scope,
        scope_a: scope,
        scope_b: scope,
        precision_grid: precisionGrid ? Number(precisionGrid) : null,
        output_crs: 'EPSG:4326',
        invalid_geometry_policy: invalidPolicy,
        multipart_policy: multipartPolicy,
        z_policy: zPolicy,
        output_collision_policy: collisionPolicy,
      }
      if (scope === 'selected') {
        const firstLayerId = String(parameters[layerParameters[0]?.name] ?? '')
        const secondLayerId = String(parameters[layerParameters[1]?.name] ?? '')
        environments.selected_feature_ids = selectedFeaturesByLayer[firstLayerId] ?? []
        environments.selected_feature_ids_a = selectedFeaturesByLayer[firstLayerId] ?? []
        environments.selected_feature_ids_b = selectedFeaturesByLayer[secondLayerId] ?? []
        if (!environments.selected_feature_ids_a.length) {
          throw new Error('The first input layer has no selected features.')
        }
        if (layerParameters.length > 1 && secondLayerId && !environments.selected_feature_ids_b.length) {
          throw new Error('The second input layer has no selected features.')
        }
      }
      if (scope === 'extent') {
        if (!visibleExtent) throw new Error('Move the map once to capture a visible extent.')
        environments.extent = visibleExtent
        environments.extent_a = visibleExtent
        environments.extent_b = visibleExtent
      }
      if (scope === 'filtered') {
        if (!filterField.trim()) throw new Error('A filter field is required for filtered scope.')
        const filter = { field: filterField.trim(), operator: filterOperator, value: filterValue }
        environments.filters = [filter]
        environments.filters_a = [filter]
        environments.filters_b = [filter]
      }
      setValidationError(null)
      onRun(selectedTool.id, { ...parameters, execution_mode: executionMode, environments })
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : 'Review the tool parameters.')
    }
  }

  if (selectedTool) {
    return (
      <Box display="grid" gap={1.5}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <IconButton size="small" onClick={() => setSelectedToolId(null)}><ArrowBackIcon fontSize="small" /></IconButton>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="subtitle1" fontWeight={700}>{selectedTool.title}</Typography>
            <Typography variant="caption" color="text.secondary">{selectedTool.category} · v{selectedTool.version}</Typography>
          </Box>
          <IconButton size="small" onClick={() => toggleFavorite(selectedTool.id)}>
            {favorites.includes(selectedTool.id) ? <StarIcon color="warning" /> : <StarBorderIcon />}
          </IconButton>
        </Box>
        <Typography variant="body2" color="text.secondary">{selectedTool.description}</Typography>
        {validationError && <Alert severity="warning">{validationError}</Alert>}
        {selectedTool.parameters.map((parameter) => {
          const value = values[parameter.name] ?? ''
          if (parameter.type === 'boolean') {
            return <FormControlLabel key={parameter.name} control={<Switch checked={Boolean(value)} onChange={(event) => setValues((current) => ({ ...current, [parameter.name]: event.target.checked }))} />} label={parameter.label} />
          }
          if (parameter.type === 'layer') {
            return (
              <TextField key={parameter.name} label={parameter.label} value={value} onChange={(event) => setValues((current) => ({ ...current, [parameter.name]: event.target.value }))} size="small" select required={parameter.required}>
                {!parameter.required && <MenuItem value="">None</MenuItem>}
                {allowedLayers(parameter, layers).map((layer) => <MenuItem key={layer.id} value={layer.id}>{layer.name}</MenuItem>)}
              </TextField>
            )
          }
          if (parameter.type === 'choice') {
            return <TextField key={parameter.name} label={parameter.label} value={value} onChange={(event) => setValues((current) => ({ ...current, [parameter.name]: event.target.value }))} size="small" select>{parameter.choices.map((choice) => <MenuItem key={choice} value={choice}>{choice.replaceAll('_', ' ')}</MenuItem>)}</TextField>
          }
          const numeric = parameter.type === 'number' || parameter.type === 'integer'
          return (
            <TextField
              key={parameter.name}
              label={parameter.label}
              value={Array.isArray(value) ? value.join(', ') : value}
              onChange={(event) => setValues((current) => ({ ...current, [parameter.name]: event.target.value }))}
              type={numeric ? 'number' : 'text'}
              multiline={parameter.type === 'statistics'}
              minRows={parameter.type === 'statistics' ? 3 : undefined}
              inputProps={numeric ? { min: parameter.minimum ?? undefined, max: parameter.maximum ?? undefined, step: parameter.type === 'integer' ? 1 : 'any' } : undefined}
              helperText={parameter.type === 'number_list' || parameter.type === 'string_list' ? 'Comma-separated values' : parameter.type === 'statistics' ? 'JSON array of statistic definitions' : undefined}
              size="small"
              required={parameter.required}
            />
          )
        })}
        <Divider />
        <Typography variant="overline" color="text.secondary">Processing environment</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
          <TextField label="Execution" value={executionMode} onChange={(event) => setExecutionMode(event.target.value as ExecutionMode)} size="small" select>
            <MenuItem value="automatic">Automatic</MenuItem><MenuItem value="synchronous">Synchronous</MenuItem><MenuItem value="asynchronous">Asynchronous</MenuItem>
          </TextField>
          <TextField label="Precision grid" value={precisionGrid} onChange={(event) => setPrecisionGrid(event.target.value)} type="number" size="small" helperText="Optional degrees" />
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
          <TextField label="Z coordinates" value={zPolicy} onChange={(event) => setZPolicy(event.target.value as typeof zPolicy)} size="small" select>
            <MenuItem value="preserve">Preserve Z</MenuItem><MenuItem value="drop">Drop Z</MenuItem>
          </TextField>
          <TextField label="Existing output name" value={collisionPolicy} onChange={(event) => setCollisionPolicy(event.target.value as typeof collisionPolicy)} size="small" select>
            <MenuItem value="suffix">Create numbered name</MenuItem><MenuItem value="error">Stop with error</MenuItem><MenuItem value="overwrite">Overwrite owned output</MenuItem>
          </TextField>
        </Box>
        <TextField label="Input scope" value={scope} onChange={(event) => setScope(event.target.value as typeof scope)} size="small" select>
          <MenuItem value="all">Full input layers</MenuItem><MenuItem value="selected">Selected features</MenuItem>
          <MenuItem value="filtered">Attribute filter</MenuItem><MenuItem value="extent">Visible map extent</MenuItem>
        </TextField>
        {scope === 'filtered' && (
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1 }}>
            <TextField label="Field" value={filterField} onChange={(event) => setFilterField(event.target.value)} size="small" />
            <TextField label="Operator" value={filterOperator} onChange={(event) => setFilterOperator(event.target.value)} size="small" select>
              {['equals', 'not_equals', 'contains', 'greater_than', 'at_least', 'less_than', 'at_most', 'is_null', 'is_not_null'].map((operator) => <MenuItem key={operator} value={operator}>{operator.replaceAll('_', ' ')}</MenuItem>)}
            </TextField>
            <TextField label="Value" value={filterValue} onChange={(event) => setFilterValue(event.target.value)} size="small" disabled={filterOperator.startsWith('is_')} />
          </Box>
        )}
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
          <TextField label="Invalid geometry" value={invalidPolicy} onChange={(event) => setInvalidPolicy(event.target.value as typeof invalidPolicy)} size="small" select>
            <MenuItem value="reject">Reject invalid</MenuItem><MenuItem value="repair">Repair for processing</MenuItem>
          </TextField>
          <TextField label="Multipart output" value={multipartPolicy} onChange={(event) => setMultipartPolicy(event.target.value as typeof multipartPolicy)} size="small" select>
            <MenuItem value="preserve">Preserve multipart</MenuItem><MenuItem value="explode">Explode parts</MenuItem>
          </TextField>
        </Box>
        <Paper variant="outlined" sx={{ p: 1.25, bgcolor: 'action.hover' }}>
          <Typography variant="caption" color="text.secondary">Output and field-map preview</Typography>
          <Typography variant="body2">{selectedTool.output_geometry_family ?? 'Derived from operation'} geometry · source fields preserved or mapped by the server</Typography>
        </Paper>
        <Button variant="contained" disabled={running} onClick={runTool}>Run {selectedTool.title}</Button>
      </Box>
    )
  }

  return (
    <Box display="grid" gap={1.5}>
      <TextField label="Search analysis tools" value={search} onChange={(event) => setSearch(event.target.value)} size="small" autoFocus />
      {toolsQuery.isError && <Alert severity="error">Could not load the server tool registry.</Alert>}
      <Box sx={{ display: 'grid', gap: 1, maxHeight: '48vh', overflowY: 'auto', pr: 0.5 }}>
        {groupedTools.map(([category, categoryTools]) => (
          <Box key={category}>
            <Typography variant="overline" color="text.secondary">{category}</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 0.75 }}>
              {categoryTools.map((tool) => (
                <Paper key={tool.id} variant="outlined" sx={{ p: 1, cursor: 'pointer', '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' } }} onClick={() => setSelectedToolId(tool.id)}>
                  <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'flex-start' }}>
                    <Typography variant="body2" fontWeight={700} sx={{ flex: 1 }}>{tool.title}</Typography>
                    {favorites.includes(tool.id) && <StarIcon color="warning" sx={{ fontSize: 15 }} />}
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{tool.description}</Typography>
                </Paper>
              ))}
            </Box>
          </Box>
        ))}
      </Box>
      {runsQuery.data?.length ? (
        <Box>
          <Typography variant="overline" color="text.secondary">Recent runs</Typography>
          <Box sx={{ display: 'grid', gap: 0.5 }}>
            {runsQuery.data.slice(0, 5).map((run) => {
              const cancellable = run.status === 'queued' || run.status === 'running'
              return (
                <Paper key={run.id} variant="outlined" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, p: 0.5 }}>
                  <Tooltip title={`${run.progress_stage ?? run.status}${run.reproducibility_hash ? ` · ${run.reproducibility_hash.slice(0, 10)}` : ''}`}>
                    <Chip
                      size="small"
                      sx={{ flex: 1, justifyContent: 'flex-start' }}
                      label={`${run.tool_id.replaceAll('_', ' ')} · ${run.status}${run.total_units ? ` · ${run.completed_units}/${run.total_units}` : ''}`}
                      color={run.status === 'succeeded' ? 'success' : run.status === 'failed' ? 'error' : 'default'}
                      onDelete={cancellable ? () => cancelMutation.mutate(run.id) : undefined}
                      disabled={cancelMutation.isPending}
                    />
                  </Tooltip>
                  <Tooltip title="Rerun with the recorded parameters">
                    <span>
                      <IconButton
                        size="small"
                        disabled={running || cancellable}
                        onClick={() => onRun(run.tool_id, {
                          ...run.parameters,
                          execution_mode: 'automatic',
                          environments: run.environments,
                        })}
                      >
                        <ReplayIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Show output layer on map">
                    <span>
                      <IconButton
                        size="small"
                        disabled={!run.output_layer_ids.length}
                        onClick={() => onOpenOutput(run.output_layer_ids[0])}
                      >
                        <VisibilityIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Paper>
              )
            })}
          </Box>
        </Box>
      ) : null}
    </Box>
  )
}
