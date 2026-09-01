#!/usr/bin/env node
/**
 * Dependency-free iPhone 14 visual/touch-target verification through Chrome CDP.
 * Requires Node 24+ (global WebSocket) and a local Google Chrome binary.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const IPHONE_14 = { width: 390, height: 844, deviceScaleFactor: 3 }
const DESKTOP = { width: 1440, height: 1000, deviceScaleFactor: 1 }
const DEFAULT_URL = null
const DEFAULT_SETTLE_MS = 1000
const MIN_TOUCH_TARGET = 44

function usage() {
  return `Usage: npm run verify:mobile -- [options]

Options:
  --url <url>          Page to verify (required)
  --note <root/path>   Open a Markdown note through the app's read-only deep link
  --output <path>      PNG output path (default: artifacts/mobile-verify.png)
  --report <path>      JSON report path (default: alongside the PNG)
  --open-files         Open the visible Files aria-controls drawer trigger first
  --open-toolbar-menu  Open the document toolbar's File actions menu
  --open-graph         Open the Graph action through the document toolbar's More menu
  --enable-writing     Click the visible Edit/Start writing action before capture
  --append-text <text> Focus the Markdown editor and insert text before capture
  --open-changes       Open the visible Changes review after inserting text
  --open-create        Open the New Note dialog without submitting it
  --desktop            Capture a 1440 by 1000 desktop viewport instead of iPhone 14
  --settle-ms <ms>     Extra data-settle time after font/network idle (default: ${DEFAULT_SETTLE_MS})
  --chrome <path>      Chrome executable (default: google-chrome)
  --help               Show this help
`
}

function parseArgs(argv) {
  const options = {
    url: DEFAULT_URL,
    note: null,
    output: 'artifacts/mobile-verify.png',
    report: null,
    openFiles: false,
    openToolbarMenu: false,
    openGraph: false,
    enableWriting: false,
    appendText: null,
    openChanges: false,
    openCreate: false,
    desktop: false,
    settleMs: DEFAULT_SETTLE_MS,
    chrome: process.env.CHROME_BIN || 'google-chrome',
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help') return { help: true }
    if (argument === '--open-files') {
      options.openFiles = true
      continue
    }
    if (argument === '--open-toolbar-menu') {
      options.openToolbarMenu = true
      continue
    }
    if (argument === '--open-graph') {
      options.openGraph = true
      continue
    }
    if (argument === '--enable-writing') {
      options.enableWriting = true
      continue
    }
    if (argument === '--open-changes') {
      options.openChanges = true
      continue
    }
    if (argument === '--open-create') {
      options.openCreate = true
      continue
    }
    if (argument === '--desktop') {
      options.desktop = true
      continue
    }
    const value = argv[index + 1]
    if (!['--url', '--note', '--output', '--report', '--settle-ms', '--chrome', '--append-text'].includes(argument) || value === undefined) {
      throw new Error(`Unknown option or missing value: ${argument}`)
    }
    index += 1
    if (argument === '--url') options.url = value
    if (argument === '--note') options.note = value
    if (argument === '--output') options.output = value
    if (argument === '--report') options.report = value
    if (argument === '--chrome') options.chrome = value
    if (argument === '--append-text') options.appendText = value
    if (argument === '--settle-ms') options.settleMs = Number(value)
  }
  if (!options.url) throw new Error('--url is required')
  if (!Number.isFinite(options.settleMs) || options.settleMs < 0) throw new Error('--settle-ms must be a non-negative number')
  if (options.openCreate && options.openChanges) throw new Error('--open-create and --open-changes capture different dialogs; run them separately')
  if (options.openGraph && options.openToolbarMenu) throw new Error('--open-graph opens the Graph action from the More menu; capture --open-toolbar-menu separately')
  if (options.note !== null) {
    const separator = options.note.indexOf('/')
    if (separator <= 0 || separator === options.note.length - 1) throw new Error('--note must be <root-id/relative-path>')
    const url = new URL(options.url)
    url.searchParams.set('root', options.note.slice(0, separator))
    url.searchParams.set('path', options.note.slice(separator + 1))
    url.searchParams.set('view', 'edit')
    options.url = url.toString()
  }
  options.output = resolve(options.output)
  options.report = resolve(options.report || join(dirname(options.output), `${basename(options.output, extname(options.output))}.json`))
  return options
}

class CdpConnection {
  constructor(url) {
    this.url = url
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Set()
  }

  async connect() {
    this.socket = new WebSocket(this.url)
    await new Promise((resolveOpen, rejectOpen) => {
      const timeout = setTimeout(() => rejectOpen(new Error('Timed out opening Chrome DevTools WebSocket')), 10_000)
      this.socket.addEventListener('open', () => {
        clearTimeout(timeout)
        resolveOpen()
      }, { once: true })
      this.socket.addEventListener('error', () => {
        clearTimeout(timeout)
        rejectOpen(new Error('Could not open Chrome DevTools WebSocket'))
      }, { once: true })
    })
    this.socket.addEventListener('message', (event) => this.onMessage(event))
    this.socket.addEventListener('close', () => {
      for (const { reject } of this.pending.values()) reject(new Error('Chrome DevTools WebSocket closed'))
      this.pending.clear()
    })
  }

  onMessage(event) {
    const message = JSON.parse(String(event.data))
    if (message.id) {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(`${message.error.message} (${pending.method})`))
      else pending.resolve(message.result)
      return
    }
    for (const listener of this.listeners) listener(message)
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++
    return new Promise((resolveSend, rejectSend) => {
      this.pending.set(id, { resolve: resolveSend, reject: rejectSend, method })
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }

  onEvent(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  close() {
    this.socket?.close()
  }
}

async function waitForFile(path, processHandle, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      return await readFile(path, 'utf8')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      if (processHandle.exitCode !== null) throw new Error(`Chrome exited before exposing DevTools (code ${processHandle.exitCode})`)
      await delay(50)
    }
  }
  throw new Error('Timed out waiting for Chrome DevToolsActivePort')
}

async function launchChrome(options, profileDir, viewport) {
  const chrome = spawn(options.chrome, [
    '--headless=new',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    `--window-size=${viewport.width},${viewport.height}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  chrome.stderr.setEncoding('utf8')
  chrome.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4_000) })
  try {
    const portFile = await waitForFile(join(profileDir, 'DevToolsActivePort'), chrome)
    const [port, browserPath] = portFile.trim().split(/\r?\n/)
    if (!port || !browserPath) throw new Error('Chrome wrote an invalid DevToolsActivePort file')
    return { chrome, webSocketUrl: `ws://127.0.0.1:${port}${browserPath}`, stderr: () => stderr }
  } catch (error) {
    chrome.kill('SIGTERM')
    throw error
  }
}

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId)
  if (result.exceptionDetails) throw new Error(`Page evaluation failed: ${result.exceptionDetails.text || 'unknown exception'}`)
  return result.result.value
}

function pageDiagnosticsExpression() {
  return `(() => {
    const minTarget = ${MIN_TOUCH_TARGET};
    const rect = (node) => {
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, right: r.right, bottom: r.bottom, left: r.left };
    };
    const visible = (node) => {
      if (!node || !node.isConnected) return false;
      const closedDetails = node.closest('details:not([open])');
      if (closedDetails) {
        const visibleSummary = closedDetails.querySelector(':scope > summary');
        if (!visibleSummary || !visibleSummary.contains(node)) return false;
      }
      const style = getComputedStyle(node);
      const r = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && r.width > 0.5 && r.height > 0.5 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
    };
    const label = (node) => (node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120);
    const selector = (node) => {
      if (node.id) return '#' + CSS.escape(node.id);
      const classes = [...node.classList].slice(0, 2).map((name) => '.' + CSS.escape(name)).join('');
      return node.tagName.toLowerCase() + classes + (node.getAttribute('aria-label') ? '[aria-label="' + node.getAttribute('aria-label').replace(/"/g, '\\\\"') + '"]' : '');
    };
    const unique = (nodes) => [...new Set(nodes.filter(Boolean))];
    const trigger = [...document.querySelectorAll('[aria-controls]')].find((node) => {
      const controls = (node.getAttribute('aria-controls') || '').toLowerCase();
      return visible(node) && (controls.includes('file') || /\\bfiles?\\b/i.test(label(node)));
    });
    const controlled = trigger ? document.getElementById(trigger.getAttribute('aria-controls')) : null;
    const sidebarCandidates = unique([
      controlled,
      document.getElementById('file-sidebar'),
      ...document.querySelectorAll('[data-mobile-sidebar], [data-sidebar], aside, [role="navigation"], [class*="sidebar" i], [class*="drawer" i]'),
    ]).filter(visible);
    const sidebar = sidebarCandidates.sort((a, b) => {
      const score = (node) => {
        const hint = (node.id + ' ' + node.className + ' ' + node.getAttribute('aria-label')).toLowerCase();
        return (node === controlled ? 1000 : 0) + (node.id === 'file-sidebar' ? 800 : 0) + (hint.includes('file') ? 200 : 0) + (hint.includes('sidebar') || hint.includes('drawer') ? 100 : 0) + (node.tagName === 'ASIDE' ? 30 : 0);
      };
      return score(b) - score(a);
    })[0] || null;
    const sidebarRect = sidebar ? rect(sidebar) : null;
    const sidebarStyle = sidebar ? getComputedStyle(sidebar) : null;
    const sidebarReport = sidebar ? {
      selector: selector(sidebar),
      visible: visible(sidebar),
      bounds: sidebarRect,
      inViewportBounds: sidebarRect.left >= -0.5 && sidebarRect.top >= -0.5 && sidebarRect.right <= innerWidth + 0.5 && sidebarRect.bottom <= innerHeight + 0.5,
      computedTransform: sidebarStyle.transform,
      position: sidebarStyle.position,
    } : { selector: null, visible: false, bounds: null, inViewportBounds: false, computedTransform: null, position: null };
    const backdrop = unique([...document.querySelectorAll('[data-backdrop], [class*="backdrop" i], [class*="overlay" i]')]).find(visible);
    const scopes = unique([sidebar, ...document.querySelectorAll('footer, [role="contentinfo"], [class*="footer" i]')]).filter(visible);
    const controls = unique(scopes.flatMap((scope) => [...scope.querySelectorAll('a[href], button, input, select, textarea, [role="button"], [role="menuitem"], [tabindex]:not([tabindex="-1"])')]));
    const requiredControls = [];
    const excludedCompactGlyphTargets = [];
    for (const control of controls) {
      if (!visible(control)) continue;
      const bounds = rect(control);
      const record = {
        selector: selector(control),
        label: label(control),
        bounds,
        meets44x44: bounds.width >= minTarget && bounds.height >= minTarget,
        disabled: 'disabled' in control && Boolean(control.disabled),
      };
      const exemption = control.getAttribute('data-mobile-verify-exempt');
      if (exemption) {
        excludedCompactGlyphTargets.push({ ...record, exemption });
      } else {
        requiredControls.push(record);
      }
    }
    const selectedRows = unique([...document.querySelectorAll('[role="treeitem"][aria-selected="true"], [role="option"][aria-selected="true"], [aria-current="page"], [data-selected="true"], .selected, .is-selected')]).filter(visible);
    return {
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio, touch: navigator.maxTouchPoints > 0 },
      document: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth },
      drawerTrigger: trigger ? { selector: selector(trigger), label: label(trigger), ariaControls: trigger.getAttribute('aria-controls'), visible: visible(trigger) } : null,
      sidebar: sidebarReport,
      backdrop: backdrop ? { selector: selector(backdrop), visible: visible(backdrop), bounds: rect(backdrop) } : { selector: null, visible: false, bounds: null },
      selectedRowCount: selectedRows.length,
      requiredControls,
      excludedCompactGlyphTargets,
    };
  })()`
}

function dialogDiagnosticsExpression() {
  return `(() => {
    const minTarget = ${MIN_TOUCH_TARGET};
    const compact = (value, limit = 240) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, limit);
    const rect = (node) => {
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, right: r.right, bottom: r.bottom, left: r.left };
    };
    const visible = (node) => {
      if (!node || !node.isConnected) return false;
      const style = getComputedStyle(node);
      const bounds = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && bounds.width > 0.5 && bounds.height > 0.5 && bounds.bottom > 0 && bounds.right > 0 && bounds.top < innerHeight && bounds.left < innerWidth;
    };
    const selector = (node) => {
      if (!node) return null;
      if (node.id) return '#' + CSS.escape(node.id);
      const classes = [...node.classList].slice(0, 2).map((name) => '.' + CSS.escape(name)).join('');
      return node.tagName.toLowerCase() + classes;
    };
    const referenced = (node, attribute) => {
      const ids = compact(node.getAttribute(attribute), 500).split(' ').filter(Boolean);
      const elements = ids.map((id) => document.getElementById(id));
      return {
        ids,
        allResolved: ids.length > 0 && elements.every(Boolean),
        text: compact(elements.filter(Boolean).map((element) => element.textContent).join(' ')),
      };
    };
    const accessibleName = (node) => {
      const direct = compact(node.getAttribute('aria-label'));
      if (direct) return direct;
      const labelled = referenced(node, 'aria-labelledby').text;
      if (labelled) return labelled;
      const labels = 'labels' in node && node.labels ? compact([...node.labels].map((label) => label.textContent).join(' ')) : '';
      if (labels) return labels;
      const title = compact(node.getAttribute('title'));
      if (title) return title;
      return compact(node.innerText || node.textContent, 120);
    };
    const implicitRole = (node) => ({ BUTTON: 'button', A: 'link', INPUT: node.type === 'checkbox' ? 'checkbox' : 'textbox', SELECT: 'combobox', TEXTAREA: 'textbox', SUMMARY: 'button' })[node.tagName] || null;
    const elementRecord = (node) => {
      if (!node) return null;
      const bounds = rect(node);
      return {
        selector: selector(node),
        tag: node.tagName.toLowerCase(),
        role: node.getAttribute('role') || implicitRole(node),
        name: accessibleName(node),
        bounds,
        visible: visible(node),
        disabled: 'disabled' in node && Boolean(node.disabled),
        meets44x44: bounds.width >= minTarget && bounds.height >= minTarget,
      };
    };
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter(visible);
    const records = dialogs.map((dialog) => {
      const bounds = rect(dialog);
      const labelledBy = referenced(dialog, 'aria-labelledby');
      const describedBy = referenced(dialog, 'aria-describedby');
      const ariaName = compact(dialog.getAttribute('aria-label')) || labelledBy.text;
      const interactives = [...dialog.querySelectorAll('a[href], button, input, select, textarea, summary, [role="button"], [role="menuitem"], [tabindex]:not([tabindex="-1"])')].filter(visible);
      const controls = [...new Set(interactives)].filter((node) => !node.matches('circle.hit-area')).map(elementRecord);
      const focusables = interactives.filter((node) => !('disabled' in node && node.disabled) && node.tabIndex >= 0);
      const style = getComputedStyle(dialog);
      const overlay = dialog.parentElement && visible(dialog.parentElement) ? dialog.parentElement : null;
      const overlayBounds = overlay ? rect(overlay) : null;
      const scrollRegions = [...dialog.querySelectorAll('*')].filter((node) => {
        if (!visible(node) || (node.scrollHeight <= node.clientHeight + 1 && node.scrollWidth <= node.clientWidth + 1)) return false;
        const nodeStyle = getComputedStyle(node);
        return /^(auto|scroll)$/.test(nodeStyle.overflowX) || /^(auto|scroll)$/.test(nodeStyle.overflowY);
      }).slice(0, 12).map((node) => ({
        selector: selector(node),
        clientWidth: node.clientWidth,
        clientHeight: node.clientHeight,
        scrollWidth: node.scrollWidth,
        scrollHeight: node.scrollHeight,
      }));
      return {
        selector: selector(dialog),
        role: dialog.getAttribute('role'),
        ariaModal: dialog.getAttribute('aria-modal'),
        accessibleName: ariaName,
        accessibleDescription: describedBy.text,
        labelledBy,
        describedBy,
        bounds,
        fullyInViewport: bounds.left >= -0.5 && bounds.top >= -0.5 && bounds.right <= innerWidth + 0.5 && bounds.bottom <= innerHeight + 0.5,
        computed: { display: style.display, position: style.position, overflowX: style.overflowX, overflowY: style.overflowY },
        overflow: {
          horizontal: dialog.scrollWidth > dialog.clientWidth + 1,
          vertical: dialog.scrollHeight > dialog.clientHeight + 1,
          clientWidth: dialog.clientWidth,
          clientHeight: dialog.clientHeight,
          scrollWidth: dialog.scrollWidth,
          scrollHeight: dialog.scrollHeight,
        },
        overlay: overlay ? {
          selector: selector(overlay),
          bounds: overlayBounds,
          coversViewport: overlayBounds.left <= 0.5 && overlayBounds.top <= 0.5 && overlayBounds.right >= innerWidth - 0.5 && overlayBounds.bottom >= innerHeight - 0.5,
        } : null,
        focus: {
          inside: Boolean(active && dialog.contains(active)),
          activeElement: elementRecord(active),
          focusableCount: focusables.length,
          firstFocusable: elementRecord(focusables[0]),
          lastFocusable: elementRecord(focusables[focusables.length - 1]),
        },
        controls,
        unnamedControlCount: controls.filter((control) => !control.name).length,
        undersizedControlCount: controls.filter((control) => !control.meets44x44).length,
        scrollRegions,
      };
    });
    return {
      visibleDialogCount: records.length,
      activeElement: elementRecord(active),
      dialogs: records,
    };
  })()`
}

function axValue(value) {
  return value && Object.hasOwn(value, 'value') ? value.value : null
}

async function dialogAccessibilitySnapshot(cdp, sessionId) {
  const tree = await cdp.send('Accessibility.getFullAXTree', {}, sessionId)
  const graphNodeButtons = (tree.nodes || [])
    .filter((node) => axValue(node.role) === 'button' && /^(Focus markdown note|Preview markdown note|Open folder graph)\b/.test(axValue(node.name) || ''))
  return {
    dialogs: (tree.nodes || [])
      .filter((node) => ['dialog', 'alertdialog'].includes(axValue(node.role)))
      .map((node) => ({
        role: axValue(node.role),
        name: axValue(node.name) || '',
        description: axValue(node.description) || '',
        ignored: Boolean(node.ignored),
        properties: Object.fromEntries((node.properties || [])
          .filter((property) => ['modal', 'focused', 'focusable', 'disabled', 'invalid'].includes(property.name))
          .map((property) => [property.name, axValue(property.value)])),
      })),
    graphNodeButtons: {
      count: graphNodeButtons.length,
      samples: graphNodeButtons.slice(0, 5).map((node) => ({
        role: axValue(node.role),
        name: axValue(node.name) || '',
        ignored: Boolean(node.ignored),
      })),
    },
  }
}

function openFilesExpression() {
  return `(() => {
    const visible = (node) => {
      const closedDetails = node.closest('details:not([open])');
      if (closedDetails) {
        const visibleSummary = closedDetails.querySelector(':scope > summary');
        if (!visibleSummary || !visibleSummary.contains(node)) return false;
      }
      const style = getComputedStyle(node); const r = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && r.width > 0.5 && r.height > 0.5 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
    };
    const label = (node) => (node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
    const trigger = [...document.querySelectorAll('[aria-controls]')].find((node) => visible(node) && ((node.getAttribute('aria-controls') || '').toLowerCase().includes('file') || /\\bfiles?\\b/i.test(label(node))));
    if (!trigger) return { clicked: false, reason: 'No visible Files aria-controls trigger found' };
    trigger.click();
    return { clicked: true, ariaControls: trigger.getAttribute('aria-controls'), label: label(trigger) };
  })()`
}

function openToolbarMenuExpression() {
  return `(() => {
    const visible = (node) => {
      if (!node) return false;
      const style = getComputedStyle(node); const bounds = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && bounds.width > 0.5 && bounds.height > 0.5 && bounds.bottom > 0 && bounds.right > 0 && bounds.top < innerHeight && bounds.left < innerWidth;
    };
    const sidebar = document.getElementById('file-sidebar');
    if (visible(sidebar) && getComputedStyle(sidebar).position === 'fixed') {
      const close = sidebar.querySelector('button[aria-label="Close file sidebar"]');
      if (!close) return { clicked: false, prepared: false, reason: 'Open Files drawer has no close action' };
      close.click();
      return { clicked: false, prepared: true, preparation: 'Closed Files drawer' };
    }
    const toolbar = document.getElementById('document-toolbar');
    if (!visible(toolbar)) {
      const controls = [...document.querySelectorAll('button[aria-controls="document-toolbar"]')]
        .find((node) => visible(node) && !node.disabled);
      if (!controls) return { clicked: false, prepared: false, reason: 'Document toolbar and its visible toggle were not found' };
      controls.click();
      return { clicked: false, prepared: true, preparation: 'Opened document controls' };
    }
    const menu = toolbar.querySelector('details.toolbar-menu');
    const summary = menu?.querySelector(':scope > summary');
    if (!menu || !summary || !visible(summary)) return { clicked: false, prepared: false, reason: 'Visible document File actions trigger was not found' };
    if (!menu.open) summary.click();
    return { clicked: true, prepared: false, open: menu.open, label: (summary.textContent || '').trim() };
  })()`
}

async function openToolbarMenu(cdp, sessionId) {
  const preparation = []
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const result = await evaluate(cdp, sessionId, openToolbarMenuExpression())
    if (!result.prepared) return preparation.length > 0 ? { ...result, preparation } : result
    preparation.push(result.preparation)
    await delay(200)
  }
  return { clicked: false, prepared: false, reason: 'Could not prepare the document File actions menu', preparation }
}

function openGraphExpression() {
  return `(() => {
    const visible = (node) => {
      if (!node) return false;
      const closedDetails = node.closest('details:not([open])');
      if (closedDetails) {
        const summary = closedDetails.querySelector(':scope > summary');
        if (!summary || !summary.contains(node)) return false;
      }
      const style = getComputedStyle(node); const bounds = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && bounds.width > 0.5 && bounds.height > 0.5 && bounds.bottom > 0 && bounds.right > 0 && bounds.top < innerHeight && bounds.left < innerWidth;
    };
    const label = (node) => (node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
    const actionable = (node) => {
      if (!visible(node) || node.disabled) return false;
      const bounds = node.getBoundingClientRect();
      const x = Math.min(innerWidth - 1, Math.max(0, bounds.left + bounds.width / 2));
      const y = Math.min(innerHeight - 1, Math.max(0, bounds.top + bounds.height / 2));
      const hit = document.elementFromPoint(x, y);
      return Boolean(hit && (hit === node || node.contains(hit)));
    };
    const sidebar = document.getElementById('file-sidebar');
    if (visible(sidebar) && getComputedStyle(sidebar).position === 'fixed') {
      const close = sidebar.querySelector('button[aria-label="Close file sidebar"]');
      if (!close || !actionable(close)) return { clicked: false, prepared: false, reason: 'Open Files drawer has no actionable close control' };
      close.click();
      return { clicked: false, prepared: true, preparation: 'Closed Files drawer' };
    }
    const toolbar = document.getElementById('document-toolbar');
    if (!visible(toolbar)) {
      const toggle = [...document.querySelectorAll('button[aria-controls="document-toolbar"]')].find(actionable);
      if (!toggle) return { clicked: false, prepared: false, reason: 'Document toolbar and its visible toggle were not found' };
      toggle.click();
      return { clicked: false, prepared: true, preparation: 'Opened document controls' };
    }
    const menu = toolbar.querySelector('details.toolbar-menu');
    const summary = menu?.querySelector(':scope > summary');
    if (!menu || !summary || !actionable(summary)) return { clicked: false, prepared: false, reason: 'Visible document More menu trigger was not found' };
    if (!menu.open) {
      summary.click();
      return { clicked: false, prepared: true, preparation: 'Opened document More menu' };
    }
    const graph = [...menu.querySelectorAll('[role="menuitem"], button')].find((node) => {
      const visibleText = (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
      return actionable(node) && /^Graph$/i.test(visibleText);
    });
    if (!graph) {
      const candidates = [...menu.querySelectorAll('[role="menuitem"], button')].map((node) => {
        const bounds = node.getBoundingClientRect();
        const x = Math.min(innerWidth - 1, Math.max(0, bounds.left + bounds.width / 2));
        const y = Math.min(innerHeight - 1, Math.max(0, bounds.top + bounds.height / 2));
        const hit = document.elementFromPoint(x, y);
        return {
          label: label(node),
          visible: visible(node),
          disabled: Boolean(node.disabled),
          hit: hit ? label(hit) : null,
          hitSelector: hit ? hit.tagName.toLowerCase() + (hit.classList.length ? '.' + [...hit.classList].join('.') : '') : null,
          containsHit: Boolean(hit && (hit === node || node.contains(hit))),
        };
      });
      return { clicked: false, prepared: false, reason: 'Visible Graph action was not found in the document More menu', candidates };
    }
    const clickedAtMs = Date.now();
    graph.click();
    return { clicked: true, clickedAtMs, label: label(graph), selector: graph.id ? '#' + CSS.escape(graph.id) : graph.tagName.toLowerCase() + '.' + [...graph.classList].map((name) => CSS.escape(name)).join('.') };
  })()`
}

async function openGraph(cdp, sessionId) {
  const preparation = []
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await evaluate(cdp, sessionId, openGraphExpression())
    if (!result.prepared) return preparation.length > 0 ? { ...result, preparation } : result
    preparation.push(result.preparation)
    await delay(200)
  }
  return { clicked: false, prepared: false, reason: 'Could not prepare the document More menu Graph action', preparation }
}

function graphReadinessExpression() {
  return `(() => {
    const dialog = document.querySelector('.graph-overlay[role="dialog"]');
    const canvas = dialog?.querySelector('.graph-canvas') || null;
    const svg = canvas?.querySelector('svg') || null;
    const state = dialog?.querySelector('.graph-state') || null;
    const error = dialog?.querySelector('.graph-banner') || null;
    return {
      dialogPresent: Boolean(dialog),
      canvasPresent: Boolean(canvas),
      svgPresent: Boolean(svg),
      loading: Boolean(state && /loading graph/i.test(state.textContent || '')),
      state: state ? (state.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 240) : null,
      error: error ? (error.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 240) : null,
    };
  })()`
}

async function waitForGraph(cdp, sessionId, startedAt = Date.now(), timeoutMs = 30_000) {
  const deadline = startedAt + timeoutMs
  let latest = await evaluate(cdp, sessionId, graphReadinessExpression())
  while (Date.now() < deadline) {
    if (latest.dialogPresent && latest.canvasPresent && (latest.svgPresent || Boolean(latest.error) || (!latest.loading && Boolean(latest.state)))) {
      return { ...latest, settled: true, timedOut: false, durationMs: Date.now() - startedAt }
    }
    await delay(100)
    latest = await evaluate(cdp, sessionId, graphReadinessExpression())
  }
  return { ...latest, settled: false, timedOut: true, durationMs: Date.now() - startedAt }
}

function graphDiagnosticsExpression() {
  return `(() => {
    const minTarget = ${MIN_TOUCH_TARGET};
    const compact = (value, limit = 240) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, limit);
    const rect = (node) => {
      if (!node) return null;
      const bounds = node.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, top: bounds.top, right: bounds.right, bottom: bounds.bottom, left: bounds.left };
    };
    const inViewport = (bounds) => Boolean(bounds && bounds.left >= -0.5 && bounds.top >= -0.5 && bounds.right <= innerWidth + 0.5 && bounds.bottom <= innerHeight + 0.5);
    const visible = (node) => {
      if (!node || !node.isConnected) return false;
      const style = getComputedStyle(node); const bounds = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && bounds.width > 0.5 && bounds.height > 0.5 && bounds.bottom > 0 && bounds.right > 0 && bounds.top < innerHeight && bounds.left < innerWidth;
    };
    const selector = (node) => {
      if (!node) return null;
      if (node.id) return '#' + CSS.escape(node.id);
      const classes = [...node.classList].slice(0, 2).map((name) => '.' + CSS.escape(name)).join('');
      return node.tagName.toLowerCase() + classes;
    };
    const referenced = (node, attribute) => {
      const ids = compact(node?.getAttribute(attribute), 500).split(' ').filter(Boolean);
      const elements = ids.map((id) => document.getElementById(id));
      return { ids, allResolved: ids.length > 0 && elements.every(Boolean), text: compact(elements.filter(Boolean).map((element) => element.textContent).join(' ')) };
    };
    const accessibleName = (node) => compact(node?.getAttribute('aria-label')) || referenced(node, 'aria-labelledby').text || compact(node?.getAttribute('title')) || compact(node?.innerText || node?.textContent, 120);
    const implicitRole = (node) => ({ BUTTON: 'button', A: 'link', INPUT: node.type === 'checkbox' ? 'checkbox' : 'textbox', SELECT: 'combobox', TEXTAREA: 'textbox', SUMMARY: 'button' })[node.tagName] || null;
    const elementRecord = (node) => {
      if (!node) return null;
      const bounds = rect(node);
      return { selector: selector(node), tag: node.tagName.toLowerCase(), role: node.getAttribute('role') || implicitRole(node), name: accessibleName(node), bounds, visible: visible(node), disabled: 'disabled' in node && Boolean(node.disabled), meets44x44: bounds.width >= minTarget && bounds.height >= minTarget };
    };
    const dialog = document.querySelector('.graph-overlay[role="dialog"]');
    if (!dialog) return { present: false, dialog: null, canvas: null, svg: null, controls: [], nodeTargets: { count: 0, undersizedCount: 0, unnamedCount: 0, samples: [] }, state: { status: 'not-open', text: null, error: null } };
    const dialogBounds = rect(dialog);
    const labelledBy = referenced(dialog, 'aria-labelledby');
    const describedBy = referenced(dialog, 'aria-describedby');
    const canvas = dialog.querySelector('.graph-canvas');
    const canvasBounds = rect(canvas);
    const canvasStyle = canvas ? getComputedStyle(canvas) : null;
    const svg = canvas?.querySelector('svg') || null;
    const svgBounds = rect(svg);
    const svgStyle = svg ? getComputedStyle(svg) : null;
    const stateNode = dialog.querySelector('.graph-state');
    const errorNode = dialog.querySelector('.graph-banner');
    const interactives = [...dialog.querySelectorAll('a[href], button, input, select, textarea, summary, [role="button"], [role="menuitem"], [tabindex]:not([tabindex="-1"])')];
    const visibleInteractives = [...new Set(interactives)].filter(visible);
    const nodeTargetRecords = visibleInteractives.filter((node) => node.matches('circle.hit-area')).map(elementRecord);
    const controls = visibleInteractives.filter((node) => !node.matches('circle.hit-area')).map(elementRecord);
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialogStyle = getComputedStyle(dialog);
    const dialogOverflow = { horizontal: dialog.scrollWidth > dialog.clientWidth + 1, vertical: dialog.scrollHeight > dialog.clientHeight + 1, clientWidth: dialog.clientWidth, clientHeight: dialog.clientHeight, scrollWidth: dialog.scrollWidth, scrollHeight: dialog.scrollHeight };
    const canvasOverflow = canvas ? { horizontal: canvas.scrollWidth > canvas.clientWidth + 1, vertical: canvas.scrollHeight > canvas.clientHeight + 1, clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight, scrollWidth: canvas.scrollWidth, scrollHeight: canvas.scrollHeight } : null;
    const error = compact(errorNode?.textContent);
    const state = compact(stateNode?.textContent);
    return {
      present: true,
      dialog: {
        selector: selector(dialog), role: dialog.getAttribute('role'), ariaModal: dialog.getAttribute('aria-modal'), accessibleName: accessibleName(dialog), accessibleDescription: describedBy.text, labelledBy, describedBy, bounds: dialogBounds, fullyInViewport: inViewport(dialogBounds), computed: { display: dialogStyle.display, position: dialogStyle.position, overflowX: dialogStyle.overflowX, overflowY: dialogStyle.overflowY }, overflow: dialogOverflow,
        focus: { inside: Boolean(active && dialog.contains(active)), activeElement: elementRecord(active) },
      },
      canvas: canvas ? { selector: selector(canvas), visible: visible(canvas), bounds: canvasBounds, fullyInViewport: inViewport(canvasBounds), computed: { display: canvasStyle.display, position: canvasStyle.position, overflowX: canvasStyle.overflowX, overflowY: canvasStyle.overflowY }, overflow: canvasOverflow } : null,
      svg: svg ? { selector: selector(svg), visible: visible(svg), bounds: svgBounds, fullyInViewport: inViewport(svgBounds), viewBox: svg.getAttribute('viewBox'), width: svg.getAttribute('width'), height: svg.getAttribute('height'), computed: { display: svgStyle.display, width: svgStyle.width, height: svgStyle.height }, nodeCount: svg.querySelectorAll('circle.node-dot').length, edgeCount: svg.querySelectorAll('line').length, hitAreaCount: svg.querySelectorAll('circle.hit-area').length } : null,
      controls,
      undersizedControlCount: controls.filter((control) => !control.meets44x44).length,
      nodeTargets: {
        count: nodeTargetRecords.length,
        undersizedCount: nodeTargetRecords.filter((control) => !control.meets44x44).length,
        unnamedCount: nodeTargetRecords.filter((control) => !control.name).length,
        samples: nodeTargetRecords.slice(0, 5),
      },
      state: { status: svg ? 'rendered' : error ? 'error' : /loading graph/i.test(state) ? 'loading' : state ? 'empty-or-idle' : 'unknown', text: state || null, error: error || null, stats: compact(dialog.querySelector('.graph-stats')?.textContent) || null },
    };
  })()`
}

function toolbarMenuDiagnosticsExpression() {
  return `(() => {
    const rect = (node) => {
      if (!node) return null;
      const bounds = node.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, top: bounds.top, right: bounds.right, bottom: bounds.bottom, left: bounds.left };
    };
    const visible = (node) => {
      if (!node) return false;
      const style = getComputedStyle(node); const bounds = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && bounds.width > 0.5 && bounds.height > 0.5 && bounds.bottom > 0 && bounds.right > 0 && bounds.top < innerHeight && bounds.left < innerWidth;
    };
    const inViewport = (bounds) => Boolean(bounds && bounds.left >= -0.5 && bounds.top >= -0.5 && bounds.right <= innerWidth + 0.5 && bounds.bottom <= innerHeight + 0.5);
    const menu = document.querySelector('#document-toolbar details.toolbar-menu');
    const trigger = menu?.querySelector(':scope > summary') || null;
    const panel = menu?.querySelector(':scope > .toolbar-menu-panel') || null;
    const panelBounds = rect(panel);
    const panelStyle = panel ? getComputedStyle(panel) : null;
    const items = panel ? [...panel.querySelectorAll('[role="menuitem"]')].map((item) => {
      const bounds = rect(item);
      return {
        label: (item.textContent || '').replace(/\\s+/g, ' ').trim(),
        disabled: Boolean(item.disabled),
        visible: visible(item),
        fullyInViewport: inViewport(bounds),
        meets44x44: bounds.width >= ${MIN_TOUCH_TARGET} && bounds.height >= ${MIN_TOUCH_TARGET},
        bounds,
      };
    }) : [];
    return {
      open: Boolean(menu?.open),
      trigger: { visible: visible(trigger), bounds: rect(trigger) },
      panel: panel ? {
        visible: visible(panel),
        fullyInViewport: inViewport(panelBounds),
        bounds: panelBounds,
        computed: { left: panelStyle.left, right: panelStyle.right, width: panelStyle.width, position: panelStyle.position, zIndex: panelStyle.zIndex },
      } : null,
      items,
    };
  })()`
}

function clickWritingExpression() {
  return `(() => {
    const visible = (node) => { const style = getComputedStyle(node); const rect = node.getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0; };
    const candidates = [...document.querySelectorAll('button.mobile-write-toggle, button.write-toggle')].filter((node) => visible(node) && !node.disabled);
    const button = candidates.find((node) => /^(Edit|Start writing)$/i.test((node.textContent || '').trim()));
    if (!button) return { clicked: false, reason: 'No visible writing-mode action found' };
    button.click();
    return { clicked: true, label: (button.textContent || '').trim() };
  })()`
}

function focusEditorExpression() {
  return `(() => {
    const editor = document.querySelector('.rich-markdown-editor__input');
    if (!editor || editor.readOnly) return { focused: false, reason: 'Writable Markdown editor not found' };
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
    return { focused: true, length: editor.value.length };
  })()`
}

function editorStateExpression(beforeLength = null) {
  return `(() => {
    const editor = document.querySelector('.rich-markdown-editor__input');
    const visible = (node) => {
      if (!node) return false;
      const style = getComputedStyle(node); const bounds = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && bounds.width > 0.5 && bounds.height > 0.5 && bounds.bottom > 0 && bounds.right > 0 && bounds.top < innerHeight && bounds.left < innerWidth;
    };
    const changes = [...document.querySelectorAll('button')].find((node) => visible(node) && /^Changes$/i.test((node.textContent || '').trim()));
    const currentLength = editor ? editor.value.length : null;
    return {
      present: Boolean(editor),
      readOnly: editor ? Boolean(editor.readOnly) : null,
      currentLength,
      beforeLength: ${beforeLength === null ? 'null' : Number(beforeLength)},
      lengthDelta: currentLength === null || ${beforeLength === null ? 'null' : Number(beforeLength)} === null ? null : currentLength - ${beforeLength === null ? 'null' : Number(beforeLength)},
      dirtyIndicatorVisible: Boolean([...document.querySelectorAll('.rich-markdown-editor__dirty, .state-dirty')].find(visible)),
      changesActionVisible: Boolean(changes),
    };
  })()`
}

function openChangesExpression() {
  return `(() => {
    const visible = (node) => { const style = getComputedStyle(node); const rect = node.getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0.5 && rect.height > 0.5 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth; };
    const button = [...document.querySelectorAll('button')].filter((node) => visible(node) && !node.disabled).find((node) => /^Changes$/i.test((node.textContent || '').trim()));
    if (!button) return { clicked: false, reason: 'No visible Changes action found' };
    button.click();
    return { clicked: true, label: (button.textContent || '').trim(), selector: button.id ? '#' + CSS.escape(button.id) : 'button.' + [...button.classList].map((name) => CSS.escape(name)).join('.') };
  })()`
}

function openCreateExpression() {
  return `(() => {
    const visible = (node) => {
      const style = getComputedStyle(node); const bounds = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && bounds.width > 0.5 && bounds.height > 0.5 && bounds.bottom > 0 && bounds.right > 0 && bounds.top < innerHeight && bounds.left < innerWidth;
    };
    const label = (node) => (node.getAttribute('aria-label') || node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
    const actionable = (node) => {
      if (!visible(node) || node.disabled) return false;
      const bounds = node.getBoundingClientRect();
      const x = Math.min(innerWidth - 1, Math.max(0, bounds.left + bounds.width / 2));
      const y = Math.min(innerHeight - 1, Math.max(0, bounds.top + bounds.height / 2));
      const hit = document.elementFromPoint(x, y);
      return Boolean(hit && (hit === node || node.contains(hit)));
    };
    const candidates = [...document.querySelectorAll('button')].filter((node) => visible(node) && /\\bNew Note\\b/i.test(label(node)));
    const button = candidates.find(actionable);
    if (button) {
      button.click();
      return { clicked: true, prepared: false, label: label(button), selector: button.id ? '#' + CSS.escape(button.id) : 'button.' + [...button.classList].map((name) => CSS.escape(name)).join('.') };
    }
    const controls = [...document.querySelectorAll('button[aria-controls="document-toolbar"]')].find(actionable);
    if (controls && controls.getAttribute('aria-expanded') !== 'true') {
      controls.click();
      return { clicked: false, prepared: true, preparation: 'Opened document controls', preparationLabel: label(controls) };
    }
    return {
      clicked: false,
      prepared: false,
      reason: candidates.length ? 'New Note actions are disabled or covered by another surface' : 'No visible New Note action found',
      candidateCount: candidates.length,
    };
  })()`
}

async function openCreateDialog(cdp, sessionId) {
  const first = await evaluate(cdp, sessionId, openCreateExpression())
  if (!first.prepared) return first
  await delay(200)
  const second = await evaluate(cdp, sessionId, openCreateExpression())
  return { ...second, preparation: first }
}

function hardFailures(report, options) {
  const failures = []
  const { viewport, document: pageDocument, sidebar, requiredControls } = report.diagnostics
  const requestedViewport = options.desktop ? DESKTOP : IPHONE_14
  if (viewport.width !== requestedViewport.width || viewport.height !== requestedViewport.height || (!options.desktop && !viewport.touch)) {
    failures.push(`viewport must be ${requestedViewport.width}x${requestedViewport.height}${options.desktop ? '' : ' with touch enabled'}; observed ${viewport.width}x${viewport.height}, touch=${viewport.touch}`)
  }
  if (pageDocument.horizontalOverflow) failures.push(`horizontal overflow: scrollWidth ${pageDocument.scrollWidth} exceeds clientWidth ${pageDocument.clientWidth}`)
  if (options.openFiles && (!report.drawerOpen?.clicked || !sidebar.visible || !sidebar.inViewportBounds)) {
    failures.push('Files drawer was requested but its sidebar is not visibly open and fully within viewport bounds')
  }
  if (options.openToolbarMenu) {
    const menu = report.toolbarMenuDiagnostics
    if (!report.toolbarMenuOpen?.clicked || !report.toolbarMenuOpen?.open || !menu?.open) {
      failures.push(`Document File actions menu was requested but did not open${report.toolbarMenuOpen?.reason ? `: ${report.toolbarMenuOpen.reason}` : ''}`)
    } else {
      if (!menu.panel?.visible) failures.push('Document File actions panel is not visible')
      if (!menu.panel?.fullyInViewport) failures.push('Document File actions panel extends outside the requested viewport')
      if (menu.items.length !== 4) failures.push(`Document File actions panel must expose four menu items; observed ${menu.items.length}`)
      for (const item of menu.items) {
        if (!item.visible || !item.fullyInViewport) failures.push(`Document File actions item is clipped or hidden: ${JSON.stringify(item.label)}`)
        if (!options.desktop && !item.meets44x44) failures.push(`Document File actions touch target below ${MIN_TOUCH_TARGET}x${MIN_TOUCH_TARGET}: ${JSON.stringify(item.label)} (${Math.round(item.bounds.width)}x${Math.round(item.bounds.height)})`)
      }
    }
  }
  if (options.openGraph) {
    const graph = report.graphDiagnostics
    if (!report.graphOpen?.clicked || !graph?.present) {
      failures.push(`Graph was requested but did not open through the document More menu${report.graphOpen?.reason ? `: ${report.graphOpen.reason}` : ''}`)
    } else {
      if (!report.graphWait?.settled || report.graphWait?.timedOut) failures.push('Graph did not reach a rendered or terminal state before the verification timeout')
      const dialog = graph.dialog
      if (!dialog?.fullyInViewport) failures.push('Graph dialog geometry extends outside the requested viewport')
      if (!graph.canvas?.visible || !graph.canvas?.fullyInViewport) failures.push('Graph canvas is missing, hidden, or extends outside the requested viewport')
      if (graph.svg && (!graph.svg.visible || !graph.svg.fullyInViewport)) failures.push('Graph SVG geometry extends outside the requested viewport')
      if (!dialog.accessibleName || !dialog.labelledBy.allResolved) failures.push('Graph dialog must expose a resolved accessible name')
      if (!dialog.accessibleDescription || !dialog.describedBy.allResolved) failures.push('Graph dialog must expose a resolved non-empty accessible description')
      if (!dialog.focus.inside) failures.push('Keyboard focus must move inside the opened graph dialog')
      if (!['dialog', 'alertdialog'].includes(dialog.role)) failures.push(`Graph dialog has unexpected role ${JSON.stringify(dialog.role)}`)
      if (dialog.ariaModal !== 'true') failures.push('Graph dialog must expose aria-modal="true"')
      if (!options.desktop) {
        for (const control of graph.controls.filter((control) => !control.meets44x44)) {
          failures.push(`graph control touch target below ${MIN_TOUCH_TARGET}x${MIN_TOUCH_TARGET}: ${control.selector} (${Math.round(control.bounds.width)}x${Math.round(control.bounds.height)})${control.name ? ` ${JSON.stringify(control.name)}` : ''}`)
        }
        if (graph.nodeTargets?.undersizedCount > 0) failures.push(`${graph.nodeTargets.undersizedCount} graph node touch target(s) are below ${MIN_TOUCH_TARGET}x${MIN_TOUCH_TARGET}`)
      }
      if (graph.nodeTargets?.unnamedCount > 0) failures.push(`${graph.nodeTargets.unnamedCount} graph node target(s) lack an accessible name`)
      if (graph.nodeTargets?.count > 0 && !report.accessibility.graphNodeButtons?.count) failures.push('Chrome accessibility tree did not expose any interactive graph node buttons')
      const axDialog = report.accessibility.dialogs.find((candidate) => candidate.name === dialog.accessibleName)
      if (!axDialog || axDialog.ignored) failures.push('Chrome accessibility tree did not expose the opened graph dialog and accessible name')
    }
  }
  if (options.enableWriting && (!report.writingMode?.clicked || !report.writingMode?.enabled)) {
    failures.push(`Writing mode was requested but was not enabled${report.writingMode?.reason ? `: ${report.writingMode.reason}` : ''}`)
  }
  if (options.appendText !== null) {
    if (!report.editorFocus?.focused) failures.push(`Draft text was requested but the editor was not writable${report.editorFocus?.reason ? `: ${report.editorFocus.reason}` : ''}`)
    else if (report.draftEdit?.lengthDelta !== options.appendText.length) failures.push(`Draft-local edit length mismatch: expected ${options.appendText.length}, observed ${report.draftEdit?.lengthDelta ?? 'unknown'}`)
  }
  if (options.openChanges && !report.changesOpen?.clicked) {
    failures.push(`Changes dialog was requested but its action was not opened${report.changesOpen?.reason ? `: ${report.changesOpen.reason}` : ''}; use --enable-writing with --append-text to create a local dirty draft`)
  }
  if (options.openCreate && !report.createOpen?.clicked) {
    failures.push(`New Note dialog was requested but its action was not opened${report.createOpen?.reason ? `: ${report.createOpen.reason}` : ''}`)
  }
  if (report.interactionRequests.mutating.length > 0) {
    failures.push(`capture interactions issued ${report.interactionRequests.mutating.length} non-read network request(s)`)
  }

  const dialogRequested = options.openCreate || options.openChanges
  if (dialogRequested) {
    const expectedName = options.openCreate ? /^Create a note$/i : /^(Review your changes|Resolve save conflict)$/i
    const dialog = report.dialogDiagnostics.dialogs.find((candidate) => expectedName.test(candidate.accessibleName))
    if (!dialog) {
      failures.push(`Expected ${options.openCreate ? 'Create a note' : 'Review your changes'} dialog was not visible with its accessible name`)
    } else {
      if (!['dialog', 'alertdialog'].includes(dialog.role)) failures.push(`Dialog has unexpected role ${JSON.stringify(dialog.role)}`)
      if (dialog.ariaModal !== 'true') failures.push('Dialog must expose aria-modal="true"')
      if (!dialog.labelledBy.allResolved) failures.push('Dialog aria-labelledby references must all resolve')
      if (!dialog.describedBy.allResolved) failures.push('Dialog aria-describedby references must all resolve')
      if (!dialog.accessibleDescription) failures.push('Dialog must expose a non-empty accessible description')
      if (!dialog.focus.inside) failures.push('Keyboard focus must move inside the opened dialog')
      if (!dialog.fullyInViewport) failures.push('Dialog geometry extends outside the requested viewport')
      if (!dialog.overlay?.coversViewport) failures.push('Dialog overlay does not cover the requested viewport')
      if (dialog.overflow.horizontal) failures.push('Dialog has horizontal overflow')
      if (dialog.unnamedControlCount > 0) failures.push(`Dialog contains ${dialog.unnamedControlCount} visible control(s) without an accessible name`)
      if (options.openCreate && dialog.focus.activeElement?.selector !== '#create-note-title') failures.push('Create Note dialog must initially focus the Title field')
      if (options.openChanges && dialog.focus.activeElement?.name !== 'Back to editor') failures.push('Changes dialog must initially focus Back to editor')
      if (!options.desktop) {
        for (const control of dialog.controls.filter((control) => !control.meets44x44)) {
          failures.push(`dialog touch target below ${MIN_TOUCH_TARGET}x${MIN_TOUCH_TARGET}: ${control.selector} (${Math.round(control.bounds.width)}x${Math.round(control.bounds.height)})${control.name ? ` ${JSON.stringify(control.name)}` : ''}`)
        }
      }
    }
    const axDialog = report.accessibility.dialogs.find((candidate) => expectedName.test(candidate.name))
    if (!axDialog || axDialog.ignored) failures.push('Chrome accessibility tree did not expose the expected dialog and accessible name')
  }
  if (!options.desktop) {
    for (const control of requiredControls.filter((control) => !control.meets44x44)) {
      failures.push(`touch target below ${MIN_TOUCH_TARGET}x${MIN_TOUCH_TARGET}: ${control.selector} (${Math.round(control.bounds.width)}x${Math.round(control.bounds.height)})${control.label ? ` ${JSON.stringify(control.label)}` : ''}`)
    }
  }
  return failures
}

function startNetworkTracker(cdp, sessionId) {
  let lastActivity = Date.now()
  const ignored = new Set()
  const inflight = new Set()
  const stop = cdp.onEvent((message) => {
    if (message.sessionId !== sessionId || !message.method?.startsWith('Network.')) return
    if (message.method === 'Network.requestWillBeSent') {
      const type = message.params.type
      if (type === 'WebSocket' || type === 'EventSource') ignored.add(message.params.requestId)
      else inflight.add(message.params.requestId)
    }
    if (message.method === 'Network.loadingFinished' || message.method === 'Network.loadingFailed') inflight.delete(message.params.requestId)
    if (!ignored.has(message.params.requestId)) lastActivity = Date.now()
  })
  return {
    async waitForQuiet(quietMs = 500, timeoutMs = 10_000) {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        if (inflight.size === 0 && Date.now() - lastActivity >= quietMs) return true
        await delay(50)
      }
      return false
    },
    stop,
  }
}

function startInteractionRequestAudit(cdp, sessionId) {
  const requests = []
  const stop = cdp.onEvent((message) => {
    if (message.sessionId !== sessionId || message.method !== 'Network.requestWillBeSent') return
    const request = message.params.request
    let target = String(request.url || '').split('?')[0]
    try {
      const parsed = new URL(request.url)
      target = `${parsed.origin}${parsed.pathname}`
    } catch {
      // Keep a query-free target for non-standard URLs such as data: documents.
    }
    requests.push({ method: String(request.method || 'GET').toUpperCase(), target, type: message.params.type || null })
  })
  return {
    snapshot() {
      const readMethods = new Set(['GET', 'HEAD', 'OPTIONS'])
      return {
        total: requests.length,
        readOnly: requests.filter((request) => readMethods.has(request.method)).slice(0, 50),
        mutating: requests.filter((request) => !readMethods.has(request.method)),
      }
    },
    stop,
  }
}

async function stopChrome(chrome) {
  if (!chrome || chrome.exitCode !== null) return
  chrome.kill('SIGTERM')
  const exited = await Promise.race([
    new Promise((resolveExit) => chrome.once('exit', () => resolveExit(true))),
    delay(5_000).then(() => false),
  ])
  if (!exited && chrome.exitCode === null) chrome.kill('SIGKILL')
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(usage())
    return
  }
  const profileDir = await mkdtemp(join(tmpdir(), 'md-ops-mobile-verify-'))
  let chrome
  let cdp
  let report
  let interactionAudit
  try {
    const requestedViewport = options.desktop ? DESKTOP : IPHONE_14
    const launched = await launchChrome(options, profileDir, requestedViewport)
    chrome = launched.chrome
    cdp = new CdpConnection(launched.webSocketUrl)
    await cdp.connect()
    const target = await cdp.send('Target.createTarget', { url: 'about:blank' })
    const attached = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })
    const sessionId = attached.sessionId
    const setupCommands = [
      cdp.send('Page.enable', {}, sessionId),
      cdp.send('Runtime.enable', {}, sessionId),
      cdp.send('Network.enable', {}, sessionId),
      cdp.send('Accessibility.enable', {}, sessionId),
      cdp.send('Emulation.setDeviceMetricsOverride', { ...requestedViewport, mobile: !options.desktop, screenWidth: requestedViewport.width, screenHeight: requestedViewport.height, positionX: 0, positionY: 0, dontSetVisibleSize: false }, sessionId),
      cdp.send('Emulation.setTouchEmulationEnabled', { enabled: !options.desktop, maxTouchPoints: options.desktop ? 1 : 5 }, sessionId),
    ]
    if (!options.desktop) setupCommands.push(cdp.send('Network.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1' }, sessionId))
    await Promise.all(setupCommands)
    const loaded = new Promise((resolveLoad) => {
      const stop = cdp.onEvent((message) => {
        if (message.sessionId === sessionId && message.method === 'Page.loadEventFired') {
          stop()
          resolveLoad()
        }
      })
    })
    const networkTracker = startNetworkTracker(cdp, sessionId)
    await cdp.send('Page.navigate', { url: options.url }, sessionId)
    await Promise.race([loaded, delay(15_000).then(() => { throw new Error(`Timed out loading ${options.url}`) })])
    const networkQuiet = await networkTracker.waitForQuiet()
    networkTracker.stop()
    await evaluate(cdp, sessionId, 'document.fonts ? document.fonts.ready.then(() => true) : true')
    await delay(options.settleMs)
    interactionAudit = startInteractionRequestAudit(cdp, sessionId)
    let writingMode = options.enableWriting ? await evaluate(cdp, sessionId, clickWritingExpression()) : null
    if (options.enableWriting) {
      await delay(250)
      const state = await evaluate(cdp, sessionId, editorStateExpression())
      writingMode = { ...writingMode, enabled: Boolean(state.present && !state.readOnly), editorState: state }
    }
    const editorFocus = options.appendText !== null ? await evaluate(cdp, sessionId, focusEditorExpression()) : null
    if (options.appendText !== null && editorFocus?.focused) {
      await cdp.send('Input.insertText', { text: options.appendText }, sessionId)
      await delay(250)
      await evaluate(cdp, sessionId, `(() => { const editor = document.querySelector('.rich-markdown-editor__input'); if (editor) editor.scrollTop = 0; window.scrollTo(0, 0); return true; })()`)
    }
    const draftEdit = options.appendText !== null ? await evaluate(cdp, sessionId, editorStateExpression(editorFocus?.length ?? null)) : null
    const changesOpen = options.openChanges ? await evaluate(cdp, sessionId, openChangesExpression()) : null
    if (options.openChanges) await delay(300)
    const drawerOpen = options.openFiles ? await evaluate(cdp, sessionId, openFilesExpression()) : null
    if (options.openFiles) await delay(350)
    const toolbarMenuOpen = options.openToolbarMenu ? await openToolbarMenu(cdp, sessionId) : null
    if (options.openToolbarMenu) await delay(300)
    const graphOpen = options.openGraph ? await openGraph(cdp, sessionId) : null
    const graphWait = graphOpen?.clicked && Number.isFinite(graphOpen.clickedAtMs)
      ? await waitForGraph(cdp, sessionId, graphOpen.clickedAtMs)
      : null
    const createOpen = options.openCreate ? await openCreateDialog(cdp, sessionId) : null
    if (options.openCreate) await delay(350)
    const [diagnostics, toolbarMenuDiagnostics, graphDiagnostics, dialogDiagnostics, accessibility] = await Promise.all([
      evaluate(cdp, sessionId, pageDiagnosticsExpression()),
      evaluate(cdp, sessionId, toolbarMenuDiagnosticsExpression()),
      evaluate(cdp, sessionId, graphDiagnosticsExpression()),
      evaluate(cdp, sessionId, dialogDiagnosticsExpression()),
      dialogAccessibilitySnapshot(cdp, sessionId),
    ])
    const interactionRequests = interactionAudit.snapshot()
    interactionAudit.stop()
    interactionAudit = null
    await mkdir(dirname(options.output), { recursive: true })
    await mkdir(dirname(options.report), { recursive: true })
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true }, sessionId)
    await writeFile(options.output, Buffer.from(screenshot.data, 'base64'))
    report = {
      schemaVersion: 2,
      timestamp: new Date().toISOString(),
      url: options.url,
      requested: { viewport: requestedViewport, desktop: options.desktop, note: options.note, openFiles: options.openFiles, openToolbarMenu: options.openToolbarMenu, openGraph: options.openGraph, enableWriting: options.enableWriting, appendText: options.appendText, openChanges: options.openChanges, openCreate: options.openCreate, settleMs: options.settleMs },
      artifacts: { screenshot: options.output, report: options.report },
      wait: { fonts: true, networkQuiet },
      drawerOpen,
      toolbarMenuOpen,
      graphOpen,
      graphWait,
      writingMode,
      editorFocus,
      draftEdit,
      changesOpen,
      createOpen,
      interactionRequests,
      diagnostics,
      toolbarMenuDiagnostics,
      graphDiagnostics,
      dialogDiagnostics,
      accessibility,
      failures: [],
      pass: false,
    }
    report.failures = hardFailures(report, options)
    report.pass = report.failures.length === 0
    await writeFile(options.report, `${JSON.stringify(report, null, 2)}\n`)
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    if (!report.pass) process.exitCode = 1
  } catch (error) {
    const failure = {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      url: options?.url || DEFAULT_URL,
      pass: false,
      failures: [error instanceof Error ? error.message : String(error)],
    }
    if (options?.report) {
      await mkdir(dirname(options.report), { recursive: true })
      await writeFile(options.report, `${JSON.stringify(failure, null, 2)}\n`)
    }
    process.stderr.write(`${JSON.stringify(failure, null, 2)}\n`)
    process.exitCode = 1
  } finally {
    interactionAudit?.stop()
    cdp?.close()
    await stopChrome(chrome)
    await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

await main()
