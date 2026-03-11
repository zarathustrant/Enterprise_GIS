import { useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import type { MapView } from '../types/gis'
import type { MapViewportState } from './MapCanvas'
import { WORK_MODE_DIALOG_PROPS, normalModeDialogSx, workModeDialogSx } from './workModeDialog'

interface MapViewsDialogProps {
  open: boolean
  views: MapView[]
  currentView: MapViewportState | null
  loading: boolean
  saving: boolean
  error: string | null
  workMode?: boolean
  onClose: () => void
  onCreateView: (name: string, view: MapViewportState) => void
  onDeleteView: (viewId: string) => void
  onGoToView: (view: MapView) => void
}

function summarizeView(view: MapView): string {
  return `${view.center.lng.toFixed(5)}, ${view.center.lat.toFixed(5)} · z${view.zoom.toFixed(1)}`
}

export function MapViewsDialog({
  open,
  views,
  currentView,
  loading,
  saving,
  error,
  workMode = false,
  onClose,
  onCreateView,
  onDeleteView,
  onGoToView,
}: MapViewsDialogProps) {
  const [name, setName] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const hasCurrentView = useMemo(() => Boolean(currentView), [currentView])

  const handleSave = () => {
    if (!currentView) {
      setLocalError('Current map view is not available yet')
      return
    }
    if (!name.trim()) {
      setLocalError('Name is required')
      return
    }
    setLocalError(null)
    onCreateView(name.trim(), currentView)
    setName('')
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      {...(workMode ? WORK_MODE_DIALOG_PROPS : {})}
      sx={workMode ? workModeDialogSx('min(720px, 96vw)') : normalModeDialogSx('min(720px, 96vw)')}
    >
      <DialogTitle>Map Bookmarks</DialogTitle>
      <DialogContent>
        <Box display="grid" gap={2} pt={0.5}>
          {(error || localError) && <Alert severity="error">{error ?? localError}</Alert>}

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
            <TextField
              label="Bookmark name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              size="small"
              fullWidth
            />
            <Button variant="outlined" onClick={handleSave} disabled={!hasCurrentView || saving}>
              Save Current View
            </Button>
          </Stack>

          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>View</TableCell>
                <TableCell sx={{ fontWeight: 700, width: 160 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {views.map((view) => (
                <TableRow key={view.id}>
                  <TableCell>{view.name}</TableCell>
                  <TableCell>{summarizeView(view)}</TableCell>
                  <TableCell>
                    <Button size="small" onClick={() => onGoToView(view)}>
                      Go To
                    </Button>
                    <IconButton size="small" color="error" onClick={() => onDeleteView(view.id)}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}

              {!views.length && !loading && (
                <TableRow>
                  <TableCell colSpan={3}>
                    <Typography variant="body2" color="text.secondary">
                      No bookmarks saved yet.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit" disabled={saving}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  )
}
