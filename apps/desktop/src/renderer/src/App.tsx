import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
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
      openNotesFolder: () => Promise<void>
      setState: (state: string) => Promise<void>
      captureScreenshot: (name: string) => Promise<string>
      runPreflight: () => Promise<{
        all_passed: boolean
        engines: { engine: string; detail: string; latency: string; status: 'pass' | 'fail' }[]
      }>
      getSidecarInfo: () => Promise<{ port: number | null; token: string; status: string }>
      onSidecarReady: (callback: (info: { port: number; token: string }) => void) => () => void
      onSidecarStatus: (callback: (info: { status: string; code?: number | string }) => void) => () => void
      onPttChange: (callback: (info: { on: boolean }) => void) => () => void
      onTriggerDemo: (callback: (file: string) => void) => () => void
      onShowPreflight: (callback: () => void) => () => void
    }
    // Test hooks for acceptance screenshot automation
    setTestState?: (state: OrbState) => void
    setTestTranscript?: (text: string) => void
    addTestNotes?: () => void
  }
}

export const App: React.FC = () => {
  const [orbState, setOrbState] = useState<OrbState>('idle')
  const [rms, setRms] = useState<number>(0)
  const [micStatus, setMicStatus] = useState<string>('checking')
  const [sidecarStatus, setSidecarStatus] = useState<'starting' | 'running' | 'crashed'>('starting')
  const [fps, setFps] = useState<number>(0)

  // Transcript state
  const [transcriptText, setTranscriptText] = useState<string>('')
  const [showQuietHint, setShowQuietHint] = useState<boolean>(true)

  // 10s fading bottom hint bar
  const [showHintBar, setShowHintBar] = useState<boolean>(true)

  // Note cards list
  const [notes, setNotes] = useState<NoteItem[]>([])

  // Preflight check modal state
  const [preflightOpen, setPreflightOpen] = useState<boolean>(false)
  const [preflightLoading, setPreflightLoading] = useState<boolean>(false)
  const [preflightData, setPreflightData] = useState<{
    all_passed: boolean
    engines: { engine: string; detail: string; latency: string; status: 'pass' | 'fail' }[]
  } | null>(null)

  const wsClientRef = useRef<WebSocketClient | null>(null)
  const audioPipelineRef = useRef<AudioPipeline | null>(null)
  const activeAudioSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const activeAudioCtxRef = useRef<AudioContext | null>(null)
  const wakeAudioRef = useRef<HTMLAudioElement | null>(null)
  const idleClearTimerRef = useRef<NodeJS.Timeout | null>(null)

  // FPS tracking
  const frameCountRef = useRef<number>(0)
  const lastFpsTimeRef = useRef<number>(performance.now())

  // Stop currently playing TTS audio
  const stopPlayback = useCallback((): void => {
    if (activeAudioSourceRef.current) {
      try {
        activeAudioSourceRef.current.stop()
      } catch {
        // Ignored
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
      wakeAudioRef.current.volume = 0.5
    }
    wakeAudioRef.current.currentTime = 0
    wakeAudioRef.current.play().catch(() => {})
  }, [])

  // Handle Cancel
  const handleCancel = useCallback((): void => {
    stopPlayback()
    if (idleClearTimerRef.current) clearTimeout(idleClearTimerRef.current)
    setTranscriptText('')
    setShowQuietHint(true)
    setOrbState('idle')
    window.scribe?.setState('idle')
    wsClientRef.current?.sendJson({ t: 'cancel' })
  }, [stopPlayback])

  // Handle Demo trigger
  const handleTriggerDemo = useCallback((fileName = 'hello.wav'): void => {
    if (idleClearTimerRef.current) clearTimeout(idleClearTimerRef.current)
    setTranscriptText('')
    setShowQuietHint(false)
    wsClientRef.current?.sendJson({ t: 'demo', file: fileName })
  }, [])

  // Handle Note file reveal
  const handleRevealFile = useCallback((path: string): void => {
    if (window.scribe?.revealFile) {
      window.scribe.revealFile(path)
    }
  }, [])

  // Trigger preflight checks
  const triggerPreflight = useCallback(async (): Promise<void> => {
    setPreflightOpen(true)
    setPreflightLoading(true)
    try {
      if (window.scribe?.runPreflight) {
        const res = await window.scribe.runPreflight()
        setPreflightData(res)
      }
    } catch (err) {
      console.error('[App] Preflight failed:', err)
    } finally {
      setPreflightLoading(false)
    }
  }, [])

  // Fade out bottom hint bar after 10 s
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowHintBar(false)
    }, 10000)
    return (): void => clearTimeout(timer)
  }, [])

  // Notify main process of state changes (for tray text)
  useEffect(() => {
    window.scribe?.setState(orbState)
  }, [orbState])

  // Handle 4 s quiet hint transition on returning to idle
  useEffect(() => {
    if (orbState === 'idle') {
      if (idleClearTimerRef.current) clearTimeout(idleClearTimerRef.current)
      idleClearTimerRef.current = setTimeout(() => {
        setTranscriptText('')
        setShowQuietHint(true)
      }, 4000)
    } else {
      if (idleClearTimerRef.current) {
        clearTimeout(idleClearTimerRef.current)
        idleClearTimerRef.current = null
      }
      setShowQuietHint(false)
    }
  }, [orbState])

  // Global Esc key & Cmd+D shortcut
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (preflightOpen) {
          setPreflightOpen(false)
          return
        }
        handleCancel()
      } else if (e.key === 'd' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        handleTriggerDemo('hello.wav')
      } else if (e.key === 'p' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        triggerPreflight()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return (): void => window.removeEventListener('keydown', onKeyDown)
  }, [handleCancel, handleTriggerDemo, triggerPreflight, preflightOpen])

  // Initialize pipeline & IPC
  useEffect(() => {
    // 1. WebSocket Client
    const ws = new WebSocketClient({
      onMessage: (msg: SidecarMessage): void => {
        const msgType = msg.t

        if (msgType === 'wake') {
          playWakeChime()
          setTranscriptText('')
          setShowQuietHint(false)
        } else if (msgType === 'state' && typeof msg.state === 'string') {
          setOrbState(msg.state as OrbState)
        } else if (msgType === 'transcript' && typeof msg.text === 'string') {
          setTranscriptText(msg.text)
          setShowQuietHint(false)
        } else if (msgType === 'note') {
          const newNote: NoteItem = {
            id: String(msg.id || Date.now()),
            title: String(msg.title || 'Untitled Note'),
            body: String(msg.body || ''),
            path: String(msg.path || ''),
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            isNew: true
          }
          setNotes((prev) => [newNote, ...prev])
        } else if (msgType === 'say') {
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

      const cleanupDemo = window.scribe.onTriggerDemo((file) => {
        handleTriggerDemo(file)
      })

      const cleanupPreflight = window.scribe.onShowPreflight(() => {
        triggerPreflight()
      })

      return (): void => {
        cleanupReady()
        cleanupStatus()
        cleanupPtt()
        cleanupDemo()
        cleanupPreflight()
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
  }, [playPcm, playWakeChime, handleTriggerDemo])

  // Expose test hooks for automated screenshots
  useEffect(() => {
    window.setTestState = (state: OrbState): void => {
      setOrbState(state)
    }
    window.setTestTranscript = (text: string): void => {
      setTranscriptText(text)
      setShowQuietHint(false)
    }
    window.addTestNotes = (): void => {
      setNotes([
        {
          id: 'test-1',
          title: 'Design review moved to Thursday at 4 PM',
          body: '- Priya is presenting the new prototype\n- Review slide deck before the meeting',
          path: '/Users/test/Documents/Hey Scribe/2026-10-23 2105 - Design review.md',
          timestamp: '9:05 PM',
          isNew: false
        },
        {
          id: 'test-2',
          title: 'Grocery list for dinner party',
          body: '- Sourdough baguette\n- Gruyère cheese and olive oil',
          path: '/Users/test/Documents/Hey Scribe/2026-10-23 2045 - Grocery list.md',
          timestamp: '8:45 PM',
          isNew: false
        }
      ])
    }
  }, [])

  // Chip copy & state indicator
  const chipConfig = useMemo(() => {
    switch (orbState) {
      case 'listening':
        return { text: 'Listening', dotClass: 'bg-[#7C8CF8]' }
      case 'thinking':
        return { text: 'Thinking', dotClass: 'bg-[#7C8CF8] animate-pulse' }
      case 'speaking':
        return { text: 'Speaking', dotClass: 'bg-[#34D399]' }
      case 'idle':
      default:
        return { text: 'Listening for Hey Jarvis', dotClass: 'bg-[#8A93A6]' }
    }
  }, [orbState])

  // Words for staggered 40 ms fade-in
  const words = useMemo(() => {
    if (!transcriptText.trim()) return []
    return transcriptText.trim().split(/\s+/)
  }, [transcriptText])

  return (
    <div className="flex h-screen w-screen bg-[#0B0E14] text-[#E6E9F2] font-sans overflow-hidden select-none">
      {/* Left Pane: 360 px Note Rail */}
      <aside className="w-[360px] h-full flex flex-col border-r border-[#1C2230] bg-[#0B0E14] shrink-0">
        {/* Title bar drag region with macOS traffic light spacing */}
        <div className="h-11 flex items-center justify-between px-6 pt-3 border-b border-[#1C2230] app-region-drag shrink-0">
          <span className="text-[13px] font-semibold tracking-[0.08em] text-[#8A93A6] uppercase pl-16">
            Today
          </span>
          {notes.length > 0 && (
            <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-[#121620] border border-[#1C2230] text-[#8A93A6]">
              {notes.length}
            </span>
          )}
        </div>

        {/* Note list or empty state */}
        <div className="flex-1 overflow-y-auto p-4 scrollbar-thin scrollbar-thumb-[#1C2230]">
          {notes.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center p-6 text-center">
              {/* Outline document glyph */}
              <div className="w-12 h-12 mb-3 rounded-lg border border-[#1C2230] flex items-center justify-center bg-[#121620]/60 text-[#8A93A6]">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.25}
                    d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                  />
                </svg>
              </div>
              <p className="text-[14px] font-normal text-[#8A93A6]">
                Your first note will land here.
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
      <main className="flex-1 h-full flex flex-col relative items-center justify-center p-8 bg-[#0B0E14]">
        {/* Top Header Controls */}
        <div className="absolute top-4 right-6 flex items-center space-x-3">
          {sidecarStatus === 'crashed' && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium bg-red-950/80 border border-red-500/50 text-red-300">
              <span className="w-1.5 h-1.5 mr-1.5 rounded-full bg-red-400 animate-ping" />
              Sidecar Offline
            </span>
          )}
        </div>

        {/* Mic Denied Recovery Card */}
        {micStatus === 'denied' ? (
          <div className="max-w-md mx-6 p-6 rounded-xl bg-[#121620] border border-rose-500/40 text-center select-none">
            <div className="w-12 h-12 mx-auto mb-4 rounded-lg bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                />
              </svg>
            </div>
            <h3 className="text-[15px] font-semibold text-[#E6E9F2]">Microphone Access Required</h3>
            <p className="text-[13px] text-[#8A93A6] mt-2 leading-relaxed">
              Hey Scribe needs microphone access to listen locally. No audio leaves this laptop.
            </p>
            <button
              onClick={() => window.scribe?.openMicSettings()}
              className="mt-5 inline-flex items-center px-4 py-2 rounded-lg bg-[#7C8CF8] hover:bg-[#6878ea] text-[#0B0E14] font-semibold text-[13px] transition-colors"
            >
              Open System Settings
            </button>
          </div>
        ) : (
          /* Live Stage: Orb + Chip + Word-by-Word Transcript */
          <div className="flex flex-col items-center justify-center max-w-xl text-center w-full">
            {/* 220 px Orb */}
            <Orb state={orbState} rms={rms} />

            {/* State Chip: Pill, 1px border, 13px label with 0.08em letter-spacing */}
            <div className="inline-flex items-center px-3.5 py-1.5 rounded-full bg-[#121620] border border-[#1C2230] mt-7 transition-all duration-200">
              <span className={`w-2 h-2 mr-2.5 rounded-full transition-colors duration-200 ${chipConfig.dotClass}`} />
              <span className="text-[13px] tracking-[0.08em] font-medium text-[#E6E9F2]">
                {chipConfig.text}
              </span>
            </div>

            {/* Transcript: Center stage, max 2 lines, 22px / 1.5, fades in per word (40 ms stagger) */}
            <div className="min-h-[66px] max-h-[66px] flex items-center justify-center mt-5 px-6 max-w-[560px] text-center overflow-hidden">
              {words.length > 0 ? (
                <p className="text-[22px] leading-[1.5] text-[#E6E9F2] font-normal line-clamp-2">
                  {words.map((word, idx) => (
                    <span
                      key={`${word}-${idx}`}
                      className="inline-block mr-1.5 opacity-0 animate-word-fade"
                      style={{ animationDelay: `${idx * 40}ms` }}
                    >
                      {word}
                    </span>
                  ))}
                </p>
              ) : showQuietHint ? (
                <p className="text-[18px] leading-[1.5] text-[#8A93A6]/40 font-normal tracking-wide transition-opacity duration-500">
                  Say Hey Jarvis
                </p>
              ) : null}
            </div>
          </div>
        )}

        {/* Bottom Hint Bar: "⌥ Space hold to talk · Esc to cancel", 12px muted, fades after 10 s */}
        <div
          className={`absolute bottom-5 inset-x-0 text-center text-[12px] text-[#8A93A6] tracking-wide pointer-events-none transition-opacity duration-1000 ${
            showHintBar ? 'opacity-100' : 'opacity-0'
          }`}
        >
          ⌥ Space hold to talk · Esc to cancel
        </div>

        {/* Hidden dev-only corner FPS meter */}
        <div className="absolute bottom-3 right-4 text-[10px] font-mono text-[#8A93A6]/30 select-none pointer-events-none hover:text-[#8A93A6] transition-colors">
          {fps} fps
        </div>

        {/* Preflight Checks In-App Modal */}
        {preflightOpen && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-md p-6 rounded-xl bg-[#121620] border border-[#1C2230] shadow-2xl animate-card-spring text-left">
              <div className="flex items-center justify-between pb-3 border-b border-[#1C2230] mb-4">
                <h3 className="text-[15px] font-semibold text-[#E6E9F2]">
                  Engine Preflight Checks
                </h3>
                {preflightData && (
                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                      preflightData.all_passed
                        ? 'bg-emerald-950/80 border border-emerald-500/50 text-emerald-300'
                        : 'bg-rose-950/80 border border-rose-500/50 text-rose-300'
                    }`}
                  >
                    {preflightData.all_passed ? 'ALL PASSED' : 'CHECK FAILED'}
                  </span>
                )}
              </div>

              {preflightLoading ? (
                <div className="flex flex-col items-center justify-center py-8 space-y-3">
                  <div className="w-6 h-6 rounded-full border-2 border-[#7C8CF8] border-t-transparent animate-spin" />
                  <p className="text-[13px] text-[#8A93A6]">
                    Testing whisper, ollama, piper, openwakeword...
                  </p>
                </div>
              ) : preflightData?.engines ? (
                <div className="space-y-3">
                  {preflightData.engines.map((eng, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-lg bg-[#0B0E14] border border-[#1C2230] flex items-center justify-between"
                    >
                      <div className="flex items-center space-x-2.5 min-w-0">
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            eng.status === 'pass' ? 'bg-[#34D399]' : 'bg-rose-400'
                          }`}
                        />
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium text-[#E6E9F2] truncate">
                            {eng.engine}
                          </p>
                          <p className="text-[11px] text-[#8A93A6] truncate">{eng.detail}</p>
                        </div>
                      </div>
                      <span className="text-[12px] font-mono text-[#7C8CF8] shrink-0 ml-3">
                        {eng.latency}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[13px] text-[#8A93A6] py-4">No results available.</p>
              )}

              <div className="mt-5 pt-3 border-t border-[#1C2230] flex items-center justify-end space-x-2.5">
                <button
                  onClick={() => triggerPreflight()}
                  disabled={preflightLoading}
                  className="px-3 py-1.5 rounded-lg border border-[#1C2230] hover:bg-[#181E2C] text-[13px] text-[#8A93A6] hover:text-[#E6E9F2] transition-colors disabled:opacity-50"
                >
                  Re-test
                </button>
                <button
                  onClick={() => setPreflightOpen(false)}
                  className="px-3.5 py-1.5 rounded-lg bg-[#7C8CF8] hover:bg-[#6878ea] text-[#0B0E14] font-semibold text-[13px] transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

const container = document.getElementById('root')
if (container) {
  const root = createRoot(container)
  root.render(<App />)
}
