import { app, powerMonitor, webContents } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { getLogsDirectory } from './observability/logs-directory'

/**
 * Why (#17872): on macOS, Chromium turns on Secure Event Input for the whole process
 * whenever any WebContents has a focused `<input type=password>` (a refcounted
 * `ScopedPasswordInputEnabler` in `RenderWidgetHostViewMac::SetTextInputActive`). The
 * enabler is normally dropped when the field blurs, when the field's window resigns key,
 * or when the WebContents is destroyed.
 *
 * A guest that never becomes key breaks all three: an agent focuses a login form's
 * password field over CDP (`DOM.focus`) inside an offscreen/retained `<webview>` or a
 * `show:false` BrowserWindow, so the enabler is created, but that guest's NSView is never
 * in a key window, so the "window resigned key" release never runs; retained pages are
 * kept alive rather than destroyed; and the agent moves on without blurring. Secure Event
 * Input then stays latched app-wide, blocking Option-only shortcuts and input methods in
 * every other app until the GUI session resets.
 *
 * Two release levers, both counter-synced (neither calls the raw
 * `DisableSecureEventInput`, which would desync Chromium's `g_password_input_counter`):
 *
 *  1. Blur the focused password field. The renderer reports a non-password text-input
 *     state, `SetTextInputActive` re-reads the type and resets that WebContents's enabler.
 *     This is the fix for a *live* focused field, driven by the text-input-state IPC rather
 *     than window-key notifications, so it reaches a guest whose window is never key.
 *  2. Drop Electron's own app-level enabler via `app.setSecureKeyboardEntryEnabled(false)`,
 *     which resets `Browser::password_input_enabler_` through the same `ScopedPasswordInputEnabler`
 *     destructor. Safe no-op when Electron never took it (Orca never calls the `true` side).
 *
 * Field evidence (2026-09, renderer-kill experiment on a live latch): killing the only
 * renderer of a latched Orca did NOT release Secure Event Input — the owner PID stayed the
 * browser process with zero live renderers. So at least one failure mode is an enabler
 * ORPHANED in the browser process, not tied to any live WebContents/RWHV. Lever 1 cannot
 * reach that (there is no live focused field to blur). Lever 2 reaches it only if the
 * orphan is Electron's app-level enabler; if it is instead a leaked RWHV enabler, only a
 * native `DisableSecureEventInput()` would clear it. The diagnostic log below records
 * `app.isSecureKeyboardEntryEnabled()` on every release trigger so we can tell which case
 * we are in: app-level-false while the OS latch is held (see IORegistry
 * `kCGSSessionSecureInputPID`) proves a leaked RWHV enabler.
 *
 * The renderer-side `useSecureInputRelease` covers the top window's own DOM and its local
 * browser-pane guests. This main-process backstop reaches EVERY WebContents (retained
 * client-hosted guests, offscreen windows, artifact/doc previews) and EVERY frame (so a
 * cross-origin OAuth/SSO login iframe is covered too), which the renderer's
 * main-frame-only `webviewRegistry` walk cannot.
 */

// Only touches a focused password input; a no-op in every other frame, so it is safe to
// run across all contents on deactivation.
const BLUR_FOCUSED_PASSWORD_INPUT = `(() => {
  const el = document.activeElement
  if (el && el.tagName === 'INPUT' && el.type === 'password') {
    el.blur()
  }
})()`

type SecureInputReleaseFrame = {
  isDestroyed(): boolean
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>
}

type SecureInputReleaseWebContents = {
  isDestroyed(): boolean
  readonly mainFrame:
    | (SecureInputReleaseFrame & { readonly framesInSubtree: SecureInputReleaseFrame[] })
    | null
}

type SecureInputAppEvents = {
  on(event: 'did-resign-active', listener: () => void): unknown
  off(event: 'did-resign-active', listener: () => void): unknown
}

type SecurePowerEvent = 'suspend' | 'resume'

type SecureInputPowerSource = {
  on(event: SecurePowerEvent, listener: () => void): unknown
  off(event: SecurePowerEvent, listener: () => void): unknown
}

// Electron's app-level Secure Keyboard Entry toggle (`Browser::password_input_enabler_`),
// distinct from the per-WebContents RWHV enablers.
type SecureKeyboardEntryController = {
  isSecureKeyboardEntryEnabled(): boolean
  setSecureKeyboardEntryEnabled(enabled: boolean): void
}

type SecureInputLogger = (event: string, detail: Record<string, unknown>) => void

type MacSecureInputReleaseOptions = {
  platform?: NodeJS.Platform
  appEvents?: SecureInputAppEvents
  powerSource?: SecureInputPowerSource
  getAllWebContents?: () => SecureInputReleaseWebContents[]
  appSecureKeyboard?: SecureKeyboardEntryController
  log?: SecureInputLogger
}

// Diagnostic log lands in a fixed, retrievable file because the desktop app is launched
// detached (`open -a Orca`), so main-process console output is not captured anywhere.
function defaultLog(event: string, detail: Record<string, unknown>): void {
  console.info(`[secure-input] ${event}`, detail)
  try {
    const dir = getLogsDirectory()
    mkdirSync(dir, { recursive: true })
    appendFileSync(
      join(dir, 'secure-input-release.log'),
      `${new Date().toISOString()} ${event} ${JSON.stringify(detail)}\n`
    )
  } catch {
    // Never let diagnostics break the release path.
  }
}

// Returns how many frames a blur was dispatched to (for the diagnostic count).
function releaseSecureInputInWebContents(contents: SecureInputReleaseWebContents): number {
  if (contents.isDestroyed()) {
    return 0
  }
  let frames: readonly SecureInputReleaseFrame[]
  try {
    const mainFrame = contents.mainFrame
    if (!mainFrame || mainFrame.isDestroyed()) {
      return 0
    }
    frames = mainFrame.framesInSubtree
  } catch {
    // Contents torn down between the guard and the read.
    return 0
  }
  let dispatched = 0
  for (const frame of frames) {
    try {
      if (frame.isDestroyed()) {
        continue
      }
      // Fire-and-forget: a frame can be mid-navigation or gone; releasing the OS latch
      // does not need the round trip to land, and one bad frame must not skip the rest.
      void frame.executeJavaScript(BLUR_FOCUSED_PASSWORD_INPUT, false)?.catch(() => {})
      dispatched += 1
    } catch {
      // Ignore: keep sweeping the remaining frames.
    }
  }
  return dispatched
}

/**
 * Release macOS Secure Event Input when Orca stops being the frontmost app, or the machine
 * suspends or resumes, so the latch cannot outlive the user leaving. Resume matters because
 * a field can be (re)focused on wake — e.g. reconnecting displays reshuffles windows while
 * Orca is not key. macOS-only; a no-op elsewhere.
 */
export function registerMacSecureInputRelease(
  options: MacSecureInputReleaseOptions = {}
): () => void {
  const platform = options.platform ?? process.platform
  if (platform !== 'darwin') {
    return () => {}
  }

  const appEvents = options.appEvents ?? app
  const powerSource = options.powerSource ?? powerMonitor
  const appSecureKeyboard = options.appSecureKeyboard ?? app
  const log = options.log ?? defaultLog
  const getAllWebContents =
    options.getAllWebContents ??
    ((): SecureInputReleaseWebContents[] => webContents.getAllWebContents())

  const sweep = (trigger: string): void => {
    // Lever 2 first: drop Electron's app-level enabler if it holds one. Counter-synced, so
    // a no-op when Electron never took it. Reading the state also feeds the diagnostic.
    let appLevelWasEnabled = false
    try {
      appLevelWasEnabled = appSecureKeyboard.isSecureKeyboardEntryEnabled()
      if (appLevelWasEnabled) {
        appSecureKeyboard.setSecureKeyboardEntryEnabled(false)
      }
    } catch {
      // Ignore: the DOM sweep below is independent.
    }

    // Lever 1: blur any live focused password field, across every WebContents and frame.
    const contentsList = getAllWebContents()
    let framesDispatched = 0
    for (const contents of contentsList) {
      framesDispatched += releaseSecureInputInWebContents(contents)
    }

    log('release', {
      trigger,
      appLevelSecureKeyboardWasEnabled: appLevelWasEnabled,
      webContentsCount: contentsList.length,
      framesDispatched
    })
  }

  const onResignActive = (): void => sweep('did-resign-active')
  const onSuspend = (): void => sweep('suspend')
  const onResume = (): void => sweep('resume')

  appEvents.on('did-resign-active', onResignActive)
  powerSource.on('suspend', onSuspend)
  powerSource.on('resume', onResume)
  return () => {
    appEvents.off('did-resign-active', onResignActive)
    powerSource.off('suspend', onSuspend)
    powerSource.off('resume', onResume)
  }
}
