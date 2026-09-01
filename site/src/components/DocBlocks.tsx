import type { ReactNode } from 'react'

interface CodeBlockProps {
  code: string
  label?: string
}

export function CodeBlock({ code, label }: CodeBlockProps) {
  return (
    <div className="code-wrap">
      {label && <p className="code-label">{label}</p>}
      <pre className="code-block">
        <code>{code}</code>
      </pre>
    </div>
  )
}

interface CalloutProps {
  tone?: 'note' | 'warn'
  children: ReactNode
}

export function Callout({ tone = 'note', children }: CalloutProps) {
  return <div className={tone === 'warn' ? 'warning' : 'doc-note'}>{children}</div>
}

interface EndpointProps {
  method: string
  path: string
  desc: string
}

export function Endpoint({ method, path, desc }: EndpointProps) {
  const tone = method === 'GET' || method === 'HEAD' ? 'get' : method.toLowerCase()
  return (
    <div className="endpoint">
      <span className={`method method-${tone}`}>{method}</span>
      <code className="endpoint-path">{path}</code>
      <span className="endpoint-desc">{desc}</span>
    </div>
  )
}
