import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useLanguage } from "../../hooks/useLanguage";
import { SerialAnalyzerBuffer } from "../../lib/serialAnalyzer";
import { listenSafely } from "../../lib/serialPresentation";

export function SerialAnalyzer() {
  const { t } = useLanguage();
  const buffer = useRef<SerialAnalyzerBuffer>();
  const [snapshot, setSnapshot] = useState<ReturnType<SerialAnalyzerBuffer["snapshot"]>>();
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const current = new SerialAnalyzerBuffer();
    buffer.current = current;
    let dirty = false;
    const stop = listenSafely<{ payload: number[] }>(
      callback => listen<number[]>("serial-data", callback),
      event => { current.receive(new Uint8Array(event.payload)); dirty = true; },
      cause => { if (buffer.current === current) setError(String(cause)); },
    );
    const timer = setInterval(() => {
      if (dirty) {
        dirty = false;
        setSnapshot(current.snapshot());
      }
    }, 200);
    return () => { buffer.current = undefined; clearInterval(timer); stop(); };
  }, []);

  const samples = snapshot?.samples ?? [];
  const names = new Set<string>();
  for (let i = samples.length - 1; i >= 0 && names.size < 64; i--) {
    for (const name of samples[i].fields.keys()) {
      names.add(name);
      if (names.size === 64) break;
    }
  }
  const fields = [...names];
  const field = fields.includes(selected) ? selected : fields[0];
  const data = samples.map(sample => ({ line: sample.line, value: field ? sample.fields.get(field) ?? null : null }));
  return (
    <section aria-label={t("serial_analyzer")} className="shrink-0 border-t border-slate-200 dark:border-slate-800 px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <label className="flex items-center gap-2">
          {t("analyzer_field")}
          <select className="max-w-60 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1"
            value={field ?? ""} disabled={!field} onChange={event => setSelected(event.target.value)}>
            {!field && <option value="">—</option>}
            {fields.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <span className="text-slate-600 dark:text-slate-400">{t("analyzer_samples")} {samples.length}
          {!!snapshot?.overlong && ` · ${t("analyzer_overlong")} ${snapshot.overlong}`}
        </span>
      </div>
      {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      {field ? (
        <div className="h-40 min-w-0 pt-2" role="img" aria-label={`${t("serial_analyzer")} · ${field}`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <XAxis dataKey="line" type="number" domain={["dataMin", "dataMax"]} tick={{ fontSize: 11 }} />
              <YAxis width={58} tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
              <Tooltip labelFormatter={line => `${t("analyzer_line")} ${line}`} />
              <Line dataKey="value" name={field} stroke="#3b82f6" isAnimationActive={false} dot={data.length < 35} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : <p className="py-2 text-xs text-slate-600 dark:text-slate-400">{t("analyzer_waiting")}</p>}
    </section>
  );
}
