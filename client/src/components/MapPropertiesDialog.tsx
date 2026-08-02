import { useState } from 'react'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import type { CatalogMap } from '../types/gis'

interface MapPropertiesDialogProps {
  open: boolean
  map: CatalogMap | null
  submitting: boolean
  deleting: boolean
  error: string | null
  onClose: () => void
  onSave: (payload: { name: string; description: string; basemap: Record<string, unknown>; is_public: boolean }) => void
  onDelete: () => void
}

const BASEMAP_TITLES: Record<string, string> = {
  osm: 'OpenStreetMap',
  light: 'Light Canvas',
  satellite: 'Satellite',
}

export function MapPropertiesDialog({
  open,
  map,
  submitting,
  deleting,
  error,
  onClose,
  onSave,
  onDelete,
}: MapPropertiesDialogProps) {
  const [name, setName] = useState(map?.name ?? '')
  const [description, setDescription] = useState(map?.description ?? '')
  const [basemapId, setBasemapId] = useState(typeof map?.basemap.id === 'string' ? map.basemap.id : 'light')
  const [isPublic, setIsPublic] = useState(map?.is_public ?? false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <Dialog open={open} onClose={submitting || deleting ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Map Properties</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField autoFocus size="small" label="Map title" value={name} onChange={(event) => setName(event.target.value)} />
          <TextField size="small" multiline minRows={2} label="Description" value={description} onChange={(event) => setDescription(event.target.value)} />
          <TextField select size="small" label="Basemap" value={basemapId} onChange={(event) => setBasemapId(event.target.value)}>
            {Object.entries(BASEMAP_TITLES).map(([id, title]) => <MenuItem key={id} value={id}>{title}</MenuItem>)}
          </TextField>
          <FormControlLabel
            control={<Switch checked={isPublic} onChange={(_, checked) => setIsPublic(checked)} />}
            label="Allow signed-in users to open this map"
          />
          {!map?.is_default && (
            <Stack spacing={1} sx={{ borderTop: 1, borderColor: 'divider', pt: 2 }}>
              <Typography variant="subtitle2" color="error">Danger zone</Typography>
              {!confirmDelete ? (
                <Button color="error" variant="outlined" onClick={() => setConfirmDelete(true)}>Delete map</Button>
              ) : (
                <Alert
                  severity="warning"
                  action={<Button color="error" size="small" disabled={deleting} onClick={onDelete}>Delete permanently</Button>}
                >
                  Source layers and features are preserved. Only this map document is deleted.
                </Alert>
              )}
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" disabled={submitting || deleting} onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!name.trim() || submitting || deleting}
          onClick={() => onSave({
            name: name.trim(),
            description: description.trim(),
            basemap: { id: basemapId, title: BASEMAP_TITLES[basemapId] },
            is_public: isPublic,
          })}
        >
          Save properties
        </Button>
      </DialogActions>
    </Dialog>
  )
}
