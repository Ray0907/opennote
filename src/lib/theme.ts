import { useCallback, useEffect, useState } from 'react'

/**
 * Theme preference vs. resolved theme (M6 polish):
 * - preference: what the user chose — 'system' follows the OS, and is the
 *   default (absence of the localStorage key).
 * - resolved: what is actually on screen right now ('light' | 'dark').
 *
 * The resolved theme is mirrored to <html data-theme="..."> so CSS tokens
 * switch, and returned from useTheme() so React consumers (BlockNoteView's
 * `theme` prop) stay in lockstep. index.html applies the same logic inline
 * before first paint to avoid a flash of the wrong theme.
 */
export type ThemePref = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'opennote.theme'
const DARK_MQ = '(prefers-color-scheme: dark)'

export function getThemePref(): ThemePref {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark') return v
  } catch {
    // Storage unavailable — fall through to system.
  }
  return 'system'
}

export function resolveTheme(pref: ThemePref): ResolvedTheme {
  if (pref === 'system') {
    return window.matchMedia(DARK_MQ).matches ? 'dark' : 'light'
  }
  return pref
}

function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.dataset.theme = resolved
}

/** Preference cycle order for the single toggle button. */
const CYCLE: ThemePref[] = ['system', 'light', 'dark']

export function useTheme(): {
  pref: ThemePref
  resolved: ResolvedTheme
  cycleTheme: () => void
} {
  const [pref, setPref] = useState<ThemePref>(getThemePref)
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(getThemePref()))

  useEffect(() => {
    const next = resolveTheme(pref)
    setResolved(next)
    applyTheme(next)
    if (pref !== 'system') return
    // Follow live OS appearance changes while in system mode.
    const mq = window.matchMedia(DARK_MQ)
    const onChange = () => {
      const r = resolveTheme('system')
      setResolved(r)
      applyTheme(r)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [pref])

  const cycleTheme = useCallback(() => {
    setPref((prev) => {
      const next = CYCLE[(CYCLE.indexOf(prev) + 1) % CYCLE.length]
      try {
        if (next === 'system') window.localStorage.removeItem(STORAGE_KEY)
        else window.localStorage.setItem(STORAGE_KEY, next)
      } catch {
        // Non-persistent is still usable for this session.
      }
      return next
    })
  }, [])

  return { pref, resolved, cycleTheme }
}
