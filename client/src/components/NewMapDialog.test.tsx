import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NewMapDialog } from './NewMapDialog'

describe('NewMapDialog', () => {
  it('creates a named map with the selected basemap', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(<NewMapDialog open submitting={false} error={null} onClose={() => {}} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/map title/i), 'Field Operations')
    await user.click(screen.getByLabelText(/basemap/i))
    await user.click(await screen.findByRole('option', { name: 'Satellite' }))
    await user.click(screen.getByRole('button', { name: /create map/i }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Field Operations',
      basemap: { id: 'satellite', title: 'Satellite' },
    }))
  })
})
