// Dependency-free PWA icon generator (Node, zlib only).
// Draws a white graduation cap on an indigo square and writes PNGs.
// Usage: node gen-icons.mjs <frontend/public directory>
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUT = process.argv[2] ?? '.'
mkdirSync(join(OUT, 'icons'), { recursive: true })

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length)
  return out
}

function png(width, height, rgbaAt) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = rgbaAt(x, y)
      const o = y * (stride + 1) + 1 + x * 4
      raw[o] = r
      raw[o + 1] = g
      raw[o + 2] = b
      raw[o + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const BG = [79, 70, 229] // indigo-600, matches the app theme
const FG = [255, 255, 255]

// Graduation cap in unit coordinates; `scale` shrinks content towards the
// centre so maskable variants stay inside the safe zone.
function inCap(x, y, scale) {
  const cx = 0.5 + (x - 0.5) / scale
  const cy = 0.5 + (y - 0.5) / scale

  // mortarboard diamond
  if (Math.abs(cx - 0.5) / 0.3 + Math.abs(cy - 0.44) / 0.13 <= 1) return true

  // cap body (tapered trapezoid under the board)
  if (cy >= 0.5 && cy <= 0.63) {
    const t = (cy - 0.5) / 0.13
    if (Math.abs(cx - 0.5) <= 0.14 - 0.045 * t) return true
  }

  // tassel: strand from the right corner of the board plus a round bob
  if (Math.abs(cx - 0.79) <= 0.012 && cy >= 0.44 && cy <= 0.6) return true
  const dx = cx - 0.79
  const dy = cy - 0.635
  if (dx * dx + dy * dy <= 0.021 * 0.021) return true

  return false
}

function render(size, contentScale) {
  const S = 4 // 4x4 supersampling for smooth edges
  return png(size, size, (px, py) => {
    let capHits = 0
    for (let sy = 0; sy < S; sy++) {
      for (let sx = 0; sx < S; sx++) {
        const x = (px + (sx + 0.5) / S) / size
        const y = (py + (sy + 0.5) / S) / size
        if (inCap(x, y, contentScale)) capHits++
      }
    }
    const t = capHits / (S * S)
    return [
      Math.round(BG[0] + (FG[0] - BG[0]) * t),
      Math.round(BG[1] + (FG[1] - BG[1]) * t),
      Math.round(BG[2] + (FG[2] - BG[2]) * t),
      255,
    ]
  })
}

writeFileSync(join(OUT, 'icons', 'icon-192.png'), render(192, 0.92))
writeFileSync(join(OUT, 'icons', 'icon-512.png'), render(512, 0.92))
writeFileSync(join(OUT, 'icons', 'icon-maskable-512.png'), render(512, 0.88))
writeFileSync(join(OUT, 'icons', 'apple-touch-icon.png'), render(180, 0.9))

console.log('icons written to', join(OUT, 'icons'))
