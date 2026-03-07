import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material'
import 'maplibre-gl/dist/maplibre-gl.css'
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css'
import './index.css'
import App from './App'

const BASEMAP_STYLE_URL = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
const BASEMAP_META_KEY = 'enterprise-gis-basemap-style-v1'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#136f63',
    },
    secondary: {
      main: '#3f88c5',
    },
    background: {
      default: '#edf4f2',
      paper: '#fcfffd',
    },
  },
  typography: {
    fontFamily: '"Manrope", "Avenir Next", sans-serif',
    h6: {
      fontFamily: '"Space Grotesk", "Manrope", sans-serif',
    },
  },
  shape: {
    borderRadius: 12,
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <App />
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
)

async function warmBasemapMetadata(): Promise<void> {
  try {
    const response = await fetch(BASEMAP_STYLE_URL)
    if (!response.ok) {
      return
    }

    const style = await response.json()
    localStorage.setItem(
      BASEMAP_META_KEY,
      JSON.stringify({
        fetched_at: new Date().toISOString(),
        style,
      }),
    )
  } catch {
    // best-effort cache warmup for offline shell
  }
}

void warmBasemapMetadata()

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    if (import.meta.env.PROD) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // no-op: app remains functional without service worker registration
      })
      return
    }

    // Keep development sessions free from stale cache/service-worker state.
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => {
        void registration.unregister()
      })
    })
  })
}
