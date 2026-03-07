import { apiRequest } from './http'

describe('apiRequest', () => {
  it('attaches auth header and parses json', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: () => 'application/json',
      },
      json: async () => ({ ok: true }),
      text: async () => '',
    })

    vi.stubGlobal('fetch', fetchMock)

    const result = await apiRequest<{ ok: boolean }>('/layers', {}, 'token-123')

    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = fetchMock.mock.calls[0][1] as RequestInit
    const headers = init.headers as Headers
    expect(headers.get('Authorization')).toBe('Bearer token-123')
  })
})
