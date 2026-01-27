interface LedProps {
  active: boolean;
  color: "red" | "green" | "yellow" | "blue";
  label?: string;
  onClick?: () => void; // Para funcionar como botão (DTR/RTS)
  interactive?: boolean;
}

export function LedIndicator({ active, color, label, onClick, interactive }: LedProps) {
  // Mapas de cores para "Aceso" (Brilho intenso) e "Apagado" (Escuro)
  const colors = {
    red:    active ? "bg-red-500 shadow-[0_0_8px_2px_rgba(239,68,68,0.6)]" : "bg-red-900/40 border-red-900",
    green:  active ? "bg-green-500 shadow-[0_0_8px_2px_rgba(34,197,94,0.6)]" : "bg-green-900/40 border-green-900",
    yellow: active ? "bg-yellow-400 shadow-[0_0_8px_2px_rgba(250,204,21,0.6)]" : "bg-yellow-900/40 border-yellow-900",
    blue:   active ? "bg-blue-500 shadow-[0_0_8px_2px_rgba(59,130,246,0.6)]" : "bg-blue-900/40 border-blue-900",
  };

  return (
    <div 
      className={`flex flex-col items-center gap-1 ${interactive ? 'cursor-pointer group' : ''}`}
      onClick={onClick}
    >
      <div className={`
        w-3 h-3 rounded-full border border-opacity-50 transition-all duration-100
        ${colors[color]}
        ${interactive ? 'group-hover:opacity-80' : ''}
      `} />
      {label && <span className={`text-[10px] font-bold ${active ? 'text-slate-200' : 'text-slate-600'}`}>{label}</span>}
    </div>
  );
}