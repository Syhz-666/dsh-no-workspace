/**
 * One-time migration for sessions created by the retired `chat-only` preset
 * (the fusion-era design that preceded dsh-no-workspace). Such sessions are
 * unopenable and invisible on current builds:
 *
 * - their creation header names a preset that no longer exists, so resume
 *   fails at composition;
 * - their header has no `cwd`, and `session.list` filters cold sessions
 *   without one, so they never appear in the UI.
 *
 * The migration relocates the session into the isolation root and rewrites
 * its header with the new cwd (a durable append would be the official path
 * for a preset switch — `resolveSessionPreset` prefers the newest
 * `agent-preset/selected` event — but cwd is a creation header field, so the
 * header itself is repaired and the artifact moved to its new path). All
 * event frames are preserved byte-for-byte; an `agent-preset/selected:
 * no-workspace` event is appended, exactly as the official backend writes an
 * append batch. Idempotent: sessions that already carry a selection event
 * are skipped.
 *
 * Usage: node scripts/migrate-legacy-session.mjs [sessionRoot] [isolatedRoot]
 * Defaults: $DSH_HOME/sessions and $DSH_HOME/.dsh-no-workspace.
 */

import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import { constants, zstdCompress, zstdDecompressSync } from 'node:zlib'

const zstdCompressAsync = promisify(zstdCompress)
const CHECKSUM_OPTIONS = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }
const ZSTD_MAGIC = 0xFD2FB528
const home = homedir()
const sessionRoot = process.argv[2] ?? join(home, '.dsh', 'sessions')
const isolatedRoot = process.argv[3] ?? join(home, '.dsh', '.dsh-no-workspace')

/** Locate complete zstd frame ranges (mirror of the official scanner). */
function scanFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return frames
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`bad magic at ${offset}`)
    offset += 4
    if (offset === buffer.length) return frames
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 0x18) !== 0) throw new Error('reserved frame-header bit')
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) return frames
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return frames
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const blockSize = blockHeader >>> 3
      if (blockType === 0x03) throw new Error('reserved block type')
      const payloadBytes = blockType === 0x01 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return frames
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return frames
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return frames
}

/** Decode every frame, one JSONL line per storage row. */
function decodeLog(buffer) {
  const frames = scanFrames(buffer)
  let text = ''
  for (const frame of frames) {
    text += zstdDecompressSync(buffer.subarray(frame.start, frame.end)).toString('utf8')
  }
  return { frames, text: text.split('\n').filter(Boolean) }
}

/** The official project-directory key for a cwd (mirror of format.ts). */
function projectKey(cwd) {
  let readable = ''
  let separatorRun = false
  for (const ch of cwd) {
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += `~${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`
      separatorRun = false
    }
  }
  const slug = readable.replace(/^-+/, '') || 'root'
  return `--${slug.slice(0, 251)}--`
}

/** The official per-session id segment (mirror of format.ts). */
function encodeSegment(raw) {
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (const ch of raw) {
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      out += ch
    } else {
      out += `~${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`
    }
  }
  return out
}

/** Recursively find every session artifact. */
async function findSessionLogs(root) {
  const found = []
  const walk = async (dir) => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const path = join(dir, entry.name)
      const nested = await readdir(path).catch(() => [])
      const artifact = nested.find((name) => name === 'session.jsonl.zstd' || name === 'session.jsonl')
      if (artifact !== undefined) {
        found.push({ dir: path, artifact })
      } else {
        await walk(path)
      }
    }
  }
  await walk(root)
  return found
}

const logs = await findSessionLogs(sessionRoot)
console.log(`scanning ${logs.length} session dirs under ${sessionRoot}`)

let migrated = 0
for (const { dir, artifact } of logs) {
  const logPath = join(dir, artifact)
  const raw = await readFile(logPath)
  const { frames, text: lines } = decodeLog(raw)
  if (lines.length === 0) continue
  let header
  try {
    header = JSON.parse(lines[0])
  } catch {
    continue
  }
  if (header.type !== 'session' || header.agentPreset !== 'chat-only') continue
  if (typeof header.id !== 'string') {
    console.log(`skip (header without id): ${logPath}`)
    continue
  }
  if (typeof header.cwd === 'string') {
    console.log(`skip (already has cwd): ${header.id}`)
    continue
  }
  const selected = lines.some((line) => {
    try {
      return JSON.parse(line).type === 'agent-preset/selected'
    } catch {
      return false
    }
  })

  // New home: an isolated directory under the isolation root, and the
  // session artifact relocated to its project-keyed path.
  const cwd = join(isolatedRoot, header.id)
  await mkdir(cwd, { recursive: true })
  const target = join(sessionRoot, projectKey(cwd), encodeSegment(header.id), 'session.jsonl.zstd')
  await mkdir(dirname(target), { recursive: true })

  const lastSeq = lines.reduce((max, line) => {
    try {
      const event = JSON.parse(line)
      return typeof event.seq === 'number' ? Math.max(max, event.seq) : max
    } catch {
      return max
    }
  }, -1)

  // Rewrite: new header frame + all original event frames (+ one selection
  // frame when the earlier event-only migration has not run yet).
  const newHeader = { ...header, cwd }
  const headerFrame = await zstdCompressAsync(Buffer.from(JSON.stringify(newHeader) + '\n'), CHECKSUM_OPTIONS)
  const eventFrames = frames.slice(1).map((frame) => raw.subarray(frame.start, frame.end))
  let tail = Buffer.alloc(0)
  if (!selected) {
    const selection = {
      type: 'agent-preset/selected',
      seq: lastSeq + 1,
      time: Date.now(),
      data: { agentPreset: 'no-workspace' },
    }
    tail = await zstdCompressAsync(Buffer.from(JSON.stringify(selection) + '\n'), CHECKSUM_OPTIONS)
    console.log(`migrated ${header.id} -> cwd ${cwd} (selection seq ${selection.seq})`)
  } else {
    console.log(`migrated ${header.id} -> cwd ${cwd} (selection already logged)`)
  }
  await writeFile(target, Buffer.concat([headerFrame, ...eventFrames, tail]))
  await rm(dir, { recursive: true, force: true })
  migrated += 1
}

console.log(migrated === 0 ? 'no legacy chat-only sessions found' : `migrated ${migrated} session(s)`)
