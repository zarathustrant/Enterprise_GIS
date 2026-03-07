import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Switch,
  TextField,
  MenuItem,
} from '@mui/material'
import type { CreateLayerPayload } from '../api/services'

interface CreateLayerDialogProps {
  open: boolean
  submitting: boolean
  error: string | null
  onClose: () => void
  onSubmit: (payload: CreateLayerPayload) => void
}

const geometryTypes = ['', 'Point', 'LineString', 'Polygon', 'MultiPolygon']

export function CreateLayerDialog({
  open,
  submitting,
  error,
  onClose,
  onSubmit,
}: CreateLayerDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [geometryType, setGeometryType] = useState('')
  const [isPublic, setIsPublic] = useState(false)

  const reset = () => {
    setName('')
    setDescription('')
    setGeometryType('')
    setIsPublic(false)
  }

  const handleClose = () => {
    if (submitting) {
      return
    }

    reset()
    onClose()
  }

  const handleSubmit = () => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      return
    }

    onSubmit({
      name: trimmedName,
      description: description.trim() || undefined,
      geometry_type: geometryType || undefined,
      is_public: isPublic,
    })
  }

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>Create Layer</DialogTitle>
      <DialogContent>
        <Box display="grid" gap={2} pt={0.5}>
          {error && <Alert severity="error">{error}</Alert>}

          <TextField
            label="Layer name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            size="small"
            required
            fullWidth
          />

          <TextField
            label="Description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            size="small"
            fullWidth
          />

          <TextField
            label="Geometry type"
            value={geometryType}
            onChange={(event) => setGeometryType(event.target.value)}
            select
            size="small"
            fullWidth
          >
            {geometryTypes.map((type) => (
              <MenuItem key={type || 'any'} value={type}>
                {type || 'Any'}
              </MenuItem>
            ))}
          </TextField>

          <FormControlLabel
            control={<Switch checked={isPublic} onChange={(_, checked) => setIsPublic(checked)} />}
            label="Public layer"
          />
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} disabled={submitting} color="inherit">
          Cancel
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={submitting || !name.trim()}>
          Create
        </Button>
      </DialogActions>
    </Dialog>
  )
}
