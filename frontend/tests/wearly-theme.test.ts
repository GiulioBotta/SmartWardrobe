import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

// Wearly's "Caffè e crema" palette with the warm moka accent (spec 2026-10-27-wearly-redesign).
const LIGHT: Record<string, string> = {
  '--background': '#f8f1e7',
  '--card': '#f8f1e7',
  '--foreground': '#3b2a20',
  '--secondary': '#efe3d3',
  '--muted': '#efe3d3',
  '--accent': '#efe3d3',
  // #8a6a52 in the mockups, darkened to stay readable (WCAG AA) on the beige surfaces.
  '--muted-foreground': '#765a45',
  '--border': '#d8c6b2',
  '--input': '#d8c6b2',
  '--primary': '#3b2a20',
  '--primary-foreground': '#f8f1e7',
  '--brand': '#8f705c',
  '--ring': '#8f705c',
}
const DARK: Record<string, string> = {
  '--background': '#241a15',
  '--card': '#241a15',
  '--foreground': '#f3e8da',
  '--secondary': '#322520',
  '--muted': '#322520',
  '--accent': '#322520',
  '--muted-foreground': '#b59b86',
  '--border': '#4a3a30',
  '--input': '#4a3a30',
  '--primary': '#f3e8da',
  '--primary-foreground': '#241a15',
  '--brand': '#cdac94',
  '--ring': '#cdac94',
}

const css = readFileSync(path.resolve(__dirname, '../app/globals.css'), 'utf8')

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) return {}
  const body = css.slice(start, css.indexOf('}', start))
  const vars: Record<string, string> = {}
  for (const m of Array.from(body.matchAll(/(--[\w-]+):\s*([^;]+);/g))) vars[m[1]] = m[2].trim()
  return vars
}

function hslToRgb(value: string): [number, number, number] {
  const [h, s, l] = value.replace(/%/g, '').split(/\s+/).map(Number)
  const sat = s / 100
  const lig = l / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = sat * Math.min(lig, 1 - lig)
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)].map((c) => Math.round(c * 255)) as [number, number, number]
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function expectClose(actual: string | undefined, hex: string, name: string) {
  expect(actual, `${name} is missing`).toBeDefined()
  const got = hslToRgb(actual!)
  const want = hexToRgb(hex)
  got.forEach((c, i) => expect(Math.abs(c - want[i]), `${name}: ${got} vs ${hex}`).toBeLessThanOrEqual(1))
}

describe('Wearly theme tokens', () => {
  it('light theme uses the Caffè e crema palette', () => {
    const vars = block(':root')
    for (const [name, hex] of Object.entries(LIGHT)) expectClose(vars[name], hex, name)
  })

  it('dark theme is the same coffee with the lights off', () => {
    const vars = block('.dark')
    for (const [name, hex] of Object.entries(DARK)) expectClose(vars[name], hex, name)
  })

  it('exposes the brand colour and a serif title font to Tailwind', async () => {
    const config = (await import('../tailwind.config.js')).default as {
      theme: { extend: { colors: Record<string, unknown>; fontFamily: Record<string, string[]> } }
    }
    expect(config.theme.extend.colors.brand).toBeDefined()
    expect(config.theme.extend.fontFamily.serif[0]).toBe('var(--font-serif)')
  })

  it('defines the small-caps detail style', () => {
    expect(css).toMatch(/\.label-caps\s*\{/)
  })
})

function luminance([r, g, b]: [number, number, number]) {
  const lin = (c: number) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(hslToRgb(a)), luminance(hslToRgb(b))].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('readable text', () => {
  it.each([
    [':root', 'light'],
    ['.dark', 'dark'],
  ])('secondary text reaches WCAG AA on the page and on surfaces (%s)', (selector) => {
    const vars = block(selector)
    expect(contrast(vars['--muted-foreground'], vars['--background'])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(vars['--muted-foreground'], vars['--secondary'])).toBeGreaterThanOrEqual(4.5)
  })
})
