import React from 'react'

export interface NoteItem {
  id: string
  title: string
  body: string
  path: string
  timestamp: string
}

interface NoteCardProps {
  note: NoteItem
  onReveal: (path: string) => void
}

export const NoteCard: React.FC<NoteCardProps> = ({ note, onReveal }) => {
  // Parse body into bullet lines
  const bullets = note.body
    .split('\n')
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter((line) => line.length > 0)

  return (
    <div
      onClick={() => onReveal(note.path)}
      className="group relative p-4 mb-3 rounded-xl bg-slate-900/70 hover:bg-slate-800/90 border border-slate-800/80 hover:border-sky-500/50 shadow-lg hover:shadow-sky-500/10 cursor-pointer transition-all duration-300 transform hover:-translate-y-0.5 active:translate-y-0 select-none animate-in fade-in slide-in-from-top-4"
    >
      {/* Header: Title + Timestamp */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <h4 className="text-sm font-semibold text-slate-100 group-hover:text-sky-300 transition-colors leading-snug">
          {note.title}
        </h4>
        <span className="text-[10px] text-slate-500 font-mono shrink-0">
          {note.timestamp}
        </span>
      </div>

      {/* Bullets */}
      <ul className="space-y-1 my-2">
        {bullets.map((bullet, idx) => (
          <li key={idx} className="flex items-start text-xs text-slate-300 leading-relaxed">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-400/60 mt-1.5 mr-2 shrink-0 group-hover:bg-sky-400 transition-colors" />
            <span>{bullet}</span>
          </li>
        ))}
      </ul>

      {/* Footer hint */}
      <div className="mt-2.5 pt-2 border-t border-slate-800/50 flex items-center justify-between text-[10px] text-slate-500 group-hover:text-slate-400 transition-colors">
        <span className="truncate max-w-[200px] font-mono opacity-60">
          {note.path.split('/').pop()}
        </span>
        <span className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center text-sky-400 font-medium">
          Open in Finder &rarr;
        </span>
      </div>
    </div>
  )
}
