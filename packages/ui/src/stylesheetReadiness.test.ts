import { describe, expect, it } from 'bun:test'
import { failedStylesheets } from '../scripts/stylesheet-readiness.mjs'

describe('browser verifier stylesheet readiness', () => {
  it('accepts only completed successful stylesheet requests with an attached document sheet', () => {
    expect(failedStylesheets(
      [{ target: '/app.css', status: 200, finished: true, failed: null }],
      [],
    )).toEqual({ requestFailures: [], unavailableDocumentLinks: [], ready: true })
  })

  it('ignores an unavailable alternate stylesheet that is not part of the capture', () => {
    expect(failedStylesheets(
      [{ target: '/print-theme.css', status: null, finished: false, failed: 'not requested' }],
      [],
      ['/print-theme.css'],
    ).ready).toBeTrue()
  })

  it('rejects failed, non-2xx, and incomplete CSS before a screenshot can pass', () => {
    const requests = [
      { target: '/failed.css', status: null, finished: false, failed: 'connection reset' },
      { target: '/missing.css', status: 404, finished: true, failed: null },
      { target: '/partial.css', status: 200, finished: false, failed: null },
    ]
    const unavailable = [{ target: '/missing.css', available: false }]
    const result = failedStylesheets(requests, unavailable)

    expect(result.ready).toBeFalse()
    expect(result.requestFailures.map((request) => request.target)).toEqual(['/failed.css', '/missing.css', '/partial.css'])
    expect(result.unavailableDocumentLinks).toEqual(unavailable)
  })
})
