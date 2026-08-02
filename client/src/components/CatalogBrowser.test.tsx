import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CatalogMap, FeatureDataset, Geodatabase } from '../types/gis'
import { CatalogBrowser } from './CatalogBrowser'

const mocks = vi.hoisted(() => ({
  geodatabases: [] as Geodatabase[],
  datasets: [] as FeatureDataset[],
  createGeodatabase: vi.fn(),
  createFeatureDataset: vi.fn(),
  createLayer: vi.fn(),
  addMapLayers: vi.fn(),
}))

vi.mock('../api/services', () => ({
  searchCatalog: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 }),
  fetchGeodatabases: vi.fn().mockImplementation(() => Promise.resolve([...mocks.geodatabases])),
  fetchFeatureDatasets: vi.fn().mockImplementation(() => Promise.resolve([...mocks.datasets])),
  createFeatureDataset: mocks.createFeatureDataset,
  createLayer: mocks.createLayer,
  addMapLayers: mocks.addMapLayers,
  createGeodatabase: mocks.createGeodatabase,
  setCatalogFavorite: vi.fn(),
  updateLayer: vi.fn(),
}))

describe('CatalogBrowser storage workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.geodatabases.length = 0
    mocks.datasets.length = 0
    mocks.geodatabases.push({
      id: 'gdb-1', workspace_id: null, name: 'Operations GDB', alias: null,
      description: null, database_type: 'project', default_crs: 'EPSG:32631',
      status: 'active', created_by: 'user-1', dataset_count: 0, layer_count: 0,
      feature_dataset_count: 0, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    })
  })

  it('creates a geodatabase with an explicit default coordinate system', async () => {
    mocks.createGeodatabase.mockImplementation(async () => {
      const created: Geodatabase = {
        ...mocks.geodatabases[0], id: 'gdb-2', name: 'Engineering GDB', default_crs: 'EPSG:3857',
      }
      mocks.geodatabases.push(created)
      return created
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const user = userEvent.setup()

    render(
      <QueryClientProvider client={queryClient}>
        <CatalogBrowser token="token" activeMap={null} onLayersAdded={() => {}} />
      </QueryClientProvider>,
    )

    await screen.findByText('Operations GDB / Root')
    await user.click(screen.getByRole('button', { name: 'New geodatabase' }))
    await user.type(screen.getByLabelText('Geodatabase name'), 'Engineering GDB')
    await user.clear(screen.getByLabelText('Default coordinate system'))
    await user.type(screen.getByLabelText('Default coordinate system'), 'EPSG:3857')
    await user.click(screen.getByRole('button', { name: 'Create geodatabase' }))

    await waitFor(() => expect(mocks.createGeodatabase).toHaveBeenCalledWith({
      name: 'Engineering GDB', default_crs: 'EPSG:3857',
    }, 'token'))
    expect(await screen.findByText(/Created geodatabase “Engineering GDB”/)).toBeVisible()
    expect(await screen.findByText('Engineering GDB / Root')).toBeVisible()
  })

  it('creates a feature dataset and then creates a layer inside it', async () => {
    mocks.createFeatureDataset.mockImplementation(async () => {
      const created: FeatureDataset = {
        id: 'dataset-1', geodatabase_id: 'gdb-1', name: 'Water Network', alias: null,
        description: null, crs: 'EPSG:32631', layer_count: 0,
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      }
      mocks.datasets.push(created)
      return created
    })
    mocks.createLayer.mockResolvedValue({ id: 'layer-1', name: 'Water Mains' })
    mocks.addMapLayers.mockResolvedValue([])
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const activeMap = {
      id: 'map-1', name: 'Operations Map', layers: [], revision: 1,
    } as unknown as CatalogMap
    const user = userEvent.setup()

    render(
      <QueryClientProvider client={queryClient}>
        <CatalogBrowser token="token" activeMap={activeMap} onLayersAdded={() => {}} />
      </QueryClientProvider>,
    )

    expect(await screen.findByText('Operations GDB / Root')).toBeVisible()
    expect(await screen.findByText(/no feature datasets yet/i)).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'New dataset' }))
    await user.type(screen.getByLabelText('Feature dataset name'), 'Water Network')
    await user.click(screen.getByRole('button', { name: 'Create feature dataset' }))

    expect(await screen.findByText(/Created feature dataset “Water Network”/)).toBeVisible()
    await waitFor(() => expect(screen.getByText('Operations GDB / Water Network')).toBeVisible())

    await user.click(screen.getByRole('button', { name: 'New layer here' }))
    await user.type(screen.getByLabelText('Layer name'), 'Water Mains')
    await user.click(screen.getByRole('button', { name: 'Create layer in Water Network' }))

    await waitFor(() => expect(mocks.createLayer).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Water Mains',
      crs: 'EPSG:32631',
      geodatabase_id: 'gdb-1',
      feature_dataset_id: 'dataset-1',
    }), 'token'))
    expect(mocks.addMapLayers).toHaveBeenCalledWith('map-1', ['layer-1'], 'token')
    expect(await screen.findByText(/Created layer “Water Mains” in Water Network/)).toBeVisible()
  })
})
