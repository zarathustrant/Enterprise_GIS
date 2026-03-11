import type { SxProps, Theme } from '@mui/material'

const WORK_MODE_PANEL_WIDTH = 360
const NORMAL_DIALOG_MAX_WIDTH = 760

export const WORK_MODE_DIALOG_PROPS = {
  hideBackdrop: true,
  disableScrollLock: true,
  disableEnforceFocus: true,
  disableAutoFocus: true,
  disableRestoreFocus: true,
} as const

export function workModeDialogSx(width: string): SxProps<Theme> {
  const cappedWidth = `min(${width}, ${WORK_MODE_PANEL_WIDTH}px)`
  return {
    pointerEvents: 'none',
    '& .MuiDialog-container': {
      alignItems: 'stretch',
      justifyContent: 'flex-end',
      p: 0,
      pt: '72px',
      pointerEvents: 'none',
    },
    '& .MuiDialog-paper': {
      m: 0,
      width: cappedWidth,
      minWidth: cappedWidth,
      maxWidth: cappedWidth,
      height: 'calc(100% - 72px)',
      maxHeight: 'calc(100% - 72px)',
      borderRadius: 0,
      borderLeft: 1,
      borderColor: 'divider',
      overflow: 'hidden',
      pointerEvents: 'auto',
    },
    '& .MuiDialogTitle-root': {
      py: 1.25,
      px: 1.5,
      borderBottom: 1,
      borderColor: 'divider',
    },
    '& .MuiDialogContent-root': {
      px: 1.5,
      py: 1.25,
    },
    '& .MuiDialogActions-root': {
      px: 1.5,
      py: 1,
      borderTop: 1,
      borderColor: 'divider',
    },
  }
}

export function normalModeDialogSx(width: string): SxProps<Theme> {
  const cappedWidth = `min(${width}, ${NORMAL_DIALOG_MAX_WIDTH}px, calc(100vw - 24px))`
  return {
    '& .MuiDialog-container': {
      p: { xs: 0.5, sm: 1.5 },
    },
    '& .MuiDialog-paper': {
      width: cappedWidth,
      maxWidth: cappedWidth,
      maxHeight: 'calc(100vh - 96px)',
      m: 0,
      borderRadius: 2,
    },
    '& .MuiDialogTitle-root': {
      py: 1.25,
      px: 2,
    },
    '& .MuiDialogContent-root': {
      px: 2,
      py: 1.25,
    },
    '& .MuiDialogActions-root': {
      px: 2,
      py: 1.25,
    },
  }
}
