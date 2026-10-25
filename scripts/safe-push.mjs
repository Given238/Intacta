#!/usr/bin/env node
/**
 * safe-push.mjs — safety checks, then `git push origin main`. Cross-platform (Node 20+), no dependencies.
 *
 *   node scripts/safe-push.mjs [--dry-run]
 *
 * (a) on main (a feature branch is fast-forwarded into main first; stops if that is not possible)
 * (b) no uncommitted changes to tracked files; the stray file "ersgipenIntacta" must not be tracked
 * (c) no secret value from server/.env (GEMINI_API_KEY, ELEVENLABS_API_KEY, OPENAI_API_KEY, DATABASE_URL, JWT_SECRET; 8+ chars)
 *     anywhere in HEAD (JWT_SECRET may equal the public dev default). Only variable and file names are printed, never values.
 * (d) no .env file (other than .env.example) and no node_modules tracked in HEAD
 * (e) origin/main is an ancestor of HEAD (after git fetch origin): never a force push
 * (f) git push origin main  (skipped with --dry-run)
 * Exits non-zero at the first failure, before anything is pushed.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DRY_RUN = process.argv.includes('--dry-run')
const SECRET_VARS = ['GEMINI_API_KEY', 'ELEVENLABS_API_KEY', 'OPENAI_API_KEY', 'DATABASE_URL', 'JWT_SECRET']
const PUBLIC_DEV_JWT_SECRET = 'intacta-dev-secret-change-in-production'
const STRAY_FILE = 'ersgipenIntacta'

function git(args, { allowFail = false } = {}) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' })
  if (r.error) throw r.error
  if (r.status !== 0 && !allowFail) {
    fail(`git ${args[0]} failed (exit ${r.status})${r.stderr ? `: ${r.stderr.trim().split('\n')[0]}` : ''}`)
  }
  return r
}

function fail(message) {
  console.error(`\n[safe-push] STOP: ${message}`)
  console.error('[safe-push] Nothing was pushed.')
  process.exit(1)
}

const step = (label) => console.log(`[safe-push] ${label}`)

// (a) branch ------------------------------------------------------------------------------------------------
step('(a) branch')
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()
if (branch === 'HEAD') fail('detached HEAD')

// (b) clean tree (checked before switching branches, so nothing uncommitted is carried over) -----------------
step('(b) working tree')
const dirty = git(['status', '--porcelain', '--untracked-files=no']).stdout.trim()
if (dirty) fail(`uncommitted changes to tracked files:\n${dirty.split('\n').map(l => `  ${l.slice(3)}`).join('\n')}`)
const strayTracked = git(['ls-files', '--', STRAY_FILE, `**/${STRAY_FILE}`]).stdout.trim()
if (strayTracked) fail(`the stray file "${STRAY_FILE}" is tracked (${strayTracked}); remove it from the index first`)
if (existsSync(join(ROOT, STRAY_FILE))) console.log(`[safe-push]     note: untracked "${STRAY_FILE}" exists; it is not committed (left as is)`)

if (branch !== 'main' && DRY_RUN) {
  // --dry-run changes nothing: only check that main could be fast-forwarded, then check this branch's HEAD
  if (git(['merge-base', '--is-ancestor', 'main', branch], { allowFail: true }).status !== 0) {
    fail(`main cannot be fast-forwarded to ${branch} (diverged)`)
  }
  step(`(a) --dry-run: main can be fast-forwarded to ${branch}; checking ${branch}`)
} else if (branch !== 'main') {
  step(`(a) fast-forwarding main to ${branch}`)
  git(['checkout', 'main'])
  const ff = git(['merge', '--ff-only', branch], { allowFail: true })
  if (ff.status !== 0) {
    git(['checkout', branch], { allowFail: true })
    fail(`main cannot be fast-forwarded to ${branch} (diverged); merge or rebase by hand`)
  }
}
if (!DRY_RUN && git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim() !== 'main') fail('not on main')

// (c) secrets from server/.env -----------------------------------------------------------------------------
step('(c) secret values in HEAD')
function readEnv(file) {
  if (!existsSync(file)) return {}
  const out = {}
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    else v = v.replace(/\s+#.*$/, '')
    out[m[1]] = v
  }
  return out
}
const env = readEnv(join(ROOT, 'server', '.env'))
if (!existsSync(join(ROOT, 'server', '.env'))) console.log('[safe-push]     note: server/.env not found; nothing to compare')
const tmp = mkdtempSync(join(tmpdir(), 'safe-push-'))
const leaks = []
try {
  for (const name of SECRET_VARS) {
    const value = env[name]
    if (!value || value.length < 8) continue
    if (name === 'JWT_SECRET' && value === PUBLIC_DEV_JWT_SECRET) continue
    // The value goes through a pattern file (mode 0600, deleted below), never the command line or the output
    const patternFile = join(tmp, 'p')
    writeFileSync(patternFile, `${value}\n`, { mode: 0o600 })
    const r = git(['grep', '-l', '-F', '-f', patternFile, 'HEAD', '--'], { allowFail: true })
    rmSync(patternFile, { force: true })
    if (r.status === 0) {
      const files = r.stdout.trim().split('\n').map(l => l.replace(/^HEAD:/, ''))
      leaks.push(`  ${name} found in: ${files.join(', ')}`)
    } else if (r.status !== 1) {
      fail(`git grep failed while checking ${name}`)
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
if (leaks.length) fail(`secret values are committed in HEAD:\n${leaks.join('\n')}`)

// (d) tracked .env / node_modules --------------------------------------------------------------------------
step('(d) tracked .env files and node_modules')
const tracked = git(['ls-tree', '-r', '--name-only', 'HEAD']).stdout.split('\n').filter(Boolean)
const badEnv = tracked.filter(p => /^\.env(\..+)?$/.test(basename(p)) && basename(p) !== '.env.example')
const badModules = tracked.filter(p => p.split('/').includes('node_modules'))
if (badEnv.length) fail(`.env files are tracked: ${badEnv.join(', ')}`)
if (badModules.length) fail(`node_modules is tracked (${badModules.length} files, e.g. ${badModules[0]})`)

// (e) fast-forward only ------------------------------------------------------------------------------------
step('(e) git fetch origin; origin/main must be an ancestor of HEAD')
git(['fetch', 'origin'])
const ancestor = git(['merge-base', '--is-ancestor', 'origin/main', 'HEAD'], { allowFail: true })
if (ancestor.status !== 0) fail('origin/main is not an ancestor of HEAD (someone pushed meanwhile?); pull and re-check')

// (f) push --------------------------------------------------------------------------------------------------
const head = git(['rev-parse', 'HEAD']).stdout.trim()
if (DRY_RUN) {
  step(`(f) --dry-run: all checks passed; would push ${head} to origin/main`)
  process.exit(0)
}
step(`(f) git push origin main (${head})`)
const push = spawnSync('git', ['push', 'origin', 'main'], { cwd: ROOT, stdio: 'inherit' })
if (push.status !== 0) fail(`git push failed (exit ${push.status})`)
console.log(`[safe-push] pushed ${head}`)
