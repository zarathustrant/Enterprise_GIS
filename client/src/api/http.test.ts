import { apiRequest } from './http'
import { useAuthStore } from '../store/auth'

describe('apiRequest', () => {
  beforeEach(() => {
    useAuthStore.getState().logout()
  })

  it('attaches auth header and parses json', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
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

  it('shows actionable guidance for expired session 401 errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: {
        get: () => 'application/json',
      },
      json: async () => ({ msg: 'Token has expired' }),
      text: async () => '',
    })

    vi.stubGlobal('fetch', fetchMock)

    await expect(apiRequest('/layers', {}, 'stale-access-token')).rejects.toMatchObject({
      status: 401,
      message: 'Session expired. Refresh the page. If it still fails, sign out and sign back in.',
    })
  })

  it('refreshes expired token and retries once', async () => {
    useAuthStore.getState().setAuthTokens('expired-token', 'refresh-token-1')

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: {
          get: () => 'application/json',
        },
        json: async () => ({ msg: 'Token has expired' }),
        text: async () => '',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: () => 'application/json',
        },
        json: async () => ({ access_token: 'new-access-token' }),
        text: async () => '',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: () => 'application/json',
        },
        json: async () => ({ ok: true }),
        text: async () => '',
      })

    vi.stubGlobal('fetch', fetchMock)

    const result = await apiRequest<{ ok: boolean }>('/layers', {}, 'expired-token')

    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/v1/auth/refresh')

    const refreshInit = fetchMock.mock.calls[1]?.[1] as RequestInit
    const refreshHeaders = refreshInit.headers as Headers
    expect(refreshHeaders.get('Authorization')).toBe('Bearer refresh-token-1')

    const retryInit = fetchMock.mock.calls[2]?.[1] as RequestInit
    const retryHeaders = retryInit.headers as Headers
    expect(retryHeaders.get('Authorization')).toBe('Bearer new-access-token')
  })
})

describe('API validation errors', () => {
  it('includes actionable style validation details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'Invalid layer style',
      details: ['opacity must be between 0 and 1', 'labels.minZoom cannot exceed maxZoom'],
    }), { status: 400, headers: { 'Content-Type': 'application/json' } })))

    await expect(apiRequest('/layers/test', { method: 'PUT' }, 'token')).rejects.toThrow(
      'Invalid layer style: opacity must be between 0 and 1; labels.minZoom cannot exceed maxZoom',
    )
  })
})
