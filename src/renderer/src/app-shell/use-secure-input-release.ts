import { useEffect } from 'react'
import { isPairedWebClientWindow } from '@/lib/desktop-window-chrome'
import { isMac } from './app-window-chrome'

function isFocusedPasswordInput(value: Element | null): value is HTMLInputElement {
  return value instanceof HTMLInputElement && value.type === 'password'
}

/**
 * Why (#17872): macOS Secure Event Input stays latched app-wide when Orca deactivates with a
 * password field focused. Chromium drops its refcounted enabler only on blur, and
 * `app.setSecureKeyboardEntryEnabled(false)` cannot clear an enabler Electron never took.
 */
export function useSecureInputRelease(): void {
  useEffect(() => {
    if (!isMac || isPairedWebClientWindow()) {
      return
    }
    let parkedInput: HTMLInputElement | null = null

    const release = (): void => {
      const active = document.activeElement
      if (isFocusedPasswordInput(active)) {
        parkedInput = active
        active.blur()
      }
    }
    const restore = (): void => {
      const target = parkedInput
      parkedInput = null
      // Only reclaim focus the user has not already moved somewhere else.
      const active = document.activeElement
      if (target?.isConnected && (active === null || active === document.body)) {
        target.focus()
      }
    }
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') {
        restore()
      } else {
        release()
      }
    }

    window.addEventListener('blur', release)
    window.addEventListener('focus', restore)
    window.addEventListener('beforeunload', release)
    document.addEventListener('visibilitychange', onVisibilityChange)
    const unsubscribeSystemResumed = window.api?.ui?.onSystemResumed?.(release)
    return () => {
      window.removeEventListener('blur', release)
      window.removeEventListener('focus', restore)
      window.removeEventListener('beforeunload', release)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      unsubscribeSystemResumed?.()
    }
  }, [])
}
