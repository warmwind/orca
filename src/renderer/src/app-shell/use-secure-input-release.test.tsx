// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/desktop-window-chrome', () => ({ isPairedWebClientWindow: () => false }))
vi.mock('./app-window-chrome', () => ({ isMac: true }))

import { useSecureInputRelease } from './use-secure-input-release'

describe('useSecureInputRelease', () => {
  let systemResumed: (() => void) | null
  const unsubscribeSystemResumed = vi.fn()

  beforeEach(() => {
    systemResumed = null
    unsubscribeSystemResumed.mockClear()
    document.body.replaceChildren()
    setVisibility('visible')
    ;(window as unknown as { api: unknown }).api = {
      ui: {
        onSystemResumed: vi.fn((callback: () => void) => {
          systemResumed = callback
          return unsubscribeSystemResumed
        })
      }
    }
  })

  afterEach(() => {
    document.body.replaceChildren()
  })

  function setVisibility(value: 'visible' | 'hidden'): void {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value })
  }

  function focusInput(type: 'password' | 'text'): HTMLInputElement {
    const input = document.createElement('input')
    input.type = type
    document.body.append(input)
    input.focus()
    expect(document.activeElement).toBe(input)
    return input
  }

  it('releases a focused password field when the window is deactivated, and restores it on return', () => {
    const password = focusInput('password')
    const view = renderHook(() => useSecureInputRelease())

    act(() => window.dispatchEvent(new Event('blur')))
    expect(document.activeElement).not.toBe(password)

    act(() => window.dispatchEvent(new Event('focus')))
    expect(document.activeElement).toBe(password)

    view.unmount()
  })

  it('releases a focused password field when the document is hidden, and restores it when shown', () => {
    const password = focusInput('password')
    const view = renderHook(() => useSecureInputRelease())

    setVisibility('hidden')
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(document.activeElement).not.toBe(password)

    setVisibility('visible')
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(document.activeElement).toBe(password)

    view.unmount()
  })

  it('releases a focused password field on system resume and on unload', () => {
    const resumedPassword = focusInput('password')
    const view = renderHook(() => useSecureInputRelease())

    act(() => systemResumed?.())
    expect(document.activeElement).not.toBe(resumedPassword)

    const unloadingPassword = focusInput('password')
    act(() => window.dispatchEvent(new Event('beforeunload')))
    expect(document.activeElement).not.toBe(unloadingPassword)

    view.unmount()
  })

  it('leaves ordinary text focus alone and drops the resume listener on unmount', () => {
    const textInput = focusInput('text')
    const view = renderHook(() => useSecureInputRelease())

    act(() => window.dispatchEvent(new Event('blur')))
    expect(document.activeElement).toBe(textInput)

    view.unmount()
    expect(unsubscribeSystemResumed).toHaveBeenCalledTimes(1)
  })

  it('does not steal focus the user has already moved elsewhere', () => {
    const password = focusInput('password')
    const view = renderHook(() => useSecureInputRelease())

    act(() => window.dispatchEvent(new Event('blur')))
    const other = focusInput('text')
    act(() => window.dispatchEvent(new Event('focus')))

    expect(document.activeElement).toBe(other)
    expect(document.activeElement).not.toBe(password)
    view.unmount()
  })

  it('does not restore focus to a field whose dialog has closed', () => {
    const password = focusInput('password')
    const view = renderHook(() => useSecureInputRelease())

    act(() => window.dispatchEvent(new Event('blur')))
    password.remove()
    act(() => window.dispatchEvent(new Event('focus')))

    expect(document.activeElement).not.toBe(password)
    view.unmount()
  })
})
