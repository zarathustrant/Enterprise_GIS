import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import type { AsyncJob } from '../types/gis'
import { WORK_MODE_DIALOG_PROPS, normalModeDialogSx, workModeDialogSx } from './workModeDialog'

interface JobsDialogProps {
  open: boolean
  jobs: AsyncJob[]
  loading: boolean
  error: string | null
  workMode?: boolean
  onClose: () => void
  onRefresh: () => void
}

function statusColor(status: AsyncJob['status']): 'default' | 'warning' | 'info' | 'success' | 'error' {
  if (status === 'queued') {
    return 'warning'
  }
  if (status === 'running') {
    return 'info'
  }
  if (status === 'success') {
    return 'success'
  }
  return 'error'
}

export function JobsDialog({ open, jobs, loading, error, workMode = false, onClose, onRefresh }: JobsDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="lg"
      {...(workMode ? WORK_MODE_DIALOG_PROPS : {})}
      sx={workMode ? workModeDialogSx('min(920px, 96vw)') : normalModeDialogSx('min(920px, 96vw)')}
    >
      <DialogTitle>Async Jobs</DialogTitle>
      <DialogContent>
        <Box display="grid" gap={2} pt={0.5}>
          {error && <Alert severity="error">{error}</Alert>}

          <Stack direction="row" spacing={1}>
            <Button variant="outlined" onClick={onRefresh} disabled={loading}>
              Refresh
            </Button>
            <Typography variant="body2" color="text.secondary" sx={{ alignSelf: 'center' }}>
              {loading ? 'Refreshing…' : `${jobs.length} job(s)`}
            </Typography>
          </Stack>

          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Progress</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Created</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Result/Error</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {jobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell>{job.job_type}</TableCell>
                  <TableCell>
                    <Chip label={job.status} size="small" color={statusColor(job.status)} variant="outlined" />
                  </TableCell>
                  <TableCell>{job.progress}%</TableCell>
                  <TableCell>{job.created_at ? new Date(job.created_at).toLocaleString() : 'n/a'}</TableCell>
                  <TableCell sx={{ maxWidth: 360 }}>
                    {job.error ? (
                      <Typography variant="body2" color="error.main" sx={{ whiteSpace: 'pre-wrap' }}>
                        {job.error}
                      </Typography>
                    ) : job.result ? (
                      <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>
                        {JSON.stringify(job.result)}
                      </Typography>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        —
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!jobs.length && !loading && (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Typography variant="body2" color="text.secondary">
                      No async jobs yet.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
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
