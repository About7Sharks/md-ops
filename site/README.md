# MD Ops — site

Marketing, docs, and how-to site for MD Ops, a local-first Markdown operations workspace.

**Release state:** public pre-release. Source: [About7Sharks/md-ops](https://github.com/About7Sharks/md-ops).

Built with **React + Vite + TypeScript**. Pure static output — no backend, no server-side
code, no environment secrets. Dark, developer-tool aesthetic with inline SVG icons and a
single hand-written stylesheet.

## Pages

- **/** — landing: hero, features, quick start, MCP & agents, security posture, footer
- **/docs** — docs hub with sidebar: quick start, configuration, API reference, MCP integration, agents, security
- **/how-to** — everyday usage walkthrough

## Develop

```bash
npm install
npm run dev        # local dev server
```

## Build

```bash
npm run build      # type-checks (tsc -b) then emits static site to dist/
npm run preview    # serve the built dist/ locally
```

`dist/` contains only static assets and can be hosted on any static host (GitHub Pages,
Netlify, nginx, etc.). There is no API route and nothing to configure at deploy time.

## License

The site itself is MIT licensed, mirroring MD Ops.
