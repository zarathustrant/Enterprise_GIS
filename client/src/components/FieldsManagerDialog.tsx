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
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  Tab,
  TextField,
  Typography,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import type {
  CreateLayerDomainPayload,
  CreateLayerFieldPayload,
  UpdateLayerDomainPayload,
  UpdateLayerFieldPayload,
} from '../api/services'
import type { LayerDomain, LayerField, LayerFieldType } from '../types/gis'

interface FieldsManagerDialogProps {
  open: boolean
  layerName: string | null
  fields: LayerField[]
  domains: LayerDomain[]
  loading: boolean
  submitting: boolean
  error: string | null
  onClose: () => void
  onCreateField: (payload: CreateLayerFieldPayload) => void
  onUpdateField: (fieldId: string, payload: UpdateLayerFieldPayload) => void
  onDeleteField: (fieldId: string) => void
  onCreateDomain: (payload: CreateLayerDomainPayload) => void
  onUpdateDomain: (domainId: string, payload: UpdateLayerDomainPayload) => void
  onDeleteDomain: (domainId: string) => void
}

const fieldTypeOptions: Array<{ value: LayerFieldType; label: string }> = [
  { value: 'string', label: 'String' },
  { value: 'integer', label: 'Integer' },
  { value: 'double', label: 'Double' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'date', label: 'Date' },
  { value: 'datetime', label: 'DateTime' },
]

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  if (typeof value === 'string') {
    return value
  }
  return String(value)
}

function parseDefaultValue(fieldType: LayerFieldType, raw: string): unknown {
  const value = raw.trim()
  if (!value.length) {
    return undefined
  }

  if (fieldType === 'string' || fieldType === 'date' || fieldType === 'datetime') {
    return value
  }

  if (fieldType === 'integer') {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isFinite(parsed)) {
      throw new Error('Default value must be a valid integer')
    }
    return parsed
  }

  if (fieldType === 'double') {
    const parsed = Number.parseFloat(value)
    if (!Number.isFinite(parsed)) {
      throw new Error('Default value must be a valid number')
    }
    return parsed
  }

  if (fieldType === 'boolean') {
    if (value.toLowerCase() === 'true' || value === '1') {
      return true
    }
    if (value.toLowerCase() === 'false' || value === '0') {
      return false
    }
    throw new Error('Default value for boolean must be true/false or 1/0')
  }

  return value
}

function formatCodedValues(codedValues: LayerDomain['coded_values']): string {
  if (!codedValues?.length) {
    return ''
  }

  return codedValues
    .map((entry) => {
      if (typeof entry === 'object' && entry !== null && 'code' in entry) {
        const record = entry as { code: unknown; label?: string }
        return record.label ? `${String(record.code)}:${record.label}` : String(record.code)
      }

      return String(entry)
    })
    .join(', ')
}

function parseCodedValues(input: string): Array<{ code: unknown; label?: string }> {
  return input
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
    .map((entry) => {
      const [rawCode, rawLabel] = entry.split(':').map((part) => part.trim())
      return rawLabel ? { code: rawCode, label: rawLabel } : { code: rawCode }
    })
}

export function FieldsManagerDialog({
  open,
  layerName,
  fields,
  domains,
  loading,
  submitting,
  error,
  onClose,
  onCreateField,
  onUpdateField,
  onDeleteField,
  onCreateDomain,
  onUpdateDomain,
  onDeleteDomain,
}: FieldsManagerDialogProps) {
  const [tab, setTab] = useState(0)
  const [localError, setLocalError] = useState<string | null>(null)

  const [editingFieldId, setEditingFieldId] = useState<string | null>(null)
  const [fieldName, setFieldName] = useState('')
  const [fieldAlias, setFieldAlias] = useState('')
  const [fieldType, setFieldType] = useState<LayerFieldType>('string')
  const [fieldNullable, setFieldNullable] = useState(true)
  const [fieldDefault, setFieldDefault] = useState('')
  const [fieldLength, setFieldLength] = useState('')
  const [fieldPrecision, setFieldPrecision] = useState('')
  const [fieldScale, setFieldScale] = useState('')
  const [fieldDomainId, setFieldDomainId] = useState('')

  const [editingDomainId, setEditingDomainId] = useState<string | null>(null)
  const [domainName, setDomainName] = useState('')
  const [domainDescription, setDomainDescription] = useState('')
  const [domainType, setDomainType] = useState<'codedValue' | 'range'>('codedValue')
  const [domainCodedValues, setDomainCodedValues] = useState('')
  const [domainMin, setDomainMin] = useState('')
  const [domainMax, setDomainMax] = useState('')

  const domainById = useMemo(() => {
    const next: Record<string, LayerDomain> = {}
    for (const domain of domains) {
      next[domain.id] = domain
    }
    return next
  }, [domains])

  const resetFieldForm = () => {
    setEditingFieldId(null)
    setFieldName('')
    setFieldAlias('')
    setFieldType('string')
    setFieldNullable(true)
    setFieldDefault('')
    setFieldLength('')
    setFieldPrecision('')
    setFieldScale('')
    setFieldDomainId('')
  }

  const resetDomainForm = () => {
    setEditingDomainId(null)
    setDomainName('')
    setDomainDescription('')
    setDomainType('codedValue')
    setDomainCodedValues('')
    setDomainMin('')
    setDomainMax('')
  }

  const handleClose = () => {
    if (submitting) {
      return
    }
    setTab(0)
    setLocalError(null)
    resetFieldForm()
    resetDomainForm()
    onClose()
  }

  const handleSubmitField = () => {
    setLocalError(null)

    const trimmedName = fieldName.trim()
    if (!trimmedName) {
      setLocalError('Field name is required')
      return
    }

    try {
      const payload: CreateLayerFieldPayload = {
        name: trimmedName,
        alias: fieldAlias.trim() || undefined,
        field_type: fieldType,
        nullable: fieldNullable,
      }

      const parsedDefault = parseDefaultValue(fieldType, fieldDefault)
      if (parsedDefault !== undefined) {
        payload.default_value = parsedDefault
      }

      if (fieldDomainId.trim()) {
        payload.domain_id = fieldDomainId.trim()
      }

      if (fieldLength.trim()) {
        payload.length = Number.parseInt(fieldLength, 10)
      }

      if (fieldPrecision.trim()) {
        payload.precision = Number.parseInt(fieldPrecision, 10)
      }

      if (fieldScale.trim()) {
        payload.scale = Number.parseInt(fieldScale, 10)
      }

      if (editingFieldId) {
        onUpdateField(editingFieldId, payload)
      } else {
        onCreateField(payload)
      }
      resetFieldForm()
    } catch (submitError) {
      setLocalError(submitError instanceof Error ? submitError.message : 'Invalid field configuration')
    }
  }

  const handleSubmitDomain = () => {
    setLocalError(null)

    const trimmedName = domainName.trim()
    if (!trimmedName) {
      setLocalError('Domain name is required')
      return
    }

    const payload: CreateLayerDomainPayload = {
      name: trimmedName,
      description: domainDescription.trim() || undefined,
      domain_type: domainType,
    }

    if (domainType === 'codedValue') {
      const parsedValues = parseCodedValues(domainCodedValues)
      if (!parsedValues.length) {
        setLocalError('codedValue domains require at least one value')
        return
      }
      payload.coded_values = parsedValues
    } else {
      const min = Number.parseFloat(domainMin)
      const max = Number.parseFloat(domainMax)
      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        setLocalError('Range domains require numeric min/max values')
        return
      }
      if (min > max) {
        setLocalError('Range domain minimum cannot be greater than maximum')
        return
      }
      payload.min_value = min
      payload.max_value = max
    }

    if (editingDomainId) {
      onUpdateDomain(editingDomainId, payload)
    } else {
      onCreateDomain(payload)
    }
    resetDomainForm()
  }

  const openEditField = (field: LayerField) => {
    setLocalError(null)
    setTab(0)
    setEditingFieldId(field.id)
    setFieldName(field.name)
    setFieldAlias(field.alias ?? '')
    setFieldType(field.field_type)
    setFieldNullable(field.nullable)
    setFieldDefault(formatValue(field.default_value))
    setFieldLength(field.length != null ? String(field.length) : '')
    setFieldPrecision(field.precision != null ? String(field.precision) : '')
    setFieldScale(field.scale != null ? String(field.scale) : '')
    setFieldDomainId(field.domain?.id ?? '')
  }

  const openEditDomain = (domain: LayerDomain) => {
    setLocalError(null)
    setTab(1)
    setEditingDomainId(domain.id)
    setDomainName(domain.name)
    setDomainDescription(domain.description ?? '')
    setDomainType(domain.domain_type)
    setDomainCodedValues(formatCodedValues(domain.coded_values))
    setDomainMin(domain.min_value != null ? String(domain.min_value) : '')
    setDomainMax(domain.max_value != null ? String(domain.max_value) : '')
  }

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="lg">
      <DialogTitle>Field & Domain Manager</DialogTitle>
      <DialogContent>
        <Box display="grid" gap={2} pt={0.5}>
          {layerName && (
            <Typography variant="body2" color="text.secondary">
              Layer: <strong>{layerName}</strong>
            </Typography>
          )}

          {error && <Alert severity="error">{error}</Alert>}
          {localError && <Alert severity="error">{localError}</Alert>}

          <Tabs value={tab} onChange={(_, value) => setTab(value)}>
            <Tab label={`Fields (${fields.length})`} />
            <Tab label={`Domains (${domains.length})`} />
          </Tabs>

          {loading && (
            <Alert severity="info">Loading schema metadata…</Alert>
          )}

          {tab === 0 && (
            <Box display="grid" gap={2}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                {editingFieldId ? 'Edit Field' : 'Add Field'}
              </Typography>

              <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }} gap={1.5}>
                <TextField
                  label="Field name"
                  value={fieldName}
                  onChange={(event) => setFieldName(event.target.value)}
                  size="small"
                  fullWidth
                />
                <TextField
                  label="Alias"
                  value={fieldAlias}
                  onChange={(event) => setFieldAlias(event.target.value)}
                  size="small"
                  fullWidth
                />
                <TextField
                  label="Type"
                  value={fieldType}
                  onChange={(event) => setFieldType(event.target.value as LayerFieldType)}
                  size="small"
                  select
                  fullWidth
                >
                  {fieldTypeOptions.map((option) => (
                    <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                  ))}
                </TextField>
                <TextField
                  label="Nullable"
                  value={fieldNullable ? 'true' : 'false'}
                  onChange={(event) => setFieldNullable(event.target.value === 'true')}
                  size="small"
                  select
                  fullWidth
                >
                  <MenuItem value="true">true</MenuItem>
                  <MenuItem value="false">false</MenuItem>
                </TextField>
                <TextField
                  label="Default value"
                  value={fieldDefault}
                  onChange={(event) => setFieldDefault(event.target.value)}
                  size="small"
                  fullWidth
                />
                <TextField
                  label="Domain"
                  value={fieldDomainId}
                  onChange={(event) => setFieldDomainId(event.target.value)}
                  size="small"
                  select
                  fullWidth
                >
                  <MenuItem value="">None</MenuItem>
                  {domains.map((domain) => (
                    <MenuItem key={domain.id} value={domain.id}>{domain.name}</MenuItem>
                  ))}
                </TextField>
                <TextField
                  label="Length"
                  value={fieldLength}
                  onChange={(event) => setFieldLength(event.target.value)}
                  size="small"
                  type="number"
                  fullWidth
                  disabled={fieldType !== 'string'}
                />
                <TextField
                  label="Precision"
                  value={fieldPrecision}
                  onChange={(event) => setFieldPrecision(event.target.value)}
                  size="small"
                  type="number"
                  fullWidth
                  disabled={fieldType === 'boolean' || fieldType === 'date' || fieldType === 'datetime'}
                />
                <TextField
                  label="Scale"
                  value={fieldScale}
                  onChange={(event) => setFieldScale(event.target.value)}
                  size="small"
                  type="number"
                  fullWidth
                  disabled={fieldType !== 'double'}
                />
              </Box>

              <Stack direction="row" spacing={1}>
                <Button variant="contained" onClick={handleSubmitField} disabled={submitting || loading}>
                  {editingFieldId ? 'Update Field' : 'Add Field'}
                </Button>
                <Button onClick={resetFieldForm} color="inherit" disabled={submitting || loading}>
                  Reset
                </Button>
              </Stack>

              <Table size="small" sx={{ mt: 1 }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Nullable</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Domain</TableCell>
                    <TableCell sx={{ fontWeight: 700 }} align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {fields.map((field) => (
                    <TableRow key={field.id}>
                      <TableCell>{field.alias ? `${field.alias} (${field.name})` : field.name}</TableCell>
                      <TableCell>{field.field_type}</TableCell>
                      <TableCell>{field.nullable ? 'true' : 'false'}</TableCell>
                      <TableCell>{field.domain?.name ?? '—'}</TableCell>
                      <TableCell align="right">
                        <IconButton size="small" onClick={() => openEditField(field)}>
                          <EditOutlinedIcon fontSize="small" />
                        </IconButton>
                        <IconButton size="small" color="error" onClick={() => onDeleteField(field.id)}>
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!fields.length && (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <Typography variant="body2" color="text.secondary">No fields defined.</Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Box>
          )}

          {tab === 1 && (
            <Box display="grid" gap={2}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                {editingDomainId ? 'Edit Domain' : 'Add Domain'}
              </Typography>

              <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }} gap={1.5}>
                <TextField
                  label="Domain name"
                  value={domainName}
                  onChange={(event) => setDomainName(event.target.value)}
                  size="small"
                  fullWidth
                />
                <TextField
                  label="Type"
                  value={domainType}
                  onChange={(event) => setDomainType(event.target.value as 'codedValue' | 'range')}
                  size="small"
                  select
                  fullWidth
                >
                  <MenuItem value="codedValue">codedValue</MenuItem>
                  <MenuItem value="range">range</MenuItem>
                </TextField>
                <TextField
                  label="Description"
                  value={domainDescription}
                  onChange={(event) => setDomainDescription(event.target.value)}
                  size="small"
                  fullWidth
                />
                {domainType === 'codedValue' ? (
                  <TextField
                    label="Coded values (code:label, code2:label2)"
                    value={domainCodedValues}
                    onChange={(event) => setDomainCodedValues(event.target.value)}
                    size="small"
                    fullWidth
                  />
                ) : (
                  <>
                    <TextField
                      label="Minimum"
                      value={domainMin}
                      onChange={(event) => setDomainMin(event.target.value)}
                      size="small"
                      type="number"
                      fullWidth
                    />
                    <TextField
                      label="Maximum"
                      value={domainMax}
                      onChange={(event) => setDomainMax(event.target.value)}
                      size="small"
                      type="number"
                      fullWidth
                    />
                  </>
                )}
              </Box>

              <Stack direction="row" spacing={1}>
                <Button variant="contained" onClick={handleSubmitDomain} disabled={submitting || loading}>
                  {editingDomainId ? 'Update Domain' : 'Add Domain'}
                </Button>
                <Button onClick={resetDomainForm} color="inherit" disabled={submitting || loading}>
                  Reset
                </Button>
              </Stack>

              <Table size="small" sx={{ mt: 1 }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Rule</TableCell>
                    <TableCell sx={{ fontWeight: 700 }} align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {domains.map((domain) => (
                    <TableRow key={domain.id}>
                      <TableCell>{domain.name}</TableCell>
                      <TableCell>{domain.domain_type}</TableCell>
                      <TableCell>
                        {domain.domain_type === 'codedValue'
                          ? formatCodedValues(domain.coded_values)
                          : `${domain.min_value ?? '-'} to ${domain.max_value ?? '-'}`}
                      </TableCell>
                      <TableCell align="right">
                        <IconButton size="small" onClick={() => openEditDomain(domain)}>
                          <EditOutlinedIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => {
                            const linked = fields.filter((field) => field.domain?.id === domain.id)
                            if (linked.length) {
                              setLocalError(`Domain is in use by ${linked.length} field(s). Remove it from fields before delete.`)
                              return
                            }
                            onDeleteDomain(domain.id)
                          }}
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!domains.length && (
                    <TableRow>
                      <TableCell colSpan={4}>
                        <Typography variant="body2" color="text.secondary">No domains defined.</Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Box>
          )}

          {fieldDomainId && !domainById[fieldDomainId] && (
            <Alert severity="warning">
              Selected domain was removed. Choose another domain or clear the selection.
            </Alert>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} color="inherit" disabled={submitting}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  )
}
