import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  Divider,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import type { FeatureCollection, Layer } from '../types/gis'
import { iconifySvgUrl } from '../utils/iconLibrary'
import { buildLayerLegendModel, type LegendMode, type LayerLegendModel } from '../utils/legend'

interface LayerLegendProps {
  layers: Layer[]
  visibleByLayerId: Record<string, boolean>
  featureCollections: Record<string, FeatureCollection | undefined>
  mapZoom?: number | null
  mode: LegendMode
  legendFilters: Record<string, string[]>
  onModeChange: (mode: LegendMode) => void
  onToggleLegendItem: (layerId: string, itemKey: string) => void
  onResetLegendFilters: (layerId?: string) => void
}

const MODE_OPTIONS: Array<{ value: LegendMode; label: string }> = [
  { value: 'professional', label: 'Professional' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'analyst', label: 'Analyst' },
  { value: 'interactive', label: 'Interactive' },
  { value: 'presentation', label: 'Presentation' },
]

function paperStyle(mode: LegendMode) {
  if (mode === 'minimal') {
    return {
      width: 230,
      maxHeight: 220,
      bgcolor: 'rgba(255,255,255,0.94)',
    }
  }
  if (mode === 'presentation') {
    return {
      width: 430,
      maxHeight: 460,
      bgcolor: '#ffffff',
      border: '2px solid #111827',
      boxShadow: '0 8px 26px rgba(15,23,42,0.25)',
    }
  }
  if (mode === 'analyst') {
    return {
      width: 370,
      maxHeight: 430,
      bgcolor: 'rgba(253,255,252,0.97)',
    }
  }
  if (mode === 'interactive') {
    return {
      width: 390,
      maxHeight: 430,
      bgcolor: 'rgba(250,253,255,0.97)',
    }
  }
  return {
    width: 360,
    maxHeight: 420,
    bgcolor: 'rgba(252,255,253,0.96)',
  }
}

function renderLegendSwatch(model: LayerLegendModel, color: string, iconId?: string) {
  if (model.pointShape === 'icon' && iconId) {
    return (
      <Box
        component="img"
        src={iconifySvgUrl(iconId, color)}
        alt={iconId}
        sx={{ width: 18, height: 18 }}
      />
    )
  }

  return (
    <Box
      sx={{
        width: 16,
        height: 16,
        borderRadius: model.pointShape === 'circle' ? '50%' : '4px',
        bgcolor: color,
        border: '1px solid #111827',
        flexShrink: 0,
      }}
    />
  )
}

function renderMinimal(models: LayerLegendModel[]) {
  return (
    <Stack spacing={0.75}>
      {models.map((model) => {
        const first = model.items.find((item) => item.count > 0) ?? model.items[0]
        if (!first) {
          return null
        }
        return (
          <Stack key={model.layerId} direction="row" spacing={1} alignItems="center">
            {renderLegendSwatch(model, first.color, first.iconId)}
            <Typography variant="caption" sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {model.layerName}
            </Typography>
          </Stack>
        )
      })}
    </Stack>
  )
}

function renderDetailed(
  mode: LegendMode,
  models: LayerLegendModel[],
  legendFilters: Record<string, string[]>,
  onToggleLegendItem: (layerId: string, itemKey: string) => void,
) {
  const interactive = mode === 'interactive'
  const showAnalyst = mode === 'analyst' || mode === 'interactive'
  const presentation = mode === 'presentation'

  return (
    <Stack spacing={1}>
      {models.map((model) => {
        const hidden = new Set(legendFilters[model.layerId] ?? [])
        const visibleCount = model.items.reduce((sum, item) => (hidden.has(item.key) ? sum : sum + item.count), 0)
        const hiddenCount = model.totalCount - visibleCount

        return (
          <Accordion key={model.layerId} disableGutters defaultExpanded sx={{ boxShadow: 'none', bgcolor: 'transparent' }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon fontSize="small" />} sx={{ px: 0.5, minHeight: 34 }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%' }}>
                <Typography
                  variant={presentation ? 'body1' : 'caption'}
                  sx={{ fontWeight: 700, flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}
                >
                  {model.layerName}
                </Typography>
                <Chip size="small" label={model.renderer} />
                {showAnalyst && <Chip size="small" color="primary" label={`${model.totalCount} feats`} />}
              </Stack>
            </AccordionSummary>
            <AccordionDetails sx={{ px: 0.5, pt: 0, pb: 0.75 }}>
              <Stack spacing={0.5}>
                {model.field && (
                  <Typography variant="caption" color="text.secondary">
                    Field: <strong>{model.field}</strong>
                  </Typography>
                )}

                {showAnalyst && hiddenCount > 0 && (
                  <Typography variant="caption" color="warning.main">
                    {hiddenCount} feature(s) hidden by legend filters
                  </Typography>
                )}

                {model.items.map((item) => {
                  const disabled = hidden.has(item.key)
                  const ratio = model.totalCount ? Math.round((item.count / model.totalCount) * 100) : 0

                  if (interactive) {
                    return (
                      <Button
                        key={`${model.layerId}-${item.key}`}
                        variant={disabled ? 'outlined' : 'contained'}
                        size="small"
                        color={disabled ? 'inherit' : 'primary'}
                        onClick={() => onToggleLegendItem(model.layerId, item.key)}
                        sx={{ justifyContent: 'space-between', textTransform: 'none', px: 1 }}
                      >
                        <Stack direction="row" spacing={1} alignItems="center">
                          {renderLegendSwatch(model, item.color, item.iconId)}
                          <Typography
                            variant="caption"
                            sx={{
                              textDecoration: disabled ? 'line-through' : 'none',
                              opacity: disabled ? 0.7 : 1,
                            }}
                          >
                            {item.label}
                          </Typography>
                        </Stack>
                        <Typography variant="caption">{item.count}</Typography>
                      </Button>
                    )
                  }

                  return (
                    <Stack key={`${model.layerId}-${item.key}`} direction="row" spacing={1} alignItems="center">
                      {renderLegendSwatch(model, item.color, item.iconId)}
                      <Typography
                        variant={presentation ? 'body2' : 'caption'}
                        sx={{ flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}
                      >
                        {item.label}
                      </Typography>
                      {showAnalyst && (
                        <Typography variant="caption" color="text.secondary">
                          {item.count} ({ratio}%)
                        </Typography>
                      )}
                    </Stack>
                  )
                })}
              </Stack>
            </AccordionDetails>
          </Accordion>
        )
      })}
    </Stack>
  )
}

export function LayerLegend({
  layers,
  visibleByLayerId,
  featureCollections,
  mapZoom,
  mode,
  legendFilters,
  onModeChange,
  onToggleLegendItem,
  onResetLegendFilters,
}: LayerLegendProps) {
  const visibleLayers = layers.filter((layer) => visibleByLayerId[layer.id] ?? true)
  const models = visibleLayers.map((layer) => buildLayerLegendModel(layer, featureCollections[layer.id]))

  if (!models.length) {
    return null
  }

  const style = paperStyle(mode)

  return (
    <Paper
      elevation={mode === 'presentation' ? 0 : 3}
      sx={{
        position: 'absolute',
        right: 16,
        bottom: 'max(18px, calc(env(safe-area-inset-bottom) + 8px))',
        overflow: 'auto',
        p: mode === 'minimal' ? 1.1 : 1.5,
        borderRadius: mode === 'presentation' ? 1 : 2,
        zIndex: 12,
        ...style,
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant={mode === 'presentation' ? 'h6' : 'subtitle2'} sx={{ fontWeight: 700 }}>
          Legend
        </Typography>
        <TextField
          select
          size="small"
          value={mode}
          onChange={(event) => onModeChange(event.target.value as LegendMode)}
          sx={{ minWidth: 148 }}
        >
          {MODE_OPTIONS.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      {(mode === 'analyst' || mode === 'interactive') && (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          <Chip size="small" label={`${models.reduce((sum, model) => sum + model.totalCount, 0)} features`} color="primary" />
          {typeof mapZoom === 'number' && <Chip size="small" label={`Zoom ${mapZoom.toFixed(1)}`} />}
          {mode === 'interactive' && (
            <Button size="small" variant="outlined" onClick={() => onResetLegendFilters()}>
              Reset Filters
            </Button>
          )}
        </Stack>
      )}

      <Divider sx={{ mb: 1 }} />

      {mode === 'minimal'
        ? renderMinimal(models)
        : renderDetailed(mode, models, legendFilters, onToggleLegendItem)}
    </Paper>
  )
}
