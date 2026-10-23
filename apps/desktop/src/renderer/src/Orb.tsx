import React, { useEffect, useRef, useState } from 'react'

export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking'

interface OrbProps {
  state: OrbState
  rms: number // 0.0 to 1.0 from microphone
}

export const Orb: React.FC<OrbProps> = ({ state, rms }) => {
  const [smoothedRms, setSmoothedRms] = useState<number>(0)
  const rmsRef = useRef<number>(rms)
  const smoothedRef = useRef<number>(0)
  const lastTimeRef = useRef<number>(performance.now())

  rmsRef.current = rms

  // Smooth RMS with 120 ms exponential decay
  useEffect(() => {
    let animId: number

    const tick = (now: number): void => {
      const dt = Math.max(1, Math.min(100, now - lastTimeRef.current))
      lastTimeRef.current = now

      const target = rmsRef.current
      const prev = smoothedRef.current

      // 120 ms half-life / decay constant
      const decay = Math.exp(-dt / 120)

      if (target >= prev) {
        // Fast attack
        smoothedRef.current = target
      } else {
        // 120 ms decay
        smoothedRef.current = prev * decay + target * (1 - decay)
      }

      setSmoothedRms(smoothedRef.current)
      animId = requestAnimationFrame(tick)
    }

    lastTimeRef.current = performance.now()
    animId = requestAnimationFrame(tick)

    return (): void => cancelAnimationFrame(animId)
  }, [])

  const barsCount = 24

  return (
    <div
      className={`relative w-[220px] h-[220px] flex items-center justify-center select-none transition-all duration-200 ease-out ${
        state !== 'idle'
          ? 'drop-shadow-[0_0_28px_rgba(124,140,248,0.3)]'
          : ''
      }`}
    >
      {/* Concentric Ring 3 (Outermost: 220 px) */}
      <div
        className={`absolute inset-0 w-[220px] h-[220px] rounded-full border transition-all duration-200 ease-out ${
          state === 'idle'
            ? 'border-[#7C8CF8]/15'
            : state === 'listening'
              ? 'border-[#7C8CF8]/40'
              : state === 'thinking'
                ? 'border-[#7C8CF8]/35'
                : 'border-[#7C8CF8]/85 border-dashed animate-spin-slow'
        }`}
      />

      {/* Concentric Ring 2 (Middle: 160 px) */}
      <div
        className={`absolute w-[160px] h-[160px] rounded-full border transition-all duration-200 ease-out ${
          state === 'idle'
            ? 'border-[#7C8CF8]/25'
            : state === 'listening'
              ? 'border-[#7C8CF8]/50'
              : state === 'thinking'
                ? 'border-[#7C8CF8]/45'
                : 'border-[#34D399]/60'
        }`}
      />

      {/* Concentric Ring 1 (Inner: 105 px) */}
      <div
        className={`absolute w-[105px] h-[105px] rounded-full border transition-all duration-200 ease-out ${
          state === 'idle'
            ? 'border-[#7C8CF8]/40'
            : state === 'listening'
              ? 'border-[#7C8CF8]/70 shadow-[0_0_18px_rgba(124,140,248,0.3)]'
              : state === 'thinking'
                ? 'border-[#7C8CF8]/65'
                : 'border-[#34D399]/75'
        }`}
        style={
          state === 'idle' && smoothedRms > 0.012
            ? {
                borderColor: `rgba(124, 140, 248, ${Math.min(0.85, 0.4 + smoothedRms * 4.0)})`,
                boxShadow: `0 0 ${Math.min(18, 4 + smoothedRms * 70)}px rgba(124, 140, 248, 0.35)`
              }
            : undefined
        }
      />

      {/* Radial Gradient Core (~76 px) */}
      <div
        className={`relative w-[76px] h-[76px] rounded-full transition-all duration-200 ease-out flex items-center justify-center ${
          state === 'idle'
            ? 'bg-[radial-gradient(circle,_#7C8CF8_0%,_#4F46E5_40%,_#1E1B4B_75%,_transparent_100%)] opacity-85 animate-orb-idle-core'
            : state === 'listening'
              ? 'bg-[radial-gradient(circle,_#7C8CF8_0%,_#6366F1_45%,_#1E1B4B_80%,_transparent_100%)] opacity-95 shadow-[0_0_24px_rgba(124,140,248,0.5)]'
              : state === 'thinking'
                ? 'bg-[radial-gradient(circle,_#A5B4FC_0%,_#7C8CF8_45%,_#312E81_85%,_transparent_100%)] animate-orb-thinking-core'
                : 'bg-[radial-gradient(circle,_#34D399_0%,_#059669_50%,_#064E3B_85%,_transparent_100%)] opacity-95'
        }`}
      />

      {/* 24 Symmetric Bars on Listening State */}
      {state === 'listening' && (
        <div className="absolute inset-0 flex items-center justify-center gap-[2px] pointer-events-none">
          {Array.from({ length: barsCount }).map((_, i) => {
            // Distance from center (0 at middle, 1 at edges)
            const distFromCenter = Math.abs(i - 11.5) / 11.5
            // Parabolic curve: highest in center, tapering toward edges
            const curve = Math.cos(distFromCenter * (Math.PI / 2.2))
            // Non-linear gain for human speech dynamics (0.01 to 0.15 RMS)
            const voiceIntensity = Math.min(1.0, Math.max(0, (smoothedRms - 0.003) * 7.5))
            const nonLinearGain = Math.pow(voiceIntensity, 0.72)
            const rawHeight = Math.max(5, Math.min(52, 5 + nonLinearGain * 45 * curve))

            return (
              <div
                key={i}
                className="w-[3px] rounded-full bg-[#E6E9F2] transition-[height] duration-75 ease-out"
                style={{
                  height: `${rawHeight}px`,
                  backgroundColor: '#7C8CF8'
                }}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
