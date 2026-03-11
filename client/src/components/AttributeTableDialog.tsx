import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BulkUpdatePayload, FeaturesQueryPayload, FeaturesQueryResponse } from '../api/services'
import type { FeatureCollection, FeatureHistoryEntry, LayerField, LayerJoin } from '../types/gis'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { WORK_MODE_DIALOG_PROPS, normalModeDialogSx, workModeDialogSx } from './workModeDialog'

interface AttributeTableDialogProps {
  open: boolean
  layerName: string | null
  featureCollection: FeatureCollection | null
  fields: LayerField[]
  saving: boolean
  error: string | null
  workMode?: boolean
  onClose: () => void
  onSaveProperties: (featureId: string, properties: Record<string, unknown>, version?: number) => void
  joins?: LayerJoin[]
  onQueryRows?: (payload: FeaturesQueryPayload) => Promise<FeaturesQueryResponse>
  onBulkUpdateRows?: (payload: BulkUpdatePayload) => Promise<{ updated_count: number; message?: string }>
  onFetchHistory?: (featureId: string) => Promise<FeatureHistoryEntry[]>
  onRollbackFeature?: (featureId: string, payload: { history_id?: string; version?: number }) => Promise<void>
}

type SortDirection = 'asc' | 'desc'
type FilterOperator = 'eq' | 'neq' | 'contains' | 'startswith' | 'endswith' | 'gt' | 'gte' | 'lt' | 'lte' | 'isnull' | 'notnull'

function editableProperties(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith('_')))
}

function extractVersion(value: Record<string, unknown> | null | undefined): number | undefined {
  const raw = value?._version
  return typeof raw === 'number' ? raw : undefined
}

function stringifyFieldValue(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  return String(value)
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '—'
  }
  if (typeof value === 'object') {
    return JSON.stringify(value)
  }
  return String(value)
}

function parseTypedField(field: LayerField, raw: string): unknown {
  const value = raw.trim()

  if (!value.length) {
    if (field.nullable) {
      return null
    }
    throw new Error(`Field "${field.name}" is required`)
  }

  if (field.field_type === 'string' || field.field_type === 'date' || field.field_type === 'datetime') {
    return value
  }

  if (field.field_type === 'integer') {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isFinite(parsed)) {
      throw new Error(`Field "${field.name}" expects an integer`)
    }
    return parsed
  }

  if (field.field_type === 'double') {
    const parsed = Number.parseFloat(value)
    if (!Number.isFinite(parsed)) {
      throw new Error(`Field "${field.name}" expects a number`)
    }
    return parsed
  }

  if (field.field_type === 'boolean') {
    if (value.toLowerCase() === 'true' || value === '1') {
      return true
    }
    if (value.toLowerCase() === 'false' || value === '0') {
      return false
    }
    throw new Error(`Field "${field.name}" expects true/false`)
  }

  return value
}

function domainOptions(field: LayerField): Array<{ label: string; value: string }> {
  const coded = field.domain?.coded_values
  if (!coded || field.domain?.domain_type !== 'codedValue') {
    return []
  }

  return coded.map((entry) => {
    if (typeof entry === 'object' && entry !== null && 'code' in entry) {
      const codedEntry = entry as { code: unknown; label?: string }
      return {
        label: codedEntry.label ?? String(codedEntry.code),
        value: String(codedEntry.code),
      }
    }

    return {
      label: String(entry),
      value: String(entry),
    }
  })
}

export function AttributeTableDialog({
  open,
  layerName,
  featureCollection,
  fields,
  saving,
  error,
  workMode = false,
  onClose,
  onSaveProperties,
  joins = [],
  onQueryRows,
  onBulkUpdateRows,
  onFetchHistory,
  onRollbackFeature,
}: AttributeTableDialogProps) {
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null)
  const [jsonDraft, setJsonDraft] = useState('{}')
  const [typedDraft, setTypedDraft] = useState<Record<string, string>>({})
  const [localError, setLocalError] = useState<string | null>(null)

  const [filterField, setFilterField] = useState('')
  const [filterOp, setFilterOp] = useState<FilterOperator>('contains')
  const [filterValue, setFilterValue] = useState('')
  const [sortField, setSortField] = useState('created_at')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [joinId, setJoinId] = useState('')

  const [querying, setQuerying] = useState(false)
  const [queryRows, setQueryRows] = useState<FeaturesQueryResponse['rows'] | null>(null)
  const [queryTotal, setQueryTotal] = useState(0)

  const [selectedFeatureIds, setSelectedFeatureIds] = useState<string[]>([])
  const [bulkField, setBulkField] = useState('')
  const [bulkValue, setBulkValue] = useState('')
  const [bulkRunning, setBulkRunning] = useState(false)

  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyEntries, setHistoryEntries] = useState<FeatureHistoryEntry[]>([])

  const features = useMemo(() => featureCollection?.features ?? [], [featureCollection])
  const hasSchema = fields.length > 0

  const localRows = useMemo(() => {
    return features.map((feature) => {
      const id = String(feature.id ?? '')
      const properties = editableProperties((feature.properties ?? {}) as Record<string, unknown>)
      const version = extractVersion((feature.properties ?? {}) as Record<string, unknown>) ?? 1
      return {
        id,
        properties,
        version,
        created_at: '',
        updated_at: '',
      }
    })
  }, [features])

  const rows = queryRows ?? localRows
  const totalRows = queryRows ? queryTotal : rows.length

  const columns = useMemo(() => {
    if (hasSchema) {
      return fields.map((field) => field.name)
    }

    const keys = new Set<string>()
    for (const row of rows) {
      Object.keys(row.properties ?? {})
        .filter((key) => !key.startsWith('_'))
        .forEach((key) => keys.add(key))
    }
    return [...keys]
  }, [fields, hasSchema, rows])

  const selectedRow = rows.find((row) => row.id === selectedFeatureId) ?? null

  const queryPayload = useMemo<FeaturesQueryPayload>(() => {
    const filters = filterField
      ? [{ field: filterField, op: filterOp, value: filterValue }]
      : []

    return {
      page,
      page_size: pageSize,
      sort: {
        field: sortField,
        direction: sortDirection,
      },
      filters,
      join_id: joinId || undefined,
    }
  }, [filterField, filterOp, filterValue, joinId, page, pageSize, sortDirection, sortField])

  const handleSelect = (featureId: string) => {
    setSelectedFeatureId(featureId)
    setLocalError(null)

    const row = rows.find((item) => item.id === featureId)
    const props = editableProperties(row?.properties ?? {})

    if (hasSchema) {
      const nextDraft: Record<string, string> = {}
      for (const field of fields) {
        nextDraft[field.name] = stringifyFieldValue(props[field.name])
      }
      setTypedDraft(nextDraft)
      return
    }

    setJsonDraft(JSON.stringify(props, null, 2))
  }

  const runQuery = useCallback(
    async (requestedPage = page) => {
      if (!onQueryRows) {
        return
      }

      setQuerying(true)
      setLocalError(null)
      try {
        const response = await onQueryRows({
          ...queryPayload,
          page: requestedPage,
        })
        setPage(response.page)
        setQueryRows(response.rows)
        setQueryTotal(response.total)
        setSelectedFeatureIds([])
        if (selectedFeatureId && !response.rows.find((row) => row.id === selectedFeatureId)) {
          setSelectedFeatureId(null)
        }
      } catch (queryError) {
        setLocalError(queryError instanceof Error ? queryError.message : 'Query failed')
      } finally {
        setQuerying(false)
      }
    },
    [onQueryRows, page, queryPayload, selectedFeatureId],
  )

  useEffect(() => {
    if (!open || !onQueryRows) {
      return
    }

    const timer = window.setTimeout(() => {
      void runQuery(page)
    }, 250)

    return () => {
      window.clearTimeout(timer)
    }
  }, [open, onQueryRows, page, runQuery])

  const handleSave = () => {
    if (!selectedRow) {
      return
    }

    try {
      let payload: Record<string, unknown>

      if (hasSchema) {
        payload = {}
        for (const field of fields) {
          const raw = typedDraft[field.name] ?? ''
          payload[field.name] = parseTypedField(field, raw)
        }
      } else {
        const parsed = JSON.parse(jsonDraft)
        if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
          throw new Error('Properties must be a JSON object')
        }
        payload = parsed as Record<string, unknown>
      }

      setLocalError(null)
      onSaveProperties(selectedRow.id, payload, selectedRow.version)
    } catch (saveError) {
      setLocalError(saveError instanceof Error ? saveError.message : 'Invalid attribute values')
    }
  }

  const toggleSelectRow = (featureId: string, checked: boolean) => {
    setSelectedFeatureIds((current) => {
      if (checked) {
        if (current.includes(featureId)) {
          return current
        }
        return [...current, featureId]
      }
      return current.filter((id) => id !== featureId)
    })
  }

  const handleSelectAllCurrentRows = (checked: boolean) => {
    if (!checked) {
      setSelectedFeatureIds([])
      return
    }
    setSelectedFeatureIds(rows.map((row) => row.id))
  }

  const handleBulkUpdate = async () => {
    if (!onBulkUpdateRows) {
      setLocalError('Bulk update is not available')
      return
    }
    if (!bulkField) {
      setLocalError('Select a field for bulk update')
      return
    }

    const fieldDef = fields.find((field) => field.name === bulkField)
    if (!fieldDef) {
      setLocalError('Unknown bulk update field')
      return
    }

    try {
      const parsed = parseTypedField(fieldDef, bulkValue)
      setBulkRunning(true)
      setLocalError(null)
      await onBulkUpdateRows({
        feature_ids: selectedFeatureIds.length ? selectedFeatureIds : undefined,
        filters: filterField ? [{ field: filterField, op: filterOp, value: filterValue }] : undefined,
        updates: { [bulkField]: parsed },
      })
      setSelectedFeatureIds([])
      await runQuery(page)
    } catch (bulkError) {
      setLocalError(bulkError instanceof Error ? bulkError.message : 'Bulk update failed')
    } finally {
      setBulkRunning(false)
    }
  }

  const handleLoadHistory = async () => {
    if (!onFetchHistory || !selectedRow) {
      return
    }
    setHistoryLoading(true)
    setLocalError(null)
    try {
      const history = await onFetchHistory(selectedRow.id)
      setHistoryEntries(history)
    } catch (historyError) {
      setLocalError(historyError instanceof Error ? historyError.message : 'Failed to load history')
    } finally {
      setHistoryLoading(false)
    }
  }

  const handleRollback = async (historyId: string) => {
    if (!onRollbackFeature || !selectedRow) {
      return
    }
    setHistoryLoading(true)
    setLocalError(null)
    try {
      await onRollbackFeature(selectedRow.id, { history_id: historyId })
      await runQuery(page)
      await handleLoadHistory()
    } catch (rollbackError) {
      setLocalError(rollbackError instanceof Error ? rollbackError.message : 'Rollback failed')
    } finally {
      setHistoryLoading(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize))

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="xl"
      {...(workMode ? WORK_MODE_DIALOG_PROPS : {})}
      sx={workMode ? workModeDialogSx('min(1020px, 98vw)') : normalModeDialogSx('min(1020px, 98vw)')}
    >
      <DialogTitle>Attribute Table</DialogTitle>
      <DialogContent>
        <Box display="grid" gap={2} pt={0.5}>
          {layerName && (
            <Typography variant="body2" color="text.secondary">
              Layer: <strong>{layerName}</strong>
            </Typography>
          )}

          {error && <Alert severity="error">{error}</Alert>}
          {localError && <Alert severity="error">{localError}</Alert>}

          {onQueryRows && (
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
              <TextField
                label="Filter field"
                value={filterField}
                onChange={(event) => {
                  setFilterField(event.target.value)
                  setPage(1)
                }}
                size="small"
                select
                sx={{ minWidth: 180 }}
              >
                <MenuItem value="">None</MenuItem>
                {fields.map((field) => (
                  <MenuItem key={field.id} value={field.name}>
                    {field.alias || field.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Join"
                value={joinId}
                onChange={(event) => {
                  setJoinId(event.target.value)
                  setPage(1)
                }}
                size="small"
                select
                sx={{ minWidth: 170 }}
              >
                <MenuItem value="">None</MenuItem>
                {joins.map((join) => (
                  <MenuItem key={join.id} value={join.id}>
                    {join.name ?? `${join.source_field}->${join.target_field}`}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Operator"
                value={filterOp}
                onChange={(event) => {
                  setFilterOp(event.target.value as FilterOperator)
                  setPage(1)
                }}
                size="small"
                select
                sx={{ minWidth: 160 }}
              >
                <MenuItem value="contains">contains</MenuItem>
                <MenuItem value="eq">eq</MenuItem>
                <MenuItem value="neq">neq</MenuItem>
                <MenuItem value="startswith">startswith</MenuItem>
                <MenuItem value="endswith">endswith</MenuItem>
                <MenuItem value="gt">gt</MenuItem>
                <MenuItem value="gte">gte</MenuItem>
                <MenuItem value="lt">lt</MenuItem>
                <MenuItem value="lte">lte</MenuItem>
                <MenuItem value="isnull">isnull</MenuItem>
                <MenuItem value="notnull">notnull</MenuItem>
              </TextField>
              <TextField
                label="Filter value"
                value={filterValue}
                onChange={(event) => {
                  setFilterValue(event.target.value)
                  setPage(1)
                }}
                size="small"
                fullWidth
                disabled={filterOp === 'isnull' || filterOp === 'notnull'}
              />
              <TextField
                label="Sort field"
                value={sortField}
                onChange={(event) => {
                  setSortField(event.target.value)
                  setPage(1)
                }}
                size="small"
                select
                sx={{ minWidth: 170 }}
              >
                <MenuItem value="created_at">created_at</MenuItem>
                <MenuItem value="updated_at">updated_at</MenuItem>
                <MenuItem value="version">version</MenuItem>
                {fields.map((field) => (
                  <MenuItem key={`sort-${field.id}`} value={field.name}>
                    {field.alias || field.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Direction"
                value={sortDirection}
                onChange={(event) => {
                  setSortDirection(event.target.value as SortDirection)
                  setPage(1)
                }}
                size="small"
                select
                sx={{ minWidth: 120 }}
              >
                <MenuItem value="asc">asc</MenuItem>
                <MenuItem value="desc">desc</MenuItem>
              </TextField>
              <TextField
                label="Page size"
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Math.max(1, Number(event.target.value) || 50))
                  setPage(1)
                }}
                size="small"
                type="number"
                sx={{ width: 120 }}
              />
              <Button
                variant="outlined"
                onClick={() => void runQuery(page)}
                disabled={querying}
              >
                Refresh
              </Button>
            </Stack>
          )}

          <TableContainer component={Paper} sx={{ maxHeight: 320 }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox">
                    <Checkbox
                      checked={rows.length > 0 && selectedFeatureIds.length === rows.length}
                      indeterminate={selectedFeatureIds.length > 0 && selectedFeatureIds.length < rows.length}
                      onChange={(event) => handleSelectAllCurrentRows(event.target.checked)}
                    />
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, minWidth: 180 }}>Feature ID</TableCell>
                  {columns.slice(0, 6).map((column) => (
                    <TableCell key={column} sx={{ fontWeight: 700, minWidth: 140 }}>
                      {column}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => {
                  const selected = row.id === selectedFeatureId
                  const checked = selectedFeatureIds.includes(row.id)
                  const props = editableProperties(row.properties)
                  return (
                    <TableRow
                      key={row.id}
                      hover
                      selected={selected}
                      onClick={() => handleSelect(row.id)}
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell padding="checkbox" onClick={(event) => event.stopPropagation()}>
                        <Checkbox
                          checked={checked}
                          onChange={(event) => toggleSelectRow(row.id, event.target.checked)}
                        />
                      </TableCell>
                      <TableCell>{row.id || 'n/a'}</TableCell>
                      {columns.slice(0, 6).map((column) => (
                        <TableCell key={`${row.id}-${column}`}>{displayValue(props[column])}</TableCell>
                      ))}
                    </TableRow>
                  )
                })}
                {!rows.length && (
                  <TableRow>
                    <TableCell colSpan={Math.max(3, columns.length + 2)}>
                      <Typography variant="body2" color="text.secondary">
                        No features found for this query.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>

          {onQueryRows && (
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Button
                variant="outlined"
                disabled={querying || page <= 1}
                onClick={() => void runQuery(page - 1)}
              >
                Previous
              </Button>
              <Typography variant="body2" color="text.secondary">
                Page {page} / {totalPages} · {totalRows} total
              </Typography>
              <Button
                variant="outlined"
                disabled={querying || page >= totalPages}
                onClick={() => void runQuery(page + 1)}
              >
                Next
              </Button>
            </Stack>
          )}

          {hasSchema && onBulkUpdateRows && (
            <>
              <Divider />
              <Box display="grid" gap={1.25}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  Bulk Update
                </Typography>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
                  <TextField
                    label="Field"
                    value={bulkField}
                    onChange={(event) => setBulkField(event.target.value)}
                    size="small"
                    select
                    sx={{ minWidth: 200 }}
                  >
                    {fields.map((field) => (
                      <MenuItem key={`bulk-${field.id}`} value={field.name}>
                        {field.alias || field.name}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    label="Value"
                    value={bulkValue}
                    onChange={(event) => setBulkValue(event.target.value)}
                    size="small"
                    fullWidth
                  />
                  <Button variant="outlined" onClick={() => void handleBulkUpdate()} disabled={bulkRunning}>
                    Apply
                  </Button>
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  {selectedFeatureIds.length
                    ? `Applying to ${selectedFeatureIds.length} selected features.`
                    : 'No rows selected: current query filter will be used.'}
                </Typography>
              </Box>
            </>
          )}

          {onFetchHistory && selectedRow && (
            <>
              <Divider />
              <Box display="grid" gap={1.25}>
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    Feature History ({selectedRow.id})
                  </Typography>
                  <Button variant="outlined" size="small" onClick={() => void handleLoadHistory()} disabled={historyLoading}>
                    Load History
                  </Button>
                </Stack>

                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700 }}>Version</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Change</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>When</TableCell>
                      <TableCell sx={{ fontWeight: 700, width: 120 }}>Action</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {historyEntries.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell>{entry.version}</TableCell>
                        <TableCell>{entry.change_type}</TableCell>
                        <TableCell>{new Date(entry.changed_at).toLocaleString()}</TableCell>
                        <TableCell>
                          {onRollbackFeature && (
                            <Button size="small" onClick={() => void handleRollback(entry.id)} disabled={historyLoading}>
                              Rollback
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {!historyEntries.length && (
                      <TableRow>
                        <TableCell colSpan={4}>
                          <Typography variant="body2" color="text.secondary">
                            No history loaded.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </Box>
            </>
          )}

          {hasSchema ? (
            <Box display="grid" gap={1.5}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                Edit attributes
              </Typography>

              <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }} gap={1.5}>
                {fields.map((field) => {
                  const codedOptions = domainOptions(field)

                  if (codedOptions.length) {
                    return (
                      <TextField
                        key={field.id}
                        label={field.alias || field.name}
                        value={selectedRow ? (typedDraft[field.name] ?? '') : ''}
                        onChange={(event) => {
                          setTypedDraft((current) => ({ ...current, [field.name]: event.target.value }))
                        }}
                        size="small"
                        select
                        fullWidth
                        disabled={!selectedRow}
                      >
                        {field.nullable && <MenuItem value="">(null)</MenuItem>}
                        {codedOptions.map((option) => (
                          <MenuItem key={`${field.id}-${option.value}`} value={option.value}>
                            {option.label}
                          </MenuItem>
                        ))}
                      </TextField>
                    )
                  }

                  if (field.field_type === 'boolean') {
                    return (
                      <TextField
                        key={field.id}
                        label={field.alias || field.name}
                        value={selectedRow ? (typedDraft[field.name] ?? '') : ''}
                        onChange={(event) => {
                          setTypedDraft((current) => ({ ...current, [field.name]: event.target.value }))
                        }}
                        size="small"
                        select
                        fullWidth
                        disabled={!selectedRow}
                      >
                        {field.nullable && <MenuItem value="">(null)</MenuItem>}
                        <MenuItem value="true">true</MenuItem>
                        <MenuItem value="false">false</MenuItem>
                      </TextField>
                    )
                  }

                  return (
                    <TextField
                      key={field.id}
                      label={field.alias || field.name}
                      value={selectedRow ? (typedDraft[field.name] ?? '') : ''}
                      onChange={(event) => {
                        setTypedDraft((current) => ({ ...current, [field.name]: event.target.value }))
                      }}
                      size="small"
                      type={field.field_type === 'integer' || field.field_type === 'double' ? 'number' : 'text'}
                      fullWidth
                      disabled={!selectedRow}
                      placeholder={field.field_type}
                    />
                  )
                })}
              </Box>
            </Box>
          ) : (
            <TextField
              label="Properties (JSON)"
              value={selectedRow ? jsonDraft : '{}'}
              onChange={(event) => setJsonDraft(event.target.value)}
              multiline
              minRows={8}
              fullWidth
              disabled={!selectedRow}
            />
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit" disabled={saving}>
          Close
        </Button>
        <Button variant="contained" disabled={!selectedRow || saving} onClick={handleSave}>
          Save Properties
        </Button>
      </DialogActions>
    </Dialog>
  )
}
