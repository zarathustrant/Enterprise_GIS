import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MapPropertiesDialog } from './MapPropertiesDialog'
import type { CatalogMap } from '../types/gis'

const map: CatalogMap = {
  id: 'map-1',
  workspace_id: null,
  name: 'Operations',
  description: 'Current map',
  basemap: { id: 'osm', title: 'OpenStreetMap' },
  initial_view: {},
  spatial_reference: 'EPSG:4326',
  settings: {},
  thumbnail_key: null,
  is_public: false,
  is_default: false,
  revision: 2,
  created_by: 'user-1',
  owner_name: 'owner',
  layer_count: 3,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

describe('MapPropertiesDialog', () => {
  it('updates map metadata and requires a second delete action', async () => {
    const onSave = vi.fn()
    const onDelete = vi.fn()
    const user = userEvent.setup()
    render(
      <MapPropertiesDialog
        open
        map={map}
        submitting={false}
        deleting={false}
        error={null}
        onClose={() => {}}
        onSave={onSave}
        onDelete={onDelete}
      />,
    )

    const title = screen.getByLabelText(/map title/i)
    await user.clear(title)
    await user.type(title, 'Emergency Operations')
    await user.click(screen.getByRole('button', { name: /save properties/i }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: 'Emergency Operations' }))

    await user.click(screen.getByRole('button', { name: /^delete map$/i }))
    expect(onDelete).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /delete permanently/i }))
    expect(onDelete).toHaveBeenCalledOnce()
  })
})
