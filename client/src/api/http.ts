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

function headers(token?: string | null, init?: HeadersInit): Headers {
  const base = new Headers(init)
  base.set('Accept', 'application/json')

  if (token) {
    base.set('Authorization', `Bearer ${token}`)
  }

  return base
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null,
): Promise<T> {
  const isFormData = options.body instanceof FormData

  const requestHeaders = headers(token, options.headers)

  if (!isFormData && !requestHeaders.has('Content-Type')) {
    requestHeaders.set('Content-Type', 'application/json')
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: requestHeaders,
  })

  const contentType = response.headers.get('content-type') ?? ''
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.text()

  if (!response.ok) {
    const message =
      typeof body === 'object' && body && 'error' in body
        ? String((body as { error: unknown }).error)
        : `Request failed with status ${response.status}`

    throw new ApiError(message, response.status, body)
  }

  return body as T
}

export async function apiBlobRequest(
  path: string,
  options: RequestInit = {},
  token?: string | null,
): Promise<Blob> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: headers(token, options.headers),
  })

  if (!response.ok) {
    const contentType = response.headers.get('content-type') ?? ''
    const body = contentType.includes('application/json')
      ? await response.json()
      : await response.text()

    const message =
      typeof body === 'object' && body && 'error' in body
        ? String((body as { error: unknown }).error)
        : `Request failed with status ${response.status}`

    throw new ApiError(message, response.status, body)
  }

  return response.blob()
}
