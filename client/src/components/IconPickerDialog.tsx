import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import type { LayerIconLibrary } from '../types/gis'
import { iconifySvgUrl, resolveIconId, resolveIconPrefix } from '../utils/iconLibrary'
import { WORK_MODE_DIALOG_PROPS, normalModeDialogSx, workModeDialogSx } from './workModeDialog'

type IconTypeKey = 'all' | 'places' | 'transport' | 'buildings' | 'utilities' | 'emergency' | 'nature'

const ICON_TYPE_OPTIONS: Array<{ key: IconTypeKey; label: string; keywords: string[] }> = [
  { key: 'all', label: 'All', keywords: [] },
  { key: 'places', label: 'Places', keywords: ['map', 'pin', 'marker', 'location', 'point', 'poi', 'place'] },
  { key: 'transport', label: 'Transport', keywords: ['car', 'bus', 'train', 'bike', 'truck', 'boat', 'airport', 'plane'] },
  { key: 'buildings', label: 'Buildings', keywords: ['building', 'house', 'home', 'school', 'hospital', 'office', 'warehouse'] },
  { key: 'utilities', label: 'Utilities', keywords: ['power', 'electric', 'water', 'pipe', 'line', 'tower', 'network', 'wifi'] },
  { key: 'emergency', label: 'Emergency', keywords: ['alert', 'warning', 'hazard', 'fire', 'police', 'ambulance', 'medical'] },
  { key: 'nature', label: 'Nature', keywords: ['tree', 'park', 'forest', 'leaf', 'mountain', 'river', 'beach'] },
]

interface IconPickerDialogProps {
  open: boolean
  workMode?: boolean
  library: LayerIconLibrary
  iconifyPrefix: string
  selectedIcon: string
  color: string
  onClose: () => void
  onSelect: (iconName: string) => void
  onIconifyPrefixChange: (prefix: string) => void
}

function dedupe(tokens: string[]): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  for (const token of tokens) {
    const trimmed = token.trim()
    if (!trimmed || seen.has(trimmed)) {
      continue
    }
    seen.add(trimmed)
    output.push(trimmed)
  }
  return output
}

function parseCollectionIconNames(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') {
    return []
  }

  const source = payload as { uncategorized?: unknown; categories?: unknown }
  const names: string[] = []

  if (Array.isArray(source.uncategorized)) {
    for (const item of source.uncategorized) {
      if (typeof item === 'string') {
        names.push(item)
      }
    }
  }

  if (source.categories && typeof source.categories === 'object') {
    for (const value of Object.values(source.categories as Record<string, unknown>)) {
      if (!Array.isArray(value)) {
        continue
      }
      for (const item of value) {
        if (typeof item === 'string') {
          names.push(item)
        }
      }
    }
  }

  return dedupe(names)
}

function parseSearchIconNames(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') {
    return []
  }

  const source = payload as { icons?: unknown }
  if (!Array.isArray(source.icons)) {
    return []
  }

  return dedupe(
    source.icons
      .filter((icon): icon is string => typeof icon === 'string')
      .map((iconId) => {
        const [, ...parts] = iconId.split(':')
        return parts.length ? parts.join(':') : iconId
      }),
  )
}

function matchesIconType(iconName: string, type: IconTypeKey): boolean {
  if (type === 'all') {
    return true
  }
  const rule = ICON_TYPE_OPTIONS.find((item) => item.key === type)
  if (!rule) {
    return true
  }
  const lower = iconName.toLowerCase()
  return rule.keywords.some((keyword) => lower.includes(keyword))
}

async function fetchCollectionIcons(prefix: string): Promise<string[]> {
  const response = await fetch(`https://api.iconify.design/collection?prefix=${encodeURIComponent(prefix)}`)
  if (!response.ok) {
    throw new Error(`Failed to load icon collection (${response.status})`)
  }
  const payload = await response.json()
  return parseCollectionIconNames(payload)
}

async function fetchSearchIcons(prefix: string, query: string, limit = 120): Promise<string[]> {
  const response = await fetch(
    `https://api.iconify.design/search?query=${encodeURIComponent(query)}&prefix=${encodeURIComponent(prefix)}&limit=${limit}`,
  )
  if (!response.ok) {
    throw new Error(`Search failed (${response.status})`)
  }
  const payload = await response.json()
  return parseSearchIconNames(payload)
}

export function IconPickerDialog({
  open,
  workMode = false,
  library,
  iconifyPrefix,
  selectedIcon,
  color,
  onClose,
  onSelect,
  onIconifyPrefixChange,
}: IconPickerDialogProps) {
  const [search, setSearch] = useState('')
  const [iconType, setIconType] = useState<IconTypeKey>('all')
  const [icons, setIcons] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(120)

  const activePrefix = resolveIconPrefix(library, iconifyPrefix)

  const selectedResolvedId = useMemo(
    () => resolveIconId(selectedIcon, library, iconifyPrefix),
    [selectedIcon, library, iconifyPrefix],
  )

  useEffect(() => {
    if (!open) {
      return
    }

    let cancelled = false

    const load = async () => {
      setLoading(true)
      setError(null)
      setVisibleCount(120)

      const trimmedSearch = search.trim()
      try {
        let loaded: string[] = []
        if (trimmedSearch) {
          loaded = await fetchSearchIcons(activePrefix, trimmedSearch, 180)
        } else if (iconType !== 'all') {
          const rule = ICON_TYPE_OPTIONS.find((item) => item.key === iconType)
          const keywords = rule?.keywords.slice(0, 4) ?? []
          const chunks = await Promise.all(keywords.map((keyword) => fetchSearchIcons(activePrefix, keyword, 80)))
          loaded = dedupe(chunks.flat())
          if (!loaded.length) {
            loaded = await fetchCollectionIcons(activePrefix)
          }
        } else {
          loaded = await fetchCollectionIcons(activePrefix)
        }

        if (iconType !== 'all') {
          loaded = loaded.filter((name) => matchesIconType(name, iconType))
        }

        if (trimmedSearch) {
          const queryLower = trimmedSearch.toLowerCase()
          loaded = loaded.filter((name) => name.toLowerCase().includes(queryLower))
        }

        const selectedWithoutPrefix = selectedResolvedId.split(':').slice(1).join(':')
        if (selectedWithoutPrefix && !loaded.includes(selectedWithoutPrefix)) {
          loaded.unshift(selectedWithoutPrefix)
        }

        if (!cancelled) {
          setIcons(dedupe(loaded).slice(0, 1200))
        }
      } catch (loadError) {
        if (!cancelled) {
          setIcons([])
          setError(loadError instanceof Error ? loadError.message : 'Failed to load icons')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [open, activePrefix, iconType, search, selectedResolvedId])

  const visibleIcons = useMemo(() => icons.slice(0, visibleCount), [icons, visibleCount])

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="lg"
      {...(workMode ? WORK_MODE_DIALOG_PROPS : {})}
      sx={workMode ? workModeDialogSx('min(920px, 96vw)') : normalModeDialogSx('min(920px, 96vw)')}
    >
      <DialogTitle>Icon Browser</DialogTitle>
      <DialogContent>
        <Box display="grid" gap={1.5} pt={0.5}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
            <TextField
              label="Search icons"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              size="small"
              placeholder="e.g. marker, school, hospital, bus"
              fullWidth
            />
            <TextField
              label="Library prefix"
              value={activePrefix}
              onChange={(event) => onIconifyPrefixChange(event.target.value)}
              size="small"
              disabled={library !== 'iconify'}
              sx={{ minWidth: 230 }}
            />
          </Stack>

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {ICON_TYPE_OPTIONS.map((option) => (
              <Chip
                key={option.key}
                label={option.label}
                color={iconType === option.key ? 'primary' : 'default'}
                onClick={() => setIconType(option.key)}
                variant={iconType === option.key ? 'filled' : 'outlined'}
              />
            ))}
          </Stack>

          <Typography variant="caption" color="text.secondary">
            Prefix <strong>{activePrefix}</strong> · showing {Math.min(visibleCount, icons.length)} of {icons.length} icons
          </Typography>

          {error && <Alert severity="error">{error}</Alert>}

          {loading ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <CircularProgress size={18} />
              <Typography variant="body2">Loading icons...</Typography>
            </Stack>
          ) : (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(94px, 1fr))',
                gap: 1,
                maxHeight: 420,
                overflow: 'auto',
                p: 0.5,
                borderRadius: 1,
                border: '1px solid',
                borderColor: 'divider',
              }}
            >
              {visibleIcons.map((iconName) => {
                const resolvedId = resolveIconId(iconName, library, iconifyPrefix)
                const selected = resolvedId === selectedResolvedId
                return (
                  <Button
                    key={resolvedId}
                    variant={selected ? 'contained' : 'outlined'}
                    color={selected ? 'primary' : 'inherit'}
                    onClick={() => onSelect(iconName)}
                    sx={{
                      display: 'grid',
                      gap: 0.4,
                      py: 1,
                      px: 0.75,
                      textTransform: 'none',
                      minHeight: 86,
                    }}
                  >
                    <Box
                      component="img"
                      src={iconifySvgUrl(resolvedId, color)}
                      alt={resolvedId}
                      sx={{ width: 24, height: 24, mx: 'auto' }}
                    />
                    <Typography variant="caption" sx={{ lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {iconName}
                    </Typography>
                  </Button>
                )
              })}
              {!visibleIcons.length && (
                <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
                  No icons found for this search/type.
                </Typography>
              )}
            </Box>
          )}

          {!loading && visibleCount < icons.length && (
            <Button variant="outlined" onClick={() => setVisibleCount((count) => count + 120)}>
              Load More
            </Button>
          )}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  )
}
