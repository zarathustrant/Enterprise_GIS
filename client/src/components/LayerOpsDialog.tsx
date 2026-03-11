import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import { WORK_MODE_DIALOG_PROPS, normalModeDialogSx, workModeDialogSx } from './workModeDialog'
import type {
  CreateEditSessionPayload,
  CreateLayerJoinPayload,
  CreateLayerRelationshipPayload,
  CreateLayerViewPayload,
  CreateShareLinkPayload,
} from '../api/services'
import type {
  EditSession,
  EditSessionChange,
  Layer,
  LayerField,
  LayerJoin,
  LayerRelationship,
  LayerShareLink,
  LayerView,
} from '../types/gis'

interface LayerOpsDialogProps {
  open: boolean
  layer: Layer | null
  layers: Layer[]
  fields: LayerField[]
  joins: LayerJoin[]
  shareLinks: LayerShareLink[]
  layerViews: LayerView[]
  relationships: LayerRelationship[]
  editSessions: EditSession[]
  editSessionChanges: EditSessionChange[]
  activeSessionId: string | null
  loading: boolean
  submitting: boolean
  error: string | null
  workMode?: boolean
  onClose: () => void
  onUpdateOrdering: (payload: { group_name: string; z_index: number }) => void
  onCreateShareLink: (payload: CreateShareLinkPayload) => void
  onDeleteShareLink: (shareId: string) => void
  onCreateJoin: (payload: CreateLayerJoinPayload) => void
  onDeleteJoin: (joinId: string) => void
  onCreateLayerView: (payload: CreateLayerViewPayload) => void
  onDeleteLayerView: (viewId: string) => void
  onCreateRelationship: (payload: CreateLayerRelationshipPayload) => void
  onDeleteRelationship: (relationshipId: string) => void
  onCreateEditSession: (payload: CreateEditSessionPayload) => void
  onSubmitEditSession: (sessionId: string) => void
  onPublishEditSession: (sessionId: string) => void
  onAbandonEditSession: (sessionId: string) => void
  onSetActiveSession: (sessionId: string | null) => void
  onLoadSessionChanges: (sessionId: string | null) => void
}

function toDatetimeLocalInput(value: string | null): string {
  if (!value) {
    return ''
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  const offsetMs = date.getTimezoneOffset() * 60_000
  const local = new Date(date.getTime() - offsetMs)
  return local.toISOString().slice(0, 16)
}

function toDisplayDatetime(value: string | null): string {
  if (!value) {
    return 'n/a'
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export function LayerOpsDialog({
  open,
  layer,
  layers,
  fields,
  joins,
  shareLinks,
  layerViews,
  relationships,
  editSessions,
  editSessionChanges,
  activeSessionId,
  loading,
  submitting,
  error,
  workMode = false,
  onClose,
  onUpdateOrdering,
  onCreateShareLink,
  onDeleteShareLink,
  onCreateJoin,
  onDeleteJoin,
  onCreateLayerView,
  onDeleteLayerView,
  onCreateRelationship,
  onDeleteRelationship,
  onCreateEditSession,
  onSubmitEditSession,
  onPublishEditSession,
  onAbandonEditSession,
  onSetActiveSession,
  onLoadSessionChanges,
}: LayerOpsDialogProps) {
  const [groupName, setGroupName] = useState('Default')
  const [zIndex, setZIndex] = useState('0')
  const [canEditShare, setCanEditShare] = useState(false)
  const [expiresAt, setExpiresAt] = useState('')
  const [joinTargetLayerId, setJoinTargetLayerId] = useState('')
  const [joinSourceField, setJoinSourceField] = useState('')
  const [joinTargetField, setJoinTargetField] = useState('')
  const [joinType, setJoinType] = useState<'left' | 'inner'>('left')
  const [joinName, setJoinName] = useState('')

  const [viewName, setViewName] = useState('')
  const [viewDescription, setViewDescription] = useState('')
  const [viewDefinition, setViewDefinition] = useState('{"filters":[],"sort":{"field":"created_at","direction":"desc"}}')
  const [viewFieldWhitelist, setViewFieldWhitelist] = useState('')
  const [viewIsPublic, setViewIsPublic] = useState(false)

  const [relationshipTargetLayerId, setRelationshipTargetLayerId] = useState('')
  const [relationshipOriginField, setRelationshipOriginField] = useState('')
  const [relationshipDestinationField, setRelationshipDestinationField] = useState('')
  const [relationshipCardinality, setRelationshipCardinality] = useState<
    'one_to_one' | 'one_to_many' | 'many_to_one' | 'many_to_many'
  >('one_to_many')
  const [relationshipName, setRelationshipName] = useState('')

  const [sessionName, setSessionName] = useState('')
  const [sessionNotes, setSessionNotes] = useState('')
  const [sessionReviewer, setSessionReviewer] = useState('')

  const [localError, setLocalError] = useState<string | null>(null)

  const candidateLayers = useMemo(() => layers.filter((item) => item.id !== layer?.id), [layers, layer?.id])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLocalError(null)
      setGroupName(layer?.group_name ?? 'Default')
      setZIndex(String(layer?.z_index ?? 0))
      setCanEditShare(false)
      setExpiresAt('')
      setJoinTargetLayerId('')
      setJoinSourceField(fields[0]?.name ?? '')
      setJoinTargetField('')
      setJoinType('left')
      setJoinName('')
      setViewName('')
      setViewDescription('')
      setViewDefinition('{"filters":[],"sort":{"field":"created_at","direction":"desc"}}')
      setViewFieldWhitelist('')
      setViewIsPublic(false)
      setRelationshipTargetLayerId('')
      setRelationshipOriginField(fields[0]?.name ?? '')
      setRelationshipDestinationField('')
      setRelationshipCardinality('one_to_many')
      setRelationshipName('')
      setSessionName('')
      setSessionNotes('')
      setSessionReviewer('')
    }, 0)

    return () => {
      window.clearTimeout(timer)
    }
  }, [layer?.id, layer?.group_name, layer?.z_index, fields])

  const handleUpdateOrdering = () => {
    const parsedZ = Number.parseInt(zIndex, 10)
    if (!Number.isFinite(parsedZ)) {
      setLocalError('z-index must be an integer')
      return
    }
    setLocalError(null)
    onUpdateOrdering({ group_name: groupName.trim() || 'Default', z_index: parsedZ })
  }

  const handleCreateShareLink = () => {
    setLocalError(null)
    const payload: CreateShareLinkPayload = { can_edit: canEditShare }
    if (expiresAt.trim()) {
      const iso = new Date(expiresAt).toISOString()
      if (!iso || iso === 'Invalid Date') {
        setLocalError('Invalid expiration date')
        return
      }
      payload.expires_at = iso
    }
    onCreateShareLink(payload)
  }

  const handleCreateJoin = () => {
    if (!joinTargetLayerId || !joinSourceField.trim() || !joinTargetField.trim()) {
      setLocalError('Target layer, source field and target field are required for joins')
      return
    }
    setLocalError(null)
    onCreateJoin({
      target_layer_id: joinTargetLayerId,
      source_field: joinSourceField.trim(),
      target_field: joinTargetField.trim(),
      join_type: joinType,
      name: joinName.trim() || undefined,
    })
  }

  const handleCreateLayerView = () => {
    if (!viewName.trim()) {
      setLocalError('View name is required')
      return
    }

    let parsedDefinition: Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(viewDefinition)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setLocalError('View definition must be a JSON object')
        return
      }
      parsedDefinition = parsed as Record<string, unknown>
    } catch {
      setLocalError('View definition must be valid JSON')
      return
    }

    const whitelist = viewFieldWhitelist
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)

    setLocalError(null)
    onCreateLayerView({
      name: viewName.trim(),
      description: viewDescription.trim() || undefined,
      definition: parsedDefinition,
      field_whitelist: whitelist.length ? whitelist : null,
      is_public: viewIsPublic,
    })
  }

  const handleCreateRelationship = () => {
    if (!relationshipTargetLayerId || !relationshipOriginField.trim() || !relationshipDestinationField.trim()) {
      setLocalError('Destination layer, origin field and destination field are required')
      return
    }
    setLocalError(null)
    onCreateRelationship({
      destination_layer_id: relationshipTargetLayerId,
      origin_field: relationshipOriginField.trim(),
      destination_field: relationshipDestinationField.trim(),
      cardinality: relationshipCardinality,
      name: relationshipName.trim() || undefined,
    })
  }

  const handleCreateEditSession = () => {
    if (!sessionName.trim()) {
      setLocalError('Session name is required')
      return
    }
    setLocalError(null)
    onCreateEditSession({
      name: sessionName.trim(),
      notes: sessionNotes.trim() || undefined,
      assigned_reviewer: sessionReviewer.trim() || undefined,
    })
  }

  const copyShareUrl = async (url: string) => {
    const absolute = url.startsWith('http') ? url : `${window.location.origin}${url}`
    try {
      await navigator.clipboard.writeText(absolute)
    } catch {
      setLocalError('Failed to copy URL to clipboard')
    }
  }

  const toggleActiveSession = (sessionId: string) => {
    const next = activeSessionId === sessionId ? null : sessionId
    onSetActiveSession(next)
    onLoadSessionChanges(next)
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="lg"
      {...(workMode ? WORK_MODE_DIALOG_PROPS : {})}
      sx={workMode ? workModeDialogSx('min(980px, 98vw)') : normalModeDialogSx('min(980px, 98vw)')}
    >
      <DialogTitle>Advanced Layer Operations</DialogTitle>
      <DialogContent>
        <Box display="grid" gap={2} pt={0.5}>
          {layer && (
            <Typography variant="body2" color="text.secondary">
              Layer: <strong>{layer.name}</strong>
            </Typography>
          )}

          {(error || localError) && <Alert severity="error">{error ?? localError}</Alert>}

          <Box display="grid" gap={1.25}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Group and Draw Order
            </Typography>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
              <TextField
                label="Group"
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                size="small"
                fullWidth
              />
              <TextField
                label="z-index"
                value={zIndex}
                onChange={(event) => setZIndex(event.target.value)}
                size="small"
                type="number"
                sx={{ minWidth: 160 }}
              />
              <Button variant="outlined" onClick={handleUpdateOrdering} disabled={submitting}>
                Save Ordering
              </Button>
            </Stack>
          </Box>

          <Box display="grid" gap={1.25}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Share Links
            </Typography>

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
              <TextField
                label="Edit access"
                value={canEditShare ? 'true' : 'false'}
                onChange={(event) => setCanEditShare(event.target.value === 'true')}
                size="small"
                select
                sx={{ minWidth: 160 }}
              >
                <MenuItem value="false">Read-only</MenuItem>
                <MenuItem value="true">Can edit</MenuItem>
              </TextField>
              <TextField
                label="Expires"
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.target.value)}
                size="small"
                type="datetime-local"
                InputLabelProps={{ shrink: true }}
                sx={{ minWidth: 230 }}
              />
              <Button variant="outlined" onClick={handleCreateShareLink} disabled={submitting}>
                Create Share Link
              </Button>
            </Stack>

            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Token</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Access</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Expires</TableCell>
                  <TableCell sx={{ fontWeight: 700, width: 120 }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {shareLinks.map((share) => (
                  <TableRow key={share.id}>
                    <TableCell sx={{ fontFamily: 'monospace' }}>{share.token}</TableCell>
                    <TableCell>{share.can_edit ? 'Can edit' : 'Read-only'}</TableCell>
                    <TableCell>{toDatetimeLocalInput(share.expires_at) || 'Never'}</TableCell>
                    <TableCell>
                      <Tooltip title="Copy URL">
                        <IconButton size="small" onClick={() => void copyShareUrl(share.url)}>
                          <ContentCopyIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete share link">
                        <IconButton size="small" color="error" onClick={() => onDeleteShareLink(share.id)}>
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
                {!shareLinks.length && !loading && (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <Typography variant="body2" color="text.secondary">
                        No share links yet.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Box>

          <Box display="grid" gap={1.25}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Layer Joins
            </Typography>

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
              <TextField
                label="Target layer"
                value={joinTargetLayerId}
                onChange={(event) => setJoinTargetLayerId(event.target.value)}
                size="small"
                select
                fullWidth
              >
                {candidateLayers.map((target) => (
                  <MenuItem key={target.id} value={target.id}>
                    {target.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Source field"
                value={joinSourceField}
                onChange={(event) => setJoinSourceField(event.target.value)}
                size="small"
                select
                fullWidth
              >
                {fields.map((field) => (
                  <MenuItem key={field.id} value={field.name}>
                    {field.alias || field.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Target field"
                value={joinTargetField}
                onChange={(event) => setJoinTargetField(event.target.value)}
                size="small"
                fullWidth
              />
            </Stack>

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
              <TextField
                label="Join type"
                value={joinType}
                onChange={(event) => setJoinType(event.target.value as 'left' | 'inner')}
                size="small"
                select
                sx={{ minWidth: 160 }}
              >
                <MenuItem value="left">left</MenuItem>
                <MenuItem value="inner">inner</MenuItem>
              </TextField>
              <TextField
                label="Join name"
                value={joinName}
                onChange={(event) => setJoinName(event.target.value)}
                size="small"
                fullWidth
              />
              <Button variant="outlined" onClick={handleCreateJoin} disabled={submitting}>
                Create Join
              </Button>
            </Stack>

            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Source</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Target</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
                  <TableCell sx={{ fontWeight: 700, width: 80 }}>Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {joins.map((join) => (
                  <TableRow key={join.id}>
                    <TableCell>{join.name ?? 'join'}</TableCell>
                    <TableCell>{join.source_field}</TableCell>
                    <TableCell>{join.target_field}</TableCell>
                    <TableCell>{join.join_type}</TableCell>
                    <TableCell>
                      <Tooltip title="Delete join">
                        <IconButton size="small" color="error" onClick={() => onDeleteJoin(join.id)}>
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
                {!joins.length && !loading && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Typography variant="body2" color="text.secondary">
                        No joins yet.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Box>

          <Box display="grid" gap={1.25}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Layer Views
            </Typography>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
              <TextField
                label="View name"
                value={viewName}
                onChange={(event) => setViewName(event.target.value)}
                size="small"
                fullWidth
              />
              <TextField
                label="Description"
                value={viewDescription}
                onChange={(event) => setViewDescription(event.target.value)}
                size="small"
                fullWidth
              />
              <TextField
                label="Visibility"
                value={viewIsPublic ? 'public' : 'private'}
                onChange={(event) => setViewIsPublic(event.target.value === 'public')}
                size="small"
                select
                sx={{ minWidth: 150 }}
              >
                <MenuItem value="private">Private</MenuItem>
                <MenuItem value="public">Public</MenuItem>
              </TextField>
            </Stack>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'stretch' }}>
              <TextField
                label="Definition JSON"
                value={viewDefinition}
                onChange={(event) => setViewDefinition(event.target.value)}
                size="small"
                fullWidth
                multiline
                minRows={3}
              />
              <TextField
                label="Field whitelist (comma separated)"
                value={viewFieldWhitelist}
                onChange={(event) => setViewFieldWhitelist(event.target.value)}
                size="small"
                fullWidth
                multiline
                minRows={3}
              />
              <Button variant="outlined" onClick={handleCreateLayerView} disabled={submitting}>
                Create View
              </Button>
            </Stack>

            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Visibility</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Updated</TableCell>
                  <TableCell sx={{ fontWeight: 700, width: 80 }}>Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {layerViews.map((view) => (
                  <TableRow key={view.id}>
                    <TableCell>{view.name}</TableCell>
                    <TableCell>{view.is_public ? 'Public' : 'Private'}</TableCell>
                    <TableCell>{toDisplayDatetime(view.updated_at)}</TableCell>
                    <TableCell>
                      <Tooltip title="Delete view">
                        <IconButton size="small" color="error" onClick={() => onDeleteLayerView(view.id)}>
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
                {!layerViews.length && !loading && (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <Typography variant="body2" color="text.secondary">
                        No layer views yet.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Box>

          <Box display="grid" gap={1.25}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Layer Relationships
            </Typography>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
              <TextField
                label="Destination layer"
                value={relationshipTargetLayerId}
                onChange={(event) => setRelationshipTargetLayerId(event.target.value)}
                size="small"
                select
                fullWidth
              >
                {candidateLayers.map((target) => (
                  <MenuItem key={target.id} value={target.id}>
                    {target.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Origin field"
                value={relationshipOriginField}
                onChange={(event) => setRelationshipOriginField(event.target.value)}
                size="small"
                select
                fullWidth
              >
                {fields.map((field) => (
                  <MenuItem key={field.id} value={field.name}>
                    {field.alias || field.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Destination field"
                value={relationshipDestinationField}
                onChange={(event) => setRelationshipDestinationField(event.target.value)}
                size="small"
                fullWidth
              />
            </Stack>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
              <TextField
                label="Cardinality"
                value={relationshipCardinality}
                onChange={(event) =>
                  setRelationshipCardinality(
                    event.target.value as 'one_to_one' | 'one_to_many' | 'many_to_one' | 'many_to_many',
                  )
                }
                size="small"
                select
                sx={{ minWidth: 180 }}
              >
                <MenuItem value="one_to_one">one_to_one</MenuItem>
                <MenuItem value="one_to_many">one_to_many</MenuItem>
                <MenuItem value="many_to_one">many_to_one</MenuItem>
                <MenuItem value="many_to_many">many_to_many</MenuItem>
              </TextField>
              <TextField
                label="Relationship name"
                value={relationshipName}
                onChange={(event) => setRelationshipName(event.target.value)}
                size="small"
                fullWidth
              />
              <Button variant="outlined" onClick={handleCreateRelationship} disabled={submitting}>
                Create Relationship
              </Button>
            </Stack>

            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Origin field</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Destination field</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Cardinality</TableCell>
                  <TableCell sx={{ fontWeight: 700, width: 80 }}>Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {relationships.map((relationship) => (
                  <TableRow key={relationship.id}>
                    <TableCell>{relationship.name ?? 'relationship'}</TableCell>
                    <TableCell>{relationship.origin_field}</TableCell>
                    <TableCell>{relationship.destination_field}</TableCell>
                    <TableCell>{relationship.cardinality}</TableCell>
                    <TableCell>
                      <Tooltip title="Delete relationship">
                        <IconButton size="small" color="error" onClick={() => onDeleteRelationship(relationship.id)}>
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
                {!relationships.length && !loading && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Typography variant="body2" color="text.secondary">
                        No relationships yet.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Box>

          <Box display="grid" gap={1.25}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Edit Sessions
            </Typography>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
              <TextField
                label="Session name"
                value={sessionName}
                onChange={(event) => setSessionName(event.target.value)}
                size="small"
                fullWidth
              />
              <TextField
                label="Assigned reviewer (UUID)"
                value={sessionReviewer}
                onChange={(event) => setSessionReviewer(event.target.value)}
                size="small"
                fullWidth
              />
              <Button variant="outlined" onClick={handleCreateEditSession} disabled={submitting}>
                Create Session
              </Button>
            </Stack>
            <TextField
              label="Session notes"
              value={sessionNotes}
              onChange={(event) => setSessionNotes(event.target.value)}
              size="small"
              fullWidth
              multiline
              minRows={2}
            />

            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Changes</TableCell>
                  <TableCell sx={{ fontWeight: 700, width: 360 }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {editSessions.map((session) => {
                  const isActive = activeSessionId === session.id
                  return (
                    <TableRow key={session.id}>
                      <TableCell>{session.name}</TableCell>
                      <TableCell>
                        <Chip size="small" label={session.status} />
                      </TableCell>
                      <TableCell>{session.change_count}</TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                          <Button
                            size="small"
                            variant={isActive ? 'contained' : 'outlined'}
                            onClick={() => toggleActiveSession(session.id)}
                            disabled={submitting || session.status === 'published' || session.status === 'abandoned'}
                          >
                            {isActive ? 'Active for edits' : 'Use for edits'}
                          </Button>
                          <Button size="small" variant="outlined" onClick={() => onLoadSessionChanges(session.id)} disabled={submitting}>
                            Changes
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => onSubmitEditSession(session.id)}
                            disabled={submitting || session.status !== 'draft'}
                          >
                            Submit
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => onPublishEditSession(session.id)}
                            disabled={submitting || (session.status !== 'draft' && session.status !== 'in_review')}
                          >
                            Publish
                          </Button>
                          <Button
                            size="small"
                            color="warning"
                            variant="outlined"
                            onClick={() => onAbandonEditSession(session.id)}
                            disabled={submitting || session.status === 'published' || session.status === 'abandoned'}
                          >
                            Abandon
                          </Button>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  )
                })}
                {!editSessions.length && !loading && (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <Typography variant="body2" color="text.secondary">
                        No edit sessions yet.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>

            {activeSessionId && (
              <Box display="grid" gap={1}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  Session Change Log
                </Typography>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Feature</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Version</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Created</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {editSessionChanges.map((change) => (
                      <TableRow key={change.id}>
                        <TableCell>{change.change_type}</TableCell>
                        <TableCell sx={{ fontFamily: 'monospace' }}>{change.feature_id ?? 'n/a'}</TableCell>
                        <TableCell>{change.version ?? 'n/a'}</TableCell>
                        <TableCell>{toDisplayDatetime(change.created_at)}</TableCell>
                      </TableRow>
                    ))}
                    {!editSessionChanges.length && !loading && (
                      <TableRow>
                        <TableCell colSpan={4}>
                          <Typography variant="body2" color="text.secondary">
                            No tracked changes for this session yet.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </Box>
            )}
          </Box>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button
          onClick={() => {
            onSetActiveSession(null)
            onLoadSessionChanges(null)
          }}
          color="inherit"
          disabled={submitting}
        >
          Clear Active Session
        </Button>
        <Button onClick={onClose} color="inherit" disabled={submitting}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  )
}
