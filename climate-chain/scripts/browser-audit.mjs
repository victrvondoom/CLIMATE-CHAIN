// Browser audit: opens every dashboard destination at three viewport widths in a real
// Chromium and records what a user would hit: console errors, uncaught page errors, HTTP
// responses of 400 or more, failed requests, horizontal overflow, error boundaries, the
// topbar title and the visible alerts. It writes one JSON report and one screenshot per
// page. It reads the app; it never clicks a write action.
//
// Usage (the app must be running, for example with start.ps1):
//   $env:PLAYWRIGHT_CORE = '<path to playwright-core>'   # or have playwright-core resolvable
//   $env:CHROME_PATH = '<path to chrome.exe>'            # optional, defaults to Playwright's own
//   node scripts/browser-audit.mjs --out <dir> [--base http://127.0.0.1:8080] [--only overview,earth]

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const BASE = option('base', 'http://127.0.0.1:8080');
const OUT = resolve(option('out', 'output/browser-audit'));
const ONLY = option('only', '');
const WIDTHS = option('widths', '390,768,1440').split(',').map(Number);
const SETTLE_MS = Number(option('settle', '4000'));

// The 32 destinations, in library order. Titles are the topbar titles from dashboard/library.ts.
const CORE = [
  ['overview', 'Climate Chain'], ['earth', 'Earth intelligence'], ['waste', 'Waste · JunkSnap'],
  ['fire', 'Fire · clearsky'], ['water', 'Water · Teesri Shikayat'], ['air', 'Air · The Vayu Project'],
  ['mission', 'From signal to proof'], ['studio', 'Unified mission studio'], ['cascade', 'Climate Cascade Review'],
  ['integrity', 'Climate Integrity Lab'], ['session', 'Climate Chain'], ['ledger', 'Evidence ledger'],
  ['memory', 'Engineering memory'],
];
const MODULES = [
  ['junksnap', 'JunkSnap'], ['clearsky', 'clearsky'], ['teesri', 'Teesri Shikayat'], ['vayu', 'The Vayu Project'],
  ['aquaquest', 'AquaQuest'], ['climateproof', 'ClimateProof AI'], ['carbonlens', 'CarbonLens'],
  ['carbonshield', 'CarbonShield'], ['carbontwin', 'CarbonTwin'], ['hourmatch', 'HourMatch'], ['plotlock', 'PlotLock'],
  ['rantai', 'rantai-3c'], ['ecograph', 'EcoGraph'], ['grounded', 'grounded'], ['carbontrace', 'CarbonTrace'],
  ['plume', 'PLUME'], ['flarewatch', 'Flarewatch'], ['gridproof', 'GridProof'],
].map(([id, title]) => [`module:${id}`, title]);
const DESTINATIONS = [...CORE, ...MODULES].filter(([id]) => !ONLY || ONLY.split(',').includes(id));

async function loadPlaywright() {
  const explicit = process.env.PLAYWRIGHT_CORE;
  const target = explicit ? pathToFileURL(join(explicit, 'index.mjs')).href : 'playwright-core';
  return import(target);
}

const pageChecks = () => {
  const viewportWidth = window.innerWidth;
  const doc = document.documentElement;
  const offenders = [];
  if (doc.scrollWidth > viewportWidth + 1) {
    for (const element of document.querySelectorAll('body *')) {
      const box = element.getBoundingClientRect();
      if (box.width > 0 && box.right > viewportWidth + 1) {
        const style = getComputedStyle(element);
        if (style.position === 'fixed') continue;
        // Report only the outermost overflowing element of each branch.
        let parent = element.parentElement; let nested = false;
        while (parent && parent !== document.body) {
          if (offenders.some((item) => item.node === parent)) { nested = true; break; }
          parent = parent.parentElement;
        }
        if (!nested) offenders.push({ node: element, right: Math.round(box.right) });
        if (offenders.length >= 6) break;
      }
    }
  }
  const describe = (element) => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${element.className && typeof element.className === 'string' ? `.${element.className.trim().split(/\s+/).slice(0, 3).join('.')}` : ''}`;
  const boundaries = [...document.querySelectorAll('.workspace-error-boundary')].map((element) => element.textContent.trim().slice(0, 240));
  const alerts = [...document.querySelectorAll('[role="alert"]')].map((element) => element.textContent.trim().slice(0, 240)).filter(Boolean);
  const loading = [...document.querySelectorAll('.loading-panel')].map((element) => element.textContent.trim());
  const unnamedButtons = [...document.querySelectorAll('button')].filter((button) => {
    const box = button.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return false;
    return !(button.getAttribute('aria-label') || button.textContent.trim() || button.getAttribute('title'));
  }).length;
  const focus = document.querySelector('.dash-focus, .dash-grid');
  return {
    title: document.querySelector('.topbar-title')?.textContent?.trim() ?? null,
    hash: location.hash,
    scrollWidth: doc.scrollWidth,
    viewportWidth,
    horizontalOverflow: doc.scrollWidth > viewportWidth + 1,
    overflowOffenders: offenders.map((item) => ({ element: describe(item.node), right: item.right })),
    errorBoundaries: boundaries,
    alerts,
    stillLoading: loading,
    unnamedButtons,
    viewTextLength: focus ? focus.textContent.trim().length : 0,
  };
};

async function main() {
  const { chromium } = await loadPlaywright();
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
  });
  const report = { base: BASE, startedAt: new Date().toISOString(), widths: WIDTHS, settleMs: SETTLE_MS, pages: [] };
  try {
    for (const width of WIDTHS) {
      const mobile = width < 600;
      const context = await browser.newContext({
        viewport: { width, height: mobile ? 844 : 900 },
        isMobile: mobile,
        hasTouch: mobile,
        deviceScaleFactor: 1,
      });
      for (const [id, expectedTitle] of DESTINATIONS) {
        const page = await context.newPage();
        const consoleErrors = []; const consoleWarnings = []; const pageErrors = []; const httpErrors = []; const failed = [];
        page.on('console', (message) => {
          if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 400));
          else if (message.type() === 'warning') consoleWarnings.push(message.text().slice(0, 300));
        });
        page.on('pageerror', (error) => pageErrors.push(String(error?.message ?? error).slice(0, 400)));
        page.on('response', (response) => {
          if (response.status() >= 400) httpErrors.push({ status: response.status(), method: response.request().method(), url: response.url() });
        });
        page.on('requestfailed', (request) => {
          const reason = request.failure()?.errorText ?? 'failed';
          if (reason !== 'net::ERR_ABORTED') failed.push({ url: request.url(), reason });
        });
        const started = Date.now();
        let navigationError = null;
        try {
          await page.goto(`${BASE}/#${id}`, { waitUntil: 'load', timeout: 45_000 });
          await page.waitForTimeout(SETTLE_MS);
        } catch (error) {
          navigationError = String(error?.message ?? error).slice(0, 300);
        }
        const checks = navigationError ? null : await page.evaluate(pageChecks).catch((error) => ({ evaluateError: String(error) }));
        const shot = join(OUT, `${width}-${id.replace(':', '_')}.jpg`);
        await page.screenshot({ path: shot, type: 'jpeg', quality: 55, fullPage: false }).catch(() => {});
        const entry = {
          id, width, expectedTitle, ms: Date.now() - started, navigationError,
          titleMatches: checks?.title === expectedTitle,
          ...checks, consoleErrors, consoleWarnings, pageErrors, httpErrors, failedRequests: failed, screenshot: shot,
        };
        report.pages.push(entry);
        const flags = [
          navigationError && 'NAV',
          entry.titleMatches ? '' : `TITLE(${checks?.title})`,
          checks?.horizontalOverflow && `OVERFLOW(${checks.scrollWidth})`,
          checks?.errorBoundaries?.length && 'BOUNDARY',
          pageErrors.length && `PAGEERR(${pageErrors.length})`,
          consoleErrors.length && `CONSOLE(${consoleErrors.length})`,
          httpErrors.length && `HTTP(${httpErrors.map((item) => item.status).join(',')})`,
          failed.length && `FAILED(${failed.length})`,
          checks?.stillLoading?.length && 'LOADING',
        ].filter(Boolean).join(' ');
        console.log(`${String(width).padStart(4)} ${id.padEnd(22)} ${String(entry.ms).padStart(6)}ms ${flags || 'ok'}`);
        await page.close();
      }
      await context.close();
    }
  } finally {
    await browser.close();
    report.finishedAt = new Date().toISOString();
    await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
