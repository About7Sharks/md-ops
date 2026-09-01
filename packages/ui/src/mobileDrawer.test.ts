import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('./App.css', import.meta.url), 'utf8')
const navigation = readFileSync(new URL('./SidebarNavigation.tsx', import.meta.url), 'utf8')
const navigationCss = readFileSync(new URL('./sidebarNavigation.css', import.meta.url), 'utf8')

describe('mobile Files drawer', () => {
  it('opens Files by default on mobile only when no note link was supplied', () => {
    expect(app).toContain("const [sidebarOpen, setSidebarOpen] = useState(() => (")
    expect(app).toContain("window.innerWidth <= DESKTOP_BREAKPOINT && !parseDeepLink()")
  })

  it('orders source, real navigation modes, All-mode quick access, and the sticky action footer', () => {
    const source = app.indexOf('className="roots root-picker"')
    const noteNavigation = app.indexOf('<SidebarNavigation')
    const mobileQuickAccess = app.indexOf('className="mobile-quick-access"')
    const search = app.indexOf('className="search"')
    const footer = app.indexOf('className="drawer-footer"')

    expect(source).toBeGreaterThan(-1)
    expect(source).toBeLessThan(noteNavigation)
    expect(noteNavigation).toBeLessThan(footer)
    expect(mobileQuickAccess).toBeGreaterThan(noteNavigation)
    expect(mobileQuickAccess).toBeLessThan(search)
    expect(navigation).toContain("{ id: 'all', label: 'All' }")
    expect(navigation).toContain("{ id: 'recent', label: 'Recent' }")
    expect(navigation).toContain("{ id: 'pinned', label: 'Pinned' }")
    expect(app).toContain('className="search"')
    expect(app).toContain('aria-label="Pinned files and folders"')
    expect(app).toContain('className="explorer-bar"')
    expect(app).toContain('New note')
    expect(app).toContain('New folder')
    expect(app).toContain("{saveStatus === 'reload-required' ? 'Reload needed' : writeMode ? 'Write on' : 'Read only'}")
  })

  it('uses a compact 78vw sheet, blurred backdrop, safe-area padding, and 44px touch targets', () => {
    expect(css).toContain('width: min(78vw, 360px)')
    expect(css).toContain('backdrop-filter: blur(8px) saturate(0.75)')
    expect(css).toContain('padding-top: env(safe-area-inset-top, 0px)')
    expect(css).toContain('padding: 12px 12px calc(12px + env(safe-area-inset-bottom, 0px))')
    expect(css).toContain('min-height: 44px')
    expect(css).toContain('min-height: 48px')
    expect(css).toContain('overscroll-behavior: contain')
    expect(navigationCss).toContain('.sidebar-mode-button,')
    expect(navigationCss).toContain('min-height: 44px')
    expect(app).toContain("aria-current={isActive ? 'page' : undefined}")
    expect(app).toContain('aria-label="Close file sidebar"')
    expect(app).toContain('aria-label="Search files and folders"')
  })

  it('promotes exactly three existing quick links into the mobile All mode without changing Pinned', () => {
    expect(app).toContain('quickLinks.slice(0, 3).map')
    expect(app).toContain('className="mobile-quick-access"')
    expect(app).toContain('className="mobile-quick-access-link"')
    expect(app).toContain('className="quick-links" aria-label="Pinned files and folders"')
    expect(css).toContain('.mobile-quick-access { display: none; }')
    expect(css).toContain('.mobile-quick-access-link {')
    expect(css).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))')
  })

  it('keeps valid mobile deep links authoritative over the default root', () => {
    expect(app).toContain("if (deepLink && roots.some((root) => root.id === deepLink.root)) return")
  })

  it('keeps drawer-only actions out of the desktop sidebar', () => {
    const baseHide = css.indexOf('.drawer-footer { display: none; }')
    const mobileOverride = css.indexOf('.drawer-footer {', baseHide + 1)

    expect(baseHide).toBeGreaterThan(-1)
    expect(mobileOverride).toBeGreaterThan(baseHide)
    expect(css.slice(mobileOverride, mobileOverride + 180)).toContain('display: grid')
  })

  it('closes mobile navigation surfaces before opening the graph', () => {
    const handler = app.slice(app.indexOf('const handleOpenGraph'), app.indexOf('const handleOpenRecent'))

    expect(handler).toContain('setSidebarOpen(false)')
    expect(handler).toContain('setMobileControlsOpen(false)')
    expect(handler).toContain('setShowGraph(true)')
    expect(app).toContain('onClick={handleOpenGraph}>Graph</button>')
  })
})
