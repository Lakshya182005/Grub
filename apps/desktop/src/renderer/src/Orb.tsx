import React from 'react'

export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking'

interface OrbProps {
  state: OrbState
  rms: number // 0.0 to 1.0
}

export const Orb: React.FC<OrbProps> = ({ state, rms }) => {
  // Normalize and smooth RMS for 24 radial bars
  const barsCount = 24
  const clampedRms = Math.min(1.0, Math.max(0.0, rms))

  return (
    <div className="relative flex items-center justify-center w-72 h-72 select-none">
      {/* Outer ambient glow */}
      <div
        className={`absolute inset-0 rounded-full blur-3xl transition-all duration-700 pointer-events-none ${
          state === 'listening'
            ? 'bg-sky-500/20 scale-110'
            : state === 'thinking'
              ? 'bg-violet-500/20 scale-105'
              : state === 'speaking'
                ? 'bg-emerald-500/25 scale-125'
                : 'bg-indigo-500/10 scale-95'
        }`}
      />

      {/* 24 Radial Bars for listening state */}
      {state === 'listening' && (
        <div className="absolute inset-0 flex items-center justify-center">
          {Array.from({ length: barsCount }).map((_, i) => {
            const angle = (i * 360) / barsCount
            // Add subtle variation to individual bar response based on index
            const variation = 0.5 + 0.5 * Math.sin((i * Math.PI) / 6)
            const dynamicScale = Math.max(0.15, clampedRms * 2.8 * variation)
            const barHeight = Math.min(38, Math.max(8, dynamicScale * 40))

            return (
              <div
                key={i}
                className="absolute w-1 rounded-full transition-all duration-75 origin-bottom"
                style={{
                  transform: `rotate(${angle}deg) translateY(-85px)`,
                  height: `${barHeight}px`,
                  background: `linear-gradient(to top, rgba(56, 189, 248, 0.4), rgba(56, 189, 248, 0.95))`
                }}
              />
            )
          })}
        </div>
      )}

      {/* Concentric Ring 3 (Outer boundary) */}
      <div
        className={`absolute rounded-full border transition-all duration-500 ${
          state === 'idle'
            ? 'w-56 h-56 border-slate-700/40 animate-orb-idle'
            : state === 'listening'
              ? 'w-52 h-52 border-sky-400/50 scale-100'
              : state === 'thinking'
                ? 'w-56 h-56 border-violet-400/40 animate-orb-thinking'
                : 'w-60 h-60 border-emerald-400/80 shadow-[0_0_25px_rgba(52,211,153,0.5)]'
        }`}
      />

      {/* Concentric Ring 2 (Middle shell) */}
      <div
        className={`absolute rounded-full border transition-all duration-500 ${
          state === 'idle'
            ? 'w-44 h-44 border-slate-600/30 animate-orb-idle'
            : state === 'listening'
              ? 'w-40 h-40 border-sky-300/60 shadow-[0_0_20px_rgba(56,189,248,0.35)]'
              : state === 'thinking'
                ? 'w-44 h-44 border-violet-400/60 animate-orb-thinking'
                : 'w-48 h-48 border-emerald-300/70 shadow-[0_0_35px_rgba(52,211,153,0.6)]'
        }`}
      />

      {/* Concentric Ring 1 (Inner ring) */}
      <div
        className={`absolute rounded-full transition-all duration-300 ${
          state === 'idle'
            ? 'w-32 h-32 border border-slate-500/20'
            : state === 'listening'
              ? 'w-28 h-28 border border-sky-400/70'
              : state === 'thinking'
                ? 'w-32 h-32 border border-violet-300/50'
                : 'w-36 h-36 border-2 border-emerald-200/90'
        }`}
      />

      {/* Center Core with Radial Gradient */}
      <div
        className={`relative rounded-full transition-all duration-500 flex items-center justify-center ${
          state === 'idle'
            ? 'w-24 h-24 bg-gradient-to-tr from-slate-900 via-slate-800 to-indigo-950/80 shadow-inner animate-orb-idle'
            : state === 'listening'
              ? 'w-22 h-22 bg-gradient-to-tr from-sky-950 via-sky-700 to-cyan-400 shadow-[0_0_25px_rgba(56,189,248,0.6)]'
              : state === 'thinking'
                ? 'w-24 h-24 bg-gradient-to-tr from-violet-950 via-purple-700 to-fuchsia-400 shadow-[0_0_30px_rgba(168,85,247,0.5)] animate-orb-thinking'
                : 'w-28 h-28 bg-gradient-to-tr from-emerald-950 via-emerald-600 to-teal-300 shadow-[0_0_40px_rgba(52,211,153,0.8)]'
        }`}
      >
        {/* Subtle center specular dot */}
        <div
          className={`w-3 h-3 rounded-full blur-[1px] transition-opacity duration-300 ${
            state === 'idle'
              ? 'bg-slate-400/40'
              : state === 'listening'
                ? 'bg-sky-200 opacity-90'
                : state === 'thinking'
                  ? 'bg-violet-200 opacity-80'
                  : 'bg-emerald-100 opacity-100'
          }`}
        />
      </div>
    </div>
  )
}
