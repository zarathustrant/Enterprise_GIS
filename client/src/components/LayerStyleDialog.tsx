import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Slider,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import AddIcon from '@mui/icons-material/Add'
import type { LayerField, LayerStyleDraft } from '../types/gis'
import { IconPickerDialog } from './IconPickerDialog'
import { ICON_LIBRARY_DEFINITIONS } from '../utils/iconLibrary'

interface LayerStyleDialogProps {
  open: boolean
  layerName: string | null
  fields: LayerField[]
  style: LayerStyleDraft
  submitting: boolean
  error: string | null
  onStyleChange: (next: LayerStyleDraft) => void
  onClose: () => void
  onSubmit: () => void
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

const STYLE_PRESETS: Array<{ label: string; patch: Partial<LayerStyleDraft> }> = [
  {
    label: 'Cadastral',
    patch: {
      rendererType: 'simple',
      color: '#f4a261',
      strokeColor: '#7f5539',
      strokeWidth: 1,
      opacity: 0.45,
      lineDashArray: [1, 0],
    },
  },
  {
    label: 'Risk Heat',
    patch: {
      rendererType: 'classBreaks',
      classBreakDefaultColor: '#457b9d',
      classBreakDefaultOpacity: 0.4,
      classBreakStops: [
        { min: 0, max: 0.33, color: '#2a9d8f', opacity: 0.45 },
        { min: 0.33, max: 0.66, color: '#f4a261', opacity: 0.6 },
        { min: 0.66, max: 1, color: '#e63946', opacity: 0.75 },
      ],
    },
  },
  {
    label: 'Utility Lines',
    patch: {
      rendererType: 'simple',
      color: '#264653',
      strokeColor: '#264653',
      strokeWidth: 3,
      opacity: 0.9,
      lineDashArray: [6, 3],
    },
  },
]

function iconNamePlaceholder(library: LayerStyleDraft['iconLibrary']): string {
  const found = ICON_LIBRARY_DEFINITIONS.find((item) => item.value === library)
  return found ? found.example : 'marker'
}

export function LayerStyleDialog({
  open,
  layerName,
  fields,
  style,
  submitting,
  error,
  onStyleChange,
  onClose,
  onSubmit,
}: LayerStyleDialogProps) {
  const [iconPickerOpen, setIconPickerOpen] = useState(false)

  const handleClose = () => {
    if (!submitting) {
      onClose()
    }
  }

  const numericFields = fields.filter((field) => field.field_type === 'integer' || field.field_type === 'double')
  const allFields = fields

  const applyPreset = (patch: Partial<LayerStyleDraft>) => {
    onStyleChange({
      ...style,
      ...patch,
    })
  }

  return (
    <>
      <Dialog open={open} onClose={handleClose} fullWidth maxWidth="md">
      <DialogTitle>Layer Style</DialogTitle>
      <DialogContent>
        <Box display="grid" gap={2} pt={0.5}>
          {layerName && (
            <Typography variant="body2" color="text.secondary">
              Layer: <strong>{layerName}</strong>
            </Typography>
          )}

          {error && <Alert severity="error">{error}</Alert>}

          <Box display="grid" gap={0.75}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Presets
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              {STYLE_PRESETS.map((preset) => (
                <Button key={preset.label} size="small" variant="outlined" onClick={() => applyPreset(preset.patch)}>
                  {preset.label}
                </Button>
              ))}
            </Stack>
          </Box>

          <TextField
            label="Renderer"
            value={style.rendererType}
            onChange={(event) => {
              onStyleChange({ ...style, rendererType: event.target.value as LayerStyleDraft['rendererType'] })
            }}
            size="small"
            select
            fullWidth
          >
            <MenuItem value="simple">Simple</MenuItem>
            <MenuItem value="uniqueValue">Unique Values</MenuItem>
            <MenuItem value="classBreaks">Class Breaks</MenuItem>
          </TextField>

          <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: 'repeat(4, minmax(0, 1fr))' }} gap={1.5}>
            <TextField
              type="color"
              label="Base Color"
              value={style.color}
              onChange={(event) => onStyleChange({ ...style, color: event.target.value })}
              size="small"
              fullWidth
              InputLabelProps={{ shrink: true }}
            />

            <TextField
              type="color"
              label="Stroke Color"
              value={style.strokeColor}
              onChange={(event) => onStyleChange({ ...style, strokeColor: event.target.value })}
              size="small"
              fullWidth
              InputLabelProps={{ shrink: true }}
            />

            <TextField
              label="Point Radius"
              value={style.pointRadius}
              onChange={(event) => onStyleChange({ ...style, pointRadius: Math.max(1, Number(event.target.value) || 1) })}
              size="small"
              type="number"
              fullWidth
            />

            <TextField
              label="Point Shape"
              value={style.pointShape}
              onChange={(event) =>
                onStyleChange({
                  ...style,
                  pointShape: event.target.value as LayerStyleDraft['pointShape'],
                })
              }
              size="small"
              select
              fullWidth
            >
              <MenuItem value="circle">circle</MenuItem>
              <MenuItem value="square">square</MenuItem>
              <MenuItem value="icon">icon</MenuItem>
            </TextField>
          </Box>

          {style.pointShape === 'icon' && (
            <Box display="grid" gap={1.5}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                Icon Symbols
              </Typography>
              <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }} gap={1.5}>
                <TextField
                  label="Icon library"
                  value={style.iconLibrary}
                  onChange={(event) =>
                    onStyleChange({
                      ...style,
                      iconLibrary: event.target.value as LayerStyleDraft['iconLibrary'],
                    })
                  }
                  size="small"
                  select
                  fullWidth
                >
                  {ICON_LIBRARY_DEFINITIONS.map((item) => (
                    <MenuItem key={item.value} value={item.value}>
                      {item.label}
                    </MenuItem>
                  ))}
                </TextField>
                <Stack direction="row" spacing={1} alignItems="center">
                  <TextField
                    label="Icon name"
                    value={style.iconName}
                    onChange={(event) => onStyleChange({ ...style, iconName: event.target.value })}
                    size="small"
                    placeholder={iconNamePlaceholder(style.iconLibrary)}
                    fullWidth
                  />
                  <Button variant="outlined" onClick={() => setIconPickerOpen(true)}>
                    Browse
                  </Button>
                </Stack>
                <TextField
                  label="Icon field (optional)"
                  value={style.iconField}
                  onChange={(event) => onStyleChange({ ...style, iconField: event.target.value })}
                  size="small"
                  select
                  fullWidth
                >
                  <MenuItem value="">None</MenuItem>
                  {allFields.map((field) => (
                    <MenuItem key={`icon-field-${field.id}`} value={field.name}>
                      {field.alias || field.name}
                    </MenuItem>
                  ))}
                </TextField>
                {style.iconLibrary === 'iconify' ? (
                  <TextField
                    label="Iconify prefix"
                    value={style.iconifyPrefix}
                    onChange={(event) => onStyleChange({ ...style, iconifyPrefix: event.target.value })}
                    size="small"
                    placeholder="mdi or carbon or fluent"
                    fullWidth
                  />
                ) : (
                  <Box />
                )}
                <TextField
                  label="Icon size scale"
                  value={style.iconSize}
                  onChange={(event) => onStyleChange({ ...style, iconSize: Math.max(0.2, Number(event.target.value) || 0.2) })}
                  size="small"
                  type="number"
                  inputProps={{ min: 0.2, step: 0.1 }}
                />
                <TextField
                  label="Rotation (deg)"
                  value={style.iconRotation}
                  onChange={(event) => onStyleChange({ ...style, iconRotation: Number(event.target.value) || 0 })}
                  size="small"
                  type="number"
                />
                <TextField
                  label="Rotation field"
                  value={style.iconRotationField}
                  onChange={(event) => onStyleChange({ ...style, iconRotationField: event.target.value })}
                  size="small"
                  select
                  fullWidth
                >
                  <MenuItem value="">None</MenuItem>
                  {numericFields.map((field) => (
                    <MenuItem key={`icon-rotation-${field.id}`} value={field.name}>
                      {field.alias || field.name}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  label="Allow overlap"
                  value={style.iconAllowOverlap ? 'true' : 'false'}
                  onChange={(event) => onStyleChange({ ...style, iconAllowOverlap: event.target.value === 'true' })}
                  size="small"
                  select
                >
                  <MenuItem value="true">true</MenuItem>
                  <MenuItem value="false">false</MenuItem>
                </TextField>
              </Box>
              <Typography variant="caption" color="text.secondary">
                Supports free icon sets via Iconify API: Maki, Tabler, Lucide, Heroicons, Material Symbols, and any
                other free Iconify prefix.
              </Typography>
            </Box>
          )}

          <Box>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Opacity: {Math.round(style.opacity * 100)}%
            </Typography>
            <Slider
              value={style.opacity}
              min={0.05}
              max={1}
              step={0.05}
              onChange={(_, value) => onStyleChange({ ...style, opacity: clamp01(value as number) })}
            />
          </Box>

          <TextField
            label="Stroke Width"
            value={style.strokeWidth}
            onChange={(event) => onStyleChange({ ...style, strokeWidth: Math.max(1, Number(event.target.value) || 1) })}
            size="small"
            type="number"
            fullWidth
          />

          <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }} gap={1.5}>
            <TextField
              label="Line dash on"
              value={style.lineDashArray[0]}
              onChange={(event) => {
                onStyleChange({
                  ...style,
                  lineDashArray: [Math.max(0, Number(event.target.value) || 0), style.lineDashArray[1]],
                })
              }}
              size="small"
              type="number"
              fullWidth
            />
            <TextField
              label="Line dash off"
              value={style.lineDashArray[1]}
              onChange={(event) => {
                onStyleChange({
                  ...style,
                  lineDashArray: [style.lineDashArray[0], Math.max(0, Number(event.target.value) || 0)],
                })
              }}
              size="small"
              type="number"
              fullWidth
            />
          </Box>

          <Box display="grid" gap={1.5}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Visual Variables
            </Typography>
            <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }} gap={1.5}>
              <TextField
                label="Size field (0..1)"
                value={style.sizeField}
                onChange={(event) => onStyleChange({ ...style, sizeField: event.target.value })}
                size="small"
                select
                fullWidth
              >
                <MenuItem value="">None</MenuItem>
                {numericFields.map((field) => (
                  <MenuItem key={`size-${field.id}`} value={field.name}>{field.alias || field.name}</MenuItem>
                ))}
              </TextField>
              <TextField
                label="Size Min"
                value={style.sizeMin}
                onChange={(event) => onStyleChange({ ...style, sizeMin: Math.max(1, Number(event.target.value) || 1) })}
                size="small"
                type="number"
              />
              <TextField
                label="Size Max"
                value={style.sizeMax}
                onChange={(event) => onStyleChange({ ...style, sizeMax: Math.max(style.sizeMin, Number(event.target.value) || style.sizeMin) })}
                size="small"
                type="number"
              />
              <TextField
                label="Opacity field (0..1)"
                value={style.opacityField}
                onChange={(event) => onStyleChange({ ...style, opacityField: event.target.value })}
                size="small"
                select
                fullWidth
              >
                <MenuItem value="">None</MenuItem>
                {numericFields.map((field) => (
                  <MenuItem key={`opacity-${field.id}`} value={field.name}>{field.alias || field.name}</MenuItem>
                ))}
              </TextField>
              <TextField
                label="Opacity Min"
                value={style.opacityMin}
                onChange={(event) => onStyleChange({ ...style, opacityMin: clamp01(Number(event.target.value) || 0) })}
                size="small"
                type="number"
                inputProps={{ min: 0, max: 1, step: 0.05 }}
              />
              <TextField
                label="Opacity Max"
                value={style.opacityMax}
                onChange={(event) => onStyleChange({ ...style, opacityMax: clamp01(Number(event.target.value) || 1) })}
                size="small"
                type="number"
                inputProps={{ min: 0, max: 1, step: 0.05 }}
              />
            </Box>
          </Box>

          <Box display="grid" gap={1.5}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Labeling
            </Typography>
            <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }} gap={1.5}>
              <TextField
                label="Label field"
                value={style.labelField}
                onChange={(event) => onStyleChange({ ...style, labelField: event.target.value })}
                size="small"
                select
                fullWidth
              >
                <MenuItem value="">None</MenuItem>
                {allFields.map((field) => (
                  <MenuItem key={`label-${field.id}`} value={field.name}>{field.alias || field.name}</MenuItem>
                ))}
              </TextField>
              <TextField
                type="color"
                label="Label color"
                value={style.labelColor}
                onChange={(event) => onStyleChange({ ...style, labelColor: event.target.value })}
                size="small"
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label="Label size"
                value={style.labelSize}
                onChange={(event) => onStyleChange({ ...style, labelSize: Math.max(8, Number(event.target.value) || 8) })}
                size="small"
                type="number"
              />
              <TextField
                type="color"
                label="Halo color"
                value={style.labelHaloColor}
                onChange={(event) => onStyleChange({ ...style, labelHaloColor: event.target.value })}
                size="small"
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label="Halo width"
                value={style.labelHaloWidth}
                onChange={(event) => onStyleChange({ ...style, labelHaloWidth: Math.max(0, Number(event.target.value) || 0) })}
                size="small"
                type="number"
              />
              <Box display="grid" gridTemplateColumns="1fr 1fr" gap={1}>
                <TextField
                  label="Min zoom"
                  value={style.labelMinZoom}
                  onChange={(event) => onStyleChange({ ...style, labelMinZoom: Math.max(0, Number(event.target.value) || 0) })}
                  size="small"
                  type="number"
                />
                <TextField
                  label="Max zoom"
                  value={style.labelMaxZoom}
                  onChange={(event) => onStyleChange({ ...style, labelMaxZoom: Math.max(style.labelMinZoom, Number(event.target.value) || style.labelMinZoom) })}
                  size="small"
                  type="number"
                />
              </Box>
              <TextField
                label="Priority field"
                value={style.labelPriorityField}
                onChange={(event) => onStyleChange({ ...style, labelPriorityField: event.target.value })}
                size="small"
                select
                fullWidth
              >
                <MenuItem value="">None</MenuItem>
                {numericFields.map((field) => (
                  <MenuItem key={`label-priority-${field.id}`} value={field.name}>
                    {field.alias || field.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Anchor"
                value={style.labelAnchor}
                onChange={(event) =>
                  onStyleChange({
                    ...style,
                    labelAnchor: event.target.value as LayerStyleDraft['labelAnchor'],
                  })
                }
                size="small"
                select
              >
                <MenuItem value="center">center</MenuItem>
                <MenuItem value="top">top</MenuItem>
                <MenuItem value="bottom">bottom</MenuItem>
                <MenuItem value="left">left</MenuItem>
                <MenuItem value="right">right</MenuItem>
              </TextField>
              <TextField
                label="Max labels"
                value={style.labelMaxCount}
                onChange={(event) =>
                  onStyleChange({
                    ...style,
                    labelMaxCount: Math.max(10, Math.min(20_000, Math.round(Number(event.target.value) || 10))),
                  })
                }
                size="small"
                type="number"
              />
            </Box>
            <TextField
              label='Label expression (JSON, optional) e.g. ["coalesce", ["get","name"], ["get","id"]]'
              value={style.labelTextExpression}
              onChange={(event) => onStyleChange({ ...style, labelTextExpression: event.target.value })}
              size="small"
              fullWidth
              multiline
              minRows={2}
            />
          </Box>

          <Box display="grid" gap={1.5}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Expression Overrides
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Use MapLibre-style JSON expressions. Leave blank to use standard renderer settings.
            </Typography>
            <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }} gap={1.5}>
              <TextField
                label='Fill color expression e.g. ["match",["get","status"],"open","#2a9d8f","#e63946"]'
                value={style.fillColorExpression}
                onChange={(event) => onStyleChange({ ...style, fillColorExpression: event.target.value })}
                size="small"
                fullWidth
                multiline
                minRows={2}
              />
              <TextField
                label='Line color expression'
                value={style.lineColorExpression}
                onChange={(event) => onStyleChange({ ...style, lineColorExpression: event.target.value })}
                size="small"
                fullWidth
                multiline
                minRows={2}
              />
              <TextField
                label='Point radius expression e.g. ["interpolate",["linear"],["get","score"],0,3,100,16]'
                value={style.pointRadiusExpression}
                onChange={(event) => onStyleChange({ ...style, pointRadiusExpression: event.target.value })}
                size="small"
                fullWidth
                multiline
                minRows={2}
              />
              <TextField
                label='Opacity expression e.g. ["interpolate",["linear"],["get","confidence"],0,0.25,1,1]'
                value={style.opacityExpression}
                onChange={(event) => onStyleChange({ ...style, opacityExpression: event.target.value })}
                size="small"
                fullWidth
                multiline
                minRows={2}
              />
            </Box>
          </Box>

          <Box display="grid" gap={1.5}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Edit Rules
            </Typography>
            <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }} gap={1.5}>
              <TextField
                label="Snap enabled"
                value={style.snapEnabled ? 'true' : 'false'}
                onChange={(event) => onStyleChange({ ...style, snapEnabled: event.target.value === 'true' })}
                size="small"
                select
              >
                <MenuItem value="false">false</MenuItem>
                <MenuItem value="true">true</MenuItem>
              </TextField>
              <TextField
                label="Snap tolerance (m)"
                value={style.snapToleranceMeters}
                onChange={(event) => onStyleChange({ ...style, snapToleranceMeters: Math.max(1, Number(event.target.value) || 1) })}
                size="small"
                type="number"
              />
              <TextField
                label="No polygon overlap"
                value={style.topologyNoOverlap ? 'true' : 'false'}
                onChange={(event) => onStyleChange({ ...style, topologyNoOverlap: event.target.value === 'true' })}
                size="small"
                select
              >
                <MenuItem value="false">false</MenuItem>
                <MenuItem value="true">true</MenuItem>
              </TextField>
            </Box>
          </Box>

          {style.rendererType === 'uniqueValue' && (
            <Box display="grid" gap={1.5}>
              <TextField
                label="Category Field"
                value={style.uniqueValueField}
                onChange={(event) => onStyleChange({ ...style, uniqueValueField: event.target.value })}
                size="small"
                select
                fullWidth
              >
                {fields.map((field) => (
                  <MenuItem key={field.id} value={field.name}>{field.alias || field.name}</MenuItem>
                ))}
              </TextField>

              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Unique Value Stops</Typography>
                <Button
                  size="small"
                  startIcon={<AddIcon fontSize="small" />}
                  onClick={() => {
                    onStyleChange({
                      ...style,
                      uniqueValueStops: [
                        ...style.uniqueValueStops,
                        { value: '', color: '#3f88c5', opacity: 0.8 },
                      ],
                    })
                  }}
                >
                  Add Stop
                </Button>
              </Stack>

              {style.uniqueValueStops.map((stop, index) => (
                <Stack key={`${stop.value}-${index}`} direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems="center">
                  <TextField
                    label="Value"
                    value={stop.value}
                    onChange={(event) => {
                      const nextStops = [...style.uniqueValueStops]
                      nextStops[index] = { ...stop, value: event.target.value }
                      onStyleChange({ ...style, uniqueValueStops: nextStops })
                    }}
                    size="small"
                    fullWidth
                  />
                  <TextField
                    type="color"
                    label="Color"
                    value={stop.color}
                    onChange={(event) => {
                      const nextStops = [...style.uniqueValueStops]
                      nextStops[index] = { ...stop, color: event.target.value }
                      onStyleChange({ ...style, uniqueValueStops: nextStops })
                    }}
                    size="small"
                    InputLabelProps={{ shrink: true }}
                  />
                  <TextField
                    label="Opacity"
                    value={stop.opacity}
                    onChange={(event) => {
                      const nextStops = [...style.uniqueValueStops]
                      nextStops[index] = { ...stop, opacity: clamp01(Number(event.target.value) || 0) }
                      onStyleChange({ ...style, uniqueValueStops: nextStops })
                    }}
                    size="small"
                    type="number"
                    inputProps={{ min: 0, max: 1, step: 0.05 }}
                  />
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => {
                      const nextStops = style.uniqueValueStops.filter((_, stopIndex) => stopIndex !== index)
                      onStyleChange({ ...style, uniqueValueStops: nextStops })
                    }}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Stack>
              ))}

              <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }} gap={1.5}>
                <TextField
                  type="color"
                  label="Default Color"
                  value={style.uniqueDefaultColor}
                  onChange={(event) => onStyleChange({ ...style, uniqueDefaultColor: event.target.value })}
                  size="small"
                  InputLabelProps={{ shrink: true }}
                />
                <TextField
                  label="Default Opacity"
                  value={style.uniqueDefaultOpacity}
                  onChange={(event) => onStyleChange({ ...style, uniqueDefaultOpacity: clamp01(Number(event.target.value) || 0) })}
                  size="small"
                  type="number"
                  inputProps={{ min: 0, max: 1, step: 0.05 }}
                />
              </Box>
            </Box>
          )}

          {style.rendererType === 'classBreaks' && (
            <Box display="grid" gap={1.5}>
              <TextField
                label="Numeric Field"
                value={style.classBreakField}
                onChange={(event) => onStyleChange({ ...style, classBreakField: event.target.value })}
                size="small"
                select
                fullWidth
              >
                {numericFields.map((field) => (
                  <MenuItem key={field.id} value={field.name}>{field.alias || field.name}</MenuItem>
                ))}
              </TextField>

              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Class Breaks</Typography>
                <Button
                  size="small"
                  startIcon={<AddIcon fontSize="small" />}
                  onClick={() => {
                    onStyleChange({
                      ...style,
                      classBreakStops: [
                        ...style.classBreakStops,
                        { min: 0, max: 1, color: '#3f88c5', opacity: 0.8 },
                      ],
                    })
                  }}
                >
                  Add Break
                </Button>
              </Stack>

              {style.classBreakStops.map((stop, index) => (
                <Stack key={`${stop.min}-${stop.max}-${index}`} direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems="center">
                  <TextField
                    label="Min"
                    value={stop.min}
                    onChange={(event) => {
                      const nextStops = [...style.classBreakStops]
                      nextStops[index] = { ...stop, min: Number(event.target.value) }
                      onStyleChange({ ...style, classBreakStops: nextStops })
                    }}
                    size="small"
                    type="number"
                  />
                  <TextField
                    label="Max"
                    value={stop.max}
                    onChange={(event) => {
                      const nextStops = [...style.classBreakStops]
                      nextStops[index] = { ...stop, max: Number(event.target.value) }
                      onStyleChange({ ...style, classBreakStops: nextStops })
                    }}
                    size="small"
                    type="number"
                  />
                  <TextField
                    type="color"
                    label="Color"
                    value={stop.color}
                    onChange={(event) => {
                      const nextStops = [...style.classBreakStops]
                      nextStops[index] = { ...stop, color: event.target.value }
                      onStyleChange({ ...style, classBreakStops: nextStops })
                    }}
                    size="small"
                    InputLabelProps={{ shrink: true }}
                  />
                  <TextField
                    label="Opacity"
                    value={stop.opacity}
                    onChange={(event) => {
                      const nextStops = [...style.classBreakStops]
                      nextStops[index] = { ...stop, opacity: clamp01(Number(event.target.value) || 0) }
                      onStyleChange({ ...style, classBreakStops: nextStops })
                    }}
                    size="small"
                    type="number"
                    inputProps={{ min: 0, max: 1, step: 0.05 }}
                  />
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => {
                      const nextStops = style.classBreakStops.filter((_, breakIndex) => breakIndex !== index)
                      onStyleChange({ ...style, classBreakStops: nextStops })
                    }}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Stack>
              ))}

              <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }} gap={1.5}>
                <TextField
                  type="color"
                  label="Default Color"
                  value={style.classBreakDefaultColor}
                  onChange={(event) => onStyleChange({ ...style, classBreakDefaultColor: event.target.value })}
                  size="small"
                  InputLabelProps={{ shrink: true }}
                />
                <TextField
                  label="Default Opacity"
                  value={style.classBreakDefaultOpacity}
                  onChange={(event) => onStyleChange({ ...style, classBreakDefaultOpacity: clamp01(Number(event.target.value) || 0) })}
                  size="small"
                  type="number"
                  inputProps={{ min: 0, max: 1, step: 0.05 }}
                />
              </Box>
            </Box>
          )}
        </Box>
      </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={handleClose} disabled={submitting} color="inherit">
            Cancel
          </Button>
          <Button variant="contained" onClick={onSubmit} disabled={submitting}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
      <IconPickerDialog
        open={iconPickerOpen}
        library={style.iconLibrary}
        iconifyPrefix={style.iconifyPrefix}
        selectedIcon={style.iconName}
        color={style.color}
        onClose={() => setIconPickerOpen(false)}
        onSelect={(iconName) => {
          onStyleChange({ ...style, iconName })
          setIconPickerOpen(false)
        }}
        onIconifyPrefixChange={(prefix) => onStyleChange({ ...style, iconifyPrefix: prefix })}
      />
    </>
  )
}
