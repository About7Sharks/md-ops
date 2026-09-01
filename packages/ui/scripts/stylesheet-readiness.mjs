export function failedStylesheets(networkStylesheets, unavailableDocumentLinks, optionalTargets = []) {
  const optional = new Set(optionalTargets)
  const requestFailures = networkStylesheets.filter((stylesheet) => !optional.has(stylesheet.target) && (
    stylesheet.failed
    || stylesheet.status === null
    || stylesheet.status >= 400
    || !stylesheet.finished
  ))
  return {
    requestFailures,
    unavailableDocumentLinks,
    ready: requestFailures.length === 0 && unavailableDocumentLinks.length === 0,
  }
}
