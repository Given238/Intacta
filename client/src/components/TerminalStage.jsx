/**
 * TerminalStage — the fluid terminal layout (replaces the fixed 1194×834 scaled stage).
 *
 *   <TerminalStage header={<Header …/>}>  …main content…  </TerminalStage>
 *
 * Full viewport (100dvh), mesh gradient full-bleed at every aspect ratio, safe-area insets, header on top,
 * the rest is a flex column (see terminal.css). Use <TerminalBody> for the waveform + text slots.
 */
import '../terminal.css'
import MeshBackground from './MeshBackground'

export default function TerminalStage({ header = null, children, className = '' }) {
  return (
    <div className={`term ${className}`}>
      <MeshBackground opacity={0.88} />
      {header}
      <main className="term-main">{children}</main>
    </div>
  )
}

/** Waveform slot above, text slot below (Figma 1:2 proportions). */
export function TerminalBody({ wave, text }) {
  return (
    <>
      <div className="term-wave-slot">{wave}</div>
      <div className="term-text-slot">
        <div className="term-text-box">{text}</div>
      </div>
    </>
  )
}
