import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material'
import { WORK_MODE_DIALOG_PROPS, normalModeDialogSx, workModeDialogSx } from './workModeDialog'

interface UploadLayerDialogProps {
  open: boolean
  layerName: string | null
  file: File | null
  submitting: boolean
  error: string | null
  workMode?: boolean
  onFileChange: (file: File | null) => void
  onClose: () => void
  onSubmit: (file: File, options: { sourceCrs?: string; sourceLayer?: string }) => void
}

export function UploadLayerDialog({
  open,
  layerName,
  file,
  submitting,
  error,
  workMode = false,
  onFileChange,
  onClose,
  onSubmit,
}: UploadLayerDialogProps) {
  const [sourceCrs, setSourceCrs] = useState('')
  const [sourceLayer, setSourceLayer] = useState('')

  const handleClose = () => {
    if (submitting) {
      return
    }

    onFileChange(null)
    setSourceCrs('')
    setSourceLayer('')
    onClose()
  }

  const handleSubmit = () => {
    if (!file) {
      return
    }

    onSubmit(file, { sourceCrs, sourceLayer })
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      fullWidth
      maxWidth="sm"
      {...(workMode ? WORK_MODE_DIALOG_PROPS : {})}
      sx={workMode ? workModeDialogSx('min(520px, 96vw)') : normalModeDialogSx('min(520px, 96vw)')}
    >
      <DialogTitle>Import Spatial Data</DialogTitle>
      <DialogContent>
        <Box display="grid" gap={1.5} pt={0.5}>
          {layerName && (
            <Typography variant="body2" color="text.secondary">
              Target layer: <strong>{layerName}</strong>
            </Typography>
          )}

          {error && <Alert severity="error">{error}</Alert>}

          <Alert severity="info">
            Supported: GeoJSON, KML, KMZ, zipped Shapefile, CSV, GeoPackage, GML, GPX,
            FlatGeobuf, DXF, SpatiaLite, and zipped OGR datasets. Geometry is normalized to EPSG:4326.
          </Alert>

          <Button variant="outlined" component="label" disabled={submitting}>
            Select spatial file
            <input
              hidden
              type="file"
              accept=".geojson,.json,.kml,.kmz,.zip,.csv,.gpkg,.gml,.gpx,.fgb,.dxf,.tab,.mif,.sqlite,application/geo+json,application/json,text/csv"
              onChange={(event) => {
                const selected = event.target.files?.[0] ?? null
                onFileChange(selected)
              }}
            />
          </Button>

          <Typography variant="body2" color={file ? 'success.main' : 'text.secondary'}>
            {file ? `Selected: ${file.name}` : 'No file selected'}
          </Typography>

          <TextField
            label="Source coordinate system override"
            value={sourceCrs}
            onChange={(event) => setSourceCrs(event.target.value)}
            size="small"
            placeholder="e.g. EPSG:32632, EPSG:26332, or a WKT definition"
            helperText="Leave blank to read CRS metadata. Required for projected CSV coordinates or files with missing/incorrect CRS metadata."
            fullWidth
          />

          <TextField
            label="Source sublayer (optional)"
            value={sourceLayer}
            onChange={(event) => setSourceLayer(event.target.value)}
            size="small"
            helperText="For multi-layer GeoPackage, KML, or archive datasets. Blank imports the first spatial layer."
            fullWidth
          />

          <Typography variant="caption" color="text.secondary">
            CSV geometry columns may be named longitude/latitude, lon/lat, lng/lat, x/y,
            easting/northing, or contain WKT in a wkt/geometry/geom column.
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
