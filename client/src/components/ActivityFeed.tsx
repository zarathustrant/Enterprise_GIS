import { memo } from 'react'
import { Alert, Box, Button, Chip, List, ListItem, ListItemText, Stack, Typography } from '@mui/material'

export type ActivityLevel = 'info' | 'success' | 'warning' | 'error'

export interface ActivityEvent {
  id: number
  message: string
  level: ActivityLevel
  timestamp: number
}

interface ActivityFeedProps {
  events: ActivityEvent[]
  onClear: () => void
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp))
}

function ActivityFeedBase({ events, onClear }: ActivityFeedProps) {
  return (
    <Box sx={{ mt: 2, pt: 1.5, borderTop: 1, borderColor: 'divider' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          Activity Feed
        </Typography>
        <Stack direction="row" spacing={0.75} alignItems="center">
          <Chip label={`${events.length}`} size="small" />
          <Button onClick={onClear} size="small" color="inherit" disabled={!events.length}>
            Clear
          </Button>
        </Stack>
      </Stack>

      {!events.length && (
        <Alert severity="info" sx={{ py: 0.5 }}>
          Actions and system events will appear here.
        </Alert>
      )}

      {!!events.length && (
        <List dense disablePadding sx={{ maxHeight: 210, overflowY: 'auto' }}>
          {events.map((event) => (
            <ListItem key={event.id} disableGutters sx={{ py: 0.35 }}>
              <ListItemText
                primary={event.message}
                secondary={formatTime(event.timestamp)}
                primaryTypographyProps={{
                  variant: 'body2',
                  color: event.level === 'error' ? 'error.main' : 'text.primary',
                }}
                secondaryTypographyProps={{ variant: 'caption' }}
              />
            </ListItem>
          ))}
        </List>
      )}
    </Box>
  )
}

export const ActivityFeed = memo(ActivityFeedBase)

