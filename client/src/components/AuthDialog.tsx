import { useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Tab,
  Tabs,
  TextField,
} from '@mui/material'
import { ApiError } from '../api/http'
import { login, register } from '../api/services'
import type { AuthResponse } from '../types/gis'

interface AuthDialogProps {
  open: boolean
  onClose: () => void
  onAuthenticated: (response: AuthResponse) => void
}

export function AuthDialog({ open, onClose, onAuthenticated }: AuthDialogProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = useMemo(() => {
    if (!username || !password) {
      return false
    }

    if (mode === 'register' && !email) {
      return false
    }

    return true
  }, [mode, username, email, password])

  const resetForm = () => {
    setUsername('')
    setEmail('')
    setPassword('')
    setError(null)
    setSubmitting(false)
    setMode('login')
  }

  const handleClose = () => {
    if (submitting) {
      return
    }

    resetForm()
    onClose()
  }

  const handleSubmit = async () => {
    if (!canSubmit) {
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const response =
        mode === 'login'
          ? await login({ username: username.trim(), password })
          : await register({ username: username.trim(), email: email.trim(), password })

      onAuthenticated(response)
      resetForm()
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
      } else {
        setError('Unexpected authentication error')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="xs">
      <DialogTitle>Account Access</DialogTitle>
      <DialogContent>
        <Tabs
          value={mode === 'login' ? 0 : 1}
          onChange={(_, next) => {
            setMode(next === 0 ? 'login' : 'register')
            setError(null)
          }}
          sx={{ mb: 2 }}
        >
          <Tab label="Login" />
          <Tab label="Register" />
        </Tabs>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Box display="grid" gap={2}>
          <TextField
            label="Username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoFocus
            fullWidth
            size="small"
          />

          {mode === 'register' && (
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              fullWidth
              size="small"
            />
          )}

          <TextField
            label={mode === 'register' ? 'Password (min 8 chars)' : 'Password'}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            fullWidth
            size="small"
          />
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} disabled={submitting} color="inherit">
          Cancel
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={!canSubmit || submitting}>
          {mode === 'login' ? 'Login' : 'Create account'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
