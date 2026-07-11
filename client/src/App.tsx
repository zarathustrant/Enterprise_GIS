import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Geometry } from 'geojson'
import {
  type AlertColor,
  Alert,
  AppBar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  IconButton,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  InputAdornment,
  Paper,
  Snackbar,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import MenuIcon from '@mui/icons-material/Menu'
import LayersIcon from '@mui/icons-material/Layers'
import LoginIcon from '@mui/icons-material/Login'
import LogoutIcon from '@mui/icons-material/Logout'
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import DownloadIcon from '@mui/icons-material/Download'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import ZoomOutMapIcon from '@mui/icons-material/ZoomOutMap'
import PaletteIcon from '@mui/icons-material/Palette'
import TableViewIcon from '@mui/icons-material/TableView'
import ViewColumnIcon from '@mui/icons-material/ViewColumn'
import EditLocationAltIcon from '@mui/icons-material/EditLocationAlt'
import ScienceIcon from '@mui/icons-material/Science'
import SearchIcon from '@mui/icons-material/Search'
import StraightenIcon from '@mui/icons-material/Straighten'
import SquareFootIcon from '@mui/icons-material/SquareFoot'
import ClearIcon from '@mui/icons-material/Clear'
import BookmarkAddedIcon from '@mui/icons-material/BookmarkAdded'
import WorkHistoryIcon from '@mui/icons-material/WorkHistory'
import SettingsSuggestIcon from '@mui/icons-material/SettingsSuggest'
import ViewSidebarIcon from '@mui/icons-material/ViewSidebar'
import AccountTreeIcon from '@mui/icons-material/AccountTree'
import UndoIcon from '@mui/icons-material/Undo'
import RedoIcon from '@mui/icons-material/Redo'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import CircleOutlinedIcon from '@mui/icons-material/CircleOutlined'
import RectangleOutlinedIcon from '@mui/icons-material/RectangleOutlined'
import CropSquareIcon from '@mui/icons-material/CropSquare'
import ChangeHistoryIcon from '@mui/icons-material/ChangeHistory'
import HexagonOutlinedIcon from '@mui/icons-material/HexagonOutlined'
import StarBorderIcon from '@mui/icons-material/StarBorder'
import PentagonOutlinedIcon from '@mui/icons-material/PentagonOutlined'
import type { UseQueryResult } from '@tanstack/react-query'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  abandonEditSession,
  bulkUpdateFeatures,
  createEditSession,
  createLayerJoin,
  createLayerRelationship,
  createLayerView,
  createShareLink,
  createView,
  createFeature,
  splitFeatures,
  createLayerDomain,
  createLayerField,
  createLayer as createLayerApi,
  createUtilityNetworkEdge,
  createUtilityNetworkNode,
  createUtilityNetwork,
  createUtilityNetworkServicePoint,
  deleteLayerJoin,
  deleteLayerRelationship,
  deleteLayerDomain,
  deleteLayerView,
  deleteShareLink,
  deleteView,
  deleteLayerField,
  deleteFeatureWithSession,
  deleteLayer as deleteLayerApi,
  exportLayerGeoJson,
  exportFeatureRows,
  fetchAsyncJobs,
  fetchCurrentUser,
  fetchDistinctFeatureValues,
  fetchFeatureStatistics,
  fetchEditSessionChanges,
  fetchEditSessions,
  // fetchFeatureHistory,
  fetchLayerJoins,
  fetchLayerRelationships,
  fetchLayerViews,
  fetchLayerDomains,
  fetchLayerFields,
  fetchLayerFeatures,
  fetchLayers,
  fetchShareLinks,
  fetchUtilityNetworkEdges,
  fetchUtilityNetworkNodes,
  fetchUtilityNetworks,
  fetchUtilityNetworkServicePoints,
  fetchUtilityNetworkSummary,
  fetchViews,
  queryLayerFeatures,
  selectFeatures,
  // rollbackFeature,
  runBufferAnalysis,
  runIntersectAnalysis,
  runWithinAnalysis,
  sendTelemetry,
  submitEditSession,
  publishEditSession,
  updateLayerOrdering,
  updateLayerDomain,
  updateLayerField,
  updateFeature,
  updateLayer,
  uploadLayerGeoJson,
} from './api/services'
import { ApiError } from './api/http'
import { AuthDialog } from './components/AuthDialog'
import { CreateLayerDialog } from './components/CreateLayerDialog'
import type { AnalysisJobState, AnalysisTab } from './components/AnalysisDialog'
import type {
  AdvancedEditMode,
  AdvancedEditOptions,
  EditCommand,
  EditState,
  EditUiState,
  MapViewportState,
  MeasurementMode,
  MeasurementSummary,
} from './components/MapCanvas'
import { ActivityFeed } from './components/ActivityFeed'
import type { ActivityEvent, ActivityLevel } from './components/ActivityFeed'
import { UtilityModePanel } from './components/UtilityModePanel'
import { useAuthStore } from './store/auth'
import type { LegendMode } from './utils/legend'
import {
  inferPolygonPatternLibraryFromName,
  normalizePolygonPatternLibrary,
  resolvePolygonPatternName,
} from './utils/polygonPatterns'
import type {
  AsyncJob,
  AuthResponse,
  EditSession,
  EditSessionChange,
  FeatureCollection,
  Layer,
  LayerDomain,
  LayerField,
  LayerJoin,
  LayerRelationship,
  LayerShareLink,
  LayerStyleDraft,
  LayerView,
  MapView,
  UtilityNetwork,
  UtilityNetworkSummary,
} from './types/gis'
import type {
  BulkUpdatePayload,
  CreateUtilityEdgePayload,
  CreateUtilityNetworkPayload,
  CreateUtilityNodePayload,
  CreateUtilityServicePointPayload,
  CreateEditSessionPayload,
  CreateLayerJoinPayload,
  CreateLayerRelationshipPayload,
  CreateLayerViewPayload,
  CreateShareLinkPayload,
  FeaturesQueryPayload,
  FeaturesQueryResponse,
  CreateLayerDomainPayload,
  CreateLayerFieldPayload,
  CreateLayerPayload,
  UpdateLayerDomainPayload,
  UpdateLayerFieldPayload,
} from './api/services'

const UploadLayerDialog = lazy(async () => {
  const module = await import('./components/UploadLayerDialog')
  return { default: module.UploadLayerDialog }
})

const LayerStyleDialog = lazy(async () => {
  const module = await import('./components/LayerStyleDialog')
  return { default: module.LayerStyleDialog }
})

const AttributeTablePanel = lazy(async () => {
  const module = await import('./components/AttributeTablePanel')
  return { default: module.AttributeTablePanel }
})

const FieldsManagerDialog = lazy(async () => {
  const module = await import('./components/FieldsManagerDialog')
  return { default: module.FieldsManagerDialog }
})

const AnalysisDialog = lazy(async () => {
  const module = await import('./components/AnalysisDialog')
  return { default: module.AnalysisDialog }
})

const LayerLegend = lazy(async () => {
  const module = await import('./components/LayerLegend')
  return { default: module.LayerLegend }
})

const MapCanvas = lazy(async () => {
  const module = await import('./components/MapCanvas')
  return { default: module.MapCanvas }
})

const LayerOpsDialog = lazy(async () => {
  const module = await import('./components/LayerOpsDialog')
  return { default: module.LayerOpsDialog }
})

const MapViewsDialog = lazy(async () => {
  const module = await import('./components/MapViewsDialog')
  return { default: module.MapViewsDialog }
})

const JobsDialog = lazy(async () => {
  const module = await import('./components/JobsDialog')
  return { default: module.JobsDialog }
})

interface SearchResult {
  lat: string
  lon: string
  display_name: string
}

interface FeatureConflictState {
  layerId: string
  featureId: string
  geometry?: Geometry
  properties?: Record<string, unknown>
  serverVersion?: number
}

const drawerWidth = 360
const EMPTY_LAYERS: Layer[] = []
const APP_MODE_STORAGE_KEY = 'enterprise-gis-app-mode-v1'
const LEGEND_MODE_STORAGE_KEY = 'enterprise-gis-legend-mode-v1'
const WORK_MODE_STORAGE_KEY = 'enterprise-gis-work-mode-v1'
const EDIT_TOOL_TAB_STORAGE_KEY = 'enterprise-gis-edit-tool-tab-v1'
const EDIT_TOOL_FAVORITES_STORAGE_KEY = 'enterprise-gis-edit-tool-favorites-v1'
type AppMode = 'standard' | 'utilities'
type EditToolTab = 'all' | 'my'
type EditToolGroup = 'Alignment' | 'Reshape' | 'Construction'
const EDIT_TOOL_GROUP_ORDER: EditToolGroup[] = ['Alignment', 'Reshape', 'Construction']
const DEFAULT_ADVANCED_EDIT_OPTIONS: AdvancedEditOptions = {
  rotateDegrees: 15,
  scaleFactor: 1,
  reshapeStrength: 0.45,
  gridSizeMeters: 2,
  alignTarget: 'center-x',
}

const ADVANCED_EDIT_MODE_OPTIONS: Array<{
  value: AdvancedEditMode
  label: string
  helper: string
  group: EditToolGroup
  keywords: string[]
}> = [
  {
    value: 'align',
    label: 'Align Features',
    helper: 'Align selected features by side or center.',
    group: 'Alignment',
    keywords: ['align', 'edge', 'center', 'arrange'],
  },
  {
    value: 'rotate-scale',
    label: 'Rotate / Scale',
    helper: 'Drag the orange handle above selection to rotate; hold Shift while dragging to scale.',
    group: 'Alignment',
    keywords: ['rotate', 'scale', 'transform'],
  },
  {
    value: 'reshape',
    label: 'Reshape',
    helper: 'Edit vertices directly on-map; Apply runs smoothing/generalization.',
    group: 'Reshape',
    keywords: ['reshape', 'edit vertices', 'generalize', 'smooth'],
  },
  {
    value: 'split',
    label: 'Split',
    helper: 'Select features, then draw a split line directly on the map.',
    group: 'Reshape',
    keywords: ['split', 'cut', 'line intersection'],
  },
  {
    value: 'trace',
    label: 'Trace',
    helper: 'Copy geometry from last selected feature into the first one.',
    group: 'Construction',
    keywords: ['trace', 'copy geometry', 'follow edge'],
  },
  {
    value: 'rectangular-constraints',
    label: 'Rectangular Constraints',
    helper: 'Force selected polygons/lines into rectilinear form.',
    group: 'Construction',
    keywords: ['rectangular', 'orthogonal', 'constraints'],
  },
  {
    value: 'grid-lock',
    label: 'Grid Lock',
    helper: 'Snap selected (and live edits) to a configurable grid.',
    group: 'Construction',
    keywords: ['grid', 'snap', 'lock'],
  },
]

const ALIGN_TARGET_OPTIONS: Array<{ value: AdvancedEditOptions['alignTarget']; label: string }> = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'top', label: 'Top' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'center-x', label: 'Center X' },
  { value: 'center-y', label: 'Center Y' },
]

function readStoredLegendMode(): LegendMode {
  if (typeof window === 'undefined') {
    return 'professional'
  }
  const raw = window.localStorage.getItem(LEGEND_MODE_STORAGE_KEY)
  if (raw === 'professional' || raw === 'minimal' || raw === 'analyst' || raw === 'interactive' || raw === 'presentation') {
    return raw
  }
  return 'professional'
}

function readStoredAppMode(): AppMode {
  if (typeof window === 'undefined') {
    return 'standard'
  }
  const raw = window.localStorage.getItem(APP_MODE_STORAGE_KEY)
  return raw === 'utilities' ? 'utilities' : 'standard'
}

function readStoredWorkMode(): boolean {
  if (typeof window === 'undefined') {
    return true
  }
  const raw = window.localStorage.getItem(WORK_MODE_STORAGE_KEY)
  if (raw === 'true') {
    return true
  }
  if (raw === 'false') {
    return false
  }
  return true
}

function readStoredEditToolTab(): EditToolTab {
  if (typeof window === 'undefined') {
    return 'all'
  }
  const raw = window.localStorage.getItem(EDIT_TOOL_TAB_STORAGE_KEY)
  return raw === 'my' ? 'my' : 'all'
}

function readStoredFavoriteEditTools(): AdvancedEditMode[] {
  if (typeof window === 'undefined') {
    return ['align', 'reshape', 'split']
  }
  const raw = window.localStorage.getItem(EDIT_TOOL_FAVORITES_STORAGE_KEY)
  if (!raw) {
    return ['align', 'reshape', 'split']
  }

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return ['align', 'reshape', 'split']
    }
    const allowed = new Set(ADVANCED_EDIT_MODE_OPTIONS.map((option) => option.value))
    return parsed
      .map((value) => (typeof value === 'string' ? value : null))
      .filter((value): value is AdvancedEditMode => Boolean(value && allowed.has(value as AdvancedEditMode)))
  } catch {
    return ['align', 'reshape', 'split']
  }
}

function layerSubtitle(layer: Layer): string {
  const privacy = layer.is_public ? 'Public' : 'Private'
  return layer.geometry_type ? `${privacy} · ${layer.geometry_type}` : privacy
}

function canManageLayer(userName: string | null, layer: Layer): boolean {
  if (!userName) {
    return false
  }

  return layer.created_by === userName
}

const DEFAULT_STYLE_DRAFT: LayerStyleDraft = {
  rendererType: 'simple',
  color: '#136f63',
  opacity: 0.8,
  strokeColor: '#0f4c5c',
  strokeWidth: 2,
  lineCasingEnabled: false,
  lineCasingColor: '#ffffff',
  lineCasingWidth: 2,
  scaleOverrides: [],
  symbolLevel: 0,
  lineSymbolLayers: [],
  lineMarkerEnabled: false,
  lineMarkerLibrary: 'maki',
  lineMarkerIcon: 'arrow',
  lineMarkerSpacingMeters: 500,
  lineMarkerSize: 18,
  lineMarkerRotateWithLine: true,
  polygonMarkerEnabled: false,
  polygonMarkerPlacement: 'interior',
  polygonMarkerLibrary: 'maki',
  polygonMarkerIcon: 'marker',
  polygonMarkerSize: 18,
  legendPatchShape: 'auto',
  pointRadius: 6,
  lineDashArray: [1, 0],
  pointShape: 'circle',
  iconLibrary: 'maki',
  iconifyPrefix: 'maki',
  iconName: 'marker',
  iconField: '',
  iconSize: 1,
  iconRotation: 0,
  iconRotationField: '',
  iconAllowOverlap: true,
  labelField: '',
  labelColor: '#1b1f24',
  labelSize: 14,
  labelHaloColor: '#ffffff',
  labelHaloWidth: 1,
  labelMinZoom: 0,
  labelMaxZoom: 24,
  labelPriorityField: '',
  labelAnchor: 'center',
  labelMaxCount: 2000,
  labelCollisionEnabled: true,
  labelWrapLength: 0,
  labelMaxLength: 0,
  labelClasses: [],
  labelRepeatDistanceMeters: 0,
  labelRotateWithLine: true,
  labelPolygonFitEnabled: false,
  labelTextExpression: '',
  sizeField: '',
  sizeMin: 4,
  sizeMax: 16,
  opacityField: '',
  opacityMin: 0.2,
  opacityMax: 1,
  polygonPatternLibrary: 'builtin',
  polygonPattern: 'solid',
  polygonPatternColor: '#0f4c5c',
  polygonPatternOpacity: 0.65,
  polygonPatternScale: 1,
  fillColorExpression: '',
  lineColorExpression: '',
  pointRadiusExpression: '',
  opacityExpression: '',
  topologyNoOverlap: false,
  snapEnabled: false,
  snapToleranceMeters: 8,
  uniqueValueField: '',
  uniqueValueStops: [],
  uniqueDefaultColor: '#3f88c5',
  uniqueDefaultOpacity: 0.75,
  uniqueNullColor: '#9ca3af',
  uniqueNullOpacity: 0.75,
  classBreakField: '',
  classBreakStops: [],
  classBreakDefaultColor: '#3f88c5',
  classBreakDefaultOpacity: 0.75,
  classBreakNullColor: '#9ca3af',
  classBreakNullOpacity: 0.75,
}

function readStyle(layer: Layer): LayerStyleDraft {
  const style = layer.style as Record<string, unknown> | null
  const rendererType =
    style?.rendererType === 'uniqueValue' || style?.rendererType === 'classBreaks'
      ? style.rendererType
      : 'simple'

  const uniqueValueStops = Array.isArray(style?.uniqueValueStops)
    ? style.uniqueValueStops
      .map((stop) => {
        if (!stop || typeof stop !== 'object') {
          return null
        }
        const value = (stop as { value?: unknown }).value
        const color = (stop as { color?: unknown }).color
        const opacity = (stop as { opacity?: unknown }).opacity
        if (value == null || typeof color !== 'string') {
          return null
        }
        return {
          value: String(value),
          color,
          opacity: typeof opacity === 'number' ? Math.max(0, Math.min(1, opacity)) : 0.75,
        }
      })
      .filter((stop): stop is { value: string; color: string; opacity: number } => Boolean(stop))
    : []

  const classBreakStops = Array.isArray(style?.classBreakStops)
    ? style.classBreakStops
      .map((stop) => {
        if (!stop || typeof stop !== 'object') {
          return null
        }
        const min = (stop as { min?: unknown }).min
        const max = (stop as { max?: unknown }).max
        const color = (stop as { color?: unknown }).color
        const opacity = (stop as { opacity?: unknown }).opacity
        if (typeof min !== 'number' || typeof max !== 'number' || typeof color !== 'string') {
          return null
        }
        return {
          min,
          max,
          color,
          opacity: typeof opacity === 'number' ? Math.max(0, Math.min(1, opacity)) : 0.75,
        }
      })
      .filter((stop): stop is { min: number; max: number; color: string; opacity: number } => Boolean(stop))
    : []

  const scaleOverrides = Array.isArray(style?.scaleOverrides)
    ? style.scaleOverrides
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null
        }
        const rule = item as Record<string, unknown>
        if (
          typeof rule.minZoom !== 'number' ||
          typeof rule.maxZoom !== 'number' ||
          typeof rule.color !== 'string'
        ) {
          return null
        }
        return {
          minZoom: Math.max(0, Math.min(24, rule.minZoom)),
          maxZoom: Math.max(0, Math.min(24, rule.maxZoom)),
          color: rule.color,
          opacity: typeof rule.opacity === 'number' ? Math.max(0, Math.min(1, rule.opacity)) : 0.8,
          strokeWidth: typeof rule.strokeWidth === 'number' ? Math.max(1, rule.strokeWidth) : 2,
          pointRadius: typeof rule.pointRadius === 'number' ? Math.max(1, rule.pointRadius) : 6,
        }
      })
      .filter((item): item is LayerStyleDraft['scaleOverrides'][number] => Boolean(item))
    : []

  const lineSymbolLayers = Array.isArray(style?.lineSymbolLayers)
    ? style.lineSymbolLayers
      .map((item, index) => {
        if (!item || typeof item !== 'object') {
          return null
        }
        const symbol = item as Record<string, unknown>
        const dash = Array.isArray(symbol.dashArray) ? symbol.dashArray : [1, 0]
        if (typeof symbol.color !== 'string') {
          return null
        }
        return {
          id: typeof symbol.id === 'string' ? symbol.id : `line-symbol-${index + 1}`,
          color: symbol.color,
          opacity: typeof symbol.opacity === 'number' ? Math.max(0, Math.min(1, symbol.opacity)) : 1,
          width: typeof symbol.width === 'number' ? Math.max(0.5, symbol.width) : 2,
          dashArray: [
            typeof dash[0] === 'number' ? Math.max(0, dash[0]) : 1,
            typeof dash[1] === 'number' ? Math.max(0, dash[1]) : 0,
          ] as [number, number],
          level: typeof symbol.level === 'number' ? symbol.level : 0,
        }
      })
      .filter((item): item is LayerStyleDraft['lineSymbolLayers'][number] => Boolean(item))
    : []

  const labelClasses = Array.isArray(style?.labelClasses)
    ? style.labelClasses
      .map((item, index) => {
        if (!item || typeof item !== 'object') {
          return null
        }
        const rule = item as Record<string, unknown>
        return {
          id: typeof rule.id === 'string' ? rule.id : `label-class-${index + 1}`,
          name: typeof rule.name === 'string' ? rule.name : `Class ${index + 1}`,
          filterField: typeof rule.filterField === 'string' ? rule.filterField : '',
          filterValue: typeof rule.filterValue === 'string' ? rule.filterValue : '',
          labelField: typeof rule.labelField === 'string' ? rule.labelField : '',
          color: typeof rule.color === 'string' ? rule.color : '#1b1f24',
          size: typeof rule.size === 'number' ? Math.max(8, rule.size) : 14,
          minZoom: typeof rule.minZoom === 'number' ? Math.max(0, rule.minZoom) : 0,
          maxZoom: typeof rule.maxZoom === 'number' ? Math.min(24, rule.maxZoom) : 24,
          priority: typeof rule.priority === 'number' ? rule.priority : 0,
        }
      })
      .filter((item): item is LayerStyleDraft['labelClasses'][number] => Boolean(item))
    : []

  return {
    ...DEFAULT_STYLE_DRAFT,
    rendererType,
    color: typeof style?.color === 'string' ? style.color : DEFAULT_STYLE_DRAFT.color,
    opacity: typeof style?.opacity === 'number' ? style.opacity : DEFAULT_STYLE_DRAFT.opacity,
    strokeColor: typeof style?.strokeColor === 'string' ? style.strokeColor : DEFAULT_STYLE_DRAFT.strokeColor,
    strokeWidth: typeof style?.strokeWidth === 'number' ? style.strokeWidth : DEFAULT_STYLE_DRAFT.strokeWidth,
    lineCasingEnabled:
      typeof style?.lineCasingEnabled === 'boolean'
        ? style.lineCasingEnabled
        : DEFAULT_STYLE_DRAFT.lineCasingEnabled,
    lineCasingColor:
      typeof style?.lineCasingColor === 'string'
        ? style.lineCasingColor
        : DEFAULT_STYLE_DRAFT.lineCasingColor,
    lineCasingWidth:
      typeof style?.lineCasingWidth === 'number'
        ? Math.max(0, style.lineCasingWidth)
        : DEFAULT_STYLE_DRAFT.lineCasingWidth,
    scaleOverrides,
    symbolLevel: typeof style?.symbolLevel === 'number' ? style.symbolLevel : DEFAULT_STYLE_DRAFT.symbolLevel,
    lineSymbolLayers,
    lineMarkerEnabled: style?.lineMarkerEnabled === true,
    lineMarkerLibrary:
      style?.lineMarkerLibrary === 'tabler' ||
      style?.lineMarkerLibrary === 'lucide' ||
      style?.lineMarkerLibrary === 'heroicons_outline' ||
      style?.lineMarkerLibrary === 'heroicons_solid' ||
      style?.lineMarkerLibrary === 'material_symbols' ||
      style?.lineMarkerLibrary === 'iconify'
        ? style.lineMarkerLibrary
        : 'maki',
    lineMarkerIcon: typeof style?.lineMarkerIcon === 'string' ? style.lineMarkerIcon : DEFAULT_STYLE_DRAFT.lineMarkerIcon,
    lineMarkerSpacingMeters:
      typeof style?.lineMarkerSpacingMeters === 'number'
        ? Math.max(1, style.lineMarkerSpacingMeters)
        : DEFAULT_STYLE_DRAFT.lineMarkerSpacingMeters,
    lineMarkerSize:
      typeof style?.lineMarkerSize === 'number' ? Math.max(4, style.lineMarkerSize) : DEFAULT_STYLE_DRAFT.lineMarkerSize,
    lineMarkerRotateWithLine:
      typeof style?.lineMarkerRotateWithLine === 'boolean'
        ? style.lineMarkerRotateWithLine
        : DEFAULT_STYLE_DRAFT.lineMarkerRotateWithLine,
    polygonMarkerEnabled: style?.polygonMarkerEnabled === true,
    polygonMarkerPlacement: style?.polygonMarkerPlacement === 'centroid' ? 'centroid' : 'interior',
    polygonMarkerLibrary:
      style?.polygonMarkerLibrary === 'tabler' ||
      style?.polygonMarkerLibrary === 'lucide' ||
      style?.polygonMarkerLibrary === 'heroicons_outline' ||
      style?.polygonMarkerLibrary === 'heroicons_solid' ||
      style?.polygonMarkerLibrary === 'material_symbols' ||
      style?.polygonMarkerLibrary === 'iconify'
        ? style.polygonMarkerLibrary
        : 'maki',
    polygonMarkerIcon:
      typeof style?.polygonMarkerIcon === 'string' ? style.polygonMarkerIcon : DEFAULT_STYLE_DRAFT.polygonMarkerIcon,
    polygonMarkerSize:
      typeof style?.polygonMarkerSize === 'number' ? Math.max(4, style.polygonMarkerSize) : DEFAULT_STYLE_DRAFT.polygonMarkerSize,
    legendPatchShape:
      style?.legendPatchShape === 'circle' ||
      style?.legendPatchShape === 'square' ||
      style?.legendPatchShape === 'line' ||
      style?.legendPatchShape === 'area'
        ? style.legendPatchShape
        : 'auto',
    pointRadius: typeof style?.pointRadius === 'number' ? style.pointRadius : DEFAULT_STYLE_DRAFT.pointRadius,
    lineDashArray:
      Array.isArray(style?.lineDashArray) &&
      style.lineDashArray.length >= 2 &&
      typeof style.lineDashArray[0] === 'number' &&
      typeof style.lineDashArray[1] === 'number'
        ? [style.lineDashArray[0], style.lineDashArray[1]]
        : DEFAULT_STYLE_DRAFT.lineDashArray,
    pointShape:
      style?.pointShape === 'square' || style?.pointShape === 'icon'
        ? style.pointShape
        : 'circle',
    iconLibrary:
      style?.iconLibrary === 'maki' ||
      style?.iconLibrary === 'tabler' ||
      style?.iconLibrary === 'lucide' ||
      style?.iconLibrary === 'heroicons_outline' ||
      style?.iconLibrary === 'heroicons_solid' ||
      style?.iconLibrary === 'material_symbols' ||
      style?.iconLibrary === 'iconify'
        ? style.iconLibrary
        : DEFAULT_STYLE_DRAFT.iconLibrary,
    iconifyPrefix: typeof style?.iconifyPrefix === 'string' ? style.iconifyPrefix : DEFAULT_STYLE_DRAFT.iconifyPrefix,
    iconName: typeof style?.iconName === 'string' ? style.iconName : DEFAULT_STYLE_DRAFT.iconName,
    iconField: typeof style?.iconField === 'string' ? style.iconField : DEFAULT_STYLE_DRAFT.iconField,
    iconSize:
      typeof style?.iconSize === 'number'
        ? style.iconSize
        : DEFAULT_STYLE_DRAFT.iconSize,
    iconRotation:
      typeof style?.iconRotation === 'number'
        ? style.iconRotation
        : DEFAULT_STYLE_DRAFT.iconRotation,
    iconRotationField:
      typeof style?.iconRotationField === 'string'
        ? style.iconRotationField
        : DEFAULT_STYLE_DRAFT.iconRotationField,
    iconAllowOverlap:
      typeof style?.iconAllowOverlap === 'boolean'
        ? style.iconAllowOverlap
        : DEFAULT_STYLE_DRAFT.iconAllowOverlap,
    labelField: typeof style?.labelField === 'string' ? style.labelField : '',
    labelColor: typeof style?.labelColor === 'string' ? style.labelColor : DEFAULT_STYLE_DRAFT.labelColor,
    labelSize: typeof style?.labelSize === 'number' ? style.labelSize : DEFAULT_STYLE_DRAFT.labelSize,
    labelHaloColor: typeof style?.labelHaloColor === 'string' ? style.labelHaloColor : DEFAULT_STYLE_DRAFT.labelHaloColor,
    labelHaloWidth: typeof style?.labelHaloWidth === 'number' ? style.labelHaloWidth : DEFAULT_STYLE_DRAFT.labelHaloWidth,
    labelMinZoom: typeof style?.labelMinZoom === 'number' ? style.labelMinZoom : DEFAULT_STYLE_DRAFT.labelMinZoom,
    labelMaxZoom: typeof style?.labelMaxZoom === 'number' ? style.labelMaxZoom : DEFAULT_STYLE_DRAFT.labelMaxZoom,
    labelPriorityField: typeof style?.labelPriorityField === 'string' ? style.labelPriorityField : '',
    labelAnchor:
      style?.labelAnchor === 'top' ||
      style?.labelAnchor === 'bottom' ||
      style?.labelAnchor === 'left' ||
      style?.labelAnchor === 'right'
        ? style.labelAnchor
        : 'center',
    labelMaxCount:
      typeof style?.labelMaxCount === 'number'
        ? Math.max(10, Math.min(20_000, Math.round(style.labelMaxCount)))
        : DEFAULT_STYLE_DRAFT.labelMaxCount,
    labelCollisionEnabled:
      typeof style?.labelCollisionEnabled === 'boolean'
        ? style.labelCollisionEnabled
        : DEFAULT_STYLE_DRAFT.labelCollisionEnabled,
    labelWrapLength:
      typeof style?.labelWrapLength === 'number' ? Math.max(0, style.labelWrapLength) : DEFAULT_STYLE_DRAFT.labelWrapLength,
    labelMaxLength:
      typeof style?.labelMaxLength === 'number' ? Math.max(0, style.labelMaxLength) : DEFAULT_STYLE_DRAFT.labelMaxLength,
    labelClasses,
    labelRepeatDistanceMeters:
      typeof style?.labelRepeatDistanceMeters === 'number'
        ? Math.max(0, style.labelRepeatDistanceMeters)
        : DEFAULT_STYLE_DRAFT.labelRepeatDistanceMeters,
    labelRotateWithLine:
      typeof style?.labelRotateWithLine === 'boolean' ? style.labelRotateWithLine : DEFAULT_STYLE_DRAFT.labelRotateWithLine,
    labelPolygonFitEnabled:
      typeof style?.labelPolygonFitEnabled === 'boolean'
        ? style.labelPolygonFitEnabled
        : DEFAULT_STYLE_DRAFT.labelPolygonFitEnabled,
    labelTextExpression: expressionToString(style?.labelTextExpression),
    sizeField: typeof style?.sizeField === 'string' ? style.sizeField : '',
    sizeMin: typeof style?.sizeMin === 'number' ? style.sizeMin : DEFAULT_STYLE_DRAFT.sizeMin,
    sizeMax: typeof style?.sizeMax === 'number' ? style.sizeMax : DEFAULT_STYLE_DRAFT.sizeMax,
    opacityField: typeof style?.opacityField === 'string' ? style.opacityField : '',
    opacityMin: typeof style?.opacityMin === 'number' ? style.opacityMin : DEFAULT_STYLE_DRAFT.opacityMin,
    opacityMax: typeof style?.opacityMax === 'number' ? style.opacityMax : DEFAULT_STYLE_DRAFT.opacityMax,
    polygonPatternLibrary: normalizePolygonPatternLibrary(
      style?.polygonPatternLibrary ??
      inferPolygonPatternLibraryFromName(typeof style?.polygonPattern === 'string' ? style.polygonPattern : ''),
    ),
    polygonPattern: resolvePolygonPatternName(
      normalizePolygonPatternLibrary(
        style?.polygonPatternLibrary ??
        inferPolygonPatternLibraryFromName(typeof style?.polygonPattern === 'string' ? style.polygonPattern : ''),
      ),
      typeof style?.polygonPattern === 'string' ? style.polygonPattern : DEFAULT_STYLE_DRAFT.polygonPattern,
    ),
    polygonPatternColor:
      typeof style?.polygonPatternColor === 'string'
        ? style.polygonPatternColor
        : DEFAULT_STYLE_DRAFT.polygonPatternColor,
    polygonPatternOpacity:
      typeof style?.polygonPatternOpacity === 'number'
        ? Math.max(0, Math.min(1, style.polygonPatternOpacity))
        : DEFAULT_STYLE_DRAFT.polygonPatternOpacity,
    polygonPatternScale:
      typeof style?.polygonPatternScale === 'number'
        ? Math.max(0.25, Math.min(6, style.polygonPatternScale))
        : DEFAULT_STYLE_DRAFT.polygonPatternScale,
    fillColorExpression: expressionToString(style?.fillColorExpression),
    lineColorExpression: expressionToString(style?.lineColorExpression),
    pointRadiusExpression: expressionToString(style?.pointRadiusExpression),
    opacityExpression: expressionToString(style?.opacityExpression),
    topologyNoOverlap: Boolean(style?.topology_no_overlap ?? style?.topologyNoOverlap),
    snapEnabled: Boolean(style?.snap_enabled ?? style?.snapEnabled),
    snapToleranceMeters:
      typeof style?.snap_tolerance_m === 'number'
        ? style.snap_tolerance_m
        : typeof style?.snapToleranceMeters === 'number'
          ? style.snapToleranceMeters
          : DEFAULT_STYLE_DRAFT.snapToleranceMeters,
    uniqueValueField: typeof style?.uniqueValueField === 'string' ? style.uniqueValueField : '',
    uniqueValueStops,
    uniqueDefaultColor:
      typeof style?.uniqueDefaultColor === 'string'
        ? style.uniqueDefaultColor
        : DEFAULT_STYLE_DRAFT.uniqueDefaultColor,
    uniqueDefaultOpacity:
      typeof style?.uniqueDefaultOpacity === 'number'
        ? style.uniqueDefaultOpacity
        : DEFAULT_STYLE_DRAFT.uniqueDefaultOpacity,
    uniqueNullColor:
      typeof style?.uniqueNullColor === 'string' ? style.uniqueNullColor : DEFAULT_STYLE_DRAFT.uniqueNullColor,
    uniqueNullOpacity:
      typeof style?.uniqueNullOpacity === 'number' ? style.uniqueNullOpacity : DEFAULT_STYLE_DRAFT.uniqueNullOpacity,
    classBreakField: typeof style?.classBreakField === 'string' ? style.classBreakField : '',
    classBreakStops,
    classBreakDefaultColor:
      typeof style?.classBreakDefaultColor === 'string'
        ? style.classBreakDefaultColor
        : DEFAULT_STYLE_DRAFT.classBreakDefaultColor,
    classBreakDefaultOpacity:
      typeof style?.classBreakDefaultOpacity === 'number'
        ? style.classBreakDefaultOpacity
        : DEFAULT_STYLE_DRAFT.classBreakDefaultOpacity,
    classBreakNullColor:
      typeof style?.classBreakNullColor === 'string' ? style.classBreakNullColor : DEFAULT_STYLE_DRAFT.classBreakNullColor,
    classBreakNullOpacity:
      typeof style?.classBreakNullOpacity === 'number' ? style.classBreakNullOpacity : DEFAULT_STYLE_DRAFT.classBreakNullOpacity,
  }
}

function toStylePayload(style: LayerStyleDraft): Record<string, unknown> {
  return {
    rendererType: style.rendererType,
    color: style.color,
    opacity: style.opacity,
    strokeColor: style.strokeColor,
    strokeWidth: style.strokeWidth,
    lineCasingEnabled: style.lineCasingEnabled,
    lineCasingColor: style.lineCasingColor,
    lineCasingWidth: style.lineCasingWidth,
    scaleOverrides: style.scaleOverrides,
    symbolLevel: style.symbolLevel,
    lineSymbolLayers: style.lineSymbolLayers,
    lineMarkerEnabled: style.lineMarkerEnabled,
    lineMarkerLibrary: style.lineMarkerLibrary,
    lineMarkerIcon: style.lineMarkerIcon,
    lineMarkerSpacingMeters: style.lineMarkerSpacingMeters,
    lineMarkerSize: style.lineMarkerSize,
    lineMarkerRotateWithLine: style.lineMarkerRotateWithLine,
    polygonMarkerEnabled: style.polygonMarkerEnabled,
    polygonMarkerPlacement: style.polygonMarkerPlacement,
    polygonMarkerLibrary: style.polygonMarkerLibrary,
    polygonMarkerIcon: style.polygonMarkerIcon,
    polygonMarkerSize: style.polygonMarkerSize,
    legendPatchShape: style.legendPatchShape,
    pointRadius: style.pointRadius,
    lineDashArray: style.lineDashArray,
    pointShape: style.pointShape,
    iconLibrary: style.iconLibrary,
    iconifyPrefix: style.iconifyPrefix,
    iconName: style.iconName,
    iconField: style.iconField,
    iconSize: style.iconSize,
    iconRotation: style.iconRotation,
    iconRotationField: style.iconRotationField,
    iconAllowOverlap: style.iconAllowOverlap,
    labelField: style.labelField,
    labelColor: style.labelColor,
    labelSize: style.labelSize,
    labelHaloColor: style.labelHaloColor,
    labelHaloWidth: style.labelHaloWidth,
    labelMinZoom: style.labelMinZoom,
    labelMaxZoom: style.labelMaxZoom,
    labelPriorityField: style.labelPriorityField,
    labelAnchor: style.labelAnchor,
    labelMaxCount: style.labelMaxCount,
    labelCollisionEnabled: style.labelCollisionEnabled,
    labelWrapLength: style.labelWrapLength,
    labelMaxLength: style.labelMaxLength,
    labelClasses: style.labelClasses,
    labelRepeatDistanceMeters: style.labelRepeatDistanceMeters,
    labelRotateWithLine: style.labelRotateWithLine,
    labelPolygonFitEnabled: style.labelPolygonFitEnabled,
    labelTextExpression: style.labelTextExpression,
    sizeField: style.sizeField,
    sizeMin: style.sizeMin,
    sizeMax: style.sizeMax,
    opacityField: style.opacityField,
    opacityMin: style.opacityMin,
    opacityMax: style.opacityMax,
    polygonPatternLibrary: style.polygonPatternLibrary,
    polygonPattern: style.polygonPattern,
    polygonPatternColor: style.polygonPatternColor,
    polygonPatternOpacity: style.polygonPatternOpacity,
    polygonPatternScale: style.polygonPatternScale,
    fillColorExpression: style.fillColorExpression,
    lineColorExpression: style.lineColorExpression,
    pointRadiusExpression: style.pointRadiusExpression,
    opacityExpression: style.opacityExpression,
    topology_no_overlap: style.topologyNoOverlap,
    snap_enabled: style.snapEnabled,
    snap_tolerance_m: style.snapToleranceMeters,
    uniqueValueField: style.uniqueValueField,
    uniqueValueStops: style.uniqueValueStops,
    uniqueDefaultColor: style.uniqueDefaultColor,
    uniqueDefaultOpacity: style.uniqueDefaultOpacity,
    uniqueNullColor: style.uniqueNullColor,
    uniqueNullOpacity: style.uniqueNullOpacity,
    classBreakField: style.classBreakField,
    classBreakStops: style.classBreakStops,
    classBreakDefaultColor: style.classBreakDefaultColor,
    classBreakDefaultOpacity: style.classBreakDefaultOpacity,
    classBreakNullColor: style.classBreakNullColor,
    classBreakNullOpacity: style.classBreakNullOpacity,
  }
}

function stripInternalProperties(properties: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!properties) {
    return undefined
  }

  return Object.fromEntries(Object.entries(properties).filter(([key]) => !key.startsWith('_')))
}

function readFeatureVersion(properties: Record<string, unknown> | undefined): number | undefined {
  const value = properties?._version
  return typeof value === 'number' ? value : undefined
}

function expressionToString(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) {
    try {
      return JSON.stringify(value)
    } catch {
      return ''
    }
  }
  return ''
}

export default function App() {
  const queryClient = useQueryClient()
  const theme = useTheme()
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'))

  const token = useAuthStore((state) => state.token)
  const user = useAuthStore((state) => state.user)
  const setAuthTokens = useAuthStore((state) => state.setAuthTokens)
  const setUser = useAuthStore((state) => state.setUser)
  const logout = useAuthStore((state) => state.logout)

  const [authOpen, setAuthOpen] = useState(false)
  const [createLayerOpen, setCreateLayerOpen] = useState(false)
  const [createLayerError, setCreateLayerError] = useState<string | null>(null)

  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadTargetLayer, setUploadTargetLayer] = useState<Layer | null>(null)
  const [uploadFile, setUploadFile] = useState<File | null>(null)

  const [styleOpen, setStyleOpen] = useState(false)
  const [styleError, setStyleError] = useState<string | null>(null)
  const [styleLayer, setStyleLayer] = useState<Layer | null>(null)
  const [styleDraft, setStyleDraft] = useState<LayerStyleDraft>(DEFAULT_STYLE_DRAFT)

  const [tableOpen, setTableOpen] = useState(false)
  const [tableError, setTableError] = useState<string | null>(null)
  const [tableLayer, setTableLayer] = useState<Layer | null>(null)

  const [fieldsOpen, setFieldsOpen] = useState(false)
  const [fieldsError, setFieldsError] = useState<string | null>(null)
  const [fieldsLayer, setFieldsLayer] = useState<Layer | null>(null)

  const [layerOpsOpen, setLayerOpsOpen] = useState(false)
  const [layerOpsError, setLayerOpsError] = useState<string | null>(null)
  const [layerOpsLayer, setLayerOpsLayer] = useState<Layer | null>(null)
  const [layerOpsSelectedSessionId, setLayerOpsSelectedSessionId] = useState<string | null>(null)

  const [viewsOpen, setViewsOpen] = useState(false)
  const [viewsError, setViewsError] = useState<string | null>(null)
  const [currentMapView, setCurrentMapView] = useState<MapViewportState | null>(null)

  const [jobsOpen, setJobsOpen] = useState(false)
  const [jobsError, setJobsError] = useState<string | null>(null)

  const [analysisOpen, setAnalysisOpen] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [analysisOverlay, setAnalysisOverlay] = useState<FeatureCollection | null>(null)
  const [withinCount, setWithinCount] = useState<number | null>(null)
  const [analysisJob, setAnalysisJob] = useState<AnalysisJobState | null>(null)

  const [featureConflict, setFeatureConflict] = useState<FeatureConflictState | null>(null)
  const featureUpdateQueuesRef = useRef(new Map<string, Promise<unknown>>())
  const latestFeatureVersionsRef = useRef(new Map<string, number>())

  const [activeEditLayerId, setActiveEditLayerId] = useState<string | null>(null)
  const [activeEditSessionByLayerId, setActiveEditSessionByLayerId] = useState<Record<string, string | null>>({})
  const [advancedEditMode, setAdvancedEditMode] = useState<AdvancedEditMode>('reshape')
  const [advancedEditOptions, setAdvancedEditOptions] = useState<AdvancedEditOptions>(DEFAULT_ADVANCED_EDIT_OPTIONS)
  const [editCommand, setEditCommand] = useState<EditCommand | null>(null)
  const [editState, setEditState] = useState<EditState>({ selectedCount: 0, canUndo: false, canRedo: false })
  const [editUiState, setEditUiState] = useState<EditUiState | null>(null)
  const [activeShapeType, setActiveShapeType] = useState<'circle' | 'rectangle' | 'square' | 'triangle' | 'pentagon' | 'hexagon' | 'star' | null>(null)
  const [shapeSize, setShapeSize] = useState(100)
  const [measurementMode, setMeasurementMode] = useState<MeasurementMode>(null)
  const [measurementResetNonce, setMeasurementResetNonce] = useState(0)
  const [measurementSummary, setMeasurementSummary] = useState<MeasurementSummary | null>(null)

  // Phase 1: Attribute Table Selection & Map Interaction
  const [selectedFeaturesByLayer, setSelectedFeaturesByLayer] = useState<Record<string, string[]>>({})
  // const [highlightedFeature, setHighlightedFeature] = useState<{ layerId: string; featureId: string } | null>(null)
  const [featureZoomRequest, setFeatureZoomRequest] = useState<{ layerId: string; featureIds: string[]; nonce: number } | null>(null)
  const [flashFeatureRequest, setFlashFeatureRequest] = useState<{ layerId: string; featureId: string; nonce: number } | null>(null)

  const [searchText, setSearchText] = useState('')
  const [searching, setSearching] = useState(false)

  const [snack, setSnack] = useState<{ message: string; severity: AlertColor } | null>(null)
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([])
  const [isOnline, setIsOnline] = useState<boolean>(() => navigator.onLine)

  const [zoomRequest, setZoomRequest] = useState<{ layerId: string; nonce: number } | null>(null)
  const [fitVisibleRequest, setFitVisibleRequest] = useState<{ nonce: number } | null>(null)
  const [locateRequest, setLocateRequest] = useState<{
    lng: number
    lat: number
    zoom?: number
    bearing?: number
    pitch?: number
    nonce: number
  } | null>(null)

  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)
  const [visibleByLayerId, setVisibleByLayerId] = useState<Record<string, boolean>>({})
  const [appMode, setAppMode] = useState<AppMode>(() => readStoredAppMode())
  const [legendMode, setLegendMode] = useState<LegendMode>(() => readStoredLegendMode())
  const [workMode, setWorkMode] = useState<boolean>(() => readStoredWorkMode())
  const [selectedUtilityNetworkId, setSelectedUtilityNetworkId] = useState<string | null>(null)
  const [utilityModeError, setUtilityModeError] = useState<string | null>(null)
  const [editToolSearch, setEditToolSearch] = useState('')
  const [editToolTab, setEditToolTab] = useState<EditToolTab>(() => readStoredEditToolTab())
  const [favoriteEditTools, setFavoriteEditTools] = useState<AdvancedEditMode[]>(() => readStoredFavoriteEditTools())
  const [openEditToolGroups, setOpenEditToolGroups] = useState<Record<EditToolGroup, boolean>>({
    Alignment: true,
    Reshape: true,
    Construction: true,
  })
  const [legendFiltersByLayerId, setLegendFiltersByLayerId] = useState<Record<string, string[]>>({})

  const pushActivity = useCallback((message: string, level: ActivityLevel = 'info') => {
    setActivityEvents((previous) => [
      { id: Date.now() + Math.floor(Math.random() * 10_000), message, level, timestamp: Date.now() },
      ...previous,
    ].slice(0, 80))
  }, [])

  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true)
      pushActivity('Connection restored.', 'success')
    }

    const onOffline = () => {
      setIsOnline(false)
      pushActivity('Offline mode: cached app shell and map metadata only.', 'warning')
    }

    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [pushActivity])

  const trackTelemetry = useCallback(
    (eventType: string, payload: Record<string, unknown>) => {
      void sendTelemetry(eventType, payload, token).catch(() => {
        // Telemetry should never block user workflows.
      })
    },
    [token],
  )

  useEffect(() => {
    trackTelemetry('app_loaded', {
      path: window.location.pathname,
      online: navigator.onLine,
    })
  }, [trackTelemetry])

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      trackTelemetry('frontend_error', {
        message: event.message,
        filename: event.filename,
        line: event.lineno,
        column: event.colno,
      })
    }

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      trackTelemetry('frontend_rejection', {
        reason: String(event.reason ?? 'unknown'),
      })
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
  }, [trackTelemetry])

  const notify = useCallback(
    (message: string, severity: AlertColor = 'info', recordActivity = true) => {
      setSnack({ message, severity })
      if (recordActivity) {
        const level: ActivityLevel =
          severity === 'success' || severity === 'warning' || severity === 'error' ? severity : 'info'
        pushActivity(message, level)
      }
      if (severity === 'warning' || severity === 'error') {
        trackTelemetry('ui_notification', { severity, message })
      }
    },
    [pushActivity, trackTelemetry],
  )

  const currentUserQuery = useQuery({
    queryKey: ['current-user', token],
    queryFn: () => fetchCurrentUser(token as string),
    enabled: Boolean(token),
    retry: false,
  })

  useEffect(() => {
    if (currentUserQuery.data) {
      setUser(currentUserQuery.data)
    }
  }, [currentUserQuery.data, setUser])

  useEffect(() => {
    if (!(currentUserQuery.error instanceof ApiError)) {
      return
    }

    if (currentUserQuery.error.status === 401) {
      logout()
      queryClient.removeQueries()
    }
  }, [currentUserQuery.error, logout, queryClient])

  const layersQuery = useQuery({
    queryKey: ['layers', token],
    queryFn: () => fetchLayers(token),
    staleTime: 20_000,
  })

  const layers = layersQuery.data ?? EMPTY_LAYERS
  const schemaLayerId = fieldsLayer?.id ?? styleLayer?.id ?? tableLayer?.id ?? null
  const schemaPanelOpen = fieldsOpen || styleOpen || tableOpen

  const featureQueries = useQueries({
    queries: layers.map((layer) => ({
      queryKey: ['layer-features', layer.id, token],
      queryFn: () => fetchLayerFeatures(layer.id, token),
      enabled: visibleByLayerId[layer.id] ?? true,
      staleTime: 20_000,
    })),
  })

  const layerFieldsQuery = useQuery({
    queryKey: ['layer-fields', schemaLayerId, token],
    queryFn: () => fetchLayerFields(schemaLayerId as string, token),
    enabled: Boolean(schemaLayerId) && schemaPanelOpen,
    staleTime: 15_000,
  })

  const layerDomainsQuery = useQuery({
    queryKey: ['layer-domains', fieldsLayer?.id, token],
    queryFn: () => fetchLayerDomains(fieldsLayer?.id as string, token),
    enabled: Boolean(fieldsLayer?.id) && fieldsOpen,
    staleTime: 15_000,
  })

  const layerOpsFieldsQuery = useQuery({
    queryKey: ['layer-fields', layerOpsLayer?.id, token, 'ops'],
    queryFn: () => fetchLayerFields(layerOpsLayer?.id as string, token),
    enabled: Boolean(layerOpsLayer?.id) && layerOpsOpen,
    staleTime: 15_000,
  })

  const layerJoinsQuery = useQuery({
    queryKey: ['layer-joins', layerOpsLayer?.id, token],
    queryFn: () => fetchLayerJoins(layerOpsLayer?.id as string, token),
    enabled: Boolean(layerOpsLayer?.id) && layerOpsOpen && Boolean(token),
    staleTime: 10_000,
  })

  const shareLinksQuery = useQuery({
    queryKey: ['layer-share-links', layerOpsLayer?.id, token],
    queryFn: () => fetchShareLinks(layerOpsLayer?.id as string, token as string),
    enabled: Boolean(layerOpsLayer?.id) && layerOpsOpen && Boolean(token),
    staleTime: 10_000,
  })

  const layerViewsQuery = useQuery({
    queryKey: ['layer-views', layerOpsLayer?.id, token],
    queryFn: () => fetchLayerViews(layerOpsLayer?.id as string, token),
    enabled: Boolean(layerOpsLayer?.id) && layerOpsOpen,
    staleTime: 10_000,
  })

  const layerRelationshipsQuery = useQuery({
    queryKey: ['layer-relationships', layerOpsLayer?.id, token],
    queryFn: () => fetchLayerRelationships(layerOpsLayer?.id as string, token),
    enabled: Boolean(layerOpsLayer?.id) && layerOpsOpen,
    staleTime: 10_000,
  })

  const utilityNetworksQuery = useQuery({
    queryKey: ['utility-networks', token],
    queryFn: () => fetchUtilityNetworks(token),
    enabled: appMode === 'utilities',
    staleTime: 15_000,
  })

  const utilitySummaryQuery = useQuery({
    queryKey: ['utility-network-summary', selectedUtilityNetworkId, token],
    queryFn: () => fetchUtilityNetworkSummary(selectedUtilityNetworkId as string, token),
    enabled: appMode === 'utilities' && Boolean(selectedUtilityNetworkId),
    staleTime: 15_000,
  })

  const utilityNodesQuery = useQuery({
    queryKey: ['utility-network-nodes', selectedUtilityNetworkId, token],
    queryFn: () => fetchUtilityNetworkNodes(selectedUtilityNetworkId as string, token, 40),
    enabled: appMode === 'utilities' && Boolean(selectedUtilityNetworkId),
    staleTime: 15_000,
  })

  const utilityEdgesQuery = useQuery({
    queryKey: ['utility-network-edges', selectedUtilityNetworkId, token],
    queryFn: () => fetchUtilityNetworkEdges(selectedUtilityNetworkId as string, token, 40),
    enabled: appMode === 'utilities' && Boolean(selectedUtilityNetworkId),
    staleTime: 15_000,
  })

  const utilityServicePointsQuery = useQuery({
    queryKey: ['utility-network-service-points', selectedUtilityNetworkId, token],
    queryFn: () => fetchUtilityNetworkServicePoints(selectedUtilityNetworkId as string, token, 40),
    enabled: appMode === 'utilities' && Boolean(selectedUtilityNetworkId),
    staleTime: 15_000,
  })

  const editSessionsQuery = useQuery({
    queryKey: ['edit-sessions', layerOpsLayer?.id, token],
    queryFn: () => fetchEditSessions(layerOpsLayer?.id as string, token as string),
    enabled: Boolean(layerOpsLayer?.id) && layerOpsOpen && Boolean(token),
    staleTime: 10_000,
  })

  const editSessionChangesQuery = useQuery({
    queryKey: ['edit-session-changes', layerOpsLayer?.id, layerOpsSelectedSessionId, token],
    queryFn: () => fetchEditSessionChanges(layerOpsLayer?.id as string, layerOpsSelectedSessionId as string, token as string),
    enabled: Boolean(layerOpsLayer?.id) && layerOpsOpen && Boolean(layerOpsSelectedSessionId) && Boolean(token),
    staleTime: 5_000,
  })

  // const tableJoinsQuery = useQuery({
  //   queryKey: ['layer-joins', tableLayer?.id, token, 'table'],
  //   queryFn: () => fetchLayerJoins(tableLayer?.id as string, token),
  //   enabled: Boolean(tableLayer?.id) && tableOpen,
  //   staleTime: 10_000,
  // })

  const viewsQuery = useQuery({
    queryKey: ['map-views', token],
    queryFn: () => fetchViews(token as string),
    enabled: Boolean(token) && viewsOpen,
    staleTime: 10_000,
  })

  const jobsQuery = useQuery({
    queryKey: ['async-jobs', token],
    queryFn: () => fetchAsyncJobs(token as string),
    enabled: Boolean(token) && jobsOpen,
    staleTime: 5_000,
    refetchInterval: jobsOpen ? 3_000 : false,
  })

  const featureCollections = useMemo(() => {
    const byLayerId: Record<string, FeatureCollection | undefined> = {}

    layers.forEach((layer, index) => {
      const query = featureQueries[index] as UseQueryResult<FeatureCollection, Error> | undefined
      byLayerId[layer.id] = query?.data
    })

    return byLayerId
  }, [layers, featureQueries])

  const resolvedVisibility = useMemo(() => {
    const next: Record<string, boolean> = {}
    for (const layer of layers) {
      next[layer.id] = visibleByLayerId[layer.id] ?? true
    }
    return next
  }, [layers, visibleByLayerId])

  const totalFeatures = useMemo(
    () =>
      Object.entries(featureCollections).reduce((acc, [layerId, fc]) => {
        if (!(visibleByLayerId[layerId] ?? true)) {
          return acc
        }
        return acc + (fc?.features.length ?? 0)
      }, 0),
    [featureCollections, visibleByLayerId],
  )

  const featureCountByLayerId = useMemo(() => {
    const next: Record<string, number> = {}
    for (const [layerId, collection] of Object.entries(featureCollections)) {
      next[layerId] = collection?.features.length ?? 0
    }
    return next
  }, [featureCollections])

  const layerById = useMemo(() => {
    const next: Record<string, Layer> = {}
    for (const layer of layers) {
      next[layer.id] = layer
    }
    return next
  }, [layers])

  useEffect(() => {
    window.localStorage.setItem(APP_MODE_STORAGE_KEY, appMode)
  }, [appMode])

  useEffect(() => {
    window.localStorage.setItem(LEGEND_MODE_STORAGE_KEY, legendMode)
  }, [legendMode])

  useEffect(() => {
    window.localStorage.setItem(WORK_MODE_STORAGE_KEY, workMode ? 'true' : 'false')
  }, [workMode])

  useEffect(() => {
    window.localStorage.setItem(EDIT_TOOL_TAB_STORAGE_KEY, editToolTab)
  }, [editToolTab])

  useEffect(() => {
    window.localStorage.setItem(EDIT_TOOL_FAVORITES_STORAGE_KEY, JSON.stringify(favoriteEditTools))
  }, [favoriteEditTools])

  useEffect(() => {
    const allowedLayerIds = new Set(layers.map((layer) => layer.id))
    setLegendFiltersByLayerId((previous) => {
      const next: Record<string, string[]> = {}
      for (const [layerId, filters] of Object.entries(previous)) {
        if (allowedLayerIds.has(layerId) && filters.length) {
          next[layerId] = filters
        }
      }
      return next
    })
  }, [layers])

  useEffect(() => {
    if (activeEditLayerId) {
      return
    }
    setEditState({ selectedCount: 0, canUndo: false, canRedo: false })
    setEditUiState(null)
    setEditCommand(null)
  }, [activeEditLayerId])

  const schemaFields: LayerField[] = layerFieldsQuery.data ?? []
  const schemaDomains: LayerDomain[] = layerDomainsQuery.data ?? []
  const layerOpsFields: LayerField[] = layerOpsFieldsQuery.data ?? []
  const layerJoins: LayerJoin[] = layerJoinsQuery.data ?? []
  const shareLinks: LayerShareLink[] = shareLinksQuery.data ?? []
  const layerViews: LayerView[] = layerViewsQuery.data ?? []
  const layerRelationships: LayerRelationship[] = layerRelationshipsQuery.data ?? []
  const utilityNetworks: UtilityNetwork[] = utilityNetworksQuery.data ?? []
  const utilityNetworkSummary: UtilityNetworkSummary | null = utilitySummaryQuery.data ?? null
  const editSessions: EditSession[] = editSessionsQuery.data ?? []
  const editSessionChanges: EditSessionChange[] = editSessionChangesQuery.data ?? []
  // const tableJoins: LayerJoin[] = tableJoinsQuery.data ?? []
  const mapViews: MapView[] = viewsQuery.data ?? []
  const asyncJobs: AsyncJob[] = jobsQuery.data ?? []

  const featuresLoading = featureQueries.some((query) => query.isFetching)
  const schemaLoading = layerFieldsQuery.isFetching || layerDomainsQuery.isFetching
  const layerOpsLoading =
    layerOpsFieldsQuery.isFetching ||
    layerJoinsQuery.isFetching ||
    shareLinksQuery.isFetching ||
    layerViewsQuery.isFetching ||
    layerRelationshipsQuery.isFetching ||
    editSessionsQuery.isFetching ||
    editSessionChangesQuery.isFetching
  const utilityModeLoading = utilityNetworksQuery.isFetching
  const utilityModeDetailLoading =
    utilitySummaryQuery.isFetching ||
    utilityNodesQuery.isFetching ||
    utilityEdgesQuery.isFetching ||
    utilityServicePointsQuery.isFetching
  const schemaQueryError =
    (layerFieldsQuery.error instanceof Error ? layerFieldsQuery.error.message : null) ??
    (layerDomainsQuery.error instanceof Error ? layerDomainsQuery.error.message : null)
  const layerOpsQueryError =
    (layerOpsFieldsQuery.error instanceof Error ? layerOpsFieldsQuery.error.message : null) ??
    (layerJoinsQuery.error instanceof Error ? layerJoinsQuery.error.message : null) ??
    (shareLinksQuery.error instanceof Error ? shareLinksQuery.error.message : null) ??
    (layerViewsQuery.error instanceof Error ? layerViewsQuery.error.message : null) ??
    (layerRelationshipsQuery.error instanceof Error ? layerRelationshipsQuery.error.message : null) ??
    (editSessionsQuery.error instanceof Error ? editSessionsQuery.error.message : null) ??
    (editSessionChangesQuery.error instanceof Error ? editSessionChangesQuery.error.message : null)
  const utilityModeQueryError =
    utilityModeError ??
    (utilityNetworksQuery.error instanceof Error ? utilityNetworksQuery.error.message : null) ??
    (utilitySummaryQuery.error instanceof Error ? utilitySummaryQuery.error.message : null) ??
    (utilityNodesQuery.error instanceof Error ? utilityNodesQuery.error.message : null) ??
    (utilityEdgesQuery.error instanceof Error ? utilityEdgesQuery.error.message : null) ??
    (utilityServicePointsQuery.error instanceof Error ? utilityServicePointsQuery.error.message : null)
  const ownerName = user?.username ?? null

  useEffect(() => {
    if (appMode !== 'utilities') {
      return
    }
    if (!utilityNetworks.length) {
      setSelectedUtilityNetworkId(null)
      return
    }
    if (!selectedUtilityNetworkId || !utilityNetworks.some((network) => network.id === selectedUtilityNetworkId)) {
      setSelectedUtilityNetworkId(utilityNetworks[0]?.id ?? null)
    }
  }, [appMode, utilityNetworks, selectedUtilityNetworkId])

  const resolveActiveSessionId = useCallback(
    (layerId: string): string | undefined => {
      const sessionId = activeEditSessionByLayerId[layerId]
      return sessionId ?? undefined
    },
    [activeEditSessionByLayerId],
  )

  useEffect(() => {
    if (!layerOpsLayer) {
      setLayerOpsSelectedSessionId(null)
      return
    }
    setLayerOpsSelectedSessionId(activeEditSessionByLayerId[layerOpsLayer.id] ?? null)
  }, [layerOpsLayer, activeEditSessionByLayerId])

  const startAnalysisJob = (tab: AnalysisTab) => {
    const label = tab === 'buffer' ? 'buffer' : tab === 'intersect' ? 'intersect' : 'within'
    pushActivity(`Started ${label} analysis`, 'info')
    setAnalysisJob({
      status: 'queued',
      progress: 10,
      message: `${label} analysis queued`,
    })
    window.setTimeout(() => {
      setAnalysisJob((current) => {
        if (!current || current.status !== 'queued') {
          return current
        }

        return {
          status: 'running',
          progress: 30,
          message: `Running ${label} analysis`,
        }
      })
    }, 120)
  }

  const completeAnalysisJob = (message: string) => {
    pushActivity(message, 'success')
    setAnalysisJob({
      status: 'success',
      progress: 100,
      message,
    })
  }

  const failAnalysisJob = (message: string) => {
    pushActivity(message, 'error')
    setAnalysisJob({
      status: 'error',
      progress: 100,
      message,
    })
  }

  useEffect(() => {
    if (analysisJob?.status !== 'running') {
      return
    }

    const timer = window.setInterval(() => {
      setAnalysisJob((current) => {
        if (!current || current.status !== 'running') {
          return current
        }

        return {
          ...current,
          progress: Math.min(92, current.progress + 8),
        }
      })
    }, 400)

    return () => {
      window.clearInterval(timer)
    }
  }, [analysisJob?.status])

  useEffect(() => {
    if (analysisJob?.status !== 'success' && analysisJob?.status !== 'error') {
      return
    }

    const timer = window.setTimeout(() => {
      setAnalysisJob((current) => {
        if (current?.status === 'success' || current?.status === 'error') {
          return null
        }
        return current
      })
    }, 4000)

    return () => {
      window.clearTimeout(timer)
    }
  }, [analysisJob?.status])

  const createLayerMutation = useMutation({
    mutationFn: async (payload: CreateLayerPayload) => {
      if (!token) {
        throw new Error('You must be signed in to create a layer.')
      }
      return createLayerApi(payload, token)
    },
    onSuccess: (newLayer) => {
      setVisibleByLayerId((previous) => ({ ...previous, [newLayer.id]: true }))
      queryClient.invalidateQueries({ queryKey: ['layers'] })
      setCreateLayerOpen(false)
      setCreateLayerError(null)
      notify(`Layer "${newLayer.name}" created`, 'success')
    },
    onError: (error) => {
      setCreateLayerError(error instanceof Error ? error.message : 'Failed to create layer')
    },
  })

  const createUtilityNetworkMutation = useMutation({
    mutationFn: async (payload: CreateUtilityNetworkPayload) => {
      if (!token) {
        throw new Error('You must be signed in to create utility networks.')
      }
      return createUtilityNetwork(payload, token)
    },
    onSuccess: (network) => {
      setUtilityModeError(null)
      setSelectedUtilityNetworkId(network.id)
      queryClient.invalidateQueries({ queryKey: ['utility-networks'] })
      notify(`Utility network "${network.name}" created`, 'success')
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to create utility network'
      setUtilityModeError(message)
      notify(message, 'error')
    },
  })

  const createUtilityNodeMutation = useMutation({
    mutationFn: async ({ networkId, payload }: { networkId: string; payload: CreateUtilityNodePayload }) => {
      if (!token) {
        throw new Error('You must be signed in to create utility assets.')
      }
      return createUtilityNetworkNode(networkId, payload, token)
    },
    onSuccess: (_, variables) => {
      setUtilityModeError(null)
      queryClient.invalidateQueries({ queryKey: ['utility-network-summary', variables.networkId] })
      queryClient.invalidateQueries({ queryKey: ['utility-network-nodes', variables.networkId] })
      notify('Utility node created', 'success')
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to create utility node'
      setUtilityModeError(message)
      notify(message, 'error')
    },
  })

  const createUtilityEdgeMutation = useMutation({
    mutationFn: async ({ networkId, payload }: { networkId: string; payload: CreateUtilityEdgePayload }) => {
      if (!token) {
        throw new Error('You must be signed in to create utility assets.')
      }
      return createUtilityNetworkEdge(networkId, payload, token)
    },
    onSuccess: (_, variables) => {
      setUtilityModeError(null)
      queryClient.invalidateQueries({ queryKey: ['utility-network-summary', variables.networkId] })
      queryClient.invalidateQueries({ queryKey: ['utility-network-edges', variables.networkId] })
      notify('Utility edge created', 'success')
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to create utility edge'
      setUtilityModeError(message)
      notify(message, 'error')
    },
  })

  const createUtilityServicePointMutation = useMutation({
    mutationFn: async ({ networkId, payload }: { networkId: string; payload: CreateUtilityServicePointPayload }) => {
      if (!token) {
        throw new Error('You must be signed in to create utility assets.')
      }
      return createUtilityNetworkServicePoint(networkId, payload, token)
    },
    onSuccess: (_, variables) => {
      setUtilityModeError(null)
      queryClient.invalidateQueries({ queryKey: ['utility-network-summary', variables.networkId] })
      queryClient.invalidateQueries({ queryKey: ['utility-network-service-points', variables.networkId] })
      notify('Utility service point created', 'success')
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to create service point'
      setUtilityModeError(message)
      notify(message, 'error')
    },
  })

  const styleMutation = useMutation({
    mutationFn: async (payload: { layer: Layer; style: LayerStyleDraft }) => {
      if (!token) {
        throw new Error('You must be signed in to update styles.')
      }
      return updateLayer(payload.layer.id, { style: toStylePayload(payload.style) }, token)
    },
    onSuccess: (layer) => {
      queryClient.invalidateQueries({ queryKey: ['layers'] })
      queryClient.invalidateQueries({ queryKey: ['layer-features', layer.id] })
      setStyleOpen(false)
      setStyleError(null)
      setStyleLayer(null)
      notify(`Updated style for "${layer.name}"`, 'success')
    },
    onError: (error) => {
      setStyleError(error instanceof Error ? error.message : 'Failed to update style')
    },
  })

  const quickEditStyleMutation = useMutation({
    mutationFn: async (payload: { layer: Layer; patch: Partial<LayerStyleDraft> }) => {
      if (!token) {
        throw new Error('You must be signed in to update editing settings.')
      }
      const base = readStyle(payload.layer)
      const nextStyle = { ...base, ...payload.patch }
      return updateLayer(payload.layer.id, { style: toStylePayload(nextStyle) }, token)
    },
    onSuccess: (layer) => {
      queryClient.invalidateQueries({ queryKey: ['layers'] })
      queryClient.invalidateQueries({ queryKey: ['layer-features', layer.id] })
      notify(`Editing settings updated for "${layer.name}"`, 'success', false)
    },
    onError: (error) => {
      notify(error instanceof Error ? error.message : 'Failed to update editing settings', 'error')
    },
  })

  const createDomainMutation = useMutation({
    mutationFn: async (payload: { layerId: string; domain: CreateLayerDomainPayload }) => {
      if (!token) {
        throw new Error('You must be signed in to manage domains.')
      }
      return createLayerDomain(payload.layerId, payload.domain, token)
    },
    onSuccess: (_, payload) => {
      setFieldsError(null)
      queryClient.invalidateQueries({ queryKey: ['layer-domains', payload.layerId] })
      queryClient.invalidateQueries({ queryKey: ['layer-fields', payload.layerId] })
      notify('Domain created', 'success')
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to create domain'
      setFieldsError(message)
      notify(message, 'error')
    },
  })

  const updateDomainMutation = useMutation({
    mutationFn: async (payload: { layerId: string; domainId: string; domain: UpdateLayerDomainPayload }) => {
      if (!token) {
        throw new Error('You must be signed in to manage domains.')
      }
      return updateLayerDomain(payload.layerId, payload.domainId, payload.domain, token)
    },
    onSuccess: (_, payload) => {
      setFieldsError(null)
      queryClient.invalidateQueries({ queryKey: ['layer-domains', payload.layerId] })
      queryClient.invalidateQueries({ queryKey: ['layer-fields', payload.layerId] })
      notify('Domain updated', 'success')
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to update domain'
      setFieldsError(message)
      notify(message, 'error')
    },
  })

  const deleteDomainMutation = useMutation({
    mutationFn: async (payload: { layerId: string; domainId: string }) => {
      if (!token) {
        throw new Error('You must be signed in to manage domains.')
      }
      await deleteLayerDomain(payload.layerId, payload.domainId, token)
      return payload
    },
    onSuccess: (payload) => {
      setFieldsError(null)
      queryClient.invalidateQueries({ queryKey: ['layer-domains', payload.layerId] })
      queryClient.invalidateQueries({ queryKey: ['layer-fields', payload.layerId] })
      notify('Domain deleted', 'success')
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to delete domain'
      setFieldsError(message)
      notify(message, 'error')
    },
  })

  const createFieldMutation = useMutation({
    mutationFn: async (payload: { layerId: string; field: CreateLayerFieldPayload }) => {
      if (!token) {
        throw new Error('You must be signed in to manage fields.')
      }
      return createLayerField(payload.layerId, payload.field, token)
    },
    onSuccess: (_, payload) => {
      setFieldsError(null)
      queryClient.invalidateQueries({ queryKey: ['layer-fields', payload.layerId] })
      queryClient.invalidateQueries({ queryKey: ['layer-features', payload.layerId] })
      notify('Field created', 'success')
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to create field'
      setFieldsError(message)
      notify(message, 'error')
    },
  })

  const updateFieldMutation = useMutation({
    mutationFn: async (payload: { layerId: string; fieldId: string; field: UpdateLayerFieldPayload }) => {
      if (!token) {
        throw new Error('You must be signed in to manage fields.')
      }
      return updateLayerField(payload.layerId, payload.fieldId, payload.field, token)
    },
    onSuccess: (_, payload) => {
      setFieldsError(null)
      queryClient.invalidateQueries({ queryKey: ['layer-fields', payload.layerId] })
      queryClient.invalidateQueries({ queryKey: ['layer-features', payload.layerId] })
      notify('Field updated', 'success')
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to update field'
      setFieldsError(message)
      notify(message, 'error')
    },
  })

  const deleteFieldMutation = useMutation({
    mutationFn: async (payload: { layerId: string; fieldId: string }) => {
      if (!token) {
        throw new Error('You must be signed in to manage fields.')
      }
      await deleteLayerField(payload.layerId, payload.fieldId, token)
      return payload
    },
    onSuccess: (payload) => {
      setFieldsError(null)
      queryClient.invalidateQueries({ queryKey: ['layer-fields', payload.layerId] })
      queryClient.invalidateQueries({ queryKey: ['layer-features', payload.layerId] })
      notify('Field deleted', 'success')
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to delete field'
      setFieldsError(message)
      notify(message, 'error')
    },
  })

  const schemaSubmitting =
    createFieldMutation.isPending ||
    updateFieldMutation.isPending ||
    deleteFieldMutation.isPending ||
    createDomainMutation.isPending ||
    updateDomainMutation.isPending ||
    deleteDomainMutation.isPending

  const updateLayerOrderingMutation = useMutation({
    mutationFn: async (payload: { layerId: string; group_name: string; z_index: number }) => {
      if (!token) {
        throw new Error('You must be signed in to manage layer ordering.')
      }
      return updateLayerOrdering(payload.layerId, { group_name: payload.group_name, z_index: payload.z_index }, token)
    },
    onSuccess: (_, payload) => {
      setLayerOpsError(null)
      queryClient.invalidateQueries({ queryKey: ['layers'] })
      queryClient.invalidateQueries({ queryKey: ['layer-features', payload.layerId] })
      notify('Layer ordering updated', 'success')
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to update ordering'
      setLayerOpsError(message)
      notify(message, 'error')
    },
  })

  const createShareLinkMutation = useMutation({
    mutationFn: async (payload: { layerId: string; share: CreateShareLinkPayload }) => {
      if (!token) {
        throw new Error('You must be signed in to create share links.')
      }
      return createShareLink(payload.layerId, payload.share, token)
    },
    onSuccess: (_, payload) => {
      setLayerOpsError(null)
      queryClient.invalidateQueries({ queryKey: ['layer-share-links', payload.layerId, token] })
      notify('Share link created', 'success')
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to create share link'
      setLayerOpsError(message)
      notify(message, 'error')
    },
  })

  const deleteShareLinkMutation = useMutation({
    mutationFn: async (payload: { layerId: string; shareId: string }) => {
      if (!token) {
        throw new Error('You must be signed in to delete share links.')
      }
      await deleteShareLink(payload.layerId, payload.shareId, token)
      return payload
    },
    onSuccess: (payload) => {
      setLayerOpsError(null)
      queryClient.invalidateQueries({ queryKey: ['layer-share-links', payload.layerId, token] })
      notify('Share link deleted', 'success')
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to delete share link'
      setLayerOpsError(message)
      notify(message, 'error')
    },
  })

  const createJoinMutation = useMutation({
    mutationFn: async (payload: { layerId: string; join: CreateLayerJoinPayload }) => {
      if (!token) {
        throw new Error('You must be signed in to create joins.')
      }
      return createLayerJoin(payload.layerId, payload.join, token)
    },
    onSuccess: (_, payload) => {
      setLayerOpsError(null)
      queryClient.invalidateQueries({ queryKey: ['layer-joins', payload.layerId, token] })
      notify('Layer join created', 'success')
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to create join'
      setLayerOpsError(message)
      notify(message, 'error')
    },
  })

  const deleteJoinMutation = useMutation({
    mutationFn: async (payload: { layerId: string; joinId: string }) => {
      if (!token) {
        throw new Error('You must be signed in to delete joins.')
      }
      await deleteLayerJoin(payload.layerId, payload.joinId, token)
      return payload
    },
    onSuccess: (payload) => {
      setLayerOpsError(null)
      queryClient.invalidateQueries({ queryKey: ['layer-joins', payload.layerId, token] })
      notify('Layer join deleted', 'success')
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to delete join'
      setLayerOpsError(message)
      notify(message, 'error')
    },
  })

  const createLayerViewMutation = useMutation({
    mutationFn: async (payload: { layerId: string; view: CreateLayerViewPayload }) => {
      if (!token) {
        throw new Error('You must be signed in to create layer views.')
      }
      return createLayerView(payload.layerId, payload.view, token)
    },
    onSuccess: (_, payload) => {
      setLayerOpsError(null)
      queryClient.invalidateQueries({ queryKey: ['layer-views', payload.layerId, token] })
      notify('Layer view created', 'success')
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to create layer view'
      setLayerOpsError(message)
      notify(message, 'error')
    },
  })

  const deleteLayerViewMutation = useMutation({
    mutationFn: async (payload: { layerId: string; viewId: string }) => {
      if (!token) {
        throw new Error('You must be signed in to delete layer views.')
      }
      await deleteLayerView(payload.layerId, payload.viewId, token)
      return payload
    },
    onSuccess: (payload) => {
      setLayerOpsError(null)
      queryClient.invalidateQueries({ queryKey: ['layer-views', payload.layerId, token] })
      notify('Layer view deleted', 'success')
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to delete layer view'
      setLayerOpsError(message)
      notify(message, 'error')
    },
  })

  const createRelationshipMutation = useMutation({
    mutationFn: async (payload: { layerId: string; relationship: CreateLayerRelationshipPayload }) => {
      if (!token) {
        throw new Error('You must be signed in to create relationships.')
      }
      return createLayerRelationship(payload.layerId, payload.relationship, token)
    },
    onSuccess: (_, payload) => {
      setLayerOpsError(null)
      queryClient.invalidateQueries({ queryKey: ['layer-relationships', payload.layerId, token] })
      notify('Layer relationship created', 'success')
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to create relationship'
      setLayerOpsError(message)
      notify(message, 'error')
    },
  })

  const deleteRelationshipMutation = useMutation({
    mutationFn: async (payload: { layerId: string; relationshipId: string }) => {
      if (!token) {
        throw new Error('You must be signed in to delete relationships.')
      }
      await deleteLayerRelationship(payload.layerId, payload.relationshipId, token)
      return payload
    },
    onSuccess: (payload) => {
      setLayerOpsError(null)
      queryClient.invalidateQueries({ queryKey: ['layer-relationships', payload.layerId, token] })
      notify('Layer relationship deleted', 'success')
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to delete relationship'
      setLayerOpsError(message)
      notify(message, 'error')
    },
  })

  const createEditSessionMutation = useMutation({
    mutationFn: async (payload: { layerId: string; session: CreateEditSessionPayload }) => {
      if (!token) {
        throw new Error('You must be signed in to create edit sessions.')
      }
      return createEditSession(payload.layerId, payload.session, token)
    },
    onSuccess: (_, payload) => {
      setLayerOpsError(null)
      queryClient.invalidateQueries({ queryKey: ['edit-sessions', payload.layerId, token] })
      notify('Edit session created', 'success')
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to create edit session'
      setLayerOpsError(message)
      notify(message, 'error')
    },
  })

  const submitEditSessionMutation = useMutation({
    mutationFn: async (payload: { layerId: string; sessionId: string }) => {
      if (!token) {
        throw new Error('You must be signed in to submit edit sessions.')
      }
      return submitEditSession(payload.layerId, payload.sessionId, token)
    },
    onSuccess: (_, payload) => {
      setLayerOpsError(null)
      queryClient.invalidateQueries({ queryKey: ['edit-sessions', payload.layerId, token] })
      notify('Edit session submitted for review', 'success')
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to submit edit session'
      setLayerOpsError(message)
      notify(message, 'error')
    },
  })

  const publishEditSessionMutation = useMutation({
    mutationFn: async (payload: { layerId: string; sessionId: string }) => {
      if (!token) {
        throw new Error('You must be signed in to publish edit sessions.')
      }
      return publishEditSession(payload.layerId, payload.sessionId, token)
    },
    onSuccess: (_, payload) => {
      setLayerOpsError(null)
      queryClient.invalidateQueries({ queryKey: ['edit-sessions', payload.layerId, token] })
      queryClient.invalidateQueries({ queryKey: ['edit-session-changes', payload.layerId] })
      setActiveEditSessionByLayerId((previous) => ({ ...previous, [payload.layerId]: null }))
      notify('Edit session published', 'success')
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to publish edit session'
      setLayerOpsError(message)
      notify(message, 'error')
    },
  })

  const abandonEditSessionMutation = useMutation({
    mutationFn: async (payload: { layerId: string; sessionId: string }) => {
      if (!token) {
        throw new Error('You must be signed in to abandon edit sessions.')
      }
      return abandonEditSession(payload.layerId, payload.sessionId, token)
    },
    onSuccess: (_, payload) => {
      setLayerOpsError(null)
      queryClient.invalidateQueries({ queryKey: ['edit-sessions', payload.layerId, token] })
      queryClient.invalidateQueries({ queryKey: ['edit-session-changes', payload.layerId] })
      setActiveEditSessionByLayerId((previous) => ({ ...previous, [payload.layerId]: null }))
      notify('Edit session abandoned', 'success')
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to abandon edit session'
      setLayerOpsError(message)
      notify(message, 'error')
    },
  })

  const createViewMutation = useMutation({
    mutationFn: async (payload: { name: string; view: MapViewportState }) => {
      if (!token) {
        throw new Error('You must be signed in to save map views.')
      }
      return createView(
        {
          name: payload.name,
          center: payload.view.center,
          zoom: payload.view.zoom,
          bearing: payload.view.bearing,
          pitch: payload.view.pitch,
        },
        token,
      )
    },
    onSuccess: () => {
      setViewsError(null)
      queryClient.invalidateQueries({ queryKey: ['map-views', token] })
      notify('Map bookmark saved', 'success')
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to save map bookmark'
      setViewsError(message)
      notify(message, 'error')
    },
  })

  const deleteViewMutation = useMutation({
    mutationFn: async (viewId: string) => {
      if (!token) {
        throw new Error('You must be signed in to delete map views.')
      }
      await deleteView(viewId, token)
    },
    onSuccess: () => {
      setViewsError(null)
      queryClient.invalidateQueries({ queryKey: ['map-views', token] })
      notify('Map bookmark deleted', 'success')
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to delete map bookmark'
      setViewsError(message)
      notify(message, 'error')
    },
  })

  const layerOpsSubmitting =
    updateLayerOrderingMutation.isPending ||
    createShareLinkMutation.isPending ||
    deleteShareLinkMutation.isPending ||
    createJoinMutation.isPending ||
    deleteJoinMutation.isPending ||
    createLayerViewMutation.isPending ||
    deleteLayerViewMutation.isPending ||
    createRelationshipMutation.isPending ||
    deleteRelationshipMutation.isPending ||
    createEditSessionMutation.isPending ||
    submitEditSessionMutation.isPending ||
    publishEditSessionMutation.isPending ||
    abandonEditSessionMutation.isPending

  const deleteLayerMutation = useMutation({
    mutationFn: async (layer: Layer) => {
      if (!token) {
        throw new Error('You must be signed in to delete layers.')
      }

      await deleteLayerApi(layer.id, token)
      return layer
    },
    onSuccess: (layer) => {
      queryClient.invalidateQueries({ queryKey: ['layers'] })
      queryClient.invalidateQueries({ queryKey: ['layer-features'] })
      if (activeEditLayerId === layer.id) {
        setActiveEditLayerId(null)
      }
      notify(`Deleted "${layer.name}"`, 'success')
    },
    onError: (error) => {
      notify(error instanceof Error ? error.message : 'Failed to delete layer', 'error')
    },
  })

  const uploadLayerMutation = useMutation({
    mutationFn: async (payload: {
      layerId: string
      file: File
      layerName: string
      sourceCrs?: string
      sourceLayer?: string
    }) => {
      if (!token) {
        throw new Error('You must be signed in to import spatial data.')
      }

      const result = await uploadLayerGeoJson(payload.layerId, payload.file, token, {
        sourceCrs: payload.sourceCrs,
        sourceLayer: payload.sourceLayer,
      })
      return { ...payload, result }
    },
    onSuccess: (payload) => {
      queryClient.invalidateQueries({ queryKey: ['layer-features', payload.layerId] })
      queryClient.invalidateQueries({ queryKey: ['layer-fields', payload.layerId] })
      queryClient.invalidateQueries({ queryKey: ['layers'] })
      setUploadOpen(false)
      setUploadError(null)
      setUploadTargetLayer(null)
      setUploadFile(null)
      const errorPart = payload.result.errors ? `, ${payload.result.errors} skipped` : ''
      const fieldPart = payload.result.fields_created
        ? `, ${payload.result.fields_created} field(s) detected`
        : ''
      notify(`Uploaded ${payload.result.inserted} feature(s) to "${payload.layerName}"${fieldPart}${errorPart}`, 'success')
    },
    onError: (error) => {
      setUploadError(error instanceof Error ? error.message : 'Upload failed')
    },
  })

  const createFeatureMutation = useMutation({
    mutationFn: async (payload: { layerId: string; feature: { geometry: Geometry; properties?: Record<string, unknown> } }) => {
      if (!token) {
        throw new Error('You must be signed in to create features.')
      }

      return createFeature(
        payload.layerId,
        {
          geometry: payload.feature.geometry,
          properties: stripInternalProperties(payload.feature.properties),
          session_id: resolveActiveSessionId(payload.layerId),
        },
        token,
      )
    },
    onSuccess: (_, payload) => {
      queryClient.invalidateQueries({ queryKey: ['layer-features', payload.layerId] })
      queryClient.invalidateQueries({ queryKey: ['layers'] })
      queryClient.invalidateQueries({ queryKey: ['edit-sessions', payload.layerId] })
      const sessionId = resolveActiveSessionId(payload.layerId)
      if (sessionId) {
        queryClient.invalidateQueries({ queryKey: ['edit-session-changes', payload.layerId, sessionId] })
      }
      notify('Feature created', 'success')
    },
    onError: (error) => {
      notify(error instanceof Error ? error.message : 'Failed to create feature', 'error')
    },
  })

  const updateFeatureMutation = useMutation({
    mutationFn: async (payload: {
      layerId: string
      featureId: string
      geometry?: Geometry
      properties?: Record<string, unknown>
      version?: number
    }) => {
      if (!token) {
        throw new Error('You must be signed in to update features.')
      }

      const queueKey = `${payload.layerId}:${payload.featureId}`
      const previousUpdate = featureUpdateQueuesRef.current.get(queueKey) ?? Promise.resolve()
      const queuedUpdate = previousUpdate
        .catch(() => undefined)
        .then(async () => {
          const latestKnownVersion = latestFeatureVersionsRef.current.get(queueKey)
          const requestedVersion = payload.version
          const version = latestKnownVersion === undefined
            ? requestedVersion
            : requestedVersion === undefined
              ? latestKnownVersion
              : Math.max(latestKnownVersion, requestedVersion)
          const updatedFeature = await updateFeature(payload.layerId, payload.featureId, {
            geometry: payload.geometry,
            properties: stripInternalProperties(payload.properties),
            version,
            session_id: resolveActiveSessionId(payload.layerId),
          }, token)
          const serverVersion = readFeatureVersion(updatedFeature.properties ?? undefined)
          if (serverVersion !== undefined) {
            latestFeatureVersionsRef.current.set(queueKey, serverVersion)
          }
          return updatedFeature
        })

      featureUpdateQueuesRef.current.set(queueKey, queuedUpdate)
      try {
        return await queuedUpdate
      } finally {
        if (featureUpdateQueuesRef.current.get(queueKey) === queuedUpdate) {
          featureUpdateQueuesRef.current.delete(queueKey)
        }
      }
    },
    onSuccess: (_, payload) => {
      queryClient.invalidateQueries({ queryKey: ['layer-features', payload.layerId] })
      queryClient.invalidateQueries({ queryKey: ['edit-sessions', payload.layerId] })
      const sessionId = resolveActiveSessionId(payload.layerId)
      if (sessionId) {
        queryClient.invalidateQueries({ queryKey: ['edit-session-changes', payload.layerId, sessionId] })
      }
      setTableError(null)
      setFeatureConflict(null)
      notify('Feature updated', 'success')
    },
    onError: (error, payload) => {
      if (error instanceof ApiError && error.status === 409) {
        const data = error.data as { server_version?: unknown } | null
        const serverVersion = typeof data?.server_version === 'number' ? data.server_version : undefined
        setFeatureConflict({
          layerId: payload.layerId,
          featureId: payload.featureId,
          geometry: payload.geometry,
          properties: payload.properties,
          serverVersion,
        })
        setTableError('Conflict detected: this feature was updated elsewhere.')
        notify('This feature changed after it was loaded. Review the conflict before saving.', 'warning')
        return
      }

      setTableError(error instanceof Error ? error.message : 'Feature update failed')
      notify(error instanceof Error ? error.message : 'Feature update failed', 'error')
    },
  })

  const deleteFeatureMutation = useMutation({
    mutationFn: async (payload: { layerId: string; featureId: string }) => {
      if (!token) {
        throw new Error('You must be signed in to delete features.')
      }

      await deleteFeatureWithSession(payload.layerId, payload.featureId, token, resolveActiveSessionId(payload.layerId))
      return payload
    },
    onSuccess: (payload) => {
      queryClient.invalidateQueries({ queryKey: ['layer-features', payload.layerId] })
      queryClient.invalidateQueries({ queryKey: ['edit-sessions', payload.layerId] })
      const sessionId = resolveActiveSessionId(payload.layerId)
      if (sessionId) {
        queryClient.invalidateQueries({ queryKey: ['edit-session-changes', payload.layerId, sessionId] })
      }
      notify('Feature deleted', 'success')
    },
    onError: (error) => {
      notify(error instanceof Error ? error.message : 'Feature delete failed', 'error')
    },
  })

  const bufferMutation = useMutation({
    mutationFn: async (payload: { layerId: string; distance: number; outputName: string }) => {
      if (!token) {
        throw new Error('Sign in to run buffer analysis.')
      }
      return runBufferAnalysis({ layer_id: payload.layerId, distance: payload.distance, output_name: payload.outputName }, token)
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['layers'] })
      queryClient.invalidateQueries({ queryKey: ['layer-features'] })
      setAnalysisError(null)
      setAnalysisOverlay(null)
      setWithinCount(null)
      completeAnalysisJob(`Buffer complete (${result.count} features)`)
      notify(`Buffer complete (${result.count} features)`, 'success')
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Buffer analysis failed'
      setAnalysisError(message)
      failAnalysisJob(message)
    },
  })

  const intersectMutation = useMutation({
    mutationFn: async (payload: { layerA: string; layerB: string; outputName: string }) => {
      if (!token) {
        throw new Error('Sign in to run intersect analysis.')
      }
      return runIntersectAnalysis({ layer_a: payload.layerA, layer_b: payload.layerB, output_name: payload.outputName }, token)
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['layers'] })
      queryClient.invalidateQueries({ queryKey: ['layer-features'] })
      setAnalysisError(null)
      setAnalysisOverlay(null)
      setWithinCount(null)
      completeAnalysisJob(`Intersect complete (${result.count} features)`)
      notify(`Intersect complete (${result.count} features)`, 'success')
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Intersect analysis failed'
      setAnalysisError(message)
      failAnalysisJob(message)
    },
  })

  const withinMutation = useMutation({
    mutationFn: async (payload: { layerId: string; polygonText: string }) => {
      const polygon = JSON.parse(payload.polygonText) as Geometry
      return runWithinAnalysis({ layer_id: payload.layerId, polygon }, token)
    },
    onSuccess: (collection) => {
      setAnalysisError(null)
      setAnalysisOverlay(collection)
      setWithinCount(collection.features.length)
      completeAnalysisJob(`Within complete (${collection.features.length} features)`)
      notify(`Within query returned ${collection.features.length} feature(s)`, 'success')
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Within analysis failed'
      setAnalysisError(message)
      failAnalysisJob(message)
    },
  })

  const analysisRunning = bufferMutation.isPending || intersectMutation.isPending || withinMutation.isPending

  const handleAuthenticated = (response: AuthResponse) => {
    setAuthTokens(response.access_token, response.refresh_token ?? null)
    setUser(response.user)
    queryClient.invalidateQueries()
    setAuthOpen(false)
    pushActivity(`Signed in as ${response.user.username}`, 'success')
  }

  const handleLogout = () => {
    if (user?.username) {
      pushActivity(`Signed out ${user.username}`, 'info')
    }
    logout()
    queryClient.removeQueries()
    setCreateLayerOpen(false)
    setCreateLayerError(null)
    setUploadOpen(false)
    setUploadTargetLayer(null)
    setUploadError(null)
    setUploadFile(null)
    setStyleOpen(false)
    setStyleLayer(null)
    setStyleError(null)
    setStyleDraft(DEFAULT_STYLE_DRAFT)
    setTableOpen(false)
    setTableLayer(null)
    setTableError(null)
    setFieldsOpen(false)
    setFieldsLayer(null)
    setFieldsError(null)
    setLayerOpsOpen(false)
    setLayerOpsLayer(null)
    setLayerOpsError(null)
    setViewsOpen(false)
    setViewsError(null)
    setCurrentMapView(null)
    setJobsOpen(false)
    setJobsError(null)
    setUtilityModeError(null)
    setFeatureConflict(null)
    setActiveEditLayerId(null)
    setMeasurementMode(null)
    setMeasurementSummary(null)
    setMeasurementResetNonce((current) => current + 1)
    setAnalysisJob(null)
  }

  const handleCreateLayer = (payload: CreateLayerPayload) => {
    setCreateLayerError(null)
    createLayerMutation.mutate(payload)
  }

  const handleCreateUtilityNetwork = (payload: CreateUtilityNetworkPayload) => {
    setUtilityModeError(null)
    createUtilityNetworkMutation.mutate(payload)
  }

  const handleCreateUtilityNode = (payload: CreateUtilityNodePayload) => {
    if (!selectedUtilityNetworkId) {
      setUtilityModeError('Select a utility network before creating a node.')
      return
    }
    setUtilityModeError(null)
    createUtilityNodeMutation.mutate({ networkId: selectedUtilityNetworkId, payload })
  }

  const handleCreateUtilityEdge = (payload: CreateUtilityEdgePayload) => {
    if (!selectedUtilityNetworkId) {
      setUtilityModeError('Select a utility network before creating an edge.')
      return
    }
    setUtilityModeError(null)
    createUtilityEdgeMutation.mutate({ networkId: selectedUtilityNetworkId, payload })
  }

  const handleCreateUtilityServicePoint = (payload: CreateUtilityServicePointPayload) => {
    if (!selectedUtilityNetworkId) {
      setUtilityModeError('Select a utility network before creating a service point.')
      return
    }
    setUtilityModeError(null)
    createUtilityServicePointMutation.mutate({ networkId: selectedUtilityNetworkId, payload })
  }

  const handleOpenUpload = (layer: Layer) => {
    setUploadTargetLayer(layer)
    setUploadFile(null)
    setUploadError(null)
    setUploadOpen(true)
  }

  const handleUploadLayer = (file: File, options: { sourceCrs?: string; sourceLayer?: string }) => {
    if (!uploadTargetLayer) {
      return
    }

    setUploadError(null)
    uploadLayerMutation.mutate({
      layerId: uploadTargetLayer.id,
      layerName: uploadTargetLayer.name,
      file,
      sourceCrs: options.sourceCrs,
      sourceLayer: options.sourceLayer,
    })
  }

  const handleOpenStyle = (layer: Layer) => {
    setStyleLayer(layer)
    setStyleError(null)
    setStyleDraft(readStyle(layer))
    setStyleOpen(true)
  }

  const handleSaveStyle = () => {
    if (!styleLayer) {
      return
    }

    styleMutation.mutate({ layer: styleLayer, style: styleDraft })
  }

  const handleOpenFields = (layer: Layer) => {
    setFieldsLayer(layer)
    setFieldsError(null)
    setFieldsOpen(true)
  }

  const handleOpenTable = (layer: Layer) => {
    setTableLayer(layer)
    setTableError(null)
    setTableOpen(true)
  }

  const handleOpenLayerOps = (layer: Layer) => {
    setLayerOpsLayer(layer)
    setLayerOpsError(null)
    setLayerOpsSelectedSessionId(activeEditSessionByLayerId[layer.id] ?? null)
    setLayerOpsOpen(true)
  }

  const handleQueryTableRows = useCallback(async (payload: FeaturesQueryPayload): Promise<FeaturesQueryResponse> => {
    if (!tableLayer) {
      throw new Error('No table layer selected')
    }
    return queryLayerFeatures(tableLayer.id, payload, token)
  }, [tableLayer, token])

  const handleSelectTableRows = useCallback(async (payload: { filters?: FeaturesQueryPayload['filters']; limit?: number }) => {
    if (!tableLayer) {
      throw new Error('No table layer selected')
    }
    return selectFeatures(tableLayer.id, payload, token)
  }, [tableLayer, token])

  const handleFetchTableStatistics = useCallback(async (payload: {
    filters?: FeaturesQueryPayload['filters']
    feature_ids?: string[]
  }) => {
    if (!tableLayer) {
      throw new Error('No table layer selected')
    }
    return fetchFeatureStatistics(tableLayer.id, payload, token)
  }, [tableLayer, token])

  const handleExportTableRows = useCallback(async (payload: {
    format: 'csv' | 'json'
    filters?: FeaturesQueryPayload['filters']
    feature_ids?: string[]
  }) => {
    if (!tableLayer) {
      throw new Error('No table layer selected')
    }
    return exportFeatureRows(tableLayer.id, payload, token)
  }, [tableLayer, token])

  const handleBulkTableUpdate = async (payload: BulkUpdatePayload): Promise<{ updated_count: number; message?: string }> => {
    if (!tableLayer) {
      throw new Error('No table layer selected')
    }
    if (!token) {
      throw new Error('Sign in to run bulk updates')
    }
    if (!canManageLayer(ownerName, tableLayer)) {
      throw new Error('Read-only layer: only the owner can run bulk updates')
    }
    const sessionId = resolveActiveSessionId(tableLayer.id)
    const result = await bulkUpdateFeatures(
      tableLayer.id,
      { ...payload, session_id: payload.session_id ?? sessionId },
      token,
    )
    queryClient.invalidateQueries({ queryKey: ['layer-features', tableLayer.id] })
    queryClient.invalidateQueries({ queryKey: ['edit-sessions', tableLayer.id] })
    if (sessionId) {
      queryClient.invalidateQueries({ queryKey: ['edit-session-changes', tableLayer.id, sessionId] })
    }
    notify(`Bulk updated ${result.updated_count} feature(s)`, 'success')
    return result
  }

  // Unused - will be implemented later
  // const handleFetchFeatureHistory = async (featureId: string) => {
  //   if (!tableLayer) {
  //     throw new Error('No table layer selected')
  //   }
  //   return fetchFeatureHistory(tableLayer.id, featureId, token)
  // }

  // const handleRollbackFeature = async (featureId: string, payload: { history_id?: string; version?: number }) => {
  //   if (!tableLayer) {
  //     throw new Error('No table layer selected')
  //   }
  //   if (!token) {
  //     throw new Error('Sign in to rollback feature history')
  //   }
  //   if (!canManageLayer(ownerName, tableLayer)) {
  //     throw new Error('Read-only layer: only the owner can rollback features')
  //   }
  //   await rollbackFeature(tableLayer.id, featureId, payload, token)
  //   queryClient.invalidateQueries({ queryKey: ['layer-features', tableLayer.id] })
  //   notify('Feature rolled back', 'success')
  // }

  const handleSaveProperties = async (
    featureId: string,
    properties: Record<string, unknown>,
    version?: number,
  ): Promise<number> => {
    if (!tableLayer) {
      throw new Error('No attribute table layer is selected.')
    }

    if (!canManageLayer(ownerName, tableLayer)) {
      setTableError('Read-only layer: only the owner can edit properties.')
      throw new Error('Read-only layer: only the owner can edit properties.')
    }

    setTableError(null)
    const updatedFeature = await updateFeatureMutation.mutateAsync({
      layerId: tableLayer.id,
      featureId,
      properties,
      version,
    })
    return readFeatureVersion(updatedFeature.properties ?? undefined) ?? version ?? 1
  }

  const handleOpenViews = () => {
    setViewsError(null)
    setViewsOpen(true)
  }

  const handleGoToView = (view: MapView) => {
    setLocateRequest({
      lng: view.center.lng,
      lat: view.center.lat,
      zoom: view.zoom,
      bearing: view.bearing,
      pitch: view.pitch,
      nonce: Date.now(),
    })
    notify(`Moved to bookmark "${view.name}"`, 'info')
  }

  const handleOpenJobs = () => {
    setJobsError(null)
    setJobsOpen(true)
  }

  const handleCreateField = (payload: CreateLayerFieldPayload) => {
    if (!fieldsLayer) {
      return
    }
    setFieldsError(null)
    createFieldMutation.mutate({ layerId: fieldsLayer.id, field: payload })
  }

  const handleUpdateField = (fieldId: string, payload: UpdateLayerFieldPayload) => {
    if (!fieldsLayer) {
      return
    }
    setFieldsError(null)
    updateFieldMutation.mutate({ layerId: fieldsLayer.id, fieldId, field: payload })
  }

  const handleDeleteField = (fieldId: string) => {
    if (!fieldsLayer) {
      return
    }
    if (!window.confirm('Delete this field from the schema and remove it from existing feature attributes?')) {
      return
    }
    setFieldsError(null)
    deleteFieldMutation.mutate({ layerId: fieldsLayer.id, fieldId })
  }

  const handleCreateDomain = (payload: CreateLayerDomainPayload) => {
    if (!fieldsLayer) {
      return
    }
    setFieldsError(null)
    createDomainMutation.mutate({ layerId: fieldsLayer.id, domain: payload })
  }

  const handleUpdateDomain = (domainId: string, payload: UpdateLayerDomainPayload) => {
    if (!fieldsLayer) {
      return
    }
    setFieldsError(null)
    updateDomainMutation.mutate({ layerId: fieldsLayer.id, domainId, domain: payload })
  }

  const handleDeleteDomain = (domainId: string) => {
    if (!fieldsLayer) {
      return
    }
    if (!window.confirm('Delete this domain? Fields using it will be detached.')) {
      return
    }
    setFieldsError(null)
    deleteDomainMutation.mutate({ layerId: fieldsLayer.id, domainId })
  }

  const handleUpdateLayerOrdering = (payload: { group_name: string; z_index: number }) => {
    if (!layerOpsLayer) {
      return
    }
    setLayerOpsError(null)
    updateLayerOrderingMutation.mutate({ layerId: layerOpsLayer.id, ...payload })
  }

  const handleCreateShareLink = (payload: CreateShareLinkPayload) => {
    if (!layerOpsLayer) {
      return
    }
    setLayerOpsError(null)
    createShareLinkMutation.mutate({ layerId: layerOpsLayer.id, share: payload })
  }

  const handleDeleteShareLink = (shareId: string) => {
    if (!layerOpsLayer) {
      return
    }
    if (!window.confirm('Delete this share link?')) {
      return
    }
    setLayerOpsError(null)
    deleteShareLinkMutation.mutate({ layerId: layerOpsLayer.id, shareId })
  }

  const handleCreateJoin = (payload: CreateLayerJoinPayload) => {
    if (!layerOpsLayer) {
      return
    }
    setLayerOpsError(null)
    createJoinMutation.mutate({ layerId: layerOpsLayer.id, join: payload })
  }

  const handleDeleteJoin = (joinId: string) => {
    if (!layerOpsLayer) {
      return
    }
    if (!window.confirm('Delete this join definition?')) {
      return
    }
    setLayerOpsError(null)
    deleteJoinMutation.mutate({ layerId: layerOpsLayer.id, joinId })
  }

  const handleCreateLayerView = (payload: CreateLayerViewPayload) => {
    if (!layerOpsLayer) {
      return
    }
    setLayerOpsError(null)
    createLayerViewMutation.mutate({ layerId: layerOpsLayer.id, view: payload })
  }

  const handleDeleteLayerView = (viewId: string) => {
    if (!layerOpsLayer) {
      return
    }
    if (!window.confirm('Delete this layer view?')) {
      return
    }
    setLayerOpsError(null)
    deleteLayerViewMutation.mutate({ layerId: layerOpsLayer.id, viewId })
  }

  const handleCreateRelationship = (payload: CreateLayerRelationshipPayload) => {
    if (!layerOpsLayer) {
      return
    }
    setLayerOpsError(null)
    createRelationshipMutation.mutate({ layerId: layerOpsLayer.id, relationship: payload })
  }

  const handleDeleteRelationship = (relationshipId: string) => {
    if (!layerOpsLayer) {
      return
    }
    if (!window.confirm('Delete this relationship?')) {
      return
    }
    setLayerOpsError(null)
    deleteRelationshipMutation.mutate({ layerId: layerOpsLayer.id, relationshipId })
  }

  const handleCreateEditSession = (payload: CreateEditSessionPayload) => {
    if (!layerOpsLayer) {
      return
    }
    setLayerOpsError(null)
    createEditSessionMutation.mutate({ layerId: layerOpsLayer.id, session: payload })
  }

  const handleSubmitEditSession = (sessionId: string) => {
    if (!layerOpsLayer) {
      return
    }
    setLayerOpsError(null)
    submitEditSessionMutation.mutate({ layerId: layerOpsLayer.id, sessionId })
  }

  const handlePublishEditSession = (sessionId: string) => {
    if (!layerOpsLayer) {
      return
    }
    if (!window.confirm('Publish this edit session? This should finalize tracked edits.')) {
      return
    }
    setLayerOpsError(null)
    publishEditSessionMutation.mutate({ layerId: layerOpsLayer.id, sessionId })
  }

  const handleAbandonEditSession = (sessionId: string) => {
    if (!layerOpsLayer) {
      return
    }
    if (!window.confirm('Abandon this edit session?')) {
      return
    }
    setLayerOpsError(null)
    abandonEditSessionMutation.mutate({ layerId: layerOpsLayer.id, sessionId })
  }

  const handleSetActiveEditSession = (sessionId: string | null) => {
    if (!layerOpsLayer) {
      return
    }
    setActiveEditSessionByLayerId((previous) => ({ ...previous, [layerOpsLayer.id]: sessionId }))
    if (sessionId) {
      notify(`Activated edit session for "${layerOpsLayer.name}"`, 'info')
    } else {
      notify(`Cleared active edit session for "${layerOpsLayer.name}"`, 'info')
    }
  }

  const handleLoadEditSessionChanges = (sessionId: string | null) => {
    setLayerOpsSelectedSessionId(sessionId)
    if (!sessionId || !layerOpsLayer) {
      return
    }
    queryClient.invalidateQueries({ queryKey: ['edit-session-changes', layerOpsLayer.id, sessionId, token] })
  }

  const handleCreateView = (name: string, view: MapViewportState) => {
    setViewsError(null)
    createViewMutation.mutate({ name, view })
  }

  const handleDeleteView = (viewId: string) => {
    if (!window.confirm('Delete this bookmark?')) {
      return
    }
    setViewsError(null)
    deleteViewMutation.mutate(viewId)
  }

  const handleExportLayer = async (layer: Layer) => {
    if (!token && !layer.is_public) {
      notify('Sign in to export private layers.', 'warning')
      return
    }

    try {
      const blob = await exportLayerGeoJson(layer.id, token ?? '')
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = `${layer.name.replace(/\s+/g, '_') || 'layer'}.geojson`
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      URL.revokeObjectURL(objectUrl)
      notify(`Exported "${layer.name}"`, 'success')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Failed to export layer', 'error')
    }
  }

  const handleDeleteLayer = (layer: Layer) => {
    if (!window.confirm(`Delete layer "${layer.name}" and all its features?`)) {
      return
    }

    deleteLayerMutation.mutate(layer)
  }

  const handleZoomLayer = (layer: Layer) => {
    const count = featureCollections[layer.id]?.features.length ?? 0
    if (!count) {
      notify(`Layer "${layer.name}" has no features to zoom to`, 'warning')
      return
    }

    setZoomRequest({ layerId: layer.id, nonce: Date.now() })
  }

  const handleFitVisible = () => {
    const visibleCount = Object.entries(featureCollections).reduce((acc, [layerId, collection]) => {
      if (!resolvedVisibility[layerId]) {
        return acc
      }
      return acc + (collection?.features.length ?? 0)
    }, 0)

    if (!visibleCount) {
      notify('No visible features to fit', 'warning')
      return
    }

    setFitVisibleRequest({ nonce: Date.now() })
  }

  // Phase 1: Attribute Table Selection Handlers
  const handleFeatureSelectionChange = (layerId: string, featureIds: string[]) => {
    setSelectedFeaturesByLayer((prev) => ({
      ...prev,
      [layerId]: featureIds,
    }))
  }

  const handleZoomToFeature = (layerId: string, featureId: string) => {
    setFeatureZoomRequest({ layerId, featureIds: [featureId], nonce: Date.now() })
  }

  const handleZoomToSelection = (layerId: string, featureIds: string[]) => {
    if (!featureIds.length) {
      notify('No features selected to zoom to', 'warning')
      return
    }
    setFeatureZoomRequest({ layerId, featureIds, nonce: Date.now() })
  }

  const handleFlashFeature = (layerId: string, featureId: string) => {
    setFlashFeatureRequest({ layerId, featureId, nonce: Date.now() })
  }

  const handlePanToFeature = (layerId: string, featureId: string) => {
    // setHighlightedFeature({ layerId, featureId })
    // Pan will be handled in MapCanvas based on highlightedFeature
    // Note: highlightedFeature state currently unused - could be implemented later
    console.log('Pan to feature:', layerId, featureId)
  }

  const handleToggleMeasurement = (mode: Exclude<MeasurementMode, null>) => {
    setMeasurementSummary(null)
    setMeasurementResetNonce((current) => current + 1)
    setMeasurementMode((current) => {
      const next = current === mode ? null : mode
      if (next) {
        pushActivity(`${next === 'distance' ? 'Distance' : 'Area'} measurement enabled`, 'info')
      } else {
        pushActivity('Measurement disabled', 'info')
      }
      return next
    })
  }

  const handleClearMeasurement = () => {
    setMeasurementSummary(null)
    setMeasurementMode(null)
    setMeasurementResetNonce((current) => current + 1)
    pushActivity('Measurement cleared', 'info')
  }

  const handleReloadConflictFeature = () => {
    if (!featureConflict) {
      return
    }

    queryClient.invalidateQueries({ queryKey: ['layer-features', featureConflict.layerId] })
    setFeatureConflict(null)
    setTableError(null)
    notify('Loaded latest feature state from server.', 'info')
  }

  const handleOverwriteConflict = () => {
    if (!featureConflict) {
      return
    }

    if (typeof featureConflict.serverVersion !== 'number') {
      handleReloadConflictFeature()
      return
    }

    updateFeatureMutation.mutate({
      layerId: featureConflict.layerId,
      featureId: featureConflict.featureId,
      geometry: featureConflict.geometry,
      properties: featureConflict.properties,
      version: featureConflict.serverVersion,
    })
    setFeatureConflict(null)
    setTableError(null)
    notify('Retrying update using latest server version…', 'info')
  }

  const handleSearch = async () => {
    const query = searchText.trim()
    if (!query) {
      return
    }

    setSearching(true)
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`,
        { headers: { 'Accept-Language': 'en' } },
      )
      const data = (await response.json()) as SearchResult[]
      const top = data[0]
      if (!top) {
        notify('No place found for search query', 'warning')
        return
      }

      setLocateRequest({
        lng: Number(top.lon),
        lat: Number(top.lat),
        zoom: 14,
        nonce: Date.now(),
      })
      notify(top.display_name.split(',').slice(0, 2).join(','), 'info')
    } catch {
      notify('Search failed', 'error')
    } finally {
      setSearching(false)
    }
  }

  const handleLegendModeChange = (mode: LegendMode) => {
    setLegendMode(mode)
    notify(`Legend mode set to ${mode}`, 'info', false)
  }

  const handleToggleAppMode = () => {
    const nextMode: AppMode = appMode === 'utilities' ? 'standard' : 'utilities'
    setAppMode(nextMode)
    setUtilityModeError(null)
    notify(nextMode === 'utilities' ? 'Utility mode activated' : 'Standard GIS mode activated', 'info')
  }

  const handleToggleLegendItem = (layerId: string, itemKey: string) => {
    setLegendFiltersByLayerId((previous) => {
      const current = new Set(previous[layerId] ?? [])
      if (current.has(itemKey)) {
        current.delete(itemKey)
      } else {
        current.add(itemKey)
      }
      return {
        ...previous,
        [layerId]: Array.from(current),
      }
    })
  }

  const handleResetLegendFilters = (layerId?: string) => {
    if (layerId) {
      setLegendFiltersByLayerId((previous) => ({ ...previous, [layerId]: [] }))
      return
    }
    setLegendFiltersByLayerId({})
  }

  const queueEditCommand = (action: EditCommand['action']) => {
    if (!activeEditLayerId) {
      notify('Enable draw/edit mode on a layer first.', 'warning')
      return
    }
    setEditCommand({
      action,
      nonce: Date.now() + Math.floor(Math.random() * 1000),
    })
  }

  const activeEditLayer = activeEditLayerId ? layerById[activeEditLayerId] ?? null : null
  const editableLayerFeatures = activeEditLayerId ? featureCollections[activeEditLayerId] ?? null : null
  const selectedUtilityNetwork = selectedUtilityNetworkId
    ? utilityNetworks.find((network) => network.id === selectedUtilityNetworkId) ?? null
    : null
  const utilityOverlay = useMemo(
    () =>
      appMode === 'utilities' && selectedUtilityNetwork
        ? {
            networkName: selectedUtilityNetwork.name,
            utilityType: selectedUtilityNetwork.utility_type,
            nodes: utilityNodesQuery.data ?? null,
            edges: utilityEdgesQuery.data ?? null,
            servicePoints: utilityServicePointsQuery.data ?? null,
          }
        : null,
    [
      appMode,
      selectedUtilityNetwork,
      utilityNodesQuery.data,
      utilityEdgesQuery.data,
      utilityServicePointsQuery.data,
    ],
  )
  const selectedModeMeta = ADVANCED_EDIT_MODE_OPTIONS.find((option) => option.value === advancedEditMode)
  const favoriteToolsSet = useMemo(() => new Set(favoriteEditTools), [favoriteEditTools])
  const activeEditStyle = (activeEditLayer?.style ?? null) as Record<string, unknown> | null
  const activeLayerSnapEnabled = Boolean(activeEditStyle?.snap_enabled ?? activeEditStyle?.snapEnabled)
  const activeLayerSnapTolerance = Math.max(
    1,
    Number(
      activeEditStyle?.snap_tolerance_m ??
      activeEditStyle?.snapToleranceMeters ??
      DEFAULT_STYLE_DRAFT.snapToleranceMeters,
    ) || DEFAULT_STYLE_DRAFT.snapToleranceMeters,
  )
  const activeLayerTopologyNoOverlap = Boolean(activeEditStyle?.topology_no_overlap ?? activeEditStyle?.topologyNoOverlap)
  const activeLayerIsPolygonFamily = Boolean(activeEditLayer?.geometry_type?.toLowerCase().includes('polygon'))
  const quickEditStyleBusy = quickEditStyleMutation.isPending

  const drawBusy = createFeatureMutation.isPending || updateFeatureMutation.isPending || deleteFeatureMutation.isPending
  const measurementLabel = measurementSummary
    ? `${measurementSummary.mode === 'distance' ? 'Distance' : 'Area'}: ${measurementSummary.formatted}`
    : measurementMode === 'distance'
      ? 'Distance: click map to add points'
      : measurementMode === 'area'
        ? 'Area: click map to add vertices'
        : null
  const snapChipColor: 'default' | 'success' | 'warning' =
    editUiState?.snapEnabled && !editUiState.snapTemporarilyDisabled
      ? editUiState.snapCandidate
        ? 'success'
        : 'default'
      : 'warning'
  const snapChipLabel = !editUiState?.snapEnabled
    ? 'Snap off'
    : editUiState.snapTemporarilyDisabled
      ? 'Snap paused (Alt)'
      : editUiState.snapCandidate
        ? 'Snap target acquired'
        : `Snap tolerance: ${editUiState.snapTolerancePixels}px`

  const applyQuickEditStylePatch = (patch: Partial<LayerStyleDraft>) => {
    if (!activeEditLayer) {
      return
    }
    quickEditStyleMutation.mutate({ layer: activeEditLayer, patch })
  }

  const toggleFavoriteEditTool = (mode: AdvancedEditMode) => {
    setFavoriteEditTools((previous) => {
      const current = new Set(previous)
      if (current.has(mode)) {
        current.delete(mode)
      } else {
        current.add(mode)
      }
      return Array.from(current)
    })
  }

  const filteredEditTools = useMemo(() => {
    const query = editToolSearch.trim().toLowerCase()
    return ADVANCED_EDIT_MODE_OPTIONS.filter((tool) => {
      if (editToolTab === 'my' && !favoriteToolsSet.has(tool.value)) {
        return false
      }
      if (!query) {
        return true
      }
      const haystack = `${tool.label} ${tool.helper} ${tool.group} ${tool.keywords.join(' ')}`.toLowerCase()
      return haystack.includes(query)
    })
  }, [editToolSearch, editToolTab, favoriteToolsSet])

  const groupedEditTools = useMemo(() => {
    const groups: Record<EditToolGroup, typeof ADVANCED_EDIT_MODE_OPTIONS> = {
      Alignment: [],
      Reshape: [],
      Construction: [],
    }
    for (const tool of filteredEditTools) {
      groups[tool.group].push(tool)
    }
    return groups
  }, [filteredEditTools])

  const toolIconForMode = (mode: AdvancedEditMode) => {
    if (mode === 'align') {
      return <ViewColumnIcon fontSize="small" />
    }
    if (mode === 'rotate-scale') {
      return <ZoomOutMapIcon fontSize="small" />
    }
    if (mode === 'reshape') {
      return <EditLocationAltIcon fontSize="small" />
    }
    if (mode === 'split') {
      return <ViewSidebarIcon fontSize="small" />
    }
    if (mode === 'trace') {
      return <SearchIcon fontSize="small" />
    }
    if (mode === 'rectangular-constraints') {
      return <SquareFootIcon fontSize="small" />
    }
    return <StraightenIcon fontSize="small" />
  }

  const toggleEditToolGroup = (group: EditToolGroup) => {
    setOpenEditToolGroups((previous) => ({
      ...previous,
      [group]: !previous[group],
    }))
  }

  const editToolsContent = activeEditLayer ? (
    <Stack spacing={1}>
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap' }}>
        <Chip
          size="small"
          color="primary"
          label={`${editState.selectedCount} selected`}
        />
        <Chip size="small" variant="outlined" label={editState.canUndo ? 'Undo ready' : 'Undo empty'} />
        <Chip size="small" variant="outlined" label={editState.canRedo ? 'Redo ready' : 'Redo empty'} />
      </Stack>

      {editUiState && (
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap' }}>
          <Chip size="small" variant="outlined" label={`Cursor: ${editUiState.cursor}`} />
          <Chip size="small" variant="outlined" label={`Draw mode: ${editUiState.drawMode}`} />
          <Chip size="small" variant="outlined" color={snapChipColor} label={snapChipLabel} />
        </Stack>
      )}

      {activeEditLayer?.geometry_type?.includes('Polygon') && (
        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, p: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.75 }}>
            Draw Shapes
          </Typography>

          <ToggleButtonGroup
            value={activeShapeType}
            exclusive
            onChange={(_, newShape: typeof activeShapeType) => {
              setActiveShapeType(newShape)
            }}
            size="small"
            sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: activeShapeType ? 1.5 : 0 }}
          >
            <Tooltip title="Circle" arrow>
              <ToggleButton value="circle" sx={{ flex: '1 1 auto', minWidth: '42px' }}>
                <CircleOutlinedIcon fontSize="small" />
              </ToggleButton>
            </Tooltip>
            <Tooltip title="Rectangle" arrow>
              <ToggleButton value="rectangle" sx={{ flex: '1 1 auto', minWidth: '42px' }}>
                <RectangleOutlinedIcon fontSize="small" />
              </ToggleButton>
            </Tooltip>
            <Tooltip title="Square" arrow>
              <ToggleButton value="square" sx={{ flex: '1 1 auto', minWidth: '42px' }}>
                <CropSquareIcon fontSize="small" />
              </ToggleButton>
            </Tooltip>
            <Tooltip title="Triangle" arrow>
              <ToggleButton value="triangle" sx={{ flex: '1 1 auto', minWidth: '42px' }}>
                <ChangeHistoryIcon fontSize="small" />
              </ToggleButton>
            </Tooltip>
            <Tooltip title="Pentagon" arrow>
              <ToggleButton value="pentagon" sx={{ flex: '1 1 auto', minWidth: '42px' }}>
                <PentagonOutlinedIcon fontSize="small" />
              </ToggleButton>
            </Tooltip>
            <Tooltip title="Hexagon" arrow>
              <ToggleButton value="hexagon" sx={{ flex: '1 1 auto', minWidth: '42px' }}>
                <HexagonOutlinedIcon fontSize="small" />
              </ToggleButton>
            </Tooltip>
            <Tooltip title="Star" arrow>
              <ToggleButton value="star" sx={{ flex: '1 1 auto', minWidth: '42px' }}>
                <StarBorderIcon fontSize="small" />
              </ToggleButton>
            </Tooltip>
          </ToggleButtonGroup>

          {activeShapeType && (
            <Box>
              <Typography variant="caption" color="text.secondary" gutterBottom display="block">
                Default Size: {shapeSize}m
              </Typography>
              <TextField
                size="small"
                type="number"
                value={shapeSize}
                onChange={(e) => {
                  const value = Number(e.target.value)
                  if (value >= 10) {
                    setShapeSize(value)
                  }
                }}
                inputProps={{ min: 10, step: 10 }}
                fullWidth
                sx={{ mb: 1 }}
              />
              <Alert severity="info" sx={{ mb: 0.75 }}>
                <Typography variant="caption" display="block">
                  <strong>Click and drag</strong> on the map to draw the {activeShapeType}
                </Typography>
                <Typography variant="caption" display="block" sx={{ mt: 0.25 }}>
                  Or <strong>single click</strong> to use default size ({shapeSize}m)
                </Typography>
              </Alert>
              <Button
                fullWidth
                variant="outlined"
                size="small"
                onClick={() => setActiveShapeType(null)}
              >
                Cancel
              </Button>
            </Box>
          )}
        </Box>
      )}

      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, p: 1 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.75 }}>
          Modify Features
        </Typography>
        <TextField
          size="small"
          fullWidth
          placeholder="Search tools"
          value={editToolSearch}
          onChange={(event) => setEditToolSearch(event.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
        />
        <Tabs
          value={editToolTab}
          onChange={(_, value: EditToolTab) => setEditToolTab(value)}
          variant="fullWidth"
          sx={{ minHeight: 34, mt: 0.75, mb: 0.5 }}
        >
          <Tab value="all" label="All Tools" sx={{ minHeight: 34, textTransform: 'none' }} />
          <Tab value="my" label={`My Tools (${favoriteEditTools.length})`} sx={{ minHeight: 34, textTransform: 'none' }} />
        </Tabs>

        {editToolTab === 'my' && !favoriteEditTools.length && (
          <Alert severity="info" sx={{ mb: 0.75 }}>
            Pin tools with the bookmark icon to build My Tools.
          </Alert>
        )}

        {!filteredEditTools.length && (
          <Alert severity="warning" sx={{ mb: 0.75 }}>
            No tools match the current search.
          </Alert>
        )}

        <Stack spacing={1}>
          {EDIT_TOOL_GROUP_ORDER.map((group) => {
            const tools = groupedEditTools[group]
            if (!tools.length) {
              return null
            }
            const open = openEditToolGroups[group]
            return (
              <Box key={group}>
                <Button
                  size="small"
                  fullWidth
                  color="inherit"
                  onClick={() => toggleEditToolGroup(group)}
                  endIcon={open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                  sx={{ justifyContent: 'space-between', textTransform: 'none', mb: 0.4, fontWeight: 700 }}
                >
                  {group}
                </Button>
                {open && (
                  <Stack spacing={0.5}>
                    {tools.map((tool) => {
                      const selected = advancedEditMode === tool.value
                      const favorite = favoriteToolsSet.has(tool.value)
                      return (
                        <Stack key={tool.value} direction="row" spacing={0.5} alignItems="center">
                          <Button
                            size="small"
                            variant={selected ? 'contained' : 'outlined'}
                            color={selected ? 'primary' : 'inherit'}
                            fullWidth
                            startIcon={toolIconForMode(tool.value)}
                            sx={{ justifyContent: 'flex-start', textTransform: 'none' }}
                            onClick={() => setAdvancedEditMode(tool.value)}
                          >
                            {tool.label}
                          </Button>
                          <Tooltip title={favorite ? 'Remove from My Tools' : 'Add to My Tools'}>
                            <IconButton
                              size="small"
                              onClick={() => toggleFavoriteEditTool(tool.value)}
                              sx={favorite ? undefined : { opacity: 0.45 }}
                            >
                              <BookmarkAddedIcon fontSize="small" color={favorite ? 'primary' : 'inherit'} />
                            </IconButton>
                          </Tooltip>
                        </Stack>
                      )
                    })}
                  </Stack>
                )}
              </Box>
            )
          })}
        </Stack>
      </Box>

      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap' }}>
        <Button
          size="small"
          variant={activeLayerSnapEnabled ? 'contained' : 'outlined'}
          onClick={() => applyQuickEditStylePatch({ snapEnabled: !activeLayerSnapEnabled })}
          disabled={quickEditStyleBusy}
        >
          {activeLayerSnapEnabled ? 'Snap On' : 'Snap Off'}
        </Button>
        <Button
          size="small"
          variant="outlined"
          onClick={() => applyQuickEditStylePatch({ snapToleranceMeters: Math.max(1, activeLayerSnapTolerance - 1) })}
          disabled={quickEditStyleBusy}
        >
          Tol -
        </Button>
        <Chip size="small" variant="outlined" label={`${activeLayerSnapTolerance} m`} />
        <Button
          size="small"
          variant="outlined"
          onClick={() => applyQuickEditStylePatch({ snapToleranceMeters: Math.min(200, activeLayerSnapTolerance + 1) })}
          disabled={quickEditStyleBusy}
        >
          Tol +
        </Button>
        {activeLayerIsPolygonFamily && (
          <Button
            size="small"
            variant={activeLayerTopologyNoOverlap ? 'contained' : 'outlined'}
            onClick={() => applyQuickEditStylePatch({ topologyNoOverlap: !activeLayerTopologyNoOverlap })}
            disabled={quickEditStyleBusy}
          >
            {activeLayerTopologyNoOverlap ? 'No-Overlap On' : 'No-Overlap Off'}
          </Button>
        )}
      </Stack>

      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, p: 1 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.75 }}>
          Tool Settings
        </Typography>

        {advancedEditMode === 'rotate-scale' && (
          <Stack spacing={0.75}>
            <Box display="grid" gridTemplateColumns="1fr 1fr" gap={1}>
              <TextField
                size="small"
                type="number"
                label="Rotate (°)"
                value={advancedEditOptions.rotateDegrees}
                onChange={(event) => {
                  const next = Number(event.target.value)
                  setAdvancedEditOptions((previous) => ({
                    ...previous,
                    rotateDegrees: Number.isFinite(next) ? next : previous.rotateDegrees,
                  }))
                }}
              />
              <TextField
                size="small"
                type="number"
                inputProps={{ step: 0.1, min: 0.1 }}
                label="Scale"
                value={advancedEditOptions.scaleFactor}
                onChange={(event) => {
                  const next = Number(event.target.value)
                  setAdvancedEditOptions((previous) => ({
                    ...previous,
                    scaleFactor: Number.isFinite(next) && next > 0 ? next : previous.scaleFactor,
                  }))
                }}
              />
            </Box>
            <Typography variant="caption" color="text.secondary">
              Drag the orange handle above the selection to rotate. Hold <strong>Shift</strong> while dragging to scale.
            </Typography>
          </Stack>
        )}

        {advancedEditMode === 'reshape' && (
          <Stack spacing={0.75}>
            <TextField
              size="small"
              type="number"
              inputProps={{ step: 0.05, min: 0.1, max: 1 }}
              label="Reshape Strength (0.1 - 1)"
              value={advancedEditOptions.reshapeStrength}
              onChange={(event) => {
                const next = Number(event.target.value)
                setAdvancedEditOptions((previous) => ({
                  ...previous,
                  reshapeStrength: Number.isFinite(next) ? Math.max(0.1, Math.min(1, next)) : previous.reshapeStrength,
                }))
              }}
              fullWidth
            />
            <Typography variant="caption" color="text.secondary">
              Drag vertices directly on the map to reshape geometry. Use Apply for smoothing strength.
            </Typography>
          </Stack>
        )}

        {advancedEditMode === 'split' && (
          <Typography variant="caption" color="text.secondary">
            Select one or more features, then draw a temporary split line on the map canvas.
          </Typography>
        )}

        {advancedEditMode === 'grid-lock' && (
          <TextField
            size="small"
            type="number"
            inputProps={{ step: 0.5, min: 0.5 }}
            label="Grid Size (meters)"
            value={advancedEditOptions.gridSizeMeters}
            onChange={(event) => {
              const next = Number(event.target.value)
              setAdvancedEditOptions((previous) => ({
                ...previous,
                gridSizeMeters: Number.isFinite(next) ? Math.max(0.5, next) : previous.gridSizeMeters,
              }))
            }}
            fullWidth
          />
        )}

        {advancedEditMode === 'align' && (
          <TextField
            select
            size="small"
            label="Align Target"
            value={advancedEditOptions.alignTarget}
            onChange={(event) =>
              setAdvancedEditOptions((previous) => ({
                ...previous,
                alignTarget: event.target.value as AdvancedEditOptions['alignTarget'],
              }))
            }
            fullWidth
          >
            {ALIGN_TARGET_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
        )}
      </Box>

      <Stack direction="row" spacing={0.75} alignItems="center">
        <Button
          size="small"
          variant="contained"
          onClick={() => queueEditCommand('apply')}
        >
          Apply
        </Button>
        <Tooltip title="Undo">
          <span>
            <IconButton size="small" onClick={() => queueEditCommand('undo')} disabled={!editState.canUndo}>
              <UndoIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Redo">
          <span>
            <IconButton size="small" onClick={() => queueEditCommand('redo')} disabled={!editState.canRedo}>
              <RedoIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      <Typography variant="caption" color="text.secondary">
        {selectedModeMeta?.helper ?? 'Select a mode and apply to selected features.'}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        Hold <strong>Alt</strong> to temporarily disable snapping while editing.
      </Typography>
    </Stack>
  ) : null

  const drawerContent = (
    <Box>
      <Toolbar sx={{ minHeight: 72 }} />
      <Box sx={{ px: 2, pb: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            {appMode === 'utilities' ? 'Utility Workspace' : 'Data Layers'}
          </Typography>
          <Chip label={appMode === 'utilities' ? `${utilityNetworks.length} networks` : `${layers.length} layers`} size="small" />
        </Stack>

        {appMode === 'utilities' && (
          <UtilityModePanel
            userId={user?.id ?? null}
            networks={utilityNetworks}
            selectedNetworkId={selectedUtilityNetworkId}
            summary={utilityNetworkSummary}
            nodes={utilityNodesQuery.data ?? null}
            edges={utilityEdgesQuery.data ?? null}
            servicePoints={utilityServicePointsQuery.data ?? null}
            loading={utilityModeLoading}
            detailLoading={utilityModeDetailLoading}
            creating={createUtilityNetworkMutation.isPending}
            creatingNode={createUtilityNodeMutation.isPending}
            creatingEdge={createUtilityEdgeMutation.isPending}
            creatingServicePoint={createUtilityServicePointMutation.isPending}
            error={utilityModeQueryError}
            onSelectNetwork={(networkId) => {
              setSelectedUtilityNetworkId(networkId)
              setUtilityModeError(null)
            }}
            onCreateNetwork={handleCreateUtilityNetwork}
            onCreateNode={handleCreateUtilityNode}
            onCreateEdge={handleCreateUtilityEdge}
            onCreateServicePoint={handleCreateUtilityServicePoint}
          />
        )}

        {activeEditLayer && (
          <Box sx={{ mb: 1.5 }}>
            <Alert severity="info" sx={{ mb: 1 }}>
              Draw/Edit mode active: <strong>{activeEditLayer.name}</strong>
            </Alert>
            {workMode ? (
              <Alert severity="info">
                Work mode is active. Advanced edit tools are docked in the right-side workbench.
              </Alert>
            ) : (
              <Box
                sx={{
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1.5,
                  p: 1.25,
                  bgcolor: 'background.paper',
                }}
              >
                {editToolsContent}
              </Box>
            )}
          </Box>
        )}

        {layersQuery.isLoading && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1 }}>
            <CircularProgress size={18} />
            <Typography variant="body2">Loading layers...</Typography>
          </Box>
        )}

        {layersQuery.error instanceof Error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {layersQuery.error.message}
          </Alert>
        )}

        {!layersQuery.isLoading && !layers.length && (
          <Alert severity="info">No layers available. Sign in to create private layers.</Alert>
        )}

        <List dense disablePadding>
          {layers.map((layer) => {
            const featureCount = featureCountByLayerId[layer.id]
            const isOwner = canManageLayer(ownerName, layer)
            const readOnly = !isOwner

            return (
              <Box key={layer.id}>
                <ListItem
                  disableGutters
                  secondaryAction={
                    <Switch
                      edge="end"
                      checked={resolvedVisibility[layer.id]}
                      onChange={(_, checked) => {
                        setVisibleByLayerId((previous) => ({ ...previous, [layer.id]: checked }))
                      }}
                    />
                  }
                >
                  <ListItemText
                    primary={
                      <Stack direction="row" spacing={0.75} alignItems="center">
                        <span>{layer.name}</span>
                        {readOnly ? <Chip label="Read-only" size="small" color="default" /> : <Chip label="Owner" size="small" color="success" />}
                      </Stack>
                    }
                    secondary={`${layerSubtitle(layer)}${featureCount != null ? ` · ${featureCount} features` : ''}`}
                    primaryTypographyProps={{ fontWeight: 600, fontSize: '0.9rem', component: 'div' }}
                    secondaryTypographyProps={{ fontSize: '0.78rem' }}
                  />
                </ListItem>

                <Stack direction="row" spacing={0.3} sx={{ pl: 0.5, pb: 1, flexWrap: 'wrap' }}>
                  <Tooltip title={isOwner ? 'Toggle draw/edit mode' : 'Only owner can edit geometry'}>
                    <span>
                      <IconButton
                        size="small"
                        color={activeEditLayerId === layer.id ? 'primary' : 'default'}
                        onClick={() => {
                          if (!isOwner) {
                            return
                          }
                          setActiveEditLayerId((current) => {
                            const next = current === layer.id ? null : layer.id
                            if (next) {
                              setMeasurementMode(null)
                              setMeasurementSummary(null)
                              setMeasurementResetNonce((value) => value + 1)
                            }
                            return next
                          })
                        }}
                        disabled={!isOwner || drawBusy}
                      >
                        <EditLocationAltIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>

                  <Tooltip title="View attributes">
                    <span>
                      <IconButton size="small" onClick={() => handleOpenTable(layer)}>
                        <TableViewIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>

                  <Tooltip title={isOwner ? 'Manage fields/domains' : 'Only owner can manage schema'}>
                    <span>
                      <IconButton size="small" onClick={() => handleOpenFields(layer)} disabled={!isOwner}>
                        <ViewColumnIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>

                  <Tooltip title={isOwner ? 'Style layer' : 'Only owner can edit style'}>
                    <span>
                      <IconButton size="small" onClick={() => handleOpenStyle(layer)} disabled={!isOwner || styleMutation.isPending}>
                        <PaletteIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>

                  <Tooltip title={isOwner ? 'Advanced layer operations' : 'Only owner can manage advanced operations'}>
                    <span>
                      <IconButton size="small" onClick={() => handleOpenLayerOps(layer)} disabled={!isOwner || layerOpsSubmitting}>
                        <SettingsSuggestIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>

                  <Tooltip title={isOwner ? 'Import spatial data' : 'Only owner can import data'}>
                    <span>
                      <IconButton
                        size="small"
                        onClick={() => handleOpenUpload(layer)}
                        disabled={!isOwner || uploadLayerMutation.isPending}
                      >
                        <UploadFileIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>

                  <Tooltip title="Zoom to extent">
                    <span>
                      <IconButton size="small" onClick={() => handleZoomLayer(layer)}>
                        <ZoomOutMapIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>

                  <Tooltip title="Export GeoJSON">
                    <span>
                      <IconButton size="small" onClick={() => void handleExportLayer(layer)}>
                        <DownloadIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>

                  <Tooltip title={isOwner ? 'Delete layer' : 'Only owner can delete'}>
                    <span>
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => handleDeleteLayer(layer)}
                        disabled={!isOwner || deleteLayerMutation.isPending}
                      >
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Stack>

                <Divider component="li" />
              </Box>
            )
          })}
        </List>

        <ActivityFeed events={activityEvents} onClear={() => setActivityEvents([])} />
      </Box>
    </Box>
  )

  return (
    <Box sx={{ display: 'flex', width: '100vw', height: '100vh', bgcolor: 'background.default' }}>
      <AppBar
        position="fixed"
        color="inherit"
        elevation={0}
        sx={{
          borderBottom: 1,
          borderColor: 'divider',
          width: isDesktop ? `calc(100% - ${drawerWidth}px)` : '100%',
          ml: isDesktop ? `${drawerWidth}px` : 0,
        }}
      >
        <Toolbar sx={{ minHeight: 72, gap: 1 }}>
          {!isDesktop && (
            <IconButton edge="start" color="inherit" onClick={() => setMobileDrawerOpen((value) => !value)}>
              <MenuIcon />
            </IconButton>
          )}

          <LayersIcon color="primary" />
          <Typography
            variant="h6"
            sx={{
              fontFamily: '"Space Grotesk", sans-serif',
              fontWeight: 700,
              letterSpacing: 0.2,
            }}
          >
            Enterprise GIS
          </Typography>

          <Chip label={`${totalFeatures} visible features`} color="primary" variant="outlined" size="small" />
          <Chip label={isOnline ? 'Online' : 'Offline'} color={isOnline ? 'success' : 'warning'} variant="outlined" size="small" />
          <Chip
            label={appMode === 'utilities' ? 'Mode: Utilities' : 'Mode: Standard'}
            color={appMode === 'utilities' ? 'success' : 'default'}
            variant="outlined"
            size="small"
          />
          {appMode === 'utilities' && selectedUtilityNetwork && (
            <Chip label={`Network: ${selectedUtilityNetwork.name}`} color="success" variant="outlined" size="small" />
          )}

          {measurementLabel && <Chip label={measurementLabel} color="info" variant="outlined" size="small" />}

          <Tooltip title={appMode === 'utilities' ? 'Return to standard GIS mode' : 'Activate utility network workflows'}>
            <Button
              size="small"
              variant={appMode === 'utilities' ? 'contained' : 'outlined'}
              color={appMode === 'utilities' ? 'success' : 'inherit'}
              startIcon={<AccountTreeIcon fontSize="small" />}
              onClick={handleToggleAppMode}
              sx={{ textTransform: 'none' }}
            >
              Utility Mode
            </Button>
          </Tooltip>

          <Tooltip title={workMode ? 'Work mode on: dialogs open as right-side panels' : 'Enable right-side work panels'}>
            <Button
              size="small"
              variant={workMode ? 'contained' : 'outlined'}
              color={workMode ? 'primary' : 'inherit'}
              startIcon={<ViewSidebarIcon fontSize="small" />}
              onClick={() => setWorkMode((value) => !value)}
              sx={{ textTransform: 'none' }}
            >
              Work Mode
            </Button>
          </Tooltip>

          <TextField
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            size="small"
            placeholder="Search place or address"
            sx={{ width: 240 }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                void handleSearch()
              }
            }}
          />
          <Tooltip title="Search location">
            <span>
              <IconButton onClick={() => void handleSearch()} disabled={searching}>
                {searching ? <CircularProgress size={16} /> : <SearchIcon fontSize="small" />}
              </IconButton>
            </span>
          </Tooltip>

          <Tooltip title="Fit visible layers">
            <IconButton onClick={handleFitVisible}>
              <ZoomOutMapIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Tooltip title="Measure distance">
            <IconButton
              onClick={() => handleToggleMeasurement('distance')}
              color={measurementMode === 'distance' ? 'primary' : 'default'}
              disabled={Boolean(activeEditLayerId)}
            >
              <StraightenIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Tooltip title="Measure area">
            <IconButton
              onClick={() => handleToggleMeasurement('area')}
              color={measurementMode === 'area' ? 'primary' : 'default'}
              disabled={Boolean(activeEditLayerId)}
            >
              <SquareFootIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Tooltip title="Clear measurement">
            <span>
              <IconButton onClick={handleClearMeasurement} disabled={!measurementMode && !measurementSummary}>
                <ClearIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>

          {user && (
            <Tooltip title="Spatial analysis">
              <IconButton onClick={() => setAnalysisOpen(true)}>
                <ScienceIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}

          {user && (
            <Tooltip title="Map bookmarks">
              <IconButton onClick={handleOpenViews}>
                <BookmarkAddedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}

          {user && (
            <Tooltip title="Async jobs">
              <IconButton onClick={handleOpenJobs}>
                <WorkHistoryIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}

          <Box sx={{ flexGrow: 1 }} />

          {currentUserQuery.isFetching && token ? (
            <CircularProgress size={18} />
          ) : user ? (
            <Stack direction="row" alignItems="center" spacing={1}>
              <Button
                startIcon={<AddCircleOutlineIcon />}
                variant="outlined"
                size="small"
                onClick={() => {
                  setCreateLayerError(null)
                  setCreateLayerOpen(true)
                }}
              >
                New Layer
              </Button>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {user.username}
              </Typography>
              <Tooltip title="Logout">
                <IconButton color="inherit" onClick={handleLogout}>
                  <LogoutIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          ) : (
            <Button startIcon={<LoginIcon />} onClick={() => setAuthOpen(true)} variant="contained" disableElevation>
              Login
            </Button>
          )}
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}>
        <Drawer
          variant={isDesktop ? 'permanent' : 'temporary'}
          open={isDesktop ? true : mobileDrawerOpen}
          onClose={() => setMobileDrawerOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            '& .MuiDrawer-paper': {
              width: drawerWidth,
              boxSizing: 'border-box',
              borderRight: 1,
              borderColor: 'divider',
              bgcolor: 'background.paper',
            },
          }}
        >
          {drawerContent}
        </Drawer>
      </Box>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          width: isDesktop ? `calc(100% - ${drawerWidth}px)` : '100%',
          mt: '72px',
          position: 'relative',
        }}
      >
        {!isOnline && (
          <Alert
            severity="warning"
            sx={{
              position: 'absolute',
              top: 8,
              left: 8,
              right: 8,
              zIndex: 11,
            }}
          >
            Offline mode active: cached shell and map metadata are available, but live edits and API sync require connection.
          </Alert>
        )}

        {featuresLoading && (
          <LinearProgress
            sx={{
              position: 'absolute',
              top: !isOnline ? 66 : 0,
              left: 0,
              right: 0,
              zIndex: 10,
            }}
          />
        )}

        <Suspense
          fallback={
            <Box sx={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}>
              <CircularProgress size={28} />
            </Box>
          }
        >
          <MapCanvas
            layers={layers}
            visibleByLayerId={resolvedVisibility}
            featureCollections={featureCollections}
            legendFilters={legendFiltersByLayerId}
            analysisOverlay={analysisOverlay}
            utilityOverlay={utilityOverlay}
            zoomRequest={zoomRequest}
            fitVisibleRequest={fitVisibleRequest}
            locateRequest={locateRequest}
            measurementMode={measurementMode}
            measurementResetNonce={measurementResetNonce}
            activeEditLayerId={activeEditLayerId}
            editLayerFeatures={editableLayerFeatures}
            advancedEditMode={advancedEditMode}
            advancedEditOptions={advancedEditOptions}
            editCommand={editCommand}
            activeShapeType={activeShapeType}
            shapeSize={shapeSize}
            selectedFeaturesByLayer={selectedFeaturesByLayer}
            featureZoomRequest={featureZoomRequest}
            flashFeatureRequest={flashFeatureRequest}
            onMeasurementChange={setMeasurementSummary}
            onViewStateChange={setCurrentMapView}
            onFeatureCreated={(layerId, geometry, properties) => {
              const targetLayer = layerById[layerId]
              if (!targetLayer || !canManageLayer(ownerName, targetLayer)) {
                notify('You cannot edit this layer', 'warning')
                return
              }

              createFeatureMutation.mutate({
                layerId,
                feature: {
                  geometry,
                  properties,
                },
              })
            }}
            onFeatureUpdated={(layerId, featureId, geometry, properties, version) => {
              const targetLayer = layerById[layerId]
              if (!targetLayer || !canManageLayer(ownerName, targetLayer)) {
                notify('You cannot edit this layer', 'warning')
                return
              }

              updateFeatureMutation.mutate({
                layerId,
                featureId,
                geometry,
                properties,
                version: version ?? readFeatureVersion(properties),
              })
            }}
            onFeatureDeleted={(layerId, featureId) => {
              const targetLayer = layerById[layerId]
              if (!targetLayer || !canManageLayer(ownerName, targetLayer)) {
                notify('You cannot edit this layer', 'warning')
                return
              }

              deleteFeatureMutation.mutate({ layerId, featureId })
            }}
            onFeaturesSplit={async (layerId, featureIds, splitLine) => {
              const targetLayer = layerById[layerId]
              if (!targetLayer || !canManageLayer(ownerName, targetLayer)) {
                throw new Error('You cannot edit this layer')
              }
              if (!token) {
                throw new Error('You must be signed in to split features.')
              }

              const result = await splitFeatures(layerId, featureIds, splitLine, token)
              await queryClient.invalidateQueries({ queryKey: ['layer-features', layerId] })
              await queryClient.invalidateQueries({ queryKey: ['layers'] })
              return result.features
            }}
            onEditValidationError={(message) => {
              notify(message, 'warning')
            }}
            onEditInfo={(message, severity = 'info') => {
              notify(message, severity)
            }}
            onEditStateChange={setEditState}
            onEditUiStateChange={setEditUiState}
          />
        </Suspense>

        {tableOpen && (
          <Suspense fallback={null}>
            <AttributeTablePanel
              layerName={tableLayer?.name ?? null}
              layerId={tableLayer?.id ?? null}
              featureCollection={tableLayer ? featureCollections[tableLayer.id] ?? null : null}
              fields={schemaFields}
              saving={updateFeatureMutation.isPending}
              error={tableError}
              selectedFeatureIds={tableLayer ? selectedFeaturesByLayer[tableLayer.id] ?? [] : []}
              accessToken={token}
              onClose={() => {
                setTableOpen(false)
                setTableLayer(null)
                setTableError(null)
              }}
              onSaveProperties={handleSaveProperties}
              onQueryRows={handleQueryTableRows}
              onSelectRows={handleSelectTableRows}
              onFetchStatistics={handleFetchTableStatistics}
              onExportRows={handleExportTableRows}
              onBulkUpdateRows={handleBulkTableUpdate}
              onFeatureSelectionChange={(featureIds) => {
                if (tableLayer) {
                  handleFeatureSelectionChange(tableLayer.id, featureIds)
                }
              }}
              onZoomToFeature={(featureId) => {
                if (tableLayer) {
                  handleZoomToFeature(tableLayer.id, featureId)
                }
              }}
              onZoomToSelection={(featureIds) => {
                if (tableLayer) {
                  handleZoomToSelection(tableLayer.id, featureIds)
                }
              }}
              onFlashFeature={(featureId) => {
                if (tableLayer) {
                  handleFlashFeature(tableLayer.id, featureId)
                }
              }}
              onPanToFeature={(featureId) => {
                if (tableLayer) {
                  handlePanToFeature(tableLayer.id, featureId)
                }
              }}
              onNavigateToRelatedLayer={(relatedLayerId, relatedFeatureId) => {
                // Find the related layer
                const relatedLayer = layers.find((l) => l.id === relatedLayerId)
                if (!relatedLayer) {
                  notify('Related layer not found', 'error')
                  return
                }

                // Switch to the related layer's table
                setTableLayer(relatedLayer)
                setTableError(null)

                // Select the related feature
                handleFeatureSelectionChange(relatedLayerId, [relatedFeatureId])

                // Flash and zoom to the related feature
                handleFlashFeature(relatedLayerId, relatedFeatureId)
                handleZoomToFeature(relatedLayerId, relatedFeatureId)
              }}
            />
          </Suspense>
        )}

        <Suspense fallback={null}>
          <LayerLegend
            layers={layers}
            visibleByLayerId={resolvedVisibility}
            featureCollections={featureCollections}
            mapZoom={currentMapView?.zoom ?? null}
            mode={legendMode}
            legendFilters={legendFiltersByLayerId}
            onModeChange={handleLegendModeChange}
            onToggleLegendItem={handleToggleLegendItem}
            onResetLegendFilters={handleResetLegendFilters}
          />
        </Suspense>

        {workMode && appMode === 'utilities' && !activeEditLayer && (
          <Box
            sx={{
              position: 'absolute',
              top: !isOnline ? 78 : 12,
              right: 12,
              width: 360,
              maxWidth: 'calc(100vw - 24px)',
              maxHeight: !isOnline ? 'calc(100% - 90px)' : 'calc(100% - 24px)',
              zIndex: 12,
              pointerEvents: 'none',
            }}
          >
            <Paper
              elevation={6}
              sx={{
                border: 1,
                borderColor: 'divider',
                pointerEvents: 'auto',
                overflow: 'auto',
              }}
            >
              <Box sx={{ p: 1.25, borderBottom: 1, borderColor: 'divider' }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  Utility Workbench
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {selectedUtilityNetwork ? selectedUtilityNetwork.name : 'Select a utility network from the left panel'}
                </Typography>
              </Box>
              <Box sx={{ p: 1.25 }}>
                {selectedUtilityNetwork ? (
                  <Stack spacing={1}>
                    <Chip
                      label={`${selectedUtilityNetwork.utility_type.replace('_', ' ')} · ${selectedUtilityNetwork.status}`}
                      color="success"
                      variant="outlined"
                      sx={{ alignSelf: 'flex-start', textTransform: 'capitalize' }}
                    />
                    <Box display="grid" gridTemplateColumns="repeat(2, minmax(0, 1fr))" gap={1}>
                      <Paper variant="outlined" sx={{ p: 1 }}>
                        <Typography variant="caption" color="text.secondary">Nodes</Typography>
                        <Typography variant="subtitle2">{utilityNetworkSummary?.node_count ?? 0}</Typography>
                      </Paper>
                      <Paper variant="outlined" sx={{ p: 1 }}>
                        <Typography variant="caption" color="text.secondary">Edges</Typography>
                        <Typography variant="subtitle2">{utilityNetworkSummary?.edge_count ?? 0}</Typography>
                      </Paper>
                      <Paper variant="outlined" sx={{ p: 1 }}>
                        <Typography variant="caption" color="text.secondary">Service Points</Typography>
                        <Typography variant="subtitle2">{utilityNetworkSummary?.service_point_count ?? 0}</Typography>
                      </Paper>
                      <Paper variant="outlined" sx={{ p: 1 }}>
                        <Typography variant="caption" color="text.secondary">Length (m)</Typography>
                        <Typography variant="subtitle2">
                          {Math.round(utilityNetworkSummary?.total_length_m ?? 0).toLocaleString()}
                        </Typography>
                      </Paper>
                    </Box>
                    <Typography variant="caption" color="text.secondary">
                      Use the left drawer to create networks and inspect assets. Map rendering and trace tools are the next step.
                    </Typography>
                  </Stack>
                ) : (
                  <Alert severity="info">Activate Utility Mode and select or create a network to start utility workflows.</Alert>
                )}
              </Box>
            </Paper>
          </Box>
        )}

        {workMode && activeEditLayer && (
          <Box
            sx={{
              position: 'absolute',
              top: !isOnline ? 78 : 12,
              right: 12,
              width: 360,
              maxWidth: 'calc(100vw - 24px)',
              maxHeight: !isOnline ? 'calc(100% - 90px)' : 'calc(100% - 24px)',
              zIndex: 12,
              pointerEvents: 'none',
            }}
          >
            <Paper
              elevation={6}
              sx={{
                border: 1,
                borderColor: 'divider',
                pointerEvents: 'auto',
                overflow: 'auto',
              }}
            >
              <Box sx={{ p: 1.25, borderBottom: 1, borderColor: 'divider' }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  Editing Workbench
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Layer: {activeEditLayer.name}
                </Typography>
              </Box>
              <Box sx={{ p: 1.25 }}>
                {editToolsContent}
              </Box>
            </Paper>
          </Box>
        )}
      </Box>

      <AuthDialog open={authOpen} onClose={() => setAuthOpen(false)} onAuthenticated={handleAuthenticated} />

      <CreateLayerDialog
        open={createLayerOpen}
        submitting={createLayerMutation.isPending}
        error={createLayerError}
        onClose={() => setCreateLayerOpen(false)}
        onSubmit={handleCreateLayer}
      />

      <Suspense fallback={null}>
        <UploadLayerDialog
          open={uploadOpen}
          workMode={workMode}
          layerName={uploadTargetLayer?.name ?? null}
          file={uploadFile}
          submitting={uploadLayerMutation.isPending}
          error={uploadError}
          onFileChange={setUploadFile}
          onClose={() => {
            setUploadOpen(false)
            setUploadFile(null)
            setUploadError(null)
          }}
          onSubmit={handleUploadLayer}
        />
      </Suspense>

      <Suspense fallback={null}>
        <LayerStyleDialog
          open={styleOpen}
          workMode={workMode}
          layerName={styleLayer?.name ?? null}
          layerGeometryType={styleLayer?.geometry_type ?? null}
          fields={schemaFields}
          style={styleDraft}
          submitting={styleMutation.isPending}
          error={styleError}
          onStyleChange={setStyleDraft}
          onFetchUniqueValues={async (field) => {
            if (!styleLayer) throw new Error('No layer is selected for styling.')
            return fetchDistinctFeatureValues(styleLayer.id, field, token, 100)
          }}
          onClose={() => {
            setStyleOpen(false)
            setStyleLayer(null)
            setStyleError(null)
            setStyleDraft(DEFAULT_STYLE_DRAFT)
          }}
          onSubmit={handleSaveStyle}
        />
      </Suspense>

      <Suspense fallback={null}>
        <FieldsManagerDialog
          open={fieldsOpen}
          workMode={workMode}
          layerName={fieldsLayer?.name ?? null}
          fields={schemaFields}
          domains={schemaDomains}
          loading={schemaLoading}
          submitting={schemaSubmitting}
          error={fieldsError ?? schemaQueryError}
          onClose={() => {
            setFieldsOpen(false)
            setFieldsLayer(null)
            setFieldsError(null)
          }}
          onCreateField={handleCreateField}
          onUpdateField={handleUpdateField}
          onDeleteField={handleDeleteField}
          onCreateDomain={handleCreateDomain}
          onUpdateDomain={handleUpdateDomain}
          onDeleteDomain={handleDeleteDomain}
        />
      </Suspense>

      <Suspense fallback={null}>
        <LayerOpsDialog
          open={layerOpsOpen}
          workMode={workMode}
          layer={layerOpsLayer}
          layers={layers}
          fields={layerOpsFields}
          joins={layerJoins}
          shareLinks={shareLinks}
          layerViews={layerViews}
          relationships={layerRelationships}
          editSessions={editSessions}
          editSessionChanges={editSessionChanges}
          activeSessionId={layerOpsLayer ? activeEditSessionByLayerId[layerOpsLayer.id] ?? null : null}
          loading={layerOpsLoading}
          submitting={layerOpsSubmitting}
          error={layerOpsError ?? layerOpsQueryError}
          onClose={() => {
            setLayerOpsOpen(false)
            setLayerOpsLayer(null)
            setLayerOpsSelectedSessionId(null)
            setLayerOpsError(null)
          }}
          onUpdateOrdering={handleUpdateLayerOrdering}
          onCreateShareLink={handleCreateShareLink}
          onDeleteShareLink={handleDeleteShareLink}
          onCreateJoin={handleCreateJoin}
          onDeleteJoin={handleDeleteJoin}
          onCreateLayerView={handleCreateLayerView}
          onDeleteLayerView={handleDeleteLayerView}
          onCreateRelationship={handleCreateRelationship}
          onDeleteRelationship={handleDeleteRelationship}
          onCreateEditSession={handleCreateEditSession}
          onSubmitEditSession={handleSubmitEditSession}
          onPublishEditSession={handlePublishEditSession}
          onAbandonEditSession={handleAbandonEditSession}
          onSetActiveSession={handleSetActiveEditSession}
          onLoadSessionChanges={handleLoadEditSessionChanges}
        />
      </Suspense>

      <Suspense fallback={null}>
        <MapViewsDialog
          open={viewsOpen}
          workMode={workMode}
          views={mapViews}
          currentView={currentMapView}
          loading={viewsQuery.isFetching}
          saving={createViewMutation.isPending || deleteViewMutation.isPending}
          error={viewsError ?? (viewsQuery.error instanceof Error ? viewsQuery.error.message : null)}
          onClose={() => {
            setViewsOpen(false)
            setViewsError(null)
          }}
          onCreateView={handleCreateView}
          onDeleteView={handleDeleteView}
          onGoToView={handleGoToView}
        />
      </Suspense>

      <Suspense fallback={null}>
        <JobsDialog
          open={jobsOpen}
          workMode={workMode}
          jobs={asyncJobs}
          loading={jobsQuery.isFetching}
          error={jobsError ?? (jobsQuery.error instanceof Error ? jobsQuery.error.message : null)}
          onClose={() => {
            setJobsOpen(false)
            setJobsError(null)
          }}
          onRefresh={() => {
            void jobsQuery.refetch()
          }}
        />
      </Suspense>

      <Suspense fallback={null}>
        <AnalysisDialog
          open={analysisOpen}
          workMode={workMode}
          layers={layers}
          running={analysisRunning}
          error={analysisError}
          withinCount={withinCount}
          job={analysisJob}
          onClose={() => setAnalysisOpen(false)}
          onRunBuffer={(payload) => {
            setAnalysisError(null)
            startAnalysisJob('buffer')
            bufferMutation.mutate(payload)
          }}
          onRunIntersect={(payload) => {
            setAnalysisError(null)
            startAnalysisJob('intersect')
            intersectMutation.mutate(payload)
          }}
          onRunWithin={(payload) => {
            setAnalysisError(null)
            startAnalysisJob('within')
            withinMutation.mutate({ layerId: payload.layerId, polygonText: payload.polygon })
          }}
        />
      </Suspense>

      <Dialog open={Boolean(featureConflict)} onClose={() => setFeatureConflict(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Feature Conflict</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 1.5 }}>
            This feature was updated by another session while you were editing it.
          </Alert>
          <Typography variant="body2" color="text.secondary">
            Feature ID: {featureConflict?.featureId ?? 'n/a'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {typeof featureConflict?.serverVersion === 'number'
              ? `Latest server version: ${featureConflict.serverVersion}`
              : 'Latest server version is unavailable.'}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setFeatureConflict(null)} color="inherit">
            Cancel
          </Button>
          <Button onClick={handleReloadConflictFeature}>
            Reload Latest
          </Button>
          <Button
            onClick={handleOverwriteConflict}
            variant="contained"
            disabled={typeof featureConflict?.serverVersion !== 'number' || updateFeatureMutation.isPending}
          >
            Overwrite
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={Boolean(snack)}
        autoHideDuration={3500}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity={snack?.severity ?? 'info'} onClose={() => setSnack(null)} variant="filled" sx={{ width: '100%' }}>
          {snack?.message ?? ''}
        </Alert>
      </Snackbar>
    </Box>
  )
}
