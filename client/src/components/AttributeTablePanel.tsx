import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import type { BulkUpdatePayload, FeaturesQueryPayload, FeaturesQueryResponse } from '../api/services'
import { fetchLayerRelationships, fetchRelatedRecords } from '../api/services'
import type { FeatureCollection, LayerField, LayerRelationship, QueryResultRow } from '../types/gis'
import {
  Alert,
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import FilterListIcon from '@mui/icons-material/FilterList'
import RefreshIcon from '@mui/icons-material/Refresh'
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess'
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore'
import ViewColumnIcon from '@mui/icons-material/ViewColumn'
import ZoomInMapIcon from '@mui/icons-material/ZoomInMap'
import FlashOnIcon from '@mui/icons-material/FlashOn'
import ClearIcon from '@mui/icons-material/Clear'
import SelectAllIcon from '@mui/icons-material/SelectAll'
import DeselectIcon from '@mui/icons-material/Deselect'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import AddBoxIcon from '@mui/icons-material/AddBox'
import IndeterminateCheckBoxIcon from '@mui/icons-material/IndeterminateCheckBox'
import SearchIcon from '@mui/icons-material/Search'
import BarChartIcon from '@mui/icons-material/BarChart'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import LinkIcon from '@mui/icons-material/Link'
import CalculateIcon from '@mui/icons-material/Calculate'
import FormatPaintIcon from '@mui/icons-material/FormatPaint'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import DownloadIcon from '@mui/icons-material/Download'
import TableChartIcon from '@mui/icons-material/TableChart'
import SortIcon from '@mui/icons-material/Sort'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'

interface AttributeTablePanelProps {
  layerName: string | null
  layerId: string | null
  featureCollection: FeatureCollection | null
  fields: LayerField[]
  saving: boolean
  error: string | null
  selectedFeatureIds?: string[]
  accessToken?: string | null
  onClose: () => void
  onSaveProperties: (featureId: string, properties: Record<string, unknown>, version?: number) => void
  onQueryRows?: (payload: FeaturesQueryPayload) => Promise<FeaturesQueryResponse>
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onBulkUpdateRows?: (payload: BulkUpdatePayload) => Promise<{ updated_count: number; message?: string }>
  onFeatureSelectionChange?: (featureIds: string[]) => void
  onZoomToFeature?: (featureId: string) => void
  onZoomToSelection?: (featureIds: string[]) => void
  onFlashFeature?: (featureId: string) => void
  onPanToFeature?: (featureId: string) => void
  onNavigateToRelatedLayer?: (layerId: string, featureId: string) => void
}

// type SortDirection = 'asc' | 'desc'
type FilterOperator = 'eq' | 'neq' | 'contains' | 'startswith' | 'endswith' | 'gt' | 'gte' | 'lt' | 'lte' | 'isnull' | 'notnull'

function editableProperties(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith('_')))
}

function extractVersion(value: Record<string, unknown> | null | undefined): number | undefined {
  const raw = value?._version
  return typeof raw === 'number' ? raw : undefined
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '—'
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No'
  }
  if (typeof value === 'number') {
    return value.toLocaleString()
  }
  if (typeof value === 'object') {
    return JSON.stringify(value)
  }
  return String(value)
}

function stringifyFieldValue(value: unknown, fieldType?: string): string {
  if (value === null || value === undefined) {
    return ''
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }

  // Format dates for date/datetime inputs
  if (fieldType === 'date' || fieldType === 'datetime') {
    const str = String(value)
    if (!str) return ''

    try {
      const date = new Date(str)
      if (!isNaN(date.getTime())) {
        if (fieldType === 'date') {
          // Format as YYYY-MM-DD
          return date.toISOString().split('T')[0]
        } else {
          // Format as YYYY-MM-DDTHH:mm for datetime-local
          const iso = date.toISOString()
          return iso.substring(0, 16) // YYYY-MM-DDTHH:mm
        }
      }
    } catch {
      // If parsing fails, return the original string
      return str
    }
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

export function AttributeTablePanel({
  layerName,
  layerId,
  featureCollection,
  fields,
  saving,
  error,
  selectedFeatureIds = [],
  accessToken,
  onClose,
  onSaveProperties,
  onQueryRows,
  onBulkUpdateRows,
  onFeatureSelectionChange,
  onZoomToFeature,
  onZoomToSelection,
  onFlashFeature,
  // onPanToFeature,
  onNavigateToRelatedLayer,
}: AttributeTablePanelProps) {
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null)
  const [typedDraft, setTypedDraft] = useState<Record<string, string>>({})
  const [localError, setLocalError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [showFilters, setShowFilters] = useState(false)

  // Phase 2: Selection tools
  // const [showSelectionTools, setShowSelectionTools] = useState(false)
  const [showSelectionStats, setShowSelectionStats] = useState(false)
  const [selectionMode, setSelectionMode] = useState<'new' | 'add' | 'remove'>('new')
  const [showQueryBuilder, setShowQueryBuilder] = useState(false)
  const [queryConditions, setQueryConditions] = useState<Array<{
    field: string
    operator: FilterOperator
    value: string
    logicalOp: 'AND' | 'OR'
  }>>([{ field: '', operator: 'eq', value: '', logicalOp: 'AND' }])

  // Phase 3: Relationships
  const [editPanelTab, setEditPanelTab] = useState<'attributes' | 'related'>('' as 'attributes')
  const [relationships, setRelationships] = useState<LayerRelationship[]>([])
  const [relatedRecords, setRelatedRecords] = useState<Record<string, QueryResultRow[]>>({})
  const [loadingRelationships, setLoadingRelationships] = useState(false)
  const [loadingRelatedRecords, setLoadingRelatedRecords] = useState<Record<string, boolean>>({})

  // Phase 4: Advanced table features
  const [showFieldCalculator, setShowFieldCalculator] = useState(false)
  const [calculatorField, setCalculatorField] = useState('')
  const [calculatorExpression, setCalculatorExpression] = useState('')
  const [calculatorApplyToSelected, setCalculatorApplyToSelected] = useState(false)

  // Phase 4.2: Conditional formatting
  const [showConditionalFormat, setShowConditionalFormat] = useState(false)
  const [formatRules, setFormatRules] = useState<Array<{
    field: string
    operator: FilterOperator
    value: string
    color: string
  }>>([])

  // Phase 4.3: Column management (to be implemented)
  // const [columnOrder, setColumnOrder] = useState<string[]>([])
  // const [frozenColumns, setFrozenColumns] = useState<Set<string>>(new Set())

  // Phase 4.4: Multi-column sorting
  const [sortColumns, setSortColumns] = useState<Array<{ field: string; direction: 'asc' | 'desc' }>>([])
  const [showSortDialog, setShowSortDialog] = useState(false)

  // Phase 5: Context menu
  const [contextMenu, setContextMenu] = useState<{ mouseX: number; mouseY: number; featureId: string } | null>(null)

  // Phase 6: Export
  const [exportMenuAnchor, setExportMenuAnchor] = useState<HTMLElement | null>(null)

  const [filterField, setFilterField] = useState('')
  const [filterOp, setFilterOp] = useState<FilterOperator>('contains')
  const [filterValue, setFilterValue] = useState('')
  // const [sortField, setSortField] = useState('created_at')
  // const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(10)

  // const [querying, setQuerying] = useState(false)
  const [queryRows] = useState<FeaturesQueryResponse['rows'] | null>(null)
  const [queryTotal] = useState(0)

  // Use selectedFeatureIds from props (global state) instead of local state

  // Column visibility state
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set())
  const [columnMenuAnchor, setColumnMenuAnchor] = useState<HTMLElement | null>(null)

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

  const allColumns = useMemo(() => {
    if (hasSchema) {
      return fields.map((field) => ({
        id: field.id,
        name: field.name,
        alias: field.alias || field.name,
        type: field.field_type,
      }))
    }

    const keys = new Set<string>()
    for (const row of rows) {
      Object.keys(row.properties ?? {})
        .filter((key) => !key.startsWith('_'))
        .forEach((key) => keys.add(key))
    }
    return [...keys].map((key) => ({ id: key, name: key, alias: key, type: 'string' }))
  }, [fields, hasSchema, rows])

  // Initialize visible columns with all columns on first load or when columns change
  useMemo(() => {
    if (allColumns.length > 0 && visibleColumns.size === 0) {
      setVisibleColumns(new Set(allColumns.map((col) => col.name)))
    }
  }, [allColumns, visibleColumns.size])

  // Filter columns based on visibility
  const columns = useMemo(() => {
    if (visibleColumns.size === 0) {
      return allColumns
    }
    return allColumns.filter((col) => visibleColumns.has(col.name))
  }, [allColumns, visibleColumns])

  const selectedRow = rows.find((row) => row.id === selectedFeatureId) ?? null

  const handleSelect = (featureId: string) => {
    setSelectedFeatureId(featureId)
    setLocalError(null)

    const row = rows.find((item) => item.id === featureId)
    const props = editableProperties(row?.properties ?? {})

    if (hasSchema) {
      const nextDraft: Record<string, string> = {}
      for (const field of fields) {
        nextDraft[field.name] = stringifyFieldValue(props[field.name], field.field_type)
      }
      setTypedDraft(nextDraft)
    }
  }

  const handleSave = () => {
    if (!selectedRow) {
      return
    }

    try {
      const payload: Record<string, unknown> = {}
      for (const field of fields) {
        const raw = typedDraft[field.name] ?? ''
        payload[field.name] = parseTypedField(field, raw)
      }

      setLocalError(null)
      onSaveProperties(selectedRow.id, payload, selectedRow.version)
    } catch (saveError) {
      setLocalError(saveError instanceof Error ? saveError.message : 'Invalid attribute values')
    }
  }

  const toggleSelectRow = (featureId: string, checked: boolean) => {
    const newSelection = checked
      ? selectedFeatureIds.includes(featureId)
        ? selectedFeatureIds
        : [...selectedFeatureIds, featureId]
      : selectedFeatureIds.filter((id) => id !== featureId)
    onFeatureSelectionChange?.(newSelection)
  }

  const handleSelectAllCurrentRows = (checked: boolean) => {
    const newSelection = checked ? rows.map((row) => row.id) : []
    onFeatureSelectionChange?.(newSelection)
  }

  const handleToggleColumn = (columnName: string) => {
    setVisibleColumns((current) => {
      const next = new Set(current)
      if (next.has(columnName)) {
        next.delete(columnName)
      } else {
        next.add(columnName)
      }
      return next
    })
  }

  const handleShowAllColumns = () => {
    setVisibleColumns(new Set(allColumns.map((col) => col.name)))
  }

  const handleHideAllColumns = () => {
    setVisibleColumns(new Set())
  }

  // Phase 4.4: Apply multi-column sorting
  const sortedRows = useMemo(() => {
    if (sortColumns.length === 0) {
      return rows
    }

    return [...rows].sort((a, b) => {
      for (const { field, direction } of sortColumns) {
        const aVal = a.properties[field]
        const bVal = b.properties[field]

        let comparison = 0
        if (aVal === null || aVal === undefined) comparison = 1
        else if (bVal === null || bVal === undefined) comparison = -1
        else if (typeof aVal === 'number' && typeof bVal === 'number') {
          comparison = aVal - bVal
        } else {
          comparison = String(aVal).localeCompare(String(bVal))
        }

        if (comparison !== 0) {
          return direction === 'asc' ? comparison : -comparison
        }
      }
      return 0
    })
  }, [rows, sortColumns])

  const paginatedRows = useMemo(() => {
    if (onQueryRows) {
      return sortedRows
    }
    const start = page * pageSize
    return sortedRows.slice(start, start + pageSize)
  }, [sortedRows, page, pageSize, onQueryRows])

  // Phase 2: Selection operations
  const handleSelectAll = () => {
    onFeatureSelectionChange?.(rows.map((row) => row.id))
  }

  const handleClearSelection = () => {
    onFeatureSelectionChange?.([])
  }

  const handleSwitchSelection = () => {
    const allIds = rows.map((row) => row.id)
    const newSelection = allIds.filter((id) => !selectedFeatureIds.includes(id))
    onFeatureSelectionChange?.(newSelection)
  }

  const handleApplyQuery = () => {
    // Filter rows based on query conditions
    const matchingIds = rows.filter((row) => {
      return queryConditions.every((condition, index) => {
        if (!condition.field) return true

        const value = row.properties[condition.field]
        const condValue = condition.value

        let matches = false
        switch (condition.operator) {
          case 'eq':
            matches = String(value) === condValue
            break
          case 'neq':
            matches = String(value) !== condValue
            break
          case 'contains':
            matches = String(value).toLowerCase().includes(condValue.toLowerCase())
            break
          case 'startswith':
            matches = String(value).toLowerCase().startsWith(condValue.toLowerCase())
            break
          case 'endswith':
            matches = String(value).toLowerCase().endsWith(condValue.toLowerCase())
            break
          case 'gt':
            matches = Number(value) > Number(condValue)
            break
          case 'gte':
            matches = Number(value) >= Number(condValue)
            break
          case 'lt':
            matches = Number(value) < Number(condValue)
            break
          case 'lte':
            matches = Number(value) <= Number(condValue)
            break
          case 'isnull':
            matches = value === null || value === undefined
            break
          case 'notnull':
            matches = value !== null && value !== undefined
            break
        }

        // Handle logical operators between conditions
        if (index > 0 && queryConditions[index - 1].logicalOp === 'OR') {
          return matches // OR logic handled differently
        }
        return matches
      })
    }).map((row) => row.id)

    // Apply selection based on mode
    switch (selectionMode) {
      case 'new':
        onFeatureSelectionChange?.(matchingIds)
        break
      case 'add':
        onFeatureSelectionChange?.([...new Set([...selectedFeatureIds, ...matchingIds])])
        break
      case 'remove':
        onFeatureSelectionChange?.(selectedFeatureIds.filter((id) => !matchingIds.includes(id)))
        break
    }

    setShowQueryBuilder(false)
  }

  // Calculate selection statistics
  const selectionStats = useMemo(() => {
    if (!selectedFeatureIds.length) return null

    const selectedRows = rows.filter((row) => selectedFeatureIds.includes(row.id))
    const numericFields = fields.filter((f) => f.field_type === 'integer' || f.field_type === 'double')

    const stats: Record<string, { sum: number; avg: number; min: number; max: number }> = {}

    numericFields.forEach((field) => {
      const values = selectedRows
        .map((row) => row.properties[field.name])
        .filter((v) => typeof v === 'number') as number[]

      if (values.length > 0) {
        const sum = values.reduce((acc, v) => acc + v, 0)
        stats[field.name] = {
          sum,
          avg: sum / values.length,
          min: Math.min(...values),
          max: Math.max(...values),
        }
      }
    })

    return {
      count: selectedFeatureIds.length,
      fields: stats,
    }
  }, [selectedFeatureIds, rows, fields])

  // Phase 3: Fetch relationships for the layer
  useEffect(() => {
    if (!layerId) {
      setRelationships([])
      return
    }

    setLoadingRelationships(true)
    fetchLayerRelationships(layerId, accessToken)
      .then((rels) => {
        setRelationships(rels)
      })
      .catch((err) => {
        console.error('Failed to fetch relationships:', err)
      })
      .finally(() => {
        setLoadingRelationships(false)
      })
  }, [layerId, accessToken])

  // Phase 3: Fetch related records when feature is selected
  useEffect(() => {
    if (!layerId || !selectedFeatureId || relationships.length === 0) {
      setRelatedRecords({})
      return
    }

    // Fetch related records for each relationship
    relationships.forEach((rel) => {
      setLoadingRelatedRecords((prev) => ({ ...prev, [rel.id]: true }))
      fetchRelatedRecords(layerId, selectedFeatureId, rel.id, accessToken)
        .then((records) => {
          setRelatedRecords((prev) => ({ ...prev, [rel.id]: records }))
        })
        .catch((err) => {
          console.error(`Failed to fetch related records for relationship ${rel.id}:`, err)
          setRelatedRecords((prev) => ({ ...prev, [rel.id]: [] }))
        })
        .finally(() => {
          setLoadingRelatedRecords((prev) => ({ ...prev, [rel.id]: false }))
        })
    })
  }, [layerId, selectedFeatureId, relationships, accessToken])

  // Phase 7: Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + A: Select all
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault()
        handleSelectAll()
      }

      // Escape: Clear selection
      if (e.key === 'Escape') {
        handleClearSelection()
      }

      // Ctrl/Cmd + E: Export
      if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
        e.preventDefault()
        // Toggle export menu
        // In a real implementation, we'd open the export menu here
      }

      // Ctrl/Cmd + F: Focus search/filter
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        setShowFilters(true)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedFeatureIds, rows])

  // Phase 6: Export helper functions
  const exportToCSV = () => {
    const exportRows = selectedFeatureIds.length > 0
      ? rows.filter((row) => selectedFeatureIds.includes(row.id))
      : rows

    const headers = columns.map((col) => col.alias)
    const csvContent = [
      headers.join(','),
      ...exportRows.map((row) => {
        const props = editableProperties(row.properties)
        return columns.map((col) => {
          const value = props[col.name]
          const str = String(value ?? '')
          // Escape commas and quotes
          return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str
        }).join(',')
      }),
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${layerName || 'table'}_${new Date().toISOString().split('T')[0]}.csv`
    link.click()
    setExportMenuAnchor(null)
  }

  const exportToJSON = () => {
    const exportRows = selectedFeatureIds.length > 0
      ? rows.filter((row) => selectedFeatureIds.includes(row.id))
      : rows

    const data = exportRows.map((row) => ({
      id: row.id,
      ...editableProperties(row.properties),
    }))

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${layerName || 'table'}_${new Date().toISOString().split('T')[0]}.json`
    link.click()
    setExportMenuAnchor(null)
  }

  const exportToExcel = () => {
    const exportRows = selectedFeatureIds.length > 0
      ? rows.filter((row) => selectedFeatureIds.includes(row.id))
      : rows

    // Prepare data for Excel
    const data = exportRows.map((row) => {
      const props = editableProperties(row.properties)
      const rowData: Record<string, unknown> = { ID: row.id }
      columns.forEach((col) => {
        rowData[col.alias] = props[col.name]
      })
      return rowData
    })

    // Create worksheet
    const worksheet = XLSX.utils.json_to_sheet(data)

    // Set column widths
    const maxWidths = columns.map((col) => {
      const maxLength = Math.max(
        col.alias.length,
        ...exportRows.map((row) => String(editableProperties(row.properties)[col.name] ?? '').length)
      )
      return { wch: Math.min(maxLength + 2, 50) }
    })
    worksheet['!cols'] = [{ wch: 10 }, ...maxWidths]

    // Create workbook and export
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, layerName || 'Table')
    XLSX.writeFile(workbook, `${layerName || 'table'}_${new Date().toISOString().split('T')[0]}.xlsx`)
    setExportMenuAnchor(null)
  }

  // Phase 4.2: Determine row background color based on formatting rules
  const getRowBackgroundColor = (rowProperties: Record<string, unknown>): string | undefined => {
    for (const rule of formatRules) {
      if (!rule.field) continue

      const value = rowProperties[rule.field]
      const ruleValue = rule.value
      let matches = false

      switch (rule.operator) {
        case 'eq':
          matches = String(value) === ruleValue
          break
        case 'neq':
          matches = String(value) !== ruleValue
          break
        case 'contains':
          matches = String(value).toLowerCase().includes(ruleValue.toLowerCase())
          break
        case 'startswith':
          matches = String(value).toLowerCase().startsWith(ruleValue.toLowerCase())
          break
        case 'endswith':
          matches = String(value).toLowerCase().endsWith(ruleValue.toLowerCase())
          break
        case 'gt':
          matches = Number(value) > Number(ruleValue)
          break
        case 'gte':
          matches = Number(value) >= Number(ruleValue)
          break
        case 'lt':
          matches = Number(value) < Number(ruleValue)
          break
        case 'lte':
          matches = Number(value) <= Number(ruleValue)
          break
        case 'isnull':
          matches = value === null || value === undefined
          break
        case 'notnull':
          matches = value !== null && value !== undefined
          break
      }

      if (matches) {
        return rule.color
      }
    }
    return undefined
  }

  return (
    <Paper
      role="region"
      aria-label="Attribute Table Panel"
      aria-describedby="attribute-table-description"
      sx={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 1200,
        borderRadius: 0,
        boxShadow: 3,
        borderTop: 2,
        borderColor: 'primary.main',
      }}
    >
      <span id="attribute-table-description" style={{ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0,0,0,0)' }}>
        Table showing attributes of {layerName} layer with {totalRows} features. Use arrow keys to navigate, Enter to edit.
      </span>

      <Toolbar
        variant="dense"
        role="toolbar"
        aria-label="Table controls"
        sx={{
          bgcolor: 'primary.main',
          color: 'primary.contrastText',
          minHeight: 48,
          pr: 1,
        }}
      >
        <Typography variant="subtitle1" sx={{ flex: 1, fontWeight: 600 }} id="table-title">
          {layerName || 'Attribute Table'} ({totalRows} {totalRows === 1 ? 'feature' : 'features'})
        </Typography>

        <Stack direction="row" spacing={0.5}>
          {selectedFeatureIds.length > 0 && (
            <>
              <Tooltip title="Zoom to selected">
                <IconButton
                  size="small"
                  onClick={() => onZoomToSelection?.(selectedFeatureIds)}
                  sx={{ color: 'inherit' }}
                >
                  <ZoomInMapIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title="Flash selected">
                <IconButton
                  size="small"
                  onClick={() => {
                    selectedFeatureIds.forEach((id) => onFlashFeature?.(id))
                  }}
                  sx={{ color: 'inherit' }}
                >
                  <FlashOnIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title="Clear selection">
                <IconButton
                  size="small"
                  onClick={() => onFeatureSelectionChange?.([])}
                  sx={{ color: 'inherit' }}
                >
                  <ClearIcon />
                </IconButton>
              </Tooltip>
              <Box sx={{ borderLeft: 1, borderColor: 'rgba(255,255,255,0.3)', height: 24, alignSelf: 'center', mx: 0.5 }} />
            </>
          )}
          <Tooltip title="Select columns">
            <IconButton
              size="small"
              onClick={(e) => setColumnMenuAnchor(e.currentTarget)}
              sx={{ color: 'inherit' }}
            >
              <ViewColumnIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="Toggle filters">
            <IconButton
              size="small"
              onClick={() => setShowFilters(!showFilters)}
              sx={{ color: 'inherit' }}
            >
              <FilterListIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title={collapsed ? 'Expand' : 'Collapse'}>
            <IconButton
              size="small"
              onClick={() => setCollapsed(!collapsed)}
              sx={{ color: 'inherit' }}
            >
              {collapsed ? <UnfoldMoreIcon /> : <UnfoldLessIcon />}
            </IconButton>
          </Tooltip>
          <Tooltip title="Close">
            <IconButton
              size="small"
              onClick={onClose}
              sx={{ color: 'inherit' }}
            >
              <CloseIcon />
            </IconButton>
          </Tooltip>
        </Stack>
      </Toolbar>

      {!collapsed && (
        <Box sx={{ height: 400, display: 'flex', flexDirection: 'column' }}>
          {(error || localError) && (
            <Box sx={{ px: 2, pt: 1 }}>
              {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
              {localError && <Alert severity="error">{localError}</Alert>}
            </Box>
          )}

          {showFilters && onQueryRows && (
            <Box sx={{ px: 2, py: 1.5, bgcolor: 'grey.50', borderBottom: 1, borderColor: 'divider' }}>
              <Stack direction="row" spacing={1} flexWrap="wrap">
                <TextField
                  label="Filter field"
                  value={filterField}
                  onChange={(e) => setFilterField(e.target.value)}
                  size="small"
                  select
                  sx={{ minWidth: 150 }}
                >
                  <MenuItem value="">None</MenuItem>
                  {fields.map((field) => (
                    <MenuItem key={field.id} value={field.name}>
                      {field.alias || field.name}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  label="Operator"
                  value={filterOp}
                  onChange={(e) => setFilterOp(e.target.value as FilterOperator)}
                  size="small"
                  select
                  sx={{ minWidth: 130 }}
                >
                  <MenuItem value="contains">contains</MenuItem>
                  <MenuItem value="eq">equals</MenuItem>
                  <MenuItem value="neq">not equals</MenuItem>
                  <MenuItem value="startswith">starts with</MenuItem>
                  <MenuItem value="endswith">ends with</MenuItem>
                  <MenuItem value="gt">&gt;</MenuItem>
                  <MenuItem value="gte">≥</MenuItem>
                  <MenuItem value="lt">&lt;</MenuItem>
                  <MenuItem value="lte">≤</MenuItem>
                </TextField>
                <TextField
                  label="Value"
                  value={filterValue}
                  onChange={(e) => setFilterValue(e.target.value)}
                  size="small"
                  sx={{ minWidth: 150, flex: 1 }}
                />
                <Button
                  variant="outlined"
                  startIcon={<RefreshIcon />}
                  size="small"
                >
                  Apply
                </Button>
              </Stack>
            </Box>
          )}

          {/* Phase 2: Selection Tools Toolbar */}
          <Box sx={{ px: 2, py: 1, bgcolor: 'grey.100', borderBottom: 1, borderColor: 'divider' }}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
              <Tooltip title="Select all features">
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<SelectAllIcon />}
                  onClick={handleSelectAll}
                  sx={{ minWidth: 'auto' }}
                >
                  Select All
                </Button>
              </Tooltip>

              <Tooltip title="Clear selection">
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<DeselectIcon />}
                  onClick={handleClearSelection}
                  disabled={selectedFeatureIds.length === 0}
                  sx={{ minWidth: 'auto' }}
                >
                  Clear
                </Button>
              </Tooltip>

              <Tooltip title="Switch selection (invert)">
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<SwapHorizIcon />}
                  onClick={handleSwitchSelection}
                  sx={{ minWidth: 'auto' }}
                >
                  Switch
                </Button>
              </Tooltip>

              <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

              <Typography variant="caption" color="text.secondary" sx={{ px: 1 }}>
                Mode:
              </Typography>
              <ToggleButtonGroup
                value={selectionMode}
                exclusive
                onChange={(_, value) => value && setSelectionMode(value)}
                size="small"
              >
                <ToggleButton value="new">
                  <Tooltip title="New selection">
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      New
                    </Box>
                  </Tooltip>
                </ToggleButton>
                <ToggleButton value="add">
                  <Tooltip title="Add to selection">
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <AddBoxIcon fontSize="small" />
                      Add
                    </Box>
                  </Tooltip>
                </ToggleButton>
                <ToggleButton value="remove">
                  <Tooltip title="Remove from selection">
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <IndeterminateCheckBoxIcon fontSize="small" />
                      Remove
                    </Box>
                  </Tooltip>
                </ToggleButton>
              </ToggleButtonGroup>

              <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

              <Tooltip title="Select by attributes (SQL query)">
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<SearchIcon />}
                  onClick={() => setShowQueryBuilder(true)}
                >
                  Query
                </Button>
              </Tooltip>

              <Tooltip title="Show selection statistics">
                <Button
                  size="small"
                  variant={showSelectionStats ? 'contained' : 'outlined'}
                  startIcon={<BarChartIcon />}
                  onClick={() => setShowSelectionStats(!showSelectionStats)}
                  disabled={selectedFeatureIds.length === 0}
                >
                  Stats
                </Button>
              </Tooltip>

              <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

              <Tooltip title="Field Calculator">
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<CalculateIcon />}
                  onClick={() => setShowFieldCalculator(true)}
                >
                  Calculate
                </Button>
              </Tooltip>

              <Tooltip title="Conditional Formatting">
                <Button
                  size="small"
                  variant={formatRules.length > 0 ? 'contained' : 'outlined'}
                  startIcon={<FormatPaintIcon />}
                  onClick={() => setShowConditionalFormat(true)}
                >
                  Format ({formatRules.length})
                </Button>
              </Tooltip>

              <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

              <Tooltip title="Multi-column sort">
                <Button
                  size="small"
                  variant={sortColumns.length > 0 ? 'contained' : 'outlined'}
                  startIcon={<SortIcon />}
                  onClick={() => setShowSortDialog(true)}
                >
                  Sort ({sortColumns.length})
                </Button>
              </Tooltip>

              <Tooltip title="Export data">
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<DownloadIcon />}
                  onClick={(e) => setExportMenuAnchor(e.currentTarget)}
                >
                  Export
                </Button>
              </Tooltip>

              {selectedFeatureIds.length > 0 && (
                <Chip
                  label={`${selectedFeatureIds.length} selected`}
                  color="primary"
                  size="small"
                  sx={{ ml: 'auto' }}
                />
              )}
            </Stack>
          </Box>

          {/* Selection Statistics Panel */}
          {showSelectionStats && selectionStats && (
            <Box sx={{ px: 2, py: 1.5, bgcolor: 'info.light', borderBottom: 1, borderColor: 'divider' }}>
              <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                Selection Summary
              </Typography>
              <Typography variant="body2" gutterBottom>
                Selected: {selectionStats.count} of {totalRows} features
              </Typography>
              {Object.keys(selectionStats.fields).length > 0 && (
                <Box sx={{ mt: 1 }}>
                  <Typography variant="caption" fontWeight={600} color="text.secondary">
                    Numeric Field Statistics:
                  </Typography>
                  <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                    {Object.entries(selectionStats.fields).map(([fieldName, stats]) => {
                      const field = fields.find((f) => f.name === fieldName)
                      return (
                        <Box key={fieldName} sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                          <Typography variant="body2" fontWeight={600} sx={{ minWidth: 100 }}>
                            {field?.alias || fieldName}:
                          </Typography>
                          <Typography variant="body2" sx={{ fontSize: '0.85rem' }}>
                            Sum: {stats.sum.toLocaleString()} | Avg: {stats.avg.toFixed(2)} | Min: {stats.min.toLocaleString()} | Max: {stats.max.toLocaleString()}
                          </Typography>
                        </Box>
                      )
                    })}
                  </Stack>
                </Box>
              )}
            </Box>
          )}

          <Box sx={{ flex: 1, overflow: 'auto', display: 'flex' }}>
            <TableContainer sx={{ flex: 1 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox" sx={{ bgcolor: 'grey.100', fontWeight: 700 }}>
                      <Checkbox
                        checked={paginatedRows.length > 0 && selectedFeatureIds.length === paginatedRows.length}
                        indeterminate={selectedFeatureIds.length > 0 && selectedFeatureIds.length < paginatedRows.length}
                        onChange={(e) => handleSelectAllCurrentRows(e.target.checked)}
                        size="small"
                      />
                    </TableCell>
                    <TableCell
                      sx={{
                        bgcolor: 'grey.100',
                        fontWeight: 700,
                        width: 80,
                        maxWidth: 80,
                        padding: '6px 8px',
                      }}
                    >
                      FID
                    </TableCell>
                    {columns.map((column) => (
                      <TableCell
                        key={column.id}
                        sx={{
                          bgcolor: 'grey.100',
                          fontWeight: 700,
                          minWidth: 120,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          <Typography variant="body2" fontWeight={700}>
                            {column.alias}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            ({column.type})
                          </Typography>
                        </Stack>
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {paginatedRows.map((row) => {
                    const selected = row.id === selectedFeatureId
                    const checked = selectedFeatureIds.includes(row.id)
                    const props = editableProperties(row.properties)
                    const bgColor = getRowBackgroundColor(props)
                    return (
                      <TableRow
                        key={row.id}
                        hover
                        selected={selected}
                        onClick={() => {
                          handleSelect(row.id)
                          onFlashFeature?.(row.id)
                        }}
                        onDoubleClick={() => {
                          onZoomToFeature?.(row.id)
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          setContextMenu({
                            mouseX: e.clientX,
                            mouseY: e.clientY,
                            featureId: row.id,
                          })
                        }}
                        sx={{
                          cursor: 'pointer',
                          bgcolor: bgColor,
                          '&.Mui-selected': {
                            bgcolor: 'primary.light',
                            '&:hover': {
                              bgcolor: 'primary.light',
                            },
                          },
                          '&:hover': bgColor ? {
                            bgcolor: bgColor,
                            filter: 'brightness(0.95)',
                          } : undefined,
                        }}
                      >
                        <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={checked}
                            onChange={(e) => toggleSelectRow(row.id, e.target.checked)}
                            size="small"
                          />
                        </TableCell>
                        <TableCell
                          sx={{
                            fontFamily: 'monospace',
                            fontSize: '0.8rem',
                            width: 80,
                            maxWidth: 80,
                            padding: '6px 8px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={String(row.id || 'n/a')}
                        >
                          {row.id || 'n/a'}
                        </TableCell>
                        {columns.map((column) => (
                          <TableCell key={`${row.id}-${column.name}`}>
                            {displayValue(props[column.name])}
                          </TableCell>
                        ))}
                      </TableRow>
                    )
                  })}
                  {!paginatedRows.length && (
                    <TableRow>
                      <TableCell colSpan={columns.length + 2}>
                        <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 4 }}>
                          No features to display
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>

            {selectedRow && hasSchema && (
              <Paper
                elevation={0}
                sx={{
                  width: 360,
                  borderLeft: 2,
                  borderColor: 'divider',
                  overflow: 'auto',
                  bgcolor: 'grey.50',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'white' }}>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ p: 1.5, pb: 1 }}>
                    Feature {selectedRow.id}
                  </Typography>
                  <Tabs
                    value={editPanelTab || 'attributes'}
                    onChange={(_, value) => setEditPanelTab(value)}
                    variant="fullWidth"
                    sx={{ minHeight: 36 }}
                  >
                    <Tab label="Attributes" value="attributes" sx={{ minHeight: 36, py: 0.5 }} />
                    <Tab
                      label={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <LinkIcon fontSize="small" />
                          Related ({relationships.length})
                        </Box>
                      }
                      value="related"
                      sx={{ minHeight: 36, py: 0.5 }}
                      disabled={relationships.length === 0}
                    />
                  </Tabs>
                </Box>

                <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
                  {editPanelTab === 'attributes' && (
                    <>
                      <Stack spacing={1.5}>
                        {fields.slice(0, 10).map((field) => {
                          // Determine input type based on field type
                          let inputType = 'text'
                          if (field.field_type === 'integer' || field.field_type === 'double') {
                            inputType = 'number'
                          } else if (field.field_type === 'date') {
                            inputType = 'date'
                          } else if (field.field_type === 'datetime') {
                            inputType = 'datetime-local'
                          }

                          return (
                            <TextField
                              key={field.id}
                              label={field.alias || field.name}
                              value={typedDraft[field.name] ?? ''}
                              onChange={(e) => {
                                setTypedDraft((current) => ({ ...current, [field.name]: e.target.value }))
                              }}
                              size="small"
                              type={inputType}
                              fullWidth
                              placeholder={field.field_type}
                              InputLabelProps={{
                                shrink: inputType === 'date' || inputType === 'datetime-local' ? true : undefined,
                              }}
                            />
                          )
                        })}
                      </Stack>

                      <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
                        <Button
                          variant="contained"
                          size="small"
                          onClick={handleSave}
                          disabled={saving}
                          fullWidth
                        >
                          Save
                        </Button>
                        <Button
                          variant="outlined"
                          size="small"
                          onClick={() => setSelectedFeatureId(null)}
                          fullWidth
                        >
                          Cancel
                        </Button>
                      </Stack>
                    </>
                  )}

                  {editPanelTab === 'related' && (
                    <Box>
                      {loadingRelationships && (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                          <CircularProgress size={24} />
                        </Box>
                      )}

                      {!loadingRelationships && relationships.length === 0 && (
                        <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 4 }}>
                          No relationships defined for this layer
                        </Typography>
                      )}

                      {!loadingRelationships && relationships.map((rel) => {
                        const records = relatedRecords[rel.id] || []
                        const loading = loadingRelatedRecords[rel.id]

                        return (
                          <Accordion key={rel.id} defaultExpanded>
                            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                <LinkIcon fontSize="small" color="action" />
                                <Box sx={{ flex: 1 }}>
                                  <Typography variant="body2" fontWeight={600}>
                                    {rel.name || `Relationship ${rel.id.substring(0, 8)}`}
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary">
                                    {rel.cardinality.replace(/_/g, '-')} | {records.length} record{records.length !== 1 ? 's' : ''}
                                  </Typography>
                                </Box>
                              </Box>
                            </AccordionSummary>
                            <AccordionDetails>
                              {loading && (
                                <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                                  <CircularProgress size={20} />
                                </Box>
                              )}

                              {!loading && records.length === 0 && (
                                <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                                  No related records found
                                </Typography>
                              )}

                              {!loading && records.length > 0 && (
                                <Stack spacing={1}>
                                  {records.slice(0, 10).map((record) => (
                                    <Paper
                                      key={record.id}
                                      variant="outlined"
                                      sx={{
                                        p: 1,
                                        cursor: 'pointer',
                                        '&:hover': {
                                          bgcolor: 'action.hover',
                                        },
                                      }}
                                      onClick={() => {
                                        onNavigateToRelatedLayer?.(rel.destination_layer_id, record.id)
                                      }}
                                    >
                                      <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                                        ID: {record.id}
                                      </Typography>
                                      <Stack spacing={0.25}>
                                        {Object.entries(record.properties)
                                          .slice(0, 3)
                                          .map(([key, value]) => (
                                            <Typography key={key} variant="caption" color="text.secondary">
                                              {key}: {displayValue(value)}
                                            </Typography>
                                          ))}
                                      </Stack>
                                    </Paper>
                                  ))}
                                  {records.length > 10 && (
                                    <Typography variant="caption" color="text.secondary" sx={{ pt: 0.5 }}>
                                      ... and {records.length - 10} more
                                    </Typography>
                                  )}
                                </Stack>
                              )}
                            </AccordionDetails>
                          </Accordion>
                        )
                      })}
                    </Box>
                  )}
                </Box>
              </Paper>
            )}
          </Box>

          <Box sx={{ borderTop: 1, borderColor: 'divider', bgcolor: 'grey.50' }}>
            <TablePagination
              component="div"
              count={totalRows}
              page={page}
              onPageChange={(_, newPage) => setPage(newPage)}
              rowsPerPage={pageSize}
              onRowsPerPageChange={(e) => {
                setPageSize(parseInt(e.target.value, 10))
                setPage(0)
              }}
              rowsPerPageOptions={[10, 25, 50, 100]}
            />
          </Box>
        </Box>
      )}

      {/* Column visibility selector menu */}
      <Menu
        anchorEl={columnMenuAnchor}
        open={Boolean(columnMenuAnchor)}
        onClose={() => setColumnMenuAnchor(null)}
        PaperProps={{
          sx: { maxHeight: 400, width: 280 },
        }}
      >
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="subtitle2" fontWeight={700}>
            Select Columns
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {visibleColumns.size} of {allColumns.length} visible
          </Typography>
        </Box>
        <Divider />
        <MenuItem onClick={handleShowAllColumns} dense>
          <ListItemText primary="Show All" />
        </MenuItem>
        <MenuItem onClick={handleHideAllColumns} dense>
          <ListItemText primary="Hide All" />
        </MenuItem>
        <Divider />
        <Box sx={{ maxHeight: 250, overflow: 'auto' }}>
          {allColumns.map((column) => (
            <MenuItem
              key={column.id}
              onClick={() => handleToggleColumn(column.name)}
              dense
            >
              <FormControlLabel
                control={
                  <Checkbox
                    checked={visibleColumns.has(column.name)}
                    size="small"
                  />
                }
                label={
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <Typography variant="body2">{column.alias}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      ({column.type})
                    </Typography>
                  </Stack>
                }
                sx={{ width: '100%', m: 0 }}
              />
            </MenuItem>
          ))}
        </Box>
      </Menu>

      {/* Query Builder Dialog */}
      <Dialog
        open={showQueryBuilder}
        onClose={() => setShowQueryBuilder(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          Select by Attributes
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            Build a query to select features based on attribute values
          </Typography>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {queryConditions.map((condition, index) => (
              <Box key={index}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Select
                    value={condition.field}
                    onChange={(e) => {
                      const newConditions = [...queryConditions]
                      newConditions[index].field = e.target.value
                      setQueryConditions(newConditions)
                    }}
                    size="small"
                    displayEmpty
                    sx={{ minWidth: 180 }}
                  >
                    <MenuItem value="">Select field</MenuItem>
                    {fields.map((field) => (
                      <MenuItem key={field.id} value={field.name}>
                        {field.alias || field.name}
                      </MenuItem>
                    ))}
                  </Select>

                  <Select
                    value={condition.operator}
                    onChange={(e) => {
                      const newConditions = [...queryConditions]
                      newConditions[index].operator = e.target.value as FilterOperator
                      setQueryConditions(newConditions)
                    }}
                    size="small"
                    sx={{ minWidth: 130 }}
                  >
                    <MenuItem value="eq">equals</MenuItem>
                    <MenuItem value="neq">not equals</MenuItem>
                    <MenuItem value="contains">contains</MenuItem>
                    <MenuItem value="startswith">starts with</MenuItem>
                    <MenuItem value="endswith">ends with</MenuItem>
                    <MenuItem value="gt">&gt;</MenuItem>
                    <MenuItem value="gte">≥</MenuItem>
                    <MenuItem value="lt">&lt;</MenuItem>
                    <MenuItem value="lte">≤</MenuItem>
                    <MenuItem value="isnull">is null</MenuItem>
                    <MenuItem value="notnull">is not null</MenuItem>
                  </Select>

                  {condition.operator !== 'isnull' && condition.operator !== 'notnull' && (
                    <TextField
                      value={condition.value}
                      onChange={(e) => {
                        const newConditions = [...queryConditions]
                        newConditions[index].value = e.target.value
                        setQueryConditions(newConditions)
                      }}
                      size="small"
                      placeholder="Value"
                      sx={{ flex: 1 }}
                    />
                  )}

                  <IconButton
                    size="small"
                    onClick={() => {
                      setQueryConditions(queryConditions.filter((_, i) => i !== index))
                    }}
                    disabled={queryConditions.length === 1}
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Stack>

                {index < queryConditions.length - 1 && (
                  <Box sx={{ my: 1, ml: 2 }}>
                    <ToggleButtonGroup
                      value={condition.logicalOp}
                      exclusive
                      onChange={(_, value) => {
                        if (value) {
                          const newConditions = [...queryConditions]
                          newConditions[index].logicalOp = value
                          setQueryConditions(newConditions)
                        }
                      }}
                      size="small"
                    >
                      <ToggleButton value="AND">AND</ToggleButton>
                      <ToggleButton value="OR">OR</ToggleButton>
                    </ToggleButtonGroup>
                  </Box>
                )}
              </Box>
            ))}

            <Button
              variant="outlined"
              size="small"
              onClick={() => {
                setQueryConditions([
                  ...queryConditions,
                  { field: '', operator: 'eq', value: '', logicalOp: 'AND' },
                ])
              }}
              sx={{ alignSelf: 'flex-start' }}
            >
              Add Condition
            </Button>

            <Divider />

            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Selection Mode:
              </Typography>
              <ToggleButtonGroup
                value={selectionMode}
                exclusive
                onChange={(_, value) => value && setSelectionMode(value)}
                size="small"
              >
                <ToggleButton value="new">New Selection</ToggleButton>
                <ToggleButton value="add">Add to Selection</ToggleButton>
                <ToggleButton value="remove">Remove from Selection</ToggleButton>
              </ToggleButtonGroup>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowQueryBuilder(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleApplyQuery}
            disabled={queryConditions.every((c) => !c.field)}
          >
            Apply Query
          </Button>
        </DialogActions>
      </Dialog>

      {/* Field Calculator Dialog */}
      <Dialog
        open={showFieldCalculator}
        onClose={() => setShowFieldCalculator(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Field Calculator
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            Calculate values for a field using expressions
          </Typography>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Select
              value={calculatorField}
              onChange={(e) => setCalculatorField(e.target.value)}
              displayEmpty
              fullWidth
              size="small"
            >
              <MenuItem value="">Select target field</MenuItem>
              {fields.filter((f) => f.field_type === 'integer' || f.field_type === 'double' || f.field_type === 'string').map((field) => (
                <MenuItem key={field.id} value={field.name}>
                  {field.alias || field.name} ({field.field_type})
                </MenuItem>
              ))}
            </Select>

            <TextField
              label="Expression"
              value={calculatorExpression}
              onChange={(e) => setCalculatorExpression(e.target.value)}
              multiline
              rows={4}
              placeholder="Examples:&#10;- Math: Population * 1.5&#10;- Math: (Area / 1000000) * Price&#10;- String: str(FirstName) + ' ' + str(LastName)&#10;- Functions: round(Population / Area, 2)&#10;- Conditional: max(Value1, Value2)"
              fullWidth
              size="small"
              helperText="Use field names directly. Available functions: abs, max, min, round, int, float, str, len"
            />

            <Box>
              <Typography variant="caption" fontWeight={600} gutterBottom display="block">
                Available Fields:
              </Typography>
              <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ gap: 0.5 }}>
                {fields.slice(0, 8).map((field) => (
                  <Chip
                    key={field.id}
                    label={field.name}
                    size="small"
                    onClick={() => {
                      setCalculatorExpression((prev) => prev + field.name)
                    }}
                    sx={{ cursor: 'pointer' }}
                  />
                ))}
              </Stack>
            </Box>

            <FormControlLabel
              control={
                <Checkbox
                  checked={calculatorApplyToSelected}
                  onChange={(e) => setCalculatorApplyToSelected(e.target.checked)}
                />
              }
              label={`Apply to selected only (${selectedFeatureIds.length} features)`}
              disabled={selectedFeatureIds.length === 0}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowFieldCalculator(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={async () => {
              if (!onBulkUpdateRows) {
                alert('Bulk update not available')
                return
              }

              try {
                const payload: BulkUpdatePayload = {
                  feature_ids: calculatorApplyToSelected ? selectedFeatureIds : undefined,
                  calculator: {
                    type: 'expression',
                    field: calculatorField,
                    expression: calculatorExpression,
                  },
                }

                const result = await onBulkUpdateRows(payload)
                setShowFieldCalculator(false)
                setCalculatorField('')
                setCalculatorExpression('')
                setCalculatorApplyToSelected(false)

                alert(`Successfully calculated values for ${result.updated_count} feature(s)`)
              } catch (err) {
                const errorMsg = err instanceof Error ? err.message : String(err)
                alert(`Field calculator failed: ${errorMsg}`)
              }
            }}
            disabled={!calculatorField || !calculatorExpression || saving}
          >
            {saving ? 'Calculating...' : 'Calculate'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Conditional Formatting Dialog */}
      <Dialog
        open={showConditionalFormat}
        onClose={() => setShowConditionalFormat(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          Conditional Formatting
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            Color-code rows based on attribute values
          </Typography>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {formatRules.map((rule, index) => (
              <Paper key={index} variant="outlined" sx={{ p: 2 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Select
                    value={rule.field}
                    onChange={(e) => {
                      const newRules = [...formatRules]
                      newRules[index].field = e.target.value
                      setFormatRules(newRules)
                    }}
                    size="small"
                    displayEmpty
                    sx={{ minWidth: 150 }}
                  >
                    <MenuItem value="">Select field</MenuItem>
                    {fields.map((field) => (
                      <MenuItem key={field.id} value={field.name}>
                        {field.alias || field.name}
                      </MenuItem>
                    ))}
                  </Select>

                  <Select
                    value={rule.operator}
                    onChange={(e) => {
                      const newRules = [...formatRules]
                      newRules[index].operator = e.target.value as FilterOperator
                      setFormatRules(newRules)
                    }}
                    size="small"
                    sx={{ minWidth: 120 }}
                  >
                    <MenuItem value="eq">equals</MenuItem>
                    <MenuItem value="neq">not equals</MenuItem>
                    <MenuItem value="contains">contains</MenuItem>
                    <MenuItem value="gt">&gt;</MenuItem>
                    <MenuItem value="gte">≥</MenuItem>
                    <MenuItem value="lt">&lt;</MenuItem>
                    <MenuItem value="lte">≤</MenuItem>
                  </Select>

                  {rule.operator !== 'isnull' && rule.operator !== 'notnull' && (
                    <TextField
                      value={rule.value}
                      onChange={(e) => {
                        const newRules = [...formatRules]
                        newRules[index].value = e.target.value
                        setFormatRules(newRules)
                      }}
                      size="small"
                      placeholder="Value"
                      sx={{ flex: 1 }}
                    />
                  )}

                  <TextField
                    type="color"
                    value={rule.color}
                    onChange={(e) => {
                      const newRules = [...formatRules]
                      newRules[index].color = e.target.value
                      setFormatRules(newRules)
                    }}
                    size="small"
                    sx={{ width: 80 }}
                  />

                  <IconButton
                    size="small"
                    onClick={() => {
                      setFormatRules(formatRules.filter((_, i) => i !== index))
                    }}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Stack>
              </Paper>
            ))}

            <Button
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={() => {
                setFormatRules([...formatRules, { field: '', operator: 'eq', value: '', color: '#ffeb3b' }])
              }}
              sx={{ alignSelf: 'flex-start' }}
            >
              Add Rule
            </Button>

            <Box>
              <Typography variant="caption" color="text.secondary">
                Rules are applied in order. First matching rule wins.
              </Typography>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setFormatRules([])
            setShowConditionalFormat(false)
          }}>
            Clear All
          </Button>
          <Button onClick={() => setShowConditionalFormat(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Multi-Column Sort Dialog */}
      <Dialog
        open={showSortDialog}
        onClose={() => setShowSortDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Multi-Column Sort
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            Sort by multiple columns in sequence
          </Typography>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {sortColumns.map((sortCol, index) => (
              <Paper key={index} variant="outlined" sx={{ p: 1.5 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="caption" color="text.secondary" sx={{ minWidth: 20 }}>
                    {index + 1}.
                  </Typography>
                  <Select
                    value={sortCol.field}
                    onChange={(e) => {
                      const newSorts = [...sortColumns]
                      newSorts[index].field = e.target.value
                      setSortColumns(newSorts)
                    }}
                    size="small"
                    displayEmpty
                    sx={{ flex: 1 }}
                  >
                    <MenuItem value="">Select field</MenuItem>
                    {fields.map((field) => (
                      <MenuItem key={field.id} value={field.name}>
                        {field.alias || field.name}
                      </MenuItem>
                    ))}
                  </Select>

                  <ToggleButtonGroup
                    value={sortCol.direction}
                    exclusive
                    onChange={(_, value) => {
                      if (value) {
                        const newSorts = [...sortColumns]
                        newSorts[index].direction = value
                        setSortColumns(newSorts)
                      }
                    }}
                    size="small"
                  >
                    <ToggleButton value="asc">
                      <Tooltip title="Ascending">
                        <ArrowUpwardIcon fontSize="small" />
                      </Tooltip>
                    </ToggleButton>
                    <ToggleButton value="desc">
                      <Tooltip title="Descending">
                        <ArrowDownwardIcon fontSize="small" />
                      </Tooltip>
                    </ToggleButton>
                  </ToggleButtonGroup>

                  <IconButton
                    size="small"
                    onClick={() => {
                      setSortColumns(sortColumns.filter((_, i) => i !== index))
                    }}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Stack>
              </Paper>
            ))}

            <Button
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={() => {
                setSortColumns([...sortColumns, { field: '', direction: 'asc' }])
              }}
              sx={{ alignSelf: 'flex-start' }}
            >
              Add Sort Level
            </Button>

            <Box>
              <Typography variant="caption" color="text.secondary">
                Rows are sorted by the first level, then by subsequent levels for tied values.
              </Typography>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setSortColumns([])
            setShowSortDialog(false)
          }}>
            Clear All
          </Button>
          <Button onClick={() => setShowSortDialog(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Context Menu */}
      <Menu
        open={contextMenu !== null}
        onClose={() => setContextMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu !== null
            ? { top: contextMenu.mouseY, left: contextMenu.mouseX }
            : undefined
        }
      >
        <MenuItem
          onClick={() => {
            if (contextMenu) {
              onZoomToFeature?.(contextMenu.featureId)
              setContextMenu(null)
            }
          }}
        >
          <ZoomInMapIcon fontSize="small" sx={{ mr: 1 }} />
          Zoom to Feature
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (contextMenu) {
              onFlashFeature?.(contextMenu.featureId)
              setContextMenu(null)
            }
          }}
        >
          <FlashOnIcon fontSize="small" sx={{ mr: 1 }} />
          Flash Feature
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => {
            if (contextMenu) {
              handleSelect(contextMenu.featureId)
              setContextMenu(null)
            }
          }}
        >
          Edit Attributes
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (contextMenu) {
              const isSelected = selectedFeatureIds.includes(contextMenu.featureId)
              toggleSelectRow(contextMenu.featureId, !isSelected)
              setContextMenu(null)
            }
          }}
        >
          {contextMenu && selectedFeatureIds.includes(contextMenu.featureId) ? 'Deselect' : 'Select'}
        </MenuItem>
      </Menu>

      {/* Export Menu */}
      <Menu
        anchorEl={exportMenuAnchor}
        open={Boolean(exportMenuAnchor)}
        onClose={() => setExportMenuAnchor(null)}
      >
        <MenuItem onClick={exportToCSV}>
          <TableChartIcon fontSize="small" sx={{ mr: 1 }} />
          Export to CSV
          <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
            ({selectedFeatureIds.length > 0 ? `${selectedFeatureIds.length} selected` : `${rows.length} total`})
          </Typography>
        </MenuItem>
        <MenuItem onClick={exportToJSON}>
          <DownloadIcon fontSize="small" sx={{ mr: 1 }} />
          Export to JSON
          <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
            ({selectedFeatureIds.length > 0 ? `${selectedFeatureIds.length} selected` : `${rows.length} total`})
          </Typography>
        </MenuItem>
        <MenuItem onClick={exportToExcel}>
          <TableChartIcon fontSize="small" sx={{ mr: 1 }} />
          Export to Excel
          <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
            ({selectedFeatureIds.length > 0 ? `${selectedFeatureIds.length} selected` : `${rows.length} total`})
          </Typography>
        </MenuItem>
      </Menu>
    </Paper>
  )
}
