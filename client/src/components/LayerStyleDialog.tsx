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
import { PatternPickerDialog } from './PatternPickerDialog'
import { WORK_MODE_DIALOG_PROPS, normalModeDialogSx, workModeDialogSx } from './workModeDialog'
import { ICON_LIBRARY_DEFINITIONS } from '../utils/iconLibrary'
import { geometryFamilyFromType } from '../utils/geometry'
import {
  polygonPatternLabel,
  POLYGON_PATTERN_LIBRARY_OPTIONS,
  resolvePolygonPatternName,
} from '../utils/polygonPatterns'

interface LayerStyleDialogProps {
  open: boolean
  layerName: string | null
  layerGeometryType?: string | null
  fields: LayerField[]
  style: LayerStyleDraft
  submitting: boolean
  error: string | null
  workMode?: boolean
  onStyleChange: (next: LayerStyleDraft) => void
  onFetchUniqueValues: (field: string) => Promise<{
    values: Array<{ value: string; count: number }>
    null_count: number
    truncated: boolean
  }>
  onClose: () => void
  onSubmit: () => void
}

const CATEGORY_PALETTE = [
  '#4477aa', '#ee6677', '#228833', '#ccbb44', '#66ccee',
  '#aa3377', '#bbbbbb', '#ee8866', '#44aa99', '#997700',
  '#6699cc', '#cc6677', '#117733', '#ddcc77', '#88ccee',
]

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

function colorChannels(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!match) return null
  return [0, 2, 4].map((offset) => Number.parseInt(match[1].slice(offset, offset + 2), 16)) as [number, number, number]
}

function relativeLuminance(hex: string): number | null {
  const channels = colorChannels(hex)
  if (!channels) return null
  const linear = channels.map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
}

function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a)
  const second = relativeLuminance(b)
  if (first === null || second === null) return 21
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

function colorDistance(a: string, b: string): number {
  const first = colorChannels(a)
  const second = colorChannels(b)
  if (!first || !second) return 255
  return Math.sqrt(first.reduce((sum, value, index) => sum + (value - second[index]) ** 2, 0))
}

export function LayerStyleDialog({
  open,
  layerName,
  layerGeometryType = null,
  fields,
  style,
  submitting,
  error,
  workMode = false,
  onStyleChange,
  onFetchUniqueValues,
  onClose,
  onSubmit,
}: LayerStyleDialogProps) {
  const [generatingCategories, setGeneratingCategories] = useState(false)
  const [categoryMessage, setCategoryMessage] = useState<string | null>(null)
  const [iconPickerOpen, setIconPickerOpen] = useState(false)
  const [patternPickerOpen, setPatternPickerOpen] = useState(false)

  const handleClose = () => {
    if (!submitting) {
      onClose()
    }
  }

  const handleGenerateCategories = async () => {
    if (!style.uniqueValueField) {
      setCategoryMessage('Choose a category field first.')
      return
    }

    setGeneratingCategories(true)
    setCategoryMessage(null)
    try {
      const result = await onFetchUniqueValues(style.uniqueValueField)
      const existingByValue = new Map(style.uniqueValueStops.map((stop) => [stop.value, stop]))
      const uniqueValueStops = result.values.map((entry, index) => {
        const existing = existingByValue.get(entry.value)
        return existing ?? {
          value: entry.value,
          color: CATEGORY_PALETTE[index % CATEGORY_PALETTE.length],
          opacity: 0.8,
        }
      })
      onStyleChange({ ...style, uniqueValueStops })
      const details = [
        `${uniqueValueStops.length} categor${uniqueValueStops.length === 1 ? 'y' : 'ies'} generated`,
        result.null_count > 0 ? `${result.null_count} null feature${result.null_count === 1 ? '' : 's'}` : null,
        result.truncated ? 'additional values use “All other values”' : null,
      ].filter(Boolean)
      setCategoryMessage(details.join(' · '))
    } catch (generateError) {
      setCategoryMessage(generateError instanceof Error ? generateError.message : 'Failed to generate categories.')
    } finally {
      setGeneratingCategories(false)
    }
  }

  const numericFields = fields.filter((field) => field.field_type === 'integer' || field.field_type === 'double')
  const allFields = fields
  const geometryFamily = geometryFamilyFromType(layerGeometryType)
  const showPointControls = geometryFamily === 'point' || geometryFamily === 'mixed'
  const showLineControls = geometryFamily === 'line' || geometryFamily === 'polygon' || geometryFamily === 'mixed'
  const showPolygonControls = geometryFamily === 'polygon' || geometryFamily === 'mixed'
  const accessibilityWarnings: string[] = []
  if (style.opacity < 0.3) accessibilityWarnings.push('Base symbol opacity is below 30% and may disappear over imagery.')
  if (showPointControls && style.pointRadius < 4) accessibilityWarnings.push('Point radius below 4 px is difficult to identify and select.')
  if (showLineControls && style.strokeWidth < 1.5) accessibilityWarnings.push('Line width below 1.5 px may be unclear on high-density displays.')
  if (contrastRatio(style.labelColor, style.labelHaloColor) < 3) accessibilityWarnings.push('Label and halo colors have low contrast.')
  const categoryColors = style.rendererType === 'uniqueValue'
    ? style.uniqueValueStops.map((stop) => stop.color)
    : style.rendererType === 'classBreaks'
      ? style.classBreakStops.map((stop) => stop.color)
      : []
  if (categoryColors.some((color, index) => categoryColors.slice(index + 1).some((other) => colorDistance(color, other) < 45))) {
    accessibilityWarnings.push('Some category colors are visually similar; add stronger lightness or hue separation.')
  }

  const applyPreset = (patch: Partial<LayerStyleDraft>) => {
    onStyleChange({
      ...style,
      ...patch,
    })
  }

  return (
    <>
      <Dialog
        open={open}
        onClose={handleClose}
        fullWidth
        maxWidth="md"
        {...(workMode ? WORK_MODE_DIALOG_PROPS : {})}
        sx={workMode ? workModeDialogSx('min(860px, 96vw)') : normalModeDialogSx('min(860px, 96vw)')}
      >
      <DialogTitle>Layer Style</DialogTitle>
      <DialogContent>
        <Box display="grid" gap={2} pt={0.5}>
          {layerName && (
            <Typography variant="body2" color="text.secondary">
              Layer: <strong>{layerName}</strong>
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary">
            Geometry: <strong>{geometryFamily}</strong>
          </Typography>

          {error && <Alert severity="error">{error}</Alert>}
          {accessibilityWarnings.length > 0 && (
            <Alert severity="warning">
              <Typography variant="caption" component="div" sx={{ fontWeight: 700 }}>Accessibility review</Typography>
              {accessibilityWarnings.map((warning) => (
                <Typography key={warning} variant="caption" component="div">• {warning}</Typography>
              ))}
            </Alert>
          )}

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

          <TextField
            label="Symbol level / drawing order"
            value={style.symbolLevel}
            onChange={(event) => onStyleChange({ ...style, symbolLevel: Number(event.target.value) || 0 })}
            size="small"
            type="number"
            helperText="Higher levels draw above lower levels, independent of the layer-list order."
            inputProps={{ step: 1 }}
            fullWidth
          />

          <TextField
            label="Legend patch shape"
            value={style.legendPatchShape}
            onChange={(event) => onStyleChange({
              ...style,
              legendPatchShape: event.target.value as LayerStyleDraft['legendPatchShape'],
            })}
            size="small"
            select
            helperText="Auto uses the layer geometry; override for thematic legend conventions."
            fullWidth
          >
            <MenuItem value="auto">Automatic by geometry</MenuItem>
            <MenuItem value="circle">Circle marker</MenuItem>
            <MenuItem value="square">Square marker</MenuItem>
            <MenuItem value="line">Line sample</MenuItem>
            <MenuItem value="area">Area patch</MenuItem>
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

            {showPointControls ? (
              <>
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
              </>
            ) : (
              <>
                <Box />
                <Box />
              </>
            )}
          </Box>

          {showPointControls && style.pointShape === 'icon' && (
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

          {showLineControls && (
            <>
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

              {(geometryFamily === 'line' || geometryFamily === 'mixed') && (
              <Box display="grid" gap={1.25} sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1.5 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  Line Casing
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Draws a wider solid stroke beneath the line for roads, pipelines, routes, and overlapping networks.
                </Typography>
                <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }} gap={1.5}>
                  <TextField
                    label="Casing"
                    value={style.lineCasingEnabled ? 'enabled' : 'disabled'}
                    onChange={(event) => onStyleChange({ ...style, lineCasingEnabled: event.target.value === 'enabled' })}
                    size="small"
                    select
                    fullWidth
                  >
                    <MenuItem value="disabled">Disabled</MenuItem>
                    <MenuItem value="enabled">Enabled</MenuItem>
                  </TextField>
                  <TextField
                    type="color"
                    label="Casing color"
                    value={style.lineCasingColor}
                    onChange={(event) => onStyleChange({ ...style, lineCasingColor: event.target.value })}
                    size="small"
                    fullWidth
                    disabled={!style.lineCasingEnabled}
                    InputLabelProps={{ shrink: true }}
                  />
                  <TextField
                    label="Extra width"
                    value={style.lineCasingWidth}
                    onChange={(event) => onStyleChange({
                      ...style,
                      lineCasingWidth: Math.max(0, Number(event.target.value) || 0),
                    })}
                    size="small"
                    type="number"
                    inputProps={{ min: 0, max: 24, step: 0.5 }}
                    fullWidth
                    disabled={!style.lineCasingEnabled}
                  />
                </Box>
              </Box>
              )}

              {(geometryFamily === 'line' || geometryFamily === 'mixed') && (
                <Box display="grid" gap={1.25} sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1.5 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Box>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                        Secondary Line Symbols
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Negative levels draw below the primary stroke; zero and positive levels draw above it.
                      </Typography>
                    </Box>
                    <Button
                      size="small"
                      startIcon={<AddIcon fontSize="small" />}
                      onClick={() => onStyleChange({
                        ...style,
                        lineSymbolLayers: [
                          ...style.lineSymbolLayers,
                          {
                            id: `line-symbol-${Date.now()}`,
                            color: style.strokeColor,
                            opacity: 1,
                            width: Math.max(1, style.strokeWidth / 2),
                            dashArray: [1, 0],
                            level: 1,
                          },
                        ],
                      })}
                    >
                      Add Stroke
                    </Button>
                  </Stack>

                  {style.lineSymbolLayers.map((symbol, index) => (
                    <Box
                      key={symbol.id}
                      display="grid"
                      gridTemplateColumns={{ xs: '1fr 1fr', md: 'repeat(6, minmax(0, 1fr)) auto' }}
                      gap={1}
                      alignItems="center"
                    >
                      <TextField
                        type="color"
                        label="Color"
                        value={symbol.color}
                        size="small"
                        InputLabelProps={{ shrink: true }}
                        onChange={(event) => {
                          const next = [...style.lineSymbolLayers]
                          next[index] = { ...symbol, color: event.target.value }
                          onStyleChange({ ...style, lineSymbolLayers: next })
                        }}
                      />
                      <TextField
                        label="Opacity"
                        value={symbol.opacity}
                        type="number"
                        size="small"
                        inputProps={{ min: 0, max: 1, step: 0.05 }}
                        onChange={(event) => {
                          const next = [...style.lineSymbolLayers]
                          next[index] = { ...symbol, opacity: clamp01(Number(event.target.value) || 0) }
                          onStyleChange({ ...style, lineSymbolLayers: next })
                        }}
                      />
                      <TextField
                        label="Width"
                        value={symbol.width}
                        type="number"
                        size="small"
                        inputProps={{ min: 0.5, max: 48, step: 0.5 }}
                        onChange={(event) => {
                          const next = [...style.lineSymbolLayers]
                          next[index] = { ...symbol, width: Math.max(0.5, Number(event.target.value) || 0.5) }
                          onStyleChange({ ...style, lineSymbolLayers: next })
                        }}
                      />
                      <TextField
                        label="Dash on"
                        value={symbol.dashArray[0]}
                        type="number"
                        size="small"
                        onChange={(event) => {
                          const next = [...style.lineSymbolLayers]
                          next[index] = { ...symbol, dashArray: [Math.max(0, Number(event.target.value) || 0), symbol.dashArray[1]] }
                          onStyleChange({ ...style, lineSymbolLayers: next })
                        }}
                      />
                      <TextField
                        label="Dash off"
                        value={symbol.dashArray[1]}
                        type="number"
                        size="small"
                        onChange={(event) => {
                          const next = [...style.lineSymbolLayers]
                          next[index] = { ...symbol, dashArray: [symbol.dashArray[0], Math.max(0, Number(event.target.value) || 0)] }
                          onStyleChange({ ...style, lineSymbolLayers: next })
                        }}
                      />
                      <TextField
                        label="Level"
                        value={symbol.level}
                        type="number"
                        size="small"
                        onChange={(event) => {
                          const next = [...style.lineSymbolLayers]
                          next[index] = { ...symbol, level: Number(event.target.value) || 0 }
                          onStyleChange({ ...style, lineSymbolLayers: next })
                        }}
                      />
                      <IconButton
                        size="small"
                        color="error"
                        aria-label={`Delete secondary line symbol ${index + 1}`}
                        onClick={() => onStyleChange({
                          ...style,
                          lineSymbolLayers: style.lineSymbolLayers.filter((_, symbolIndex) => symbolIndex !== index),
                        })}
                      >
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  ))}
                </Box>
              )}

              {(geometryFamily === 'line' || geometryFamily === 'mixed') && (
                <Box display="grid" gap={1.25} sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1.5 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    Markers Along Line
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Repeats an icon by real-world distance along line and multiline features.
                  </Typography>
                  <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: 'repeat(6, minmax(0, 1fr))' }} gap={1}>
                    <TextField
                      label="Placement"
                      value={style.lineMarkerEnabled ? 'enabled' : 'disabled'}
                      onChange={(event) => onStyleChange({ ...style, lineMarkerEnabled: event.target.value === 'enabled' })}
                      size="small"
                      select
                    >
                      <MenuItem value="disabled">Disabled</MenuItem>
                      <MenuItem value="enabled">Enabled</MenuItem>
                    </TextField>
                    <TextField
                      label="Icon library"
                      value={style.lineMarkerLibrary}
                      onChange={(event) => onStyleChange({
                        ...style,
                        lineMarkerLibrary: event.target.value as LayerStyleDraft['lineMarkerLibrary'],
                      })}
                      size="small"
                      select
                      disabled={!style.lineMarkerEnabled}
                    >
                      {ICON_LIBRARY_DEFINITIONS.map((item) => (
                        <MenuItem key={`line-marker-${item.value}`} value={item.value}>{item.label}</MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      label="Icon name"
                      value={style.lineMarkerIcon}
                      onChange={(event) => onStyleChange({ ...style, lineMarkerIcon: event.target.value })}
                      size="small"
                      disabled={!style.lineMarkerEnabled}
                    />
                    <TextField
                      label="Spacing (m)"
                      value={style.lineMarkerSpacingMeters}
                      onChange={(event) => onStyleChange({
                        ...style,
                        lineMarkerSpacingMeters: Math.max(1, Number(event.target.value) || 1),
                      })}
                      type="number"
                      size="small"
                      disabled={!style.lineMarkerEnabled}
                    />
                    <TextField
                      label="Size (px)"
                      value={style.lineMarkerSize}
                      onChange={(event) => onStyleChange({
                        ...style,
                        lineMarkerSize: Math.max(4, Number(event.target.value) || 4),
                      })}
                      type="number"
                      size="small"
                      disabled={!style.lineMarkerEnabled}
                    />
                    <TextField
                      label="Rotation"
                      value={style.lineMarkerRotateWithLine ? 'follow' : 'fixed'}
                      onChange={(event) => onStyleChange({
                        ...style,
                        lineMarkerRotateWithLine: event.target.value === 'follow',
                      })}
                      size="small"
                      select
                      disabled={!style.lineMarkerEnabled}
                    >
                      <MenuItem value="follow">Follow line</MenuItem>
                      <MenuItem value="fixed">Fixed upright</MenuItem>
                    </TextField>
                  </Box>
                </Box>
              )}
            </>
          )}

          {showPolygonControls && (
            <Box display="grid" gap={1.5}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                Polygon Fill Patterns
              </Typography>
              <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: 'repeat(4, minmax(0, 1fr))' }} gap={1.5}>
                <TextField
                  label="Pattern library"
                  value={style.polygonPatternLibrary}
                  onChange={(event) =>
                    onStyleChange({
                      ...style,
                      polygonPatternLibrary: event.target.value as LayerStyleDraft['polygonPatternLibrary'],
                      polygonPattern: resolvePolygonPatternName(
                        event.target.value as LayerStyleDraft['polygonPatternLibrary'],
                        style.polygonPattern,
                      ),
                    })
                  }
                  size="small"
                  select
                  fullWidth
                >
                  {POLYGON_PATTERN_LIBRARY_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ gridColumn: { xs: 'span 1', md: 'span 2' } }}>
                  <TextField
                    label="Pattern"
                    value={polygonPatternLabel(style.polygonPatternLibrary, style.polygonPattern)}
                    size="small"
                    fullWidth
                    InputProps={{ readOnly: true }}
                  />
                  <Button variant="outlined" onClick={() => setPatternPickerOpen(true)}>
                    Browse
                  </Button>
                </Stack>
                <TextField
                  type="color"
                  label="Pattern color"
                  value={style.polygonPatternColor}
                  onChange={(event) => onStyleChange({ ...style, polygonPatternColor: event.target.value })}
                  size="small"
                  fullWidth
                  disabled={style.polygonPatternLibrary === 'builtin' && style.polygonPattern === 'solid'}
                  InputLabelProps={{ shrink: true }}
                />
                <TextField
                  label="Pattern opacity"
                  value={style.polygonPatternOpacity}
                  onChange={(event) =>
                    onStyleChange({
                      ...style,
                      polygonPatternOpacity: clamp01(Number(event.target.value) || 0),
                    })
                  }
                  size="small"
                  type="number"
                  fullWidth
                  disabled={style.polygonPatternLibrary === 'builtin' && style.polygonPattern === 'solid'}
                  inputProps={{ min: 0, max: 1, step: 0.05 }}
                />
                <TextField
                  label="Pattern scale"
                  value={style.polygonPatternScale}
                  onChange={(event) =>
                    onStyleChange({
                      ...style,
                      polygonPatternScale: Math.max(0.25, Math.min(6, Number(event.target.value) || 0.25)),
                    })
                  }
                  size="small"
                  type="number"
                  fullWidth
                  disabled={style.polygonPatternLibrary === 'builtin' && style.polygonPattern === 'solid'}
                  inputProps={{ min: 0.25, max: 6, step: 0.25 }}
                />
              </Box>
              <Typography variant="caption" color="text.secondary">
                Choose from built-in hatch styles or Hero Patterns (free MIT library), with live visual browser.
              </Typography>
              <Box display="grid" gap={1.25} sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1.5 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  Polygon Marker
                </Typography>
                <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: 'repeat(5, minmax(0, 1fr))' }} gap={1}>
                  <TextField
                    label="Marker"
                    value={style.polygonMarkerEnabled ? 'enabled' : 'disabled'}
                    onChange={(event) => onStyleChange({ ...style, polygonMarkerEnabled: event.target.value === 'enabled' })}
                    size="small"
                    select
                  >
                    <MenuItem value="disabled">Disabled</MenuItem>
                    <MenuItem value="enabled">Enabled</MenuItem>
                  </TextField>
                  <TextField
                    label="Placement"
                    value={style.polygonMarkerPlacement}
                    onChange={(event) => onStyleChange({
                      ...style,
                      polygonMarkerPlacement: event.target.value as LayerStyleDraft['polygonMarkerPlacement'],
                    })}
                    size="small"
                    select
                    disabled={!style.polygonMarkerEnabled}
                  >
                    <MenuItem value="interior">Interior point</MenuItem>
                    <MenuItem value="centroid">Centroid</MenuItem>
                  </TextField>
                  <TextField
                    label="Icon library"
                    value={style.polygonMarkerLibrary}
                    onChange={(event) => onStyleChange({
                      ...style,
                      polygonMarkerLibrary: event.target.value as LayerStyleDraft['polygonMarkerLibrary'],
                    })}
                    size="small"
                    select
                    disabled={!style.polygonMarkerEnabled}
                  >
                    {ICON_LIBRARY_DEFINITIONS.map((item) => (
                      <MenuItem key={`polygon-marker-${item.value}`} value={item.value}>{item.label}</MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    label="Icon name"
                    value={style.polygonMarkerIcon}
                    onChange={(event) => onStyleChange({ ...style, polygonMarkerIcon: event.target.value })}
                    size="small"
                    disabled={!style.polygonMarkerEnabled}
                  />
                  <TextField
                    label="Size (px)"
                    value={style.polygonMarkerSize}
                    onChange={(event) => onStyleChange({
                      ...style,
                      polygonMarkerSize: Math.max(4, Number(event.target.value) || 4),
                    })}
                    type="number"
                    size="small"
                    disabled={!style.polygonMarkerEnabled}
                  />
                </Box>
                <Typography variant="caption" color="text.secondary">
                  Interior placement keeps markers inside concave polygons and outside interior holes when possible.
                </Typography>
              </Box>
            </Box>
          )}

          <Box display="grid" gap={1.5}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Visual Variables
            </Typography>
            <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }} gap={1.5}>
              {showPointControls && (
                <>
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
                </>
              )}
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
              <TextField
                label="Collision handling"
                value={style.labelCollisionEnabled ? 'enabled' : 'disabled'}
                onChange={(event) => onStyleChange({ ...style, labelCollisionEnabled: event.target.value === 'enabled' })}
                size="small"
                select
                helperText="Higher priority values survive collisions."
              >
                <MenuItem value="enabled">Avoid overlaps</MenuItem>
                <MenuItem value="disabled">Allow overlaps</MenuItem>
              </TextField>
              <TextField
                label="Wrap after characters"
                value={style.labelWrapLength}
                onChange={(event) => onStyleChange({
                  ...style,
                  labelWrapLength: Math.max(0, Math.round(Number(event.target.value) || 0)),
                })}
                size="small"
                type="number"
                helperText="0 disables wrapping."
              />
              <TextField
                label="Abbreviate after characters"
                value={style.labelMaxLength}
                onChange={(event) => onStyleChange({
                  ...style,
                  labelMaxLength: Math.max(0, Math.round(Number(event.target.value) || 0)),
                })}
                size="small"
                type="number"
                helperText="0 keeps the full text."
              />
              {(geometryFamily === 'line' || geometryFamily === 'mixed') && (
                <TextField
                  label="Line label repeat (m)"
                  value={style.labelRepeatDistanceMeters}
                  onChange={(event) => onStyleChange({
                    ...style,
                    labelRepeatDistanceMeters: Math.max(0, Number(event.target.value) || 0),
                  })}
                  size="small"
                  type="number"
                  helperText="0 places one label per feature."
                />
              )}
              {(geometryFamily === 'line' || geometryFamily === 'mixed') && (
                <TextField
                  label="Line label rotation"
                  value={style.labelRotateWithLine ? 'follow' : 'fixed'}
                  onChange={(event) => onStyleChange({ ...style, labelRotateWithLine: event.target.value === 'follow' })}
                  size="small"
                  select
                >
                  <MenuItem value="follow">Follow segment</MenuItem>
                  <MenuItem value="fixed">Fixed upright</MenuItem>
                </TextField>
              )}
              {showPolygonControls && (
                <TextField
                  label="Polygon label fitting"
                  value={style.labelPolygonFitEnabled ? 'enabled' : 'disabled'}
                  onChange={(event) => onStyleChange({
                    ...style,
                    labelPolygonFitEnabled: event.target.value === 'enabled',
                  })}
                  size="small"
                  select
                  helperText="Suppress labels that do not fit at the current zoom."
                >
                  <MenuItem value="enabled">Require fit</MenuItem>
                  <MenuItem value="disabled">Allow overflow</MenuItem>
                </TextField>
              )}
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
            <Box display="grid" gap={1.25} sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1.5 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Label Classes</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Ordered attribute rules; the last matching class wins.
                  </Typography>
                </Box>
                <Button
                  size="small"
                  startIcon={<AddIcon fontSize="small" />}
                  onClick={() => onStyleChange({
                    ...style,
                    labelClasses: [
                      ...style.labelClasses,
                      {
                        id: `label-class-${Date.now()}`,
                        name: `Class ${style.labelClasses.length + 1}`,
                        filterField: '',
                        filterValue: '',
                        labelField: style.labelField,
                        color: style.labelColor,
                        size: style.labelSize,
                        minZoom: style.labelMinZoom,
                        maxZoom: style.labelMaxZoom,
                        priority: 0,
                      },
                    ],
                  })}
                >
                  Add Class
                </Button>
              </Stack>
              {style.labelClasses.map((labelClass, index) => (
                <Box key={labelClass.id} display="grid" gap={1} sx={{ p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
                  <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: 'repeat(4, minmax(0, 1fr))' }} gap={1}>
                    <TextField
                      label="Class name"
                      value={labelClass.name}
                      size="small"
                      onChange={(event) => {
                        const next = [...style.labelClasses]
                        next[index] = { ...labelClass, name: event.target.value }
                        onStyleChange({ ...style, labelClasses: next })
                      }}
                    />
                    <TextField
                      label="Filter field"
                      value={labelClass.filterField}
                      size="small"
                      select
                      onChange={(event) => {
                        const next = [...style.labelClasses]
                        next[index] = { ...labelClass, filterField: event.target.value }
                        onStyleChange({ ...style, labelClasses: next })
                      }}
                    >
                      <MenuItem value="">All features</MenuItem>
                      {allFields.map((field) => <MenuItem key={`class-filter-${field.id}`} value={field.name}>{field.alias || field.name}</MenuItem>)}
                    </TextField>
                    <TextField
                      label="Equals value"
                      value={labelClass.filterValue}
                      size="small"
                      disabled={!labelClass.filterField}
                      onChange={(event) => {
                        const next = [...style.labelClasses]
                        next[index] = { ...labelClass, filterValue: event.target.value }
                        onStyleChange({ ...style, labelClasses: next })
                      }}
                    />
                    <TextField
                      label="Label field"
                      value={labelClass.labelField}
                      size="small"
                      select
                      onChange={(event) => {
                        const next = [...style.labelClasses]
                        next[index] = { ...labelClass, labelField: event.target.value }
                        onStyleChange({ ...style, labelClasses: next })
                      }}
                    >
                      <MenuItem value="">Use base label</MenuItem>
                      {allFields.map((field) => <MenuItem key={`class-label-${field.id}`} value={field.name}>{field.alias || field.name}</MenuItem>)}
                    </TextField>
                  </Box>
                  <Box display="grid" gridTemplateColumns={{ xs: '1fr 1fr', md: 'repeat(6, minmax(0, 1fr)) auto' }} gap={1} alignItems="center">
                    <TextField type="color" label="Color" value={labelClass.color} size="small" InputLabelProps={{ shrink: true }} onChange={(event) => {
                      const next = [...style.labelClasses]; next[index] = { ...labelClass, color: event.target.value }; onStyleChange({ ...style, labelClasses: next })
                    }} />
                    <TextField label="Size" value={labelClass.size} type="number" size="small" onChange={(event) => {
                      const next = [...style.labelClasses]; next[index] = { ...labelClass, size: Math.max(8, Number(event.target.value) || 8) }; onStyleChange({ ...style, labelClasses: next })
                    }} />
                    <TextField label="Min zoom" value={labelClass.minZoom} type="number" size="small" onChange={(event) => {
                      const next = [...style.labelClasses]; next[index] = { ...labelClass, minZoom: Math.max(0, Number(event.target.value) || 0) }; onStyleChange({ ...style, labelClasses: next })
                    }} />
                    <TextField label="Max zoom" value={labelClass.maxZoom} type="number" size="small" onChange={(event) => {
                      const next = [...style.labelClasses]; next[index] = { ...labelClass, maxZoom: Math.min(24, Number(event.target.value) || 24) }; onStyleChange({ ...style, labelClasses: next })
                    }} />
                    <TextField label="Priority" value={labelClass.priority} type="number" size="small" onChange={(event) => {
                      const next = [...style.labelClasses]; next[index] = { ...labelClass, priority: Number(event.target.value) || 0 }; onStyleChange({ ...style, labelClasses: next })
                    }} />
                    <Box />
                    <IconButton size="small" color="error" aria-label={`Delete label class ${index + 1}`} onClick={() => onStyleChange({
                      ...style,
                      labelClasses: style.labelClasses.filter((_, classIndex) => classIndex !== index),
                    })}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>

          <Box display="grid" gap={1.5}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Expression Overrides
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Use MapLibre-style JSON expressions. Leave blank to use standard renderer settings.
            </Typography>
            <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }} gap={1.5}>
              {(showPointControls || showPolygonControls) && (
                <TextField
                  label='Fill color expression e.g. ["match",["get","status"],"open","#2a9d8f","#e63946"]'
                  value={style.fillColorExpression}
                  onChange={(event) => onStyleChange({ ...style, fillColorExpression: event.target.value })}
                  size="small"
                  fullWidth
                  multiline
                  minRows={2}
                />
              )}
              {showLineControls && (
                <TextField
                  label='Line color expression'
                  value={style.lineColorExpression}
                  onChange={(event) => onStyleChange({ ...style, lineColorExpression: event.target.value })}
                  size="small"
                  fullWidth
                  multiline
                  minRows={2}
                />
              )}
              {showPointControls && (
                <TextField
                  label='Point radius expression e.g. ["interpolate",["linear"],["get","score"],0,3,100,16]'
                  value={style.pointRadiusExpression}
                  onChange={(event) => onStyleChange({ ...style, pointRadiusExpression: event.target.value })}
                  size="small"
                  fullWidth
                  multiline
                  minRows={2}
                />
              )}
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

          <Box display="grid" gap={1.5} sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1.5 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  Scale-Dependent Symbols
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  The last matching zoom rule wins when ranges overlap.
                </Typography>
              </Box>
              <Button
                size="small"
                startIcon={<AddIcon fontSize="small" />}
                onClick={() => onStyleChange({
                  ...style,
                  scaleOverrides: [
                    ...style.scaleOverrides,
                    {
                      minZoom: 0,
                      maxZoom: 24,
                      color: style.color,
                      opacity: style.opacity,
                      strokeWidth: style.strokeWidth,
                      pointRadius: style.pointRadius,
                    },
                  ],
                })}
              >
                Add Zoom Rule
              </Button>
            </Stack>

            {style.scaleOverrides.length === 0 && (
              <Typography variant="caption" color="text.secondary">
                No overrides. The base symbol is used at every visible zoom level.
              </Typography>
            )}

            {style.scaleOverrides.map((rule, index) => (
              <Box
                key={`scale-rule-${index}`}
                display="grid"
                gridTemplateColumns={{ xs: '1fr 1fr', md: 'repeat(6, minmax(0, 1fr)) auto' }}
                gap={1}
                alignItems="center"
              >
                <TextField
                  label="Min zoom"
                  value={rule.minZoom}
                  type="number"
                  size="small"
                  inputProps={{ min: 0, max: 24, step: 0.5 }}
                  onChange={(event) => {
                    const next = [...style.scaleOverrides]
                    next[index] = { ...rule, minZoom: Math.max(0, Math.min(24, Number(event.target.value) || 0)) }
                    onStyleChange({ ...style, scaleOverrides: next })
                  }}
                />
                <TextField
                  label="Max zoom"
                  value={rule.maxZoom}
                  type="number"
                  size="small"
                  inputProps={{ min: 0, max: 24, step: 0.5 }}
                  error={rule.maxZoom < rule.minZoom}
                  onChange={(event) => {
                    const next = [...style.scaleOverrides]
                    next[index] = { ...rule, maxZoom: Math.max(0, Math.min(24, Number(event.target.value) || 0)) }
                    onStyleChange({ ...style, scaleOverrides: next })
                  }}
                />
                <TextField
                  type="color"
                  label="Color"
                  value={rule.color}
                  size="small"
                  InputLabelProps={{ shrink: true }}
                  onChange={(event) => {
                    const next = [...style.scaleOverrides]
                    next[index] = { ...rule, color: event.target.value }
                    onStyleChange({ ...style, scaleOverrides: next })
                  }}
                />
                <TextField
                  label="Opacity"
                  value={rule.opacity}
                  type="number"
                  size="small"
                  inputProps={{ min: 0, max: 1, step: 0.05 }}
                  onChange={(event) => {
                    const next = [...style.scaleOverrides]
                    next[index] = { ...rule, opacity: clamp01(Number(event.target.value) || 0) }
                    onStyleChange({ ...style, scaleOverrides: next })
                  }}
                />
                <TextField
                  label="Line width"
                  value={rule.strokeWidth}
                  type="number"
                  size="small"
                  inputProps={{ min: 1, max: 48, step: 0.5 }}
                  onChange={(event) => {
                    const next = [...style.scaleOverrides]
                    next[index] = { ...rule, strokeWidth: Math.max(1, Number(event.target.value) || 1) }
                    onStyleChange({ ...style, scaleOverrides: next })
                  }}
                />
                <TextField
                  label="Point radius"
                  value={rule.pointRadius}
                  type="number"
                  size="small"
                  inputProps={{ min: 1, max: 96, step: 0.5 }}
                  onChange={(event) => {
                    const next = [...style.scaleOverrides]
                    next[index] = { ...rule, pointRadius: Math.max(1, Number(event.target.value) || 1) }
                    onStyleChange({ ...style, scaleOverrides: next })
                  }}
                />
                <IconButton
                  size="small"
                  color="error"
                  aria-label={`Delete zoom rule ${index + 1}`}
                  onClick={() => onStyleChange({
                    ...style,
                    scaleOverrides: style.scaleOverrides.filter((_, ruleIndex) => ruleIndex !== index),
                  })}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Box>
            ))}
          </Box>

          <Box display="grid" gap={1.5}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Edit Rules
            </Typography>
            <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }} gap={1.5}>
              {showPointControls && (
                <>
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
                </>
              )}
              {showPolygonControls && (
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
              )}
            </Box>
            {!showPointControls && !showPolygonControls && (
              <Typography variant="caption" color="text.secondary">
                No edit topology rules are available for pure line layers.
              </Typography>
            )}
          </Box>

          {style.rendererType === 'uniqueValue' && (
            <Box display="grid" gap={1.5}>
              <TextField
                label="Category Field"
                value={style.uniqueValueField}
                onChange={(event) => {
                  setCategoryMessage(null)
                  onStyleChange({ ...style, uniqueValueField: event.target.value })
                }}
                size="small"
                select
                fullWidth
              >
                {fields.map((field) => (
                  <MenuItem key={field.id} value={field.name}>{field.alias || field.name}</MenuItem>
                ))}
              </TextField>

              <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} gap={1}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Unique Value Stops</Typography>
                <Stack direction="row" gap={1}>
                  <Button
                    size="small"
                    variant="contained"
                    disabled={!style.uniqueValueField || generatingCategories}
                    onClick={() => void handleGenerateCategories()}
                  >
                    {generatingCategories ? 'Generating…' : 'Generate Categories'}
                  </Button>
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
                    Add Manually
                  </Button>
                </Stack>
              </Stack>

              {categoryMessage && <Alert severity="info">{categoryMessage}</Alert>}

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

              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Fallback Symbols</Typography>
              <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: 'repeat(4, minmax(0, 1fr))' }} gap={1.5}>
                <TextField
                  type="color"
                  label="All other values"
                  value={style.uniqueDefaultColor}
                  onChange={(event) => onStyleChange({ ...style, uniqueDefaultColor: event.target.value })}
                  size="small"
                  InputLabelProps={{ shrink: true }}
                />
                <TextField
                  label="Other opacity"
                  value={style.uniqueDefaultOpacity}
                  onChange={(event) => onStyleChange({ ...style, uniqueDefaultOpacity: clamp01(Number(event.target.value) || 0) })}
                  size="small"
                  type="number"
                  inputProps={{ min: 0, max: 1, step: 0.05 }}
                />
                <TextField
                  type="color"
                  label="Null / empty values"
                  value={style.uniqueNullColor}
                  onChange={(event) => onStyleChange({ ...style, uniqueNullColor: event.target.value })}
                  size="small"
                  InputLabelProps={{ shrink: true }}
                />
                <TextField
                  label="Null opacity"
                  value={style.uniqueNullOpacity}
                  onChange={(event) => onStyleChange({ ...style, uniqueNullOpacity: clamp01(Number(event.target.value) || 0) })}
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

              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Fallback Symbols</Typography>
              <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: 'repeat(4, minmax(0, 1fr))' }} gap={1.5}>
                <TextField
                  type="color"
                  label="Outside breaks"
                  value={style.classBreakDefaultColor}
                  onChange={(event) => onStyleChange({ ...style, classBreakDefaultColor: event.target.value })}
                  size="small"
                  InputLabelProps={{ shrink: true }}
                />
                <TextField
                  label="Outside opacity"
                  value={style.classBreakDefaultOpacity}
                  onChange={(event) => onStyleChange({ ...style, classBreakDefaultOpacity: clamp01(Number(event.target.value) || 0) })}
                  size="small"
                  type="number"
                  inputProps={{ min: 0, max: 1, step: 0.05 }}
                />
                <TextField
                  type="color"
                  label="Null values"
                  value={style.classBreakNullColor}
                  onChange={(event) => onStyleChange({ ...style, classBreakNullColor: event.target.value })}
                  size="small"
                  InputLabelProps={{ shrink: true }}
                />
                <TextField
                  label="Null opacity"
                  value={style.classBreakNullOpacity}
                  onChange={(event) => onStyleChange({ ...style, classBreakNullOpacity: clamp01(Number(event.target.value) || 0) })}
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
        workMode={workMode}
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
      {patternPickerOpen && (
        <PatternPickerDialog
          open={patternPickerOpen}
          workMode={workMode}
          library={style.polygonPatternLibrary}
          selectedPattern={style.polygonPattern}
          color={style.polygonPatternColor}
          opacity={style.polygonPatternOpacity}
          onClose={() => setPatternPickerOpen(false)}
          onSelect={(library, patternName) => {
            onStyleChange({
              ...style,
              polygonPatternLibrary: library,
              polygonPattern: patternName,
            })
            setPatternPickerOpen(false)
          }}
        />
      )}
    </>
  )
}
