import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CreateLayerDialog } from './CreateLayerDialog'

describe('CreateLayerDialog', () => {
  it('submits layer payload', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()

    render(
      <CreateLayerDialog
        open
        submitting={false}
        error={null}
        onClose={() => {}}
        onSubmit={onSubmit}
      />,
    )

    await user.type(screen.getByLabelText(/layer name/i), 'Parcels')
    await user.type(screen.getByLabelText(/description/i), 'Land parcels')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Parcels',
        description: 'Land parcels',
      }),
    )
  })
})
