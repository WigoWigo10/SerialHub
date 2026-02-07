import { useState, useMemo, useEffect } from "react";
import { ChevronRight, ChevronDown, Folder, FileText, Zap, Copy, Hash, AlignLeft, Braces, LineChart, Binary } from "lucide-react";
import toast from "react-hot-toast";
import { useLanguage } from "../../hooks/useLanguage";

interface TreeNode {
  name: string;
  fullName: string;
  value?: string;
  originalValue?: string;
  timestamp?: string;
  isJson?: boolean;
  isVirtual?: boolean;
  children: Record<string, TreeNode>;
}

interface TopicTreeProps {
  messages: Array<{ topic: string; payload: string; timestamp: string }>;
  onToggleChart?: (topic: string) => void;
  recordedTopics?: string[];
  viewMode: 'ASCII' | 'HEX';
}

const toHexDisplay = (str?: string) => {
  if (!str) return "";
  let hex = "";
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i).toString(16).toUpperCase().padStart(2, '0');
    hex += code + " ";
  }
  return hex.trim();
};

const buildTree = (messages: TopicTreeProps['messages']) => {
  const root: TreeNode = { name: "root", fullName: "", children: {} };

  messages.forEach((msg) => {
    const parts = msg.topic.split("/");
    let current = root;
    let pathSoFar = "";

    parts.forEach((part, index) => {
      pathSoFar += (pathSoFar ? "/" : "") + part;
      
      if (!current.children[part]) {
        current.children[part] = { name: part, fullName: pathSoFar, children: {} };
      }
      current = current.children[part];

      if (index === parts.length - 1) {
        current.timestamp = msg.timestamp;
        current.originalValue = msg.payload;

        const realChildren: Record<string, TreeNode> = {};
        Object.entries(current.children).forEach(([key, child]) => {
            if (!child.isVirtual) realChildren[key] = child;
        });
        current.children = realChildren;
        
        try {
          const json = JSON.parse(msg.payload);
          if (typeof json === 'object' && json !== null) {
            current.value = "{ JSON }"; 
            current.isJson = true;
            processJsonToTree(current, json);
          } else {
            current.value = msg.payload;
            current.isJson = false;
          }
        } catch {
          current.value = msg.payload;
          current.isJson = false;
        }
      }
    });
  });

  return root;
};

const processJsonToTree = (node: TreeNode, jsonObj: any) => {
  Object.keys(jsonObj).forEach(key => {
    const val = jsonObj[key];
    const childName = key;
    
    if (!node.children[childName]) {
      node.children[childName] = { 
        name: childName, 
        fullName: `${node.fullName}.${childName}`, 
        children: {},
        isJson: true,
        isVirtual: true
      };
    }
    
    const childNode = node.children[childName];
    
    if (typeof val === 'object' && val !== null) {
      childNode.value = "{...}";
      childNode.originalValue = JSON.stringify(val);
      processJsonToTree(childNode, val);
    } else {
      childNode.value = String(val);
      childNode.originalValue = String(val);
    }
  });
};

const TreeNodeItem = ({ node, depth, onToggleChart, recordedTopics = [], viewMode }: { 
  node: TreeNode; 
  depth: number; 
  onToggleChart?: (t: string) => void;
  recordedTopics?: string[];
  viewMode: 'ASCII' | 'HEX';
}) => {
  const { t } = useLanguage();
  const [isOpen, setIsOpen] = useState(depth < 2);
  const [flash, setFlash] = useState(false);
  const hasChildren = Object.keys(node.children).length > 0;
  
  useEffect(() => {
    if (node.value) {
      setFlash(true);
      const timer = setTimeout(() => setFlash(false), 500);
      return () => clearTimeout(timer);
    }
  }, [node.value, node.timestamp]);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    const textToCopy = viewMode === 'HEX' ? toHexDisplay(node.originalValue) : (node.originalValue || "");
    if(textToCopy) {
      navigator.clipboard.writeText(textToCopy);
      toast.success(t('mqtt_toast_copied_short'), { duration: 1000, position: "bottom-center", icon: '📋' });
    }
  };

  const handleChart = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onToggleChart) onToggleChart(node.fullName);
  };

  const isNumber = node.value && !isNaN(Number(node.value)) && !node.isJson;
  const showChartIcon = (isNumber || recordedTopics.includes(node.fullName)) && viewMode === 'ASCII';
  const isActive = recordedTopics.includes(node.fullName);

  let displayValue = node.value;
  let valueColorClass = "text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800";

  if (viewMode === 'HEX') {
    if (node.originalValue) {
      displayValue = toHexDisplay(node.originalValue);
      valueColorClass = "text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 font-mono tracking-widest text-[10px]";
    } else {
      displayValue = "{...}";
      valueColorClass = "text-slate-400 italic";
    }
  } else {
    if (node.isJson) {
      valueColorClass = "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 italic";
    } else if (isNumber) {
      valueColorClass = "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 font-bold";
    }
  }

  return (
    <div className="select-none font-mono text-sm">
      <div 
        className={`
          group flex items-center gap-1 py-1 px-2 cursor-pointer transition-all duration-200 border-b border-transparent
          ${depth === 0 ? 'ml-0' : 'ml-4'}
          ${flash 
            ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-900 dark:text-emerald-100" 
            : "hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
          }
        `}
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="w-5 h-5 flex items-center justify-center text-slate-400 shrink-0">
          {hasChildren ? (
            isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />
          ) : <span className="w-4" />}
        </div>

        <div className={`mr-1 shrink-0 ${viewMode === 'HEX' ? "text-purple-500" : (node.isJson ? "text-amber-500" : (hasChildren ? "text-blue-500" : (isNumber ? "text-emerald-500" : "text-slate-500")))}`}>
          {viewMode === 'HEX' ? <Binary size={14}/> : (node.isJson ? <Braces size={14} /> : (hasChildren ? <Folder size={14} /> : (isNumber ? <Hash size={14} /> : <AlignLeft size={14}/>)))}
        </div>

        <span className="font-semibold truncate max-w-[140px] md:max-w-[250px]" title={node.name}>
          {node.name}
        </span>

        {displayValue && (
          <div className="ml-auto flex items-center gap-2 min-w-0 pl-4 justify-end flex-1">
            {!node.isJson && node.timestamp && (
              <span className="text-[10px] text-slate-400 font-normal opacity-70 shrink-0">
                {node.timestamp.split(' ')[0]} 
              </span>
            )}
            
            <span 
                className={`truncate max-w-[150px] md:max-w-[400px] lg:max-w-[800px] px-1.5 py-0.5 rounded ${valueColorClass}`} 
                title={viewMode === 'HEX' ? t('mqtt_tt_hex_val') : (node.originalValue || node.value)}
            >
              {displayValue}
            </span>

            <div className="flex gap-1 shrink-0">
                {showChartIcon && (
                <button 
                    onClick={handleChart}
                    className={`p-1 transition-opacity ${isActive ? "text-emerald-600 opacity-100 hover:text-red-500" : "text-slate-400 hover:text-emerald-500 opacity-0 group-hover:opacity-100"}`}
                    title={isActive ? t('mqtt_tt_hide_chart') : t('mqtt_tt_show_chart')}
                >
                    <LineChart size={14} strokeWidth={isActive ? 2.5 : 2} />
                </button>
                )}

                <button onClick={handleCopy} className="p-1 text-slate-400 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" title={t('mqtt_tt_copy')}>
                <Copy size={12} />
                </button>
            </div>
          </div>
        )}
      </div>

      {isOpen && hasChildren && (
        <div className="border-l border-slate-200 dark:border-slate-800 ml-2.5">
          {Object.values(node.children).sort((a,b) => a.name.localeCompare(b.name)).map((child) => (
            <TreeNodeItem 
              key={child.fullName} 
              node={child} 
              depth={depth + 1} 
              onToggleChart={onToggleChart} 
              recordedTopics={recordedTopics} 
              viewMode={viewMode}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export function TopicTree({ messages, onToggleChart, recordedTopics = [], viewMode }: TopicTreeProps) {
  const tree = useMemo(() => buildTree(messages), [messages]);
  const hasData = Object.keys(tree.children).length > 0;
  
  // 1. Inicializa o hook de tradução
  const { t } = useLanguage(); 

  if (!hasData) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400 opacity-50 select-none">
        <Folder size={48} strokeWidth={1} />
        {/* 2. Aplica a tradução aqui */}
        <p className="mt-2 text-sm font-medium">{t('mqtt_waiting_data')}</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto pr-1 pb-10 group">
      {Object.values(tree.children)
        .sort((a, b) => a.name.localeCompare(b.name)) 
        .map((child) => (
          <TreeNodeItem 
            key={child.fullName} 
            node={child} 
            depth={0} 
            onToggleChart={onToggleChart} 
            recordedTopics={recordedTopics}
            viewMode={viewMode}
          />
      ))}
    </div>
  );
}