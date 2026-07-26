import '@testing-library/jest-dom/vitest'

// jsdom doesn't ship ResizeObserver; Recharts and our charts use it.
if (typeof globalThis.ResizeObserver === 'undefined') {
  // No-op fallback: charts render with 0×0 dims and Recharts falls
  // back to its own container. That's good enough for the smoke tests
  // we run; visual contract tests live in Playwright.
  class StubResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver
}

// IntersectObserver is similarly absent; the MapPicker uses it
// transitively through react-leaflet, but the `dynamic(() => …, { ssr:
// false })` import already prevents the component from rendering
// during tests. Skip the polyfill to keep the setup lean.

// canvas + ResizeObserver-on-server workarounds live in tests that
// touch libraries which import them at module-init time.
