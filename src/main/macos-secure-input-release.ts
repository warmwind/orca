import { app, powerMonitor, webContents } from 'electron'

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
 * The one lever that releases it through Chromium's own counter (so the count never
 * desyncs) is to blur the focused password field: the renderer reports a non-password
 * text-input state, `SetTextInputActive` re-reads the type and resets the enabler, and
 * `DisableSecureEventInput()` runs. This works even for a guest whose window is never key,
 * because it is driven by the text-input-state IPC, not by window-key notifications.
 *
 * The renderer-side `useSecureInputRelease` covers the top window's own DOM and its local
 * browser-pane guests. This sweep is the authoritative backstop: from the main process it
 * reaches EVERY WebContents (retained client-hosted guests, offscreen windows, artifact /
 * doc previews) and EVERY frame (so a cross-origin OAuth/SSO login iframe is covered too),
 * which the renderer's main-frame-only `webviewRegistry` walk cannot.
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

type MacSecureInputReleaseOptions = {
  platform?: NodeJS.Platform
  appEvents?: SecureInputAppEvents
  powerSource?: SecureInputPowerSource
  getAllWebContents?: () => SecureInputReleaseWebContents[]
}

function releaseSecureInputInWebContents(contents: SecureInputReleaseWebContents): void {
  if (contents.isDestroyed()) {
    return
  }
  let frames: readonly SecureInputReleaseFrame[]
  try {
    const mainFrame = contents.mainFrame
    if (!mainFrame || mainFrame.isDestroyed()) {
      return
    }
    frames = mainFrame.framesInSubtree
  } catch {
    // Contents torn down between the guard and the read.
    return
  }
  for (const frame of frames) {
    try {
      if (frame.isDestroyed()) {
        continue
      }
      // Fire-and-forget: a frame can be mid-navigation or gone; releasing the OS latch
      // does not need the round trip to land, and one bad frame must not skip the rest.
      void frame.executeJavaScript(BLUR_FOCUSED_PASSWORD_INPUT, false)?.catch(() => {})
    } catch {
      // Ignore: keep sweeping the remaining frames.
    }
  }
}

/**
 * Blur any focused password field in every WebContents when Orca stops being the frontmost
 * app, or the machine suspends or resumes, so macOS Secure Event Input cannot stay latched
 * after the user leaves. Resume matters because a field can be (re)focused on wake — e.g.
 * arriving at a desk and reconnecting displays reshuffles windows while Orca is not key.
 * macOS-only; a no-op elsewhere.
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
  const getAllWebContents =
    options.getAllWebContents ??
    (() => webContents.getAllWebContents() as unknown as SecureInputReleaseWebContents[])

  const sweep = (): void => {
    for (const contents of getAllWebContents()) {
      releaseSecureInputInWebContents(contents)
    }
  }

  appEvents.on('did-resign-active', sweep)
  powerSource.on('suspend', sweep)
  powerSource.on('resume', sweep)
  return () => {
    appEvents.off('did-resign-active', sweep)
    powerSource.off('suspend', sweep)
    powerSource.off('resume', sweep)
  }
}
