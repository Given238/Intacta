/**
 * 16-bit PCM mono WAV encoding (VAD speech segments → POST /api/respond; silence for the audio unlock).
 */

/** Linear resample of mono float samples (VAD gives 16 kHz already; this keeps other rates safe). */
export function resample(samples, fromRate, toRate) {
  if (fromRate === toRate) return samples
  const ratio = fromRate / toRate
  const out = new Float32Array(Math.floor(samples.length / ratio))
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(samples.length - 1, i0 + 1)
    const f = pos - i0
    out[i] = samples[i0] * (1 - f) + samples[i1] * f
  }
  return out
}

/** Float32 [-1, 1] mono → WAV bytes (ArrayBuffer), 16-bit PCM at `sampleRate`. */
export function encodeWav(samples, sampleRate = 16000) {
  const dataBytes = samples.length * 2
  const buf = new ArrayBuffer(44 + dataBytes)
  const v = new DataView(buf)
  const str = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)) }
  str(0, 'RIFF')
  v.setUint32(4, 36 + dataBytes, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)          // fmt chunk size
  v.setUint16(20, 1, true)           // PCM
  v.setUint16(22, 1, true)           // mono
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true) // byte rate
  v.setUint16(32, 2, true)           // block align
  v.setUint16(34, 16, true)          // bits per sample
  str(36, 'data')
  v.setUint32(40, dataBytes, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return buf
}

export function wavBlob(samples, sampleRate = 16000) {
  return new Blob([encodeWav(samples, sampleRate)], { type: 'audio/wav' })
}
