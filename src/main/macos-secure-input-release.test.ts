import { describe, expect, it, vi } from 'vitest'
import { registerMacSecureInputRelease } from './macos-secure-input-release'

vi.mock('electron', () => ({
  app: { on: vi.fn(), off: vi.fn() },
  powerMonitor: { on: vi.fn(), off: vi.fn() },
  webContents: { getAllWebContents: vi.fn(() => []) }
}))

type Listener = () => void

function createEventSource<E extends string>() {
  const listeners = new Map<E, Listener>()
  const source = {
    on: vi.fn((event: E, listener: Listener) => {
      listeners.set(event, listener)
    }),
    off: vi.fn((event: E, listener: Listener) => {
      if (listeners.get(event) === listener) {
        listeners.delete(event)
      }
    })
  }
  return { source, emit: (event: E) => listeners.get(event)?.() }
}

type ExecuteJavaScript = (code: string, userGesture?: boolean) => Promise<unknown>

type TestFrame = {
  isDestroyed: () => boolean
  executeJavaScript: ReturnType<typeof vi.fn<ExecuteJavaScript>>
  framesInSubtree: TestFrame[]
}

function createFrame(overrides: { destroyed?: boolean; throwOnExec?: boolean } = {}): TestFrame {
  const executeJavaScript = vi.fn<ExecuteJavaScript>(() =>
    overrides.throwOnExec ? Promise.reject(new Error('navigating')) : Promise.resolve()
  )
  return {
    isDestroyed: () => overrides.destroyed ?? false,
    executeJavaScript,
    framesInSubtree: []
  }
}

function createContents(frames: TestFrame[], destroyed = false) {
  const mainFrame = frames[0] ?? null
  if (mainFrame) {
    mainFrame.framesInSubtree = frames
  }
  return { isDestroyed: () => destroyed, mainFrame }
}

describe('registerMacSecureInputRelease', () => {
  it('attaches no listeners and returns a no-op off Mac', () => {
    const app = createEventSource<'did-resign-active'>()
    const suspend = createEventSource<'suspend' | 'resume'>()
    const dispose = registerMacSecureInputRelease({
      platform: 'win32',
      appEvents: app.source,
      powerSource: suspend.source,
      getAllWebContents: () => []
    })
    expect(app.source.on).not.toHaveBeenCalled()
    expect(suspend.source.on).not.toHaveBeenCalled()
    expect(() => dispose()).not.toThrow()
  })

  it('blurs a focused password field in every frame of every contents on deactivation', () => {
    const app = createEventSource<'did-resign-active'>()
    const suspend = createEventSource<'suspend' | 'resume'>()
    const frameA = createFrame()
    const frameB = createFrame()
    const guest = createContents([createFrame()])
    registerMacSecureInputRelease({
      platform: 'darwin',
      appEvents: app.source,
      powerSource: suspend.source,
      getAllWebContents: () => [createContents([frameA, frameB]), guest]
    })

    app.emit('did-resign-active')

    for (const frame of [frameA, frameB, guest.mainFrame!]) {
      expect(frame.executeJavaScript).toHaveBeenCalledTimes(1)
      expect(frame.executeJavaScript.mock.calls[0][0]).toContain("type === 'password'")
    }
  })

  it('also sweeps on system suspend and on resume', () => {
    const app = createEventSource<'did-resign-active'>()
    const power = createEventSource<'suspend' | 'resume'>()
    const frame = createFrame()
    registerMacSecureInputRelease({
      platform: 'darwin',
      appEvents: app.source,
      powerSource: power.source,
      getAllWebContents: () => [createContents([frame])]
    })

    power.emit('suspend')
    expect(frame.executeJavaScript).toHaveBeenCalledTimes(1)

    // Resume matters: a field can be (re)focused on wake while Orca is not key.
    power.emit('resume')
    expect(frame.executeJavaScript).toHaveBeenCalledTimes(2)
  })

  it('skips destroyed contents and destroyed frames, and survives a throwing frame', () => {
    const app = createEventSource<'did-resign-active'>()
    const suspend = createEventSource<'suspend' | 'resume'>()
    const mainFrame = createFrame()
    const destroyedFrame = createFrame({ destroyed: true })
    const throwingFrame = createFrame({ throwOnExec: true })
    const liveFrame = createFrame()
    const destroyedContents = createContents([createFrame()], true)
    registerMacSecureInputRelease({
      platform: 'darwin',
      appEvents: app.source,
      powerSource: suspend.source,
      getAllWebContents: () => [
        destroyedContents,
        // A live main frame with a destroyed, a rejecting, and a live subframe.
        createContents([mainFrame, destroyedFrame, throwingFrame, liveFrame])
      ]
    })

    expect(() => app.emit('did-resign-active')).not.toThrow()

    expect(destroyedContents.mainFrame!.executeJavaScript).not.toHaveBeenCalled()
    expect(mainFrame.executeJavaScript).toHaveBeenCalledTimes(1)
    expect(destroyedFrame.executeJavaScript).not.toHaveBeenCalled()
    expect(throwingFrame.executeJavaScript).toHaveBeenCalledTimes(1)
    expect(liveFrame.executeJavaScript).toHaveBeenCalledTimes(1)
  })

  it('detaches every listener on dispose', () => {
    const app = createEventSource<'did-resign-active'>()
    const power = createEventSource<'suspend' | 'resume'>()
    const frame = createFrame()
    const dispose = registerMacSecureInputRelease({
      platform: 'darwin',
      appEvents: app.source,
      powerSource: power.source,
      getAllWebContents: () => [createContents([frame])]
    })

    dispose()
    app.emit('did-resign-active')
    power.emit('suspend')
    power.emit('resume')

    expect(app.source.off).toHaveBeenCalledTimes(1)
    // suspend + resume both detached.
    expect(power.source.off).toHaveBeenCalledTimes(2)
    expect(frame.executeJavaScript).not.toHaveBeenCalled()
  })
})
