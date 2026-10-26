import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const size = 128
const pixels = Buffer.alloc(size * size * 4)
const colors = { bg: [17, 17, 22], purple: [167, 139, 250], cyan: [103, 232, 249] }

function setPixel(x, y, color) {
  if (x < 0 || y < 0 || x >= size || y >= size) return
  const offset = (y * size + x) * 4
  pixels[offset] = color[0]; pixels[offset + 1] = color[1]; pixels[offset + 2] = color[2]; pixels[offset + 3] = 255
}
function line(x1, y1, x2, y2, color, thickness = 10) {
  const dx = Math.abs(x2 - x1), sx = x1 < x2 ? 1 : -1
  const dy = -Math.abs(y2 - y1), sy = y1 < y2 ? 1 : -1
  let error = dx + dy, x = x1, y = y1
  while (true) {
    for (let oy = -thickness; oy <= thickness; oy++) for (let ox = -thickness; ox <= thickness; ox++) {
      if (ox * ox + oy * oy <= thickness * thickness) setPixel(x + ox, y + oy, color)
    }
    if (x === x2 && y === y2) break
    const twice = error * 2
    if (twice >= dy) { error += dy; x += sx }
    if (twice <= dx) { error += dx; y += sy }
  }
}

for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const inset = 8
  const radius = 26
  const cx = Math.max(inset + radius, Math.min(x, size - inset - radius - 1))
  const cy = Math.max(inset + radius, Math.min(y, size - inset - radius - 1))
  if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) setPixel(x, y, colors.bg)
}

// A compact code glyph: violet brackets around a cyan slash.
line(47, 39, 28, 64, colors.purple, 7)
line(28, 64, 47, 89, colors.purple, 7)
line(81, 39, 100, 64, colors.purple, 7)
line(100, 64, 81, 89, colors.purple, 7)
line(72, 37, 56, 91, colors.cyan, 6)

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const name = Buffer.from(type)
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([length, name, data, checksum])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6
const scanlines = Buffer.alloc(size * (size * 4 + 1))
for (let y = 0; y < size; y++) pixels.copy(scanlines, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))])
const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4)
const entry = Buffer.alloc(16); entry[0] = 0; entry[1] = 0; entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6); entry.writeUInt32LE(png.length, 8); entry.writeUInt32LE(22, 12)
const destination = path.join(root, 'build', 'icon.ico')
await mkdir(path.dirname(destination), { recursive: true })
await writeFile(destination, Buffer.concat([header, entry, png]))
await writeFile(path.join(root, 'build', 'icon.png'), png)
process.stdout.write(`${destination}\n`)
