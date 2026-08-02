import { useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField } from '@mui/material'

interface NewMapDialogProps {
  open: boolean
  submitting: boolean
  error: string | null
  onClose: () => void
  onSubmit: (payload: { name: string; description?: string; basemap?: Record<string, unknown> }) => void
}

const BASEMAPS: Record<string, Record<string, unknown>> = {
  osm: { id: 'osm', title: 'OpenStreetMap' },
  light: { id: 'light', title: 'Light Canvas' },
  satellite: { id: 'satellite', title: 'Satellite' },
}

export function NewMapDialog({ open, submitting, error, onClose, onSubmit }: NewMapDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [basemap, setBasemap] = useState('osm')

  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>New Map</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField autoFocus size="small" label="Map title" value={name} onChange={(event) => setName(event.target.value)} />
          <TextField size="small" label="Description" multiline minRows={2} value={description} onChange={(event) => setDescription(event.target.value)} />
          <TextField select size="small" label="Basemap" value={basemap} onChange={(event) => setBasemap(event.target.value)}>
            <MenuItem value="osm">OpenStreetMap</MenuItem>
            <MenuItem value="light">Light Canvas</MenuItem>
            <MenuItem value="satellite">Satellite</MenuItem>
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button variant="contained" disabled={!name.trim() || submitting} onClick={() => onSubmit({ name: name.trim(), description: description.trim() || undefined, basemap: BASEMAPS[basemap] })}>Create map</Button>
      </DialogActions>
    </Dialog>
  )
}
