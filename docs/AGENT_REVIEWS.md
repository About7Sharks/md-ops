# Bounded agent reviews

Use one prompt per reviewer. Do not combine the lanes. Each prompt limits the files, checks, and output so that a reviewer does not repeat the full repository review.

## API boundary reviewer

```text
Review only packages/api/src and packages/api/test for logical-path escape,
mutation confirmation, ETag, and physical-path disclosure defects. Do not edit.
Run npm run test:api. Return only findings with severity, exact file and line,
a concrete failing case, and the smallest proposed fix. Return "No findings" if
all reviewed paths are safe. Do not review UI layout, deployment, or MCP code.
```

## MCP client reviewer

```text
Review only packages/mcp/src and packages/mcp/test. Check URL construction,
credential handling, write gates, response validation, and browser deep links.
Do not edit. Run npm run test:mcp and npm run build:mcp. Return only findings
with severity, exact file and line, and a reproducible failing input. Return
"No findings" if there are none. Do not review the API or UI implementation.
```

## UI behavior reviewer

```text
Review only packages/ui/src and its colocated tests for the named UI change:
<ONE CHANGE>. Do not review unrelated features. Run npm run test:ui and
npm run build:ui. If browser behavior is relevant, run
npm run verify:browser:local -- <ONLY THE REQUIRED INTERACTION FLAGS>.
Return only reproducible findings with exact file and line plus the failed
command or report field. Do not use a remote browser service. Do not edit.
```

## Repository operations reviewer

```text
Review only package manifests, lockfiles, Dockerfile, and scripts/*.sh. Check
standalone installs, command working directories, local verification, and
checkout bootstrap behavior. Do not inspect application features. Do not edit.
Run npm run test:operations. Return only reproducible findings with exact file
and line and the failed command. Return "No findings" if there are none.
```

The controller must run the relevant checks again. A reviewer report is not verification evidence.
