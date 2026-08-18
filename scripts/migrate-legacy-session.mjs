/**
 * One-time migration for sessions created by the retired `chat-only` preset
 * (the fusion-era design that preceded dsh-no-workspace). Such sessions are
 * permanently unopenable on current builds: their creation header names a
 * preset that no longer exists, so resume fails at composition. The official
 * escape hatch is the `agent-preset/selected` log event — `resolveSessionPreset`
 * prefers the newest such event over the header — so appending one selecting
 * `no-workspace` makes the session open under the read-only preset without
 * touching its header or its history.
 *
 * The append is a plain durable event batch: one checksummed Zstandard frame
 * of one JSONL line, seq-continuing the log, exactly as the official backend
 * writes an append batch. Idempotent: sessions that already carry a
 * selection event are skipped.
 *
 * Usage: node scripts/migrate-legacy-session.mjs [sessionRoot]
 * Default session root: $DSH_HOME/sessions (DSH_HOME defaults to ~/.dsh).
 */

import { readdir, readFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import { constants, zstdCompress, zstdDecompressSync } from 'node:zlib'

const zstdCompressAsync = promisify(zstdCompress)
const CHECKSUM_OPTIONS = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }
const ZSTD_MAGIC = 0xFD2FB528

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
  return text.split('\n').filter(Boolean)
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
      if (entry.name === '.pnpm' || entry.name === 'node_modules') continue
      const path = join(dir, entry.name)
      if (entry.name.endsWith('.jsonl.zstd')) continue
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

const sessionRoot = process.argv[2] ?? join(homedir(), '.dsh', 'sessions')
const logs = await findSessionLogs(sessionRoot)
console.log(`scanning ${logs.length} session dirs under ${sessionRoot}`)

let migrated = 0
for (const { dir, artifact } of logs) {
  const logPath = join(dir, artifact)
  const raw = await readFile(logPath)
  const lines = decodeLog(raw)
  if (lines.length === 0) continue
  let header
  try {
    header = JSON.parse(lines[0])
  } catch {
    continue
  }
  if (header.type !== 'session' || header.agentPreset !== 'chat-only') continue
  const selected = lines.some((line) => {
    try {
      return JSON.parse(line).type === 'agent-preset/selected'
    } catch {
      return false
    }
  })
  if (selected) {
    console.log(`skip (already selected): ${header.id}`)
    continue
  }
  const lastSeq = lines.reduce((max, line) => {
    try {
      const event = JSON.parse(line)
      return typeof event.seq === 'number' ? Math.max(max, event.seq) : max
    } catch {
      return max
    }
  }, -1)
  const event = {
    type: 'agent-preset/selected',
    seq: lastSeq + 1,
    time: Date.now(),
    data: { agentPreset: 'no-workspace' },
  }
  const frame = await zstdCompressAsync(Buffer.from(JSON.stringify(event) + '\n'), CHECKSUM_OPTIONS)
  await appendFile(logPath, frame)
  migrated += 1
  console.log(`migrated ${header.id}: appended agent-preset/selected -> no-workspace (seq ${event.seq})`)
}

console.log(migrated === 0 ? 'no legacy chat-only sessions found' : `migrated ${migrated} session(s)`)
