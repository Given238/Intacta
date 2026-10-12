/**
 * TerminalStage — fixed 1194×834 design-stage container.
 *
 * Renders at 1194×834 internal pixels, scaled to fit the viewport with:
 *   transform: scale(min(innerWidth/1194, innerHeight/834))
 *
 * All children use absolute pixel coordinates based on the 1194×834 canvas.
 * No per-element vw/vh — everything is relative to the stage dimensions.
 *
 * The letterbox around the stage is filled with the same mesh gradient, scaled to cover
 * the whole viewport, so there are no flat side bars.
 */
import { useEffect, useState, useRef } from 'react'
import MeshBackground from './MeshBackground'

const STAGE_W = 1194
const STAGE_H = 834
const HEADER_H = 125 // every stage screen has the Header

export function useStageScale() {
  const [scale, setScale] = useState(1)
  const rafRef = useRef(null)

  useEffect(() => {
    const compute = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        setScale(Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H))
      })
    }
    compute()
    window.addEventListener('resize', compute)
    return () => {
      window.removeEventListener('resize', compute)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return scale
}

export default function TerminalStage({ children, className = '' }) {
  const scale = useStageScale()

  return (
    <div
      className={`relative flex items-center justify-center w-full h-full overflow-hidden ${className}`}
      style={{ background: '#ffffff' }}
    >
      {/* Letterbox fill: same mesh, cover-scaled to the viewport */}
      <MeshBackground opacity={0.88} />
      {/* Header band (Figma 3:2, 125px tall) continued into the side letterbox */}
      <div
        aria-hidden="true"
        style={{
          position:   'absolute',
          left:       0,
          right:      0,
          top:        `calc(50% - ${(STAGE_H / 2) * scale}px)`,
          height:     HEADER_H * scale,
          background: '#05668d',
        }}
      />

      {/*
        The scaled stage — everything inside uses 1194×834 pixel coordinates.
        We apply scale from the center (transform-origin: center center).
        The outer wrapper handles centering; the stage itself is unscaled internal pixels.
      */}
      <div
        style={{
          position:    'relative',
          width:       STAGE_W,
          height:      STAGE_H,
          flexShrink:  0,
          transform:   `scale(${scale})`,
          transformOrigin: 'center center',
          overflow:    'hidden',
          background:  '#ffffff', // the mesh is 88% opaque over white, as in Figma
        }}
      >
        {children}
      </div>
    </div>
  )
}
