import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material'

interface UploadLayerDialogProps {
  open: boolean
  layerName: string | null
  file: File | null
  submitting: boolean
  error: string | null
  onFileChange: (file: File | null) => void
  onClose: () => void
  onSubmit: (file: File) => void
}

export function UploadLayerDialog({
  open,
  layerName,
  file,
  submitting,
  error,
  onFileChange,
  onClose,
  onSubmit,
}: UploadLayerDialogProps) {
  const handleClose = () => {
    if (submitting) {
      return
    }

    onFileChange(null)
    onClose()
  }

  const handleSubmit = () => {
    if (!file) {
      return
    }

    onSubmit(file)
  }

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>Upload GeoJSON</DialogTitle>
      <DialogContent>
        <Box display="grid" gap={1.5} pt={0.5}>
          {layerName && (
            <Typography variant="body2" color="text.secondary">
              Target layer: <strong>{layerName}</strong>
            </Typography>
          )}

          {error && <Alert severity="error">{error}</Alert>}

          <Button variant="outlined" component="label" disabled={submitting}>
            Select `.geojson` file
            <input
              hidden
              type="file"
              accept=".geojson,application/geo+json,application/json"
              onChange={(event) => {
                const selected = event.target.files?.[0] ?? null
                onFileChange(selected)
              }}
            />
          </Button>

          <Typography variant="body2" color={file ? 'success.main' : 'text.secondary'}>
            {file ? `Selected: ${file.name}` : 'No file selected'}
          </Typography>
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} disabled={submitting} color="inherit">
          Cancel
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={!file || submitting}>
          Upload
        </Button>
      </DialogActions>
    </Dialog>
  )
}
