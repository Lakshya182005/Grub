/**
 * audio.ts — Microphone capture and AudioWorklet pipeline.
 */

// Import worklet as asset URL via Vite
import pcmWorkletUrl from './pcm-worklet.js?url'

export interface AudioPipelineCallbacks {
  onFrame: (frame: ArrayBuffer, rms: number) => void
  onError?: (error: Error) => void
}

export class AudioPipeline {
  private audioContext: AudioContext | null = null
  private mediaStream: MediaStream | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private workletNode: AudioWorkletNode | null = null
  private isRunning = false

  constructor(private callbacks: AudioPipelineCallbacks) {}

  public async start(): Promise<void> {
    if (this.isRunning) return

    try {
      // 1. Acquire microphone stream with noise suppression & echo cancellation
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      })

      // 2. Initialize AudioContext at device native rate
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.audioContext = new AudioContextClass()

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume()
      }

      // 3. Load AudioWorklet module
      await this.audioContext.audioWorklet.addModule(pcmWorkletUrl)

      // 4. Create nodes
      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream)
      this.workletNode = new AudioWorkletNode(this.audioContext, 'pcm-worklet')

      // 5. Handle incoming 320-sample Int16 PCM frames
      this.workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>): void => {
        const frameBuffer = event.data
        const int16Array = new Int16Array(frameBuffer)

        // Calculate Root Mean Square (RMS) energy: [0.0, 1.0]
        let sumSquares = 0
        for (let i = 0; i < int16Array.length; i++) {
          const norm = int16Array[i] / 32768.0
          sumSquares += norm * norm
        }
        const rms = Math.sqrt(sumSquares / int16Array.length)

        this.callbacks.onFrame(frameBuffer, rms)
      }

      // Connect source to worklet
      this.sourceNode.connect(this.workletNode)
      this.isRunning = true
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      this.callbacks.onError?.(error)
      this.stop()
      throw error
    }
  }

  public stop(): void {
    this.isRunning = false

    if (this.workletNode) {
      this.workletNode.port.onmessage = null
      this.workletNode.disconnect()
      this.workletNode = null
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect()
      this.sourceNode = null
    }

    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        track.stop()
      }
      this.mediaStream = null
    }

    if (this.audioContext) {
      this.audioContext.close().catch(() => {})
      this.audioContext = null
    }
  }
}
