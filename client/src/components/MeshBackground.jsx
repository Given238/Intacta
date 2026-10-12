/**
 * MeshBackground — canvas-based bicubic Catmull-Rom mesh gradient.
 *
 * Reproduces the Figma ShaderFill WebGPU runtime exactly:
 *  - 4×4 grid of color points at (0,33,67,100 %) of width × height
 *  - Bicubic Catmull-Rom interpolation in LINEAR LIGHT (sRGB → linear → back)
 *  - Rendered once to a 256×256 canvas, CSS-scaled up (no blur blobs, no overlay)
 *  - Opacity 0.88 over white as per Figma layer settings
 *
 * Color grid (rows top→bottom, columns left→right):
 *   y=0:   #FF6B6B  #FFA36B  #FFD16B  #FFD166
 *   y=33:  #B34D99  #CC8C80  #E6B373  #80B359
 *   y=67:  #6680B3  #59A6A6  #33A68C  #1A8CB3
 *   y=100: #05D6A1  #1AB3A6  #1A99B3  #128AB3
 */

import { useEffect, useRef } from 'react'

// Grid positions as fractions of width/height
const GRID_X = [0, 0.33, 0.67, 1.0]
const GRID_Y = [0, 0.33, 0.67, 1.0]

// 4×4 color grid as hex strings
const HEX_GRID = [
  ['#FF6B6B', '#FFA36B', '#FFD16B', '#FFD166'],
  ['#B34D99', '#CC8C80', '#E6B373', '#80B359'],
  ['#6680B3', '#59A6A6', '#33A68C', '#1A8CB3'],
  ['#05D6A1', '#1AB3A6', '#1A99B3', '#128AB3'],
]

/** sRGB hex → linear RGB (0-1) */
function hexToLinear(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)]
}

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function linearToSrgb(c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

/** Catmull-Rom bicubic interpolation between four values at t=0,1,2,3 */
function catmullRom(v0, v1, v2, v3, t) {
  const t2 = t * t
  const t3 = t2 * t
  return 0.5 * (
    (2 * v1) +
    (-v0 + v2) * t +
    (2 * v0 - 5 * v1 + 4 * v2 - v3) * t2 +
    (-v0 + 3 * v1 - 3 * v2 + v3) * t3
  )
}

/**
 * Sample the grid at fractional position (gx, gy) using bicubic Catmull-Rom.
 * gx, gy are in [0,1].
 */
export function sampleBicubic(gx, gy) {
  // Find which cell we're in
  let ix = gx < 0.33 ? 0 : gx < 0.67 ? 1 : 2
  let iy = gy < 0.33 ? 0 : gy < 0.67 ? 1 : 2

  // Fractional position within the cell (0–1)
  const tx = (gx - GRID_X[ix]) / (GRID_X[ix + 1] - GRID_X[ix])
  const ty = (gy - GRID_Y[iy]) / (GRID_Y[iy + 1] - GRID_Y[iy])

  // Collect 4×4 neighbors (extend edges for out-of-bounds)
  const neighbors = []
  for (let dy = -1; dy <= 2; dy++) {
    const row = []
    for (let dx = -1; dx <= 2; dx++) {
      const cix = Math.max(0, Math.min(3, ix + dx))
      const ciy = Math.max(0, Math.min(3, iy + dy))
      row.push(HEX_GRID[ciy][cix])
    }
    neighbors.push(row)
  }

  // Convert neighbors to linear RGB
  const linNeighbors = neighbors.map(row => row.map(hexToLinear))

  // Interpolate in x direction for each row
  const tmp = []
  for (let dy = 0; dy < 4; dy++) {
    const r = catmullRom(linNeighbors[dy][0][0], linNeighbors[dy][1][0],
                         linNeighbors[dy][2][0], linNeighbors[dy][3][0], tx)
    const g = catmullRom(linNeighbors[dy][0][1], linNeighbors[dy][1][1],
                         linNeighbors[dy][2][1], linNeighbors[dy][3][1], tx)
    const b = catmullRom(linNeighbors[dy][0][2], linNeighbors[dy][1][2],
                         linNeighbors[dy][2][2], linNeighbors[dy][3][2], tx)
    tmp.push([r, g, b])
  }

  // Interpolate in y direction
  const [lr, lg, lb] = [
    catmullRom(tmp[0][0], tmp[1][0], tmp[2][0], tmp[3][0], ty),
    catmullRom(tmp[0][1], tmp[1][1], tmp[2][1], tmp[3][1], ty),
    catmullRom(tmp[0][2], tmp[1][2], tmp[2][2], tmp[3][2], ty),
  ]

  // Clamp and convert back to sRGB
  const clamp = (v) => Math.max(0, Math.min(1, v))
  return [
    Math.round(linearToSrgb(clamp(lr)) * 255),
    Math.round(linearToSrgb(clamp(lg)) * 255),
    Math.round(linearToSrgb(clamp(lb)) * 255),
  ]
}

/** Render the mesh canvas */
function renderMeshCanvas(canvas) {
  // Stage aspect (1194×834), so object-fit: cover fills the stage exactly and covers any viewport
  const W = 256
  const H = 179
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  const imageData = ctx.createImageData(W, H)
  const data = imageData.data

  for (let py = 0; py < H; py++) {
    const gy = py / (H - 1)
    for (let px = 0; px < W; px++) {
      const gx = px / (W - 1)
      const [r, g, b] = sampleBicubic(gx, gy)
      const i = (py * W + px) * 4
      data[i]     = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 255 // opaque
    }
  }

  ctx.putImageData(imageData, 0, 0)
}

export default function MeshBackground({ opacity = 0.88 }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    if (canvasRef.current) {
      renderMeshCanvas(canvasRef.current)
    }
  }, [])

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 0 }}
      aria-hidden="true"
    >
      <canvas
        ref={canvasRef}
        style={{
          position:   'absolute',
          inset:      0,
          width:      '100%',
          height:     '100%',
          objectFit:  'cover',
          opacity,
        }}
      />
    </div>
  )
}
