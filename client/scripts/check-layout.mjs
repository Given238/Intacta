/**
 * check-layout.mjs — responsive layout check (C3): screenshots + horizontal-overflow check at 9 viewports.
 *
 *   npm i --no-save playwright-core        (once; uses the installed Chrome, no browser download)
 *   npm run dev  (server + client running)
 *   PORTAL_TOKEN=<caregiver JWT> PATIENT_ID=<id> node scripts/check-layout.mjs [outDir]
 *
 * Env: BASE_URL (default http://localhost:5173), CHROME_PATH (default: the usual Windows/mac/Linux Chrome path),
 *      PLAYWRIGHT_CORE_PATH (absolute path to a playwright-core install, if not in node_modules).
 * Pages: /terminal (idle + a long reply via the dev-only window.__intactaSay), /portal/pair, Home, Patient,
 * Routines, Context, Settings. Writes <outDir>/<page>-<w>x<h>.png and <outDir>/report.json; exits 1 when any
 * page scrolls horizontally (document.scrollWidth > innerWidth).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const VIEWPORTS = [[360, 740], [390, 844], [430, 932], [768, 1024], [834, 1194], [1024, 768], [1194, 834], [1366, 768], [1920, 1080]]
const BASE = process.env.BASE_URL || 'http://localhost:5173'
const OUT = process.argv[2] || 'layout-check'
const LONG_REPLY = 'Kamu rindu Timothy dan ingin sekali bertemu dengannya sore ini. Timothy pulang jam 5 sore nanti, dan aku menemanimu sampai dia datang. Mari dengarkan lagu keroncong kesukaanmu sambil menunggu dengan tenang.'

const LONG_NAME = 'Bartholomew Alexander Wiryawan-Santoso'

const CHROME = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find(p => existsSync(p))

const pwPath = process.env.PLAYWRIGHT_CORE_PATH
const { chromium } = await import(pwPath ? pathToFileURL(join(pwPath, 'index.mjs')).href : 'playwright-core')

const session = process.env.PORTAL_TOKEN
  ? JSON.stringify({ token: process.env.PORTAL_TOKEN, patient_id: Number(process.env.PATIENT_ID), language: 'id', device_name: 'Tablet' })
  : null

const PORTAL_PAGES = [
  ['portal-home', '/portal'],
  ['portal-patient', '/portal/patient'],
  ['portal-routines', '/portal/routines'],
  ['portal-context', '/portal/context'],
  ['portal-settings', '/portal/settings'],
]

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const report = []

async function measure(page, name, [w, h]) {
  await page.waitForTimeout(600)
  const m = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    // smallest clickable target (buttons, links, inputs) that is visible
    smallTargets: [...document.querySelectorAll('button, a[href], input, select, textarea, [role=button]')]
      .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' })
      .filter(el => { const r = el.getBoundingClientRect(); return el.type !== 'range' && (r.width < 44 && r.height < 44) })
      .map(el => (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 30)),
    // the header chip: still on screen (not pushed past the right edge) and truncated rather than wrapped
    chip: (() => {
      const el = document.querySelector('[data-testid=connected-chip]')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { right: Math.round(r.right), left: Math.round(r.left), fits: r.right <= window.innerWidth && r.left >= 0 }
    })(),
    textOverflow: (() => {
      const box = document.querySelector('[data-testid=reply]')
      return box ? box.scrollHeight > box.clientHeight + 1 : null
    })(),
  }))
  const file = `${name}-${w}x${h}.png`
  await page.screenshot({ path: join(OUT, file) })
  const row = { page: name, viewport: `${w}x${h}`, file, hScroll: m.scrollWidth > m.innerWidth || m.chip?.fits === false, scrollWidth: m.scrollWidth, innerWidth: m.innerWidth, smallTargets: m.smallTargets, replyScrolls: m.textOverflow, chip: m.chip }
  report.push(row)
  console.log(`${row.hScroll ? 'H-SCROLL' : 'ok      '} ${name.padEnd(18)} ${row.viewport.padEnd(9)} small targets: ${m.smallTargets.length}${m.textOverflow ? ' · reply scrolls' : ''}${m.chip ? ` · chip ${m.chip.left}-${m.chip.right}` : ''}`)
}

for (const vp of VIEWPORTS) {
  const [w, h] = vp
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
  const page = await context.newPage()

  // Terminal: start gate → idle → long reply
  await page.goto(`${BASE}/terminal`)
  await page.waitForTimeout(500)
  await page.mouse.click(w / 2, h / 2)
  await page.waitForTimeout(500)
  await measure(page, 'terminal-idle', vp)
  await page.evaluate((text) => window.__intactaSay?.({ text, source: 'typed' }), LONG_REPLY)
  await page.waitForTimeout(1200)
  await measure(page, 'terminal-reply', vp)

  // Terminal paired: the "Connected · {name}" chip painted from the cached state (long name + several caregivers).
  // A fake device token: without a backend the reconcile fails and the cached state stays.
  await page.evaluate((name) => {
    localStorage.setItem('device_token', 'layout-check')
    localStorage.setItem('terminal_connection', JSON.stringify({ paired: true, name, count: 3 }))
  }, LONG_NAME)
  await page.goto(`${BASE}/terminal`)
  await page.waitForTimeout(500)
  await page.mouse.click(w / 2, h / 2)
  await page.waitForTimeout(500)
  await measure(page, 'terminal-connected', vp)
  await page.evaluate(() => { localStorage.removeItem('terminal_connection'); localStorage.removeItem('device_token') })

  // Portal: pair screen (no session), then the 5 screens with a session
  await page.goto(`${BASE}/portal/pair`)
  await page.evaluate(() => localStorage.removeItem('portal_session'))
  await page.goto(`${BASE}/portal/pair`)
  await measure(page, 'portal-pair', vp)
  if (session) {
    await page.evaluate((s) => localStorage.setItem('portal_session', s), session)
    for (const [name, path] of PORTAL_PAGES) {
      await page.goto(`${BASE}${path}`)
      await page.waitForTimeout(900)
      await measure(page, name, vp)
    }
  }
  await context.close()
}

await browser.close()
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
const bad = report.filter(r => r.hScroll)
console.log(`\n${report.length} screenshots, ${bad.length} with horizontal scroll → ${OUT}`)
process.exit(bad.length ? 1 : 0)
