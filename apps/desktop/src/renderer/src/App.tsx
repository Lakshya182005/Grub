import React, { useEffect, useRef, useState, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { Orb, OrbState } from './Orb'
import { NoteCard, NoteItem } from './NoteCard'
import { AudioPipeline } from './audio'
import { WebSocketClient, SidecarMessage } from './ws'
import './index.css'

declare global {
  interface Window {
    scribe: {
      getMicStatus: () => Promise<string>
      openMicSettings: () => Promise<void>
      revealFile: (path: string) => Promise<void>
      getSidecarInfo: () => Promise<{ port: number | null; token: string; status: string }>
      onSidecarReady: (callback: (info: { port: number; token: string }) => void) => () => void
      onSidecarStatus: (callback: (info: { status: string; code?: number | string }) => void) => () => void
      onPttChange: (callback: (info: { on: boolean }) => void) => () => void
    }
  }
}

export const App: React.FC = () => {
  const [orbState, setOrbState] = useState<OrbState>('idle')
  const [rms, setRms] = useState<number>(0)
  const [micStatus, setMicStatus] = useState<string>('checking')
  const [sidecarStatus, setSidecarStatus] = useState<'starting' | 'running' | 'crashed'>('starting')
  const [fps, setFps] = useState<number>(0)

  // Transcript typewriter state
  const [fullTranscript, setFullTranscript] = useState<string>('')
  const [displayedTranscript, setDisplayedTranscript] = useState<string>('')
  const [spokenReply, setSpokenReply] = useState<string>('')

  // Note cards list
  const [notes, setNotes] = useState<NoteItem[]>([])

  const wsClientRef = useRef<WebSocketClient | null>(null)
  const audioPipelineRef = useRef<AudioPipeline | null>(null)
  const activeAudioSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const activeAudioCtxRef = useRef<AudioContext | null>(null)
  const wakeAudioRef = useRef<HTMLAudioElement | null>(null)

  // FPS tracking
  const frameCountRef = useRef<number>(0)
  const lastFpsTimeRef = useRef<number>(performance.now())

  // Stop currently playing TTS audio
  const stopPlayback = useCallback((): void => {
    if (activeAudioSourceRef.current) {
      try {
        activeAudioSourceRef.current.stop()
      } catch {
        // Ignored if already stopped
      }
      activeAudioSourceRef.current = null
    }
    if (activeAudioCtxRef.current) {
      activeAudioCtxRef.current.close().catch(() => {})
      activeAudioCtxRef.current = null
    }
  }, [])

  // Play base64 PCM16 audio
  const playPcm = useCallback((pcmB64: string, sampleRate: number): void => {
    stopPlayback()

    try {
      const binaryString = atob(pcmB64)
      const len = binaryString.length
      const bytes = new Uint8Array(len)
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }

      const int16Array = new Int16Array(bytes.buffer)
      const float32Array = new Float32Array(int16Array.length)
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0
      }

      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new AudioCtxClass({ sampleRate })
      activeAudioCtxRef.current = ctx

      const audioBuffer = ctx.createBuffer(1, float32Array.length, sampleRate)
      audioBuffer.copyToChannel(float32Array, 0)

      const source = ctx.createBufferSource()
      source.buffer = audioBuffer
      source.connect(ctx.destination)
      activeAudioSourceRef.current = source

      source.onended = (): void => {
        activeAudioSourceRef.current = null
        ctx.close().catch(() => {})
        activeAudioCtxRef.current = null
        wsClientRef.current?.sendJson({ t: 'playback_done' })
      }

      source.start(0)
    } catch (err) {
      console.error('[App] Failed to play PCM audio:', err)
      wsClientRef.current?.sendJson({ t: 'playback_done' })
    }
  }, [stopPlayback])

  // Play wake chime
  const playWakeChime = useCallback((): void => {
    if (!wakeAudioRef.current) {
      wakeAudioRef.current = new Audio('./Tink.aiff')
      wakeAudioRef.current.volume = 0.6
    }
    wakeAudioRef.current.currentTime = 0
    wakeAudioRef.current.play().catch(() => {})
  }, [])

  // Handle Cancel
  const handleCancel = useCallback((): void => {
    stopPlayback()
    setDisplayedTranscript('')
    setFullTranscript('')
    setSpokenReply('')
    setOrbState('idle')
    wsClientRef.current?.sendJson({ t: 'cancel' })
  }, [stopPlayback])

  // Handle Demo mode
  const handleTriggerDemo = useCallback((fileName = 'hello.wav'): void => {
    setDisplayedTranscript('')
    setFullTranscript('')
    setSpokenReply('')
    wsClientRef.current?.sendJson({ t: 'demo', file: fileName })
  }, [])

  // Handle Note file reveal
  const handleRevealFile = useCallback((path: string): void => {
    if (window.scribe?.revealFile) {
      window.scribe.revealFile(path)
    }
  }, [])

  // Typewriter reveal effect for transcript
  useEffect(() => {
    if (!fullTranscript) {
      setDisplayedTranscript('')
      return
    }

    setDisplayedTranscript('')
    let currentIdx = 0
    const interval = setInterval(() => {
      currentIdx += 2
      if (currentIdx >= fullTranscript.length) {
        setDisplayedTranscript(fullTranscript)
        clearInterval(interval)
      } else {
        setDisplayedTranscript(fullTranscript.slice(0, currentIdx))
      }
    }, 20)

    return (): void => clearInterval(interval)
  }, [fullTranscript])

  // Global Esc key listener
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        handleCancel()
      } else if (e.key === 'd' && (e.metaKey || e.ctrlKey)) {
        // Cmd+D shortcut for Demo Mode
        e.preventDefault()
        handleTriggerDemo('hello.wav')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return (): void => window.removeEventListener('keydown', onKeyDown)
  }, [handleCancel, handleTriggerDemo])

  // Initialize pipeline
  useEffect(() => {
    // 1. WebSocket Client
    const ws = new WebSocketClient({
      onMessage: (msg: SidecarMessage): void => {
        const msgType = msg.t

        if (msgType === 'wake') {
          playWakeChime()
          setDisplayedTranscript('')
          setFullTranscript('')
          setSpokenReply('')
        } else if (msgType === 'state' && typeof msg.state === 'string') {
          setOrbState(msg.state as OrbState)
          if (msg.state === 'idle') {
            setSpokenReply('')
          }
        } else if (msgType === 'transcript' && typeof msg.text === 'string') {
          setFullTranscript(msg.text)
        } else if (msgType === 'note') {
          const newNote: NoteItem = {
            id: String(msg.id || Date.now()),
            title: String(msg.title || 'Untitled Note'),
            body: String(msg.body || ''),
            path: String(msg.path || ''),
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
          setNotes((prev) => [newNote, ...prev])
        } else if (msgType === 'say') {
          const text = String(msg.text || '')
          setSpokenReply(text)
          if (msg.pcm_b64 && typeof msg.pcm_b64 === 'string') {
            playPcm(msg.pcm_b64, Number(msg.rate) || 22050)
          }
        }
      },
      onStatusChange: (status): void => {
        if (status === 'connected') {
          setSidecarStatus('running')
        }
      }
    })
    wsClientRef.current = ws

    // 2. Audio Pipeline
    const audio = new AudioPipeline({
      onFrame: (frameBuffer, calculatedRms): void => {
        ws.sendFrame(frameBuffer)
        setRms(calculatedRms)

        frameCountRef.current++
        const now = performance.now()
        const elapsed = now - lastFpsTimeRef.current
        if (elapsed >= 1000) {
          setFps(Math.round((frameCountRef.current * 1000) / elapsed))
          frameCountRef.current = 0
          lastFpsTimeRef.current = now
        }
      },
      onError: (err): void => {
        console.error('[App] Audio pipeline error:', err)
      }
    })
    audioPipelineRef.current = audio

    // 3. Microphone & IPC setup
    if (window.scribe) {
      window.scribe.getMicStatus().then((status) => {
        setMicStatus(status)
        if (status === 'granted') {
          audio.start().catch((err) => console.error('[App] Failed to auto-start audio:', err))
        }
      })

      window.scribe.getSidecarInfo().then((info) => {
        if (info.port) {
          ws.connect(info.port, info.token)
        }
      })

      const cleanupReady = window.scribe.onSidecarReady(({ port, token }) => {
        ws.connect(port, token)
      })

      const cleanupStatus = window.scribe.onSidecarStatus(({ status }) => {
        if (status === 'crashed') setSidecarStatus('crashed')
        else if (status === 'running') setSidecarStatus('running')
      })

      const cleanupPtt = window.scribe.onPttChange(({ on }) => {
        setOrbState(on ? 'listening' : 'idle')
        ws.sendJson({ t: 'ptt', on })
      })

      return (): void => {
        cleanupReady()
        cleanupStatus()
        cleanupPtt()
        audio.stop()
        ws.destroy()
      }
    } else {
      navigator.mediaDevices?.getUserMedia({ audio: true }).then(() => {
        setMicStatus('granted')
        audio.start()
      }).catch(() => {
        setMicStatus('denied')
      })

      return (): void => {
        audio.stop()
        ws.destroy()
      }
    }
  }, [playPcm, playWakeChime])

  const getStatusChipText = (): string => {
    switch (orbState) {
      case 'listening':
        return 'Listening'
      case 'thinking':
        return 'Thinking'
      case 'speaking':
        return spokenReply || 'Speaking'
      default:
        return 'Listening for Hey Jarvis'
    }
  }

  return (
    <div className="flex h-screen w-screen bg-[#0b0e14] text-slate-100 font-sans overflow-hidden select-none">
      {/* Left Pane: 360 px Note Rail */}
      <aside className="w-[360px] h-full flex flex-col border-r border-slate-800/80 bg-[#0f141d]/80 backdrop-blur-xl shrink-0">
        {/* Title bar drag region */}
        <div className="h-12 flex items-center justify-between px-6 border-b border-slate-800/50 app-region-drag shrink-0">
          <span className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
            Notes
          </span>
          {notes.length > 0 && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
              {notes.length}
            </span>
          )}
        </div>

        {/* Note list or empty state */}
        <div className="flex-1 overflow-y-auto p-4 scrollbar-thin scrollbar-thumb-slate-800">
          {notes.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center p-6 text-center">
              <div className="w-12 h-12 mb-4 rounded-xl border border-slate-800 flex items-center justify-center bg-slate-900/60 text-slate-500">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                  />
                </svg>
              </div>
              <p className="text-sm font-medium text-slate-400">Your notes will appear here</p>
              <p className="text-xs text-slate-600 mt-1 max-w-[200px]">
                Say &ldquo;Hey Jarvis&rdquo; or hold ⌥Space to take a note.
              </p>
            </div>
          ) : (
            notes.map((note) => (
              <NoteCard key={note.id} note={note} onReveal={handleRevealFile} />
            ))
          )}
        </div>
      </aside>

      {/* Right Stage */}
      <main className="flex-1 h-full flex flex-col relative items-center justify-center p-8">
        {/* Top Header controls */}
        <div className="absolute top-4 right-6 flex items-center space-x-3">
          {/* Demo Mode Button */}
          <button
            onClick={() => handleTriggerDemo('hello.wav')}
            title="Replay test fixture audio (⌘D)"
            className="px-2.5 py-1 rounded-md bg-slate-900/90 hover:bg-slate-800 border border-slate-700/60 text-[11px] font-medium text-slate-400 hover:text-slate-200 transition-colors shadow-sm"
          >
            Demo Mode
          </button>

          {sidecarStatus === 'crashed' && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-red-950/80 border border-red-500/50 text-red-300">
              <span className="w-1.5 h-1.5 mr-1.5 rounded-full bg-red-400 animate-ping" />
              Sidecar Offline
            </span>
          )}
        </div>

        {/* Mic Denied Recovery Card */}
        {micStatus === 'denied' ? (
          <div className="max-w-md mx-6 p-6 rounded-2xl bg-slate-900/90 border border-rose-500/40 shadow-2xl backdrop-blur-xl text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-slate-100">Microphone Access Required</h3>
            <p className="text-xs text-slate-400 mt-2 leading-relaxed">
              Hey Scribe needs microphone access to listen locally. No audio leaves this laptop.
            </p>
            <button
              onClick={() => window.scribe?.openMicSettings()}
              className="mt-5 inline-flex items-center px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs transition-colors shadow-lg shadow-sky-500/20"
            >
              Open System Settings
            </button>
          </div>
        ) : (
          /* Live Stage Orb & Status & Transcript */
          <div className="flex flex-col items-center justify-center space-y-6 max-w-xl text-center">
            <Orb state={orbState} rms={rms} />

            {/* Status Chip */}
            <div className="inline-flex items-center px-4 py-1.5 rounded-full bg-slate-900/80 border border-slate-700/60 shadow-lg backdrop-blur-md">
              <span
                className={`w-2 h-2 mr-2.5 rounded-full transition-colors duration-300 ${
                  orbState === 'listening'
                    ? 'bg-sky-400 shadow-[0_0_8px_#38bdf8]'
                    : orbState === 'thinking'
                      ? 'bg-violet-400 shadow-[0_0_8px_#a855f7]'
                      : orbState === 'speaking'
                        ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
                        : 'bg-slate-500'
                }`}
              />
              <span className="text-xs font-medium tracking-wide text-slate-300">
                {getStatusChipText()}
              </span>
            </div>

            {/* Typewriter reveal transcript */}
            {displayedTranscript && (
              <div className="min-h-[48px] px-6 py-3 rounded-xl bg-slate-900/40 border border-slate-800/60 text-sm text-slate-200 font-medium tracking-normal leading-relaxed max-w-md animate-in fade-in duration-300">
                &ldquo;{displayedTranscript}&rdquo;
              </div>
            )}
          </div>
        )}

        {/* Hidden dev-only corner FPS meter */}
        <div className="absolute bottom-3 right-4 text-[10px] font-mono text-slate-600 select-none pointer-events-none opacity-40 hover:opacity-100 transition-opacity">
          {fps} fps
        </div>
      </main>
    </div>
  )
}

const container = document.getElementById('root')
if (container) {
  const root = createRoot(container)
  root.render(<App />)
}
