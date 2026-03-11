import { useMemo, useState } from 'react'
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import type { PolygonPatternLibrary } from '../types/gis'
import { WORK_MODE_DIALOG_PROPS, normalModeDialogSx, workModeDialogSx } from './workModeDialog'
import {
  listPatternOptions,
  polygonPatternCss,
  polygonPatternLabel,
  POLYGON_PATTERN_LIBRARY_OPTIONS,
  resolvePolygonPatternName,
} from '../utils/polygonPatterns'

interface PatternPickerDialogProps {
  open: boolean
  workMode?: boolean
  library: PolygonPatternLibrary
  selectedPattern: string
  color: string
  opacity: number
  onClose: () => void
  onSelect: (library: PolygonPatternLibrary, patternName: string) => void
}

export function PatternPickerDialog({
  open,
  workMode = false,
  library,
  selectedPattern,
  color,
  opacity,
  onClose,
  onSelect,
}: PatternPickerDialogProps) {
  const [activeLibrary, setActiveLibrary] = useState<PolygonPatternLibrary>(library)
  const [search, setSearch] = useState('')
  const [visibleCount, setVisibleCount] = useState(120)

  const patternOptions = useMemo(
    () => listPatternOptions(activeLibrary, search),
    [activeLibrary, search],
  )

  const visibleOptions = useMemo(() => patternOptions.slice(0, visibleCount), [patternOptions, visibleCount])
  const selectedResolved = resolvePolygonPatternName(activeLibrary, selectedPattern)

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="lg"
      {...(workMode ? WORK_MODE_DIALOG_PROPS : {})}
      sx={workMode ? workModeDialogSx('min(920px, 96vw)') : normalModeDialogSx('min(920px, 96vw)')}
    >
      <DialogTitle>Pattern Browser</DialogTitle>
      <DialogContent>
        <Box display="grid" gap={1.5} pt={0.5}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
            <TextField
              label="Pattern Library"
              value={activeLibrary}
              onChange={(event) => {
                setActiveLibrary(event.target.value as PolygonPatternLibrary)
                setVisibleCount(120)
              }}
              size="small"
              select
              sx={{ minWidth: 240 }}
            >
              {POLYGON_PATTERN_LIBRARY_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Search patterns"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setVisibleCount(120)
              }}
              size="small"
              fullWidth
              placeholder="e.g. dots, grid, circles, waves"
            />
          </Stack>

          <Typography variant="caption" color="text.secondary">
            {patternOptions.length} pattern(s) available
          </Typography>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(138px, 1fr))',
              gap: 1,
              maxHeight: 430,
              overflow: 'auto',
              p: 0.75,
              borderRadius: 1,
              border: '1px solid',
              borderColor: 'divider',
            }}
          >
            {visibleOptions.map((option) => {
              const selected = option.name === selectedResolved
              const preview = polygonPatternCss(activeLibrary, option.name, color, opacity)

              return (
                <Button
                  key={`${activeLibrary}-${option.name}`}
                  variant={selected ? 'contained' : 'outlined'}
                  color={selected ? 'primary' : 'inherit'}
                  onClick={() => onSelect(activeLibrary, option.name)}
                  sx={{
                    display: 'grid',
                    gap: 0.75,
                    p: 0.9,
                    textTransform: 'none',
                    minHeight: 98,
                    alignContent: 'start',
                  }}
                >
                  <Box
                    sx={{
                      width: '100%',
                      height: 48,
                      borderRadius: 1,
                      border: '1px solid rgba(15,23,42,0.26)',
                      bgcolor: '#ffffff',
                      backgroundImage: preview.backgroundImage,
                      backgroundSize: preview.backgroundSize,
                    }}
                  />
                  <Typography
                    variant="caption"
                    sx={{ lineHeight: 1.25, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis' }}
                  >
                    {polygonPatternLabel(activeLibrary, option.name)}
                  </Typography>
                </Button>
              )
            })}

            {!visibleOptions.length && (
              <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
                No patterns found for this search.
              </Typography>
            )}
          </Box>

          {!search && visibleCount < patternOptions.length && (
            <Stack direction="row">
              <Chip
                label={`Showing ${visibleOptions.length} of ${patternOptions.length}`}
                size="small"
                variant="outlined"
              />
              <Box flexGrow={1} />
              <Button variant="outlined" onClick={() => setVisibleCount((count) => count + 120)}>
                Load More
              </Button>
            </Stack>
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
