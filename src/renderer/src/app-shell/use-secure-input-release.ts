import { useEffect } from 'react'
import { webviewRegistry } from '@/components/browser-pane/host-guest/webview-registry'
import { isPairedWebClientWindow } from '@/lib/desktop-window-chrome'
import { isMac } from './app-window-chrome'

const GUEST_PARKED_KEY = '__orcaSecureInputParkedPassword'

// Why a string: a <webview> guest is a separate WebContents, so the host can only
// reach its focused node through executeJavaScript. `moveFocusToRendererBeforeFocused
// WebviewHidden` is not reusable here — it also calls window.focus(), which would
// fight the app the user just switched to.
const RELEASE_IN_GUEST = `(() => {
  const active = document.activeElement
  if (active instanceof HTMLInputElement && active.type === 'password') {
    window['${GUEST_PARKED_KEY}'] = active
    active.blur()
  }
})()`

const RESTORE_IN_GUEST = `(() => {
  const parked = window['${GUEST_PARKED_KEY}']
  window['${GUEST_PARKED_KEY}'] = null
  const active = document.activeElement
  if (parked?.isConnected && (active === null || active === document.body)) {
    parked.focus()
  }
})()`

function isFocusedPasswordInput(value: Element | null): value is HTMLInputElement {
  return value instanceof HTMLInputElement && value.type === 'password'
}

// Fire-and-forget: a guest can be mid-navigation or already destroyed, and on
// beforeunload the async round trip will not land before teardown.
function runInGuests(script: string): void {
  for (const webview of webviewRegistry.values()) {
    try {
      void webview.executeJavaScript(script)?.catch(() => {})
    } catch {}
  }
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
      // Focus inside a guest reads as the <webview> element here, so the host check
      // above can never see the embedded browser's own password fields.
      runInGuests(RELEASE_IN_GUEST)
    }
    const restore = (): void => {
      const target = parkedInput
      parkedInput = null
      // Only reclaim focus the user has not already moved somewhere else.
      const active = document.activeElement
      if (target?.isConnected && (active === null || active === document.body)) {
        target.focus()
      }
      runInGuests(RESTORE_IN_GUEST)
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
