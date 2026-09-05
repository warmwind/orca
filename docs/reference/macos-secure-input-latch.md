# macOS Secure Event Input latch (#17872)

## Symptom

On macOS, Orca leaves **Secure Event Input** enabled process-wide. While it is on, other
apps cannot read Option-only global shortcuts or drive input methods. `ioreg -l | grep
kCGSSessionSecureInputPID` reports the live Orca PID as the owner, and the state persists
after Orca loses focus. It only clears on a GUI-session reset (logout/reboot) or when the
holding process exits.

## Mechanism (verified against Chromium 150.0.7871.224 / Electron 43.4.1)

Secure Event Input is a **per-process, reference-counted** macOS facility:

- `ui/base/cocoa/secure_password_input.mm` keeps a static counter
  `g_password_input_counter`. `ScopedPasswordInputEnabler`'s constructor calls
  `EnableSecureEventInput()` on the 0→1 edge; its destructor calls
  `DisableSecureEventInput()` on the 1→0 edge.
- `RenderWidgetHostViewMac::SetTextInputActive(active)` creates the enabler when
  `active && GetTextInputType() == TEXT_INPUT_TYPE_PASSWORD`, and resets it otherwise. So
  **each WebContents with a focused `<input type=password>` holds one enabler.**

Chromium normally drops the enabler on any of:

1. **Blur / text-input-type change** — the renderer reports a non-password
   `TextInputState`; `OnUpdateTextInputStateCalled` re-runs `SetTextInputActive`, which
   re-reads the now-`NONE` type and resets the enabler.
2. **Window resigns key** — `OnWindowIsKeyChanged(false)` → `SetActive(false)` →
   `SetTextInputActive(false)`.
3. **WebContents destroyed** — the `password_input_enabler_` member is freed in `Destroy()`.

## Why it latches in Orca

A **guest WebContents that never becomes key** defeats all three release paths at once:

- An agent focuses a login form's password field over CDP (`DOM.focus`, see
  `src/main/browser/cdp-text-input-commands.ts`) inside an **offscreen/retained
  `<webview>`** (client-hosted pages are parked at `left:-10000px`, see
  `browser-client-page-retained-elements.ts`; inactive local guests are `display:none`) or
  a **`show:false` BrowserWindow** (`offscreen-browser-backend.ts`). The enabler is created.
- That guest's NSView is **never in a key window**, so path 2 never fires.
- Retained pages are **kept alive** (up to 256 client-hosted / 4 hidden worktrees), so path
  3 never fires.
- The agent moves on **without blurring**, so path 1 never fires.

Result: the enabler lives for the life of the process. This matches every observation in
#17872: live Orca PID owns it; no visible browser tab or password field is required at
observation time; app focus-loss (activating Finder) does not release it; a Fusion login
guest with a password field was seen once; closing the visible tab did not help (a
different retained/offscreen guest, or a cross-origin login iframe, held the enabler).

The login field is frequently inside a **cross-origin iframe** (OAuth/SSO), which matters
for the fix: the host page's `document.activeElement` is the `<iframe>` element, not the
password input, so a main-frame-only blur misses it.

## Field evidence: an orphaned browser-process enabler (2026-09)

A live-latch experiment refined the model. On a latched Orca (IORegistry owner = the Orca
browser PID), killing the **only** renderer process (`kill -9`) did **not** release Secure
Event Input: at the instant there were zero live renderers, the owner PID was still the
browser process, and it stayed latched while a replacement renderer was spawned and across
many app-focus changes. A read-only monitor confirmed the owner never changed.

This proves at least one failure mode is an enabler **orphaned in the browser process**,
not tied to any live WebContents / RWHV. Destroying every renderer — the strongest form of
release path 3 above — did not clear it, and there was no live focused password field to
blur (release path 1). So a DOM-blur sweep alone cannot recover this state; the lever has
to act in the browser (main) process. Two candidates: Electron's own app-level enabler
(clearable via `setSecureKeyboardEntryEnabled(false)`), or a leaked RWHV enabler (only a
native `DisableSecureEventInput()` reaches it). The diagnostic below distinguishes them.

## The fix

The only lever that releases the OS latch **through Chromium's own counter** (so the count
never desyncs) is path 1: **blur the focused password field.** The renderer reports a
non-password state and Chromium resets the enabler for us. This works even when the guest's
window is never key, because it is driven by the text-input-state IPC, not by window-key
notifications.

Two layers, both macOS-only and behind platform guards:

- **Renderer** (`src/renderer/src/app-shell/use-secure-input-release.ts`): parks/restores
  a focused password field in the top window's own DOM and its local browser-pane guests,
  on window blur / document hidden / system resume / `beforeunload`. Covers the common
  visible cases and the teardown timing that the main process cannot observe.
- **Main process** (`src/main/macos-secure-input-release.ts`): the authoritative backstop.
  On `app.on('did-resign-active')` and `powerMonitor` `suspend`/`resume`, it runs two
  counter-synced levers:
  1. **Blur sweep** — walks **every** WebContents (`webContents.getAllWebContents()`) and
     **every frame** (`mainFrame.framesInSubtree`), blurring a focused password input in
     each. This reaches retained client-hosted guests, offscreen windows, artifact/doc
     previews, and cross-origin login iframes — none of which the renderer's
     `webviewRegistry` walk can see.
  2. **App-level release** — if `app.isSecureKeyboardEntryEnabled()` is true, calls
     `app.setSecureKeyboardEntryEnabled(false)` to drop Electron's own
     `Browser::password_input_enabler_`. Counter-synced (goes through Electron's
     `ScopedPasswordInputEnabler` destructor, **not** the raw `DisableSecureEventInput`),
     and a no-op when Electron never took it — which is always, in current Orca, since Orca
     never calls the `true` side.

  Each trigger appends a diagnostic line to
  `~/Library/Application Support/Orca/logs/secure-input-release.log`
  (`trigger`, `appLevelSecureKeyboardWasEnabled`, `webContentsCount`, `framesDispatched`).
  The desktop app is launched detached (`open -a Orca`), so console output is lost; the file
  is the retrievable record. Cross-referencing `appLevelSecureKeyboardWasEnabled=false`
  against an IORegistry owner that is still Orca is the decisive proof that a stuck latch is
  a leaked **RWHV** enabler (lever 2 cannot reach it) rather than Electron's app-level one.

The blur script only touches a focused `<input type=password>`, so it is a no-op in every
other frame and safe to broadcast on deactivation. Automation is unaffected: the CDP
`fill`/`type` path re-issues `DOM.focus` before typing, so a blurred field is re-focused on
the next agent keystroke, and blur never clears an already-typed value.

## App-level release vs. the raw OS call (Goal C)

`app.setSecureKeyboardEntryEnabled(false)` resets **Electron's own**
`Browser::password_input_enabler_` (`shell/browser/browser_mac.mm`) through the same
`ScopedPasswordInputEnabler` destructor Chromium uses, so it stays in lockstep with
`g_password_input_counter`. That is why it is safe to run as lever 2 on every deactivation.
Its limit: it **cannot** touch an enabler a RenderWidgetHostViewMac created. Reaching that
would need a native addon calling the raw `DisableSecureEventInput()`.

The raw OS call is rejected as the primary fix:

- **Desync risk.** `DisableSecureEventInput()` decrements the OS-level per-process count
  without touching Chromium's `g_password_input_counter`. Blindly decrementing leaves
  Chromium believing it still holds an enabler; the next genuine blur/destroy then
  double-disables. The blur lever keeps both counts in lockstep instead.
- **Build/signing burden.** A native `.node` module must be compiled, code-signed, and
  notarized per release — heavy for a fix that must rebase onto upstream daily, and the
  task forbids new signing identities.

Keep it on record as a *last-resort* option only: a native helper that, on teardown of an
affected context, loops `DisableSecureEventInput()` until `IsSecureEventInputEnabled()`
is false — acceptable only if paired with logic that re-synchronizes Chromium's enablers,
which is why the DOM-blur approach is strictly preferable.

## Recovery without reboot/logout (Goal F)

Secure Event Input is per-process, so **no other process can decrement a live holder's
count.** To clear a state currently held by a running Orca:

1. **Preferred, non-destructive:** lock the screen with **Ctrl+Cmd+Q** and unlock by
   **typing** your password (not Touch ID — the typed unlock forces loginwindow through its
   own secure-input take/release, which re-derives the WindowServer state). This avoids a
   full logout and usually clears the latch.
2. **Deterministic:** quit and relaunch Orca — its enabler is freed when the process exits.
   Requires user authorization; do not quit a process whose live failure state is being
   preserved for diagnosis.
3. **Through Orca, counter-synced:** get the holding guest to blur its password field (or
   be destroyed). Once the patched build is running, simply switching away from Orca
   (`did-resign-active`) releases it automatically.

A **stale** PID (Orca already exited but `kCGSSessionSecureInputPID` still points at the
dead PID) is a known macOS bug (rdar://48953777: the PID is recorded wrong when secure
input is enabled from a background app). Recovery 1 clears it; the patch prevents Orca from
enabling secure input from a never-key background guest in the first place.

## Verifying a build

The current production latch makes a clean live measurement ambiguous, because
`IsSecureEventInputEnabled()` is a login-session global and the existing holder keeps it
true. Do a clean check only after the latch is cleared (recovery above), on a build that
carries this fix:

1. Confirm baseline released: `ioreg -l -w0 | grep kCGSSessionSecureInputPID` prints
   nothing (or not Orca).
2. Drive an agent to focus a password field on a background/retained browser page.
3. Switch to another app. Confirm the owner does **not** become Orca and Option-only
   shortcuts keep working in the other app.
