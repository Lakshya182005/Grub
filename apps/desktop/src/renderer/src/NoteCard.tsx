import React from 'react'

export interface NoteItem {
  id: string
  title: string
  body: string
  path: string
  timestamp: string
  isNew?: boolean
}

interface NoteCardProps {
  note: NoteItem
  onReveal: (path: string) => void
}

export const NoteCard: React.FC<NoteCardProps> = ({ note, onReveal }) => {
  // Extract first body bullet
  const lines = note.body
    .split('\n')
    .map((l) => l.replace(/^[-*]\s*/, '').trim())
    .filter((l) => l.length > 0)

  const firstBullet = lines[0] || ''

  return (
    <div
      onClick={() => onReveal(note.path)}
      title="Click to reveal note in Finder"
      className={`group relative p-3.5 mb-2.5 rounded-lg bg-[#121620] hover:bg-[#181E2C] border border-[#1C2230] cursor-pointer transition-colors duration-150 select-none ${
        note.isNew ? 'animate-card-spring animate-card-glow' : ''
      }`}
    >
      {/* Header: 15px Semibold Title + 13px Right-Aligned Time */}
      <div className="flex items-start justify-between gap-3 mb-1">
        <h4 className="text-[15px] font-semibold text-[#E6E9F2] group-hover:text-white transition-colors leading-snug line-clamp-2">
          {note.title}
        </h4>
        <span className="text-[13px] text-[#8A93A6] shrink-0 font-normal pt-0.5">
          {note.timestamp}
        </span>
      </div>

      {/* First Body Bullet clamped to 2 lines */}
      {firstBullet && (
        <p className="text-[13px] text-[#8A93A6] line-clamp-2 leading-relaxed">
          {firstBullet}
        </p>
      )}
    </div>
  )
}
