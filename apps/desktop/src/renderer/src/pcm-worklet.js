/**
 * pcm-worklet.js — AudioWorkletProcessor for microphone downsampling.
 * Decimates input (e.g. 48 kHz -> 16 kHz by averaging 3 samples) and batches into 320 Int16 samples.
 * Emits binary frames: 0x01 | uint32 seq (big-endian) | 640 bytes PCM (645 bytes total).
 */
class PcmWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buffer = new Int16Array(320)
    this.bufferIndex = 0
    this.accum = 0
    this.accumCount = 0
    this.seq = 0
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || !input[0]) return true
    const channel = input[0]

    // Determine decimation factor (e.g., 48000 / 16000 = 3)
    const decimation = Math.max(1, Math.round(sampleRate / 16000))

    for (let i = 0; i < channel.length; i++) {
      this.accum += channel[i]
      this.accumCount++

      if (this.accumCount >= decimation) {
        const avg = this.accum / this.accumCount
        this.accum = 0
        this.accumCount = 0

        // Clamp Float32 to [-1.0, 1.0] and convert to 16-bit signed integer
        const clamped = Math.max(-1.0, Math.min(1.0, avg))
        const pcm16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
        this.buffer[this.bufferIndex++] = Math.round(pcm16)

        if (this.bufferIndex >= 320) {
          // Construct packet: 0x01 | uint32 seq (4 bytes) | 640 bytes PCM
          const packetBuffer = new ArrayBuffer(1 + 4 + 640)
          const dataView = new DataView(packetBuffer)
          dataView.setUint8(0, 0x01)
          dataView.setUint32(1, this.seq >>> 0, false) // Big-endian uint32
          this.seq = (this.seq + 1) >>> 0

          // Copy raw Int16 PCM bytes
          const packetBytes = new Uint8Array(packetBuffer, 5, 640)
          packetBytes.set(new Uint8Array(this.buffer.buffer))

          // Transfer buffer
          this.port.postMessage(packetBuffer, [packetBuffer])

          this.buffer = new Int16Array(320)
          this.bufferIndex = 0
        }
      }
    }

    return true
  }
}

registerProcessor('pcm-worklet', PcmWorkletProcessor)
