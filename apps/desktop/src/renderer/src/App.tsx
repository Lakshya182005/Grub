import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Orb, OrbState } from './Orb'
import { AudioPipeline } from './audio'
import { WebSocketClient, SidecarMessage } from './ws'
import './index.css'

declare global {
  interface Window {
    scribe: {
      getMicStatus: () => Promise<string>
      openMicSettings: () => Promise<void>
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

  const wsClientRef = useRef<WebSocketClient | null>(null)
  const audioPipelineRef = useRef<AudioPipeline | null>(null)

  // FPS tracking
  const frameCountRef = useRef<number>(0)
  const lastFpsTimeRef = useRef<number>(performance.now())

  useEffect(() => {
    // 1. Initialize WebSocket Client
    const ws = new WebSocketClient({
      onMessage: (msg: SidecarMessage): void => {
        if (msg.t === 'state' && typeof msg.state === 'string') {
          setOrbState(msg.state as OrbState)
        }
      },
      onStatusChange: (status): void => {
        if (status === 'connected') {
          setSidecarStatus('running')
        }
      }
    })
    wsClientRef.current = ws

    // 2. Set up Audio Pipeline
    const audio = new AudioPipeline({
      onFrame: (frameBuffer, calculatedRms): void => {
        // Send frame to sidecar
        ws.sendFrame(frameBuffer)
        setRms(calculatedRms)

        // Increment frame count for FPS calculation
        frameCountRef.current++
        const now = performance.now()
        const elapsed = now - lastFpsTimeRef.current
        if (elapsed >= 1000) {
          const calculatedFps = Math.round((frameCountRef.current * 1000) / elapsed)
          setFps(calculatedFps)
          frameCountRef.current = 0
          lastFpsTimeRef.current = now
        }
      },
      onError: (err): void => {
        console.error('[App] Audio pipeline error:', err)
      }
    })
    audioPipelineRef.current = audio

    // 3. Check Microphone Status
    if (window.scribe) {
      window.scribe.getMicStatus().then((status) => {
        setMicStatus(status)
        if (status === 'granted') {
          audio.start().catch((err) => {
            console.error('[App] Failed to auto-start audio:', err)
          })
        }
      })

      // Query sidecar initial info
      window.scribe.getSidecarInfo().then((info) => {
        if (info.port) {
          ws.connect(info.port, info.token)
        }
      })

      // Listen for sidecar ready event
      const cleanupReady = window.scribe.onSidecarReady(({ port, token }) => {
        ws.connect(port, token)
      })

      // Listen for sidecar crash / status
      const cleanupStatus = window.scribe.onSidecarStatus(({ status }) => {
        if (status === 'crashed') {
          setSidecarStatus('crashed')
        } else if (status === 'running') {
          setSidecarStatus('running')
        }
      })

      // Listen for Alt+Space push-to-talk
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
      // Browser fallback (e.g., during direct browser preview)
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
  }, [])

  const getStatusChipText = (): string => {
    switch (orbState) {
      case 'listening':
        return 'Listening'
      case 'thinking':
        return 'Thinking'
      case 'speaking':
        return 'Speaking'
      default:
        return 'Listening for Hey Jarvis'
    }
  }

  return (
    <div className="flex h-screen w-screen bg-[#0b0e14] text-slate-100 font-sans overflow-hidden select-none">
      {/* Left Pane: 360 px Note Rail */}
      <aside className="w-[360px] h-full flex flex-col border-r border-slate-800/80 bg-[#0f141d]/70 backdrop-blur-xl">
        {/* Title bar drag region */}
        <div className="h-12 flex items-center px-6 border-b border-slate-800/50 app-region-drag">
          <span className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
            Notes
          </span>
        </div>

        {/* Note list empty state */}
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <div className="w-12 h-12 mb-4 rounded-xl border border-slate-800 flex items-center justify-center bg-slate-900/60 text-slate-500">
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
              />
            </svg>
          </div>
          <p className="text-sm font-medium text-slate-400">
            Your notes will appear here
          </p>
          <p className="text-xs text-slate-600 mt-1 max-w-[200px]">
            Speak with &ldquo;Hey Jarvis&rdquo; or hold ⌥Space to record.
          </p>
        </div>
      </aside>

      {/* Right Stage */}
      <main className="flex-1 h-full flex flex-col relative items-center justify-center">
        {/* Top Header info / Sidecar status chip */}
        <div className="absolute top-4 right-6 flex items-center space-x-3">
          {sidecarStatus === 'crashed' && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-red-950/80 border border-red-500/50 text-red-300">
              <span className="w-1.5 h-1.5 mr-1.5 rounded-full bg-red-400 animate-ping" />
              Sidecar Offline (Restarting...)
            </span>
          )}
        </div>

        {/* Mic Denied Recovery Card */}
        {micStatus === 'denied' ? (
          <div className="max-w-md mx-6 p-6 rounded-2xl bg-slate-900/90 border border-rose-500/40 shadow-2xl backdrop-blur-xl text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400">
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-slate-100">
              Microphone Access Required
            </h3>
            <p className="text-xs text-slate-400 mt-2 leading-relaxed">
              Hey Scribe needs microphone access to listen locally. No audio ever leaves your computer.
            </p>
            <button
              onClick={() => window.scribe?.openMicSettings()}
              className="mt-5 inline-flex items-center px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs transition-colors shadow-lg shadow-sky-500/20"
            >
              Open System Settings
            </button>
          </div>
        ) : (
          /* Live Stage Orb & Status */
          <div className="flex flex-col items-center justify-center space-y-8">
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

// Mount React application
const container = document.getElementById('root')
if (container) {
  const root = createRoot(container)
  root.render(<App />)
}
