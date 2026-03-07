import { useAuthStore } from '../store/auth'

export class ApiError extends Error {
  status: number
  data: unknown

  constructor(message: string, status: number, data: unknown = null) {
    super(message)
    this.status = status
    this.data = data
  }
}

const API_BASE = '/api/v1'
let refreshInFlight: Promise<string | null> | null = null

function headers(token?: string | null, init?: HeadersInit): Headers {
  const base = new Headers(init)
  base.set('Accept', 'application/json')

  if (token) {
    base.set('Authorization', `Bearer ${token}`)
  }

  return base
}

function errorMessage(status: number, body: unknown): string {
  let resolvedMessage: string | null = null

  if (typeof body === 'object' && body) {
    if ('error' in body) {
      resolvedMessage = String((body as { error: unknown }).error)
    }
    if (!resolvedMessage && 'msg' in body) {
      resolvedMessage = String((body as { msg: unknown }).msg)
    }
    if (!resolvedMessage && 'message' in body) {
      resolvedMessage = String((body as { message: unknown }).message)
    }
  }

  if (status === 401) {
    const tokenRelated = /token|authorization|jwt|expired|signature/i.test(resolvedMessage ?? '')
    if (!resolvedMessage || tokenRelated) {
      return 'Session expired. Refresh the page. If it still fails, sign out and sign back in.'
    }
  }

  if (resolvedMessage) {
    return resolvedMessage
  }

  return `Request failed with status ${status}`
}

async function readResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    try {
      return await response.json()
    } catch {
      return null
    }
  }

  try {
    return await response.text()
  } catch {
    return null
  }
}

function isAuthPath(path: string): boolean {
  return path.startsWith('/auth/')
}

async function refreshAccessToken(): Promise<string | null> {
  const store = useAuthStore.getState()
  const refreshToken = store.refreshToken
  if (!refreshToken) {
    return null
  }

  if (refreshInFlight) {
    return refreshInFlight
  }

  refreshInFlight = (async () => {
    const response = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: headers(refreshToken),
    })
    const body = await readResponseBody(response)

    if (!response.ok || typeof body !== 'object' || !body || !('access_token' in body)) {
      store.logout()
      return null
    }

    const accessToken = String((body as { access_token: unknown }).access_token)
    if (!accessToken) {
      store.logout()
      return null
    }

    store.setToken(accessToken)
    return accessToken
  })().finally(() => {
    refreshInFlight = null
  })

  return refreshInFlight
}

async function fetchJsonWithAuth(
  path: string,
  options: RequestInit,
  token?: string | null,
): Promise<{ response: Response; body: unknown }> {
  const isFormData = options.body instanceof FormData
  const requestHeaders = headers(token, options.headers)

  if (!isFormData && !requestHeaders.has('Content-Type')) {
    requestHeaders.set('Content-Type', 'application/json')
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: requestHeaders,
  })
  const body = await readResponseBody(response)

  return { response, body }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null,
): Promise<T> {
  const requestedToken = token ?? useAuthStore.getState().token
  let result = await fetchJsonWithAuth(path, options, requestedToken)

  if (!result.response.ok && result.response.status === 401 && !isAuthPath(path) && requestedToken) {
    const refreshedToken = await refreshAccessToken()
    if (refreshedToken) {
      result = await fetchJsonWithAuth(path, options, refreshedToken)
    }
  }

  if (!result.response.ok) {
    const message = errorMessage(result.response.status, result.body)
    throw new ApiError(message, result.response.status, result.body)
  }

  return result.body as T
}

export async function apiBlobRequest(
  path: string,
  options: RequestInit = {},
  token?: string | null,
): Promise<Blob> {
  const requestedToken = token ?? useAuthStore.getState().token
  let response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: headers(requestedToken, options.headers),
  })

  if (!response.ok && response.status === 401 && !isAuthPath(path) && requestedToken) {
    const refreshedToken = await refreshAccessToken()
    if (refreshedToken) {
      response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: headers(refreshedToken, options.headers),
      })
    }
  }

  if (!response.ok) {
    const body = await readResponseBody(response)
    const message = errorMessage(response.status, body)

    throw new ApiError(message, response.status, body)
  }

  return response.blob()
}
