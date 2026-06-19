import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { X, Activity, Trash2 } from "lucide-react";

interface ChartDataPoint {
  time: string;
  value: number;
  originalTime: number; 
}

interface MqttChartProps {
  topic: string;
  data: ChartDataPoint[];
  color?: string;
  onClose: () => void;      
  onStop: () => void;       
}

export function MqttChart({ topic, data, color = "#10b981", onClose, onStop }: MqttChartProps) {
  const lastValue = data.length > 0 ? data[data.length - 1].value : "-";    

  const formatXAxis = (tickItem: number) => {
    return new Date(tickItem).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  return (
    <div className="flex flex-col h-40 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-sm overflow-hidden shrink-0 animate-in fade-in slide-in-from-bottom-2 duration-300">
      
      {/* Cabeçalho */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2 overflow-hidden">
          <Activity size={14} className="text-emerald-500 shrink-0" />
          <span className="text-xs font-bold font-mono text-slate-600 dark:text-slate-300 truncate max-w-[200px]" title={topic}>
            {topic}
          </span>
          <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold">
            {lastValue}
          </span>
        </div>
        
        <div className="flex items-center gap-1">
          <button onClick={onStop} className="text-slate-400 hover:text-red-500 transition-colors p-1" title="Parar e Apagar">
            <Trash2 size={14} />
          </button>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors p-1" title="Ocultar Gráfico">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Área do Gráfico */}
      <div className="flex-1 w-full min-h-0 text-xs relative" style={{ minHeight: '100px' }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}> {/* USA OS DADOS REAIS SEM HACK */}
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.1} />
            
            <XAxis 
              dataKey="originalTime" 
              type="number"          
              domain={['dataMin', 'dataMax']} 
              tickFormatter={formatXAxis}     
              tick={{ fontSize: 9, fill: '#64748b' }} 
              tickLine={false}
              axisLine={false}
              minTickGap={30} 
              height={20}
            />
            
            <YAxis 
              domain={['auto', 'auto']}
              padding={{ top: 20, bottom: 20 }} 
              tick={{ fontSize: 9, fill: '#64748b' }} 
              tickLine={false}
              axisLine={false}
              width={30}
            />
            
            <Tooltip 
              labelFormatter={(label) => formatXAxis(label)}
              contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#f1f5f9', fontSize: '11px', borderRadius: '4px', padding: '4px' }}
              itemStyle={{ color: color, padding: 0 }}
              labelStyle={{ color: '#94a3b8', marginBottom: '2px' }}
            />
            
            <Line 
                type="linear"
                dataKey="value" 
                stroke={color} 
                strokeWidth={2} 
                dot={{ r: 3, fill: color, strokeWidth: 0 }} 
                activeDot={{ r: 5, strokeWidth: 0 }}
                isAnimationActive={false} 
                connectNulls={true}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}