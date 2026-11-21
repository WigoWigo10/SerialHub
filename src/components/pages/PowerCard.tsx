import { Battery, BatteryCharging, Plug } from "lucide-react";
import type { LanguageKey } from "../../i18n/translations";

export type PowerStatus = {
  ac_online: boolean | null;
  battery_present: boolean | null;
  charging: boolean | null;
  percent: number | null;
  remaining_seconds: number | null;
  battery_saver: boolean | null;
};

function formatRemaining(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  if (minutes === 0) return "< 1 min";
  const hours = Math.floor(minutes / 60);
  return hours === 0 ? `${minutes} min` : `${hours} h ${minutes % 60} min`;
}

export function PowerCard({
  status, t,
}: {
  status: PowerStatus | null | undefined;
  t: (key: LanguageKey) => string;
}) {
  const hasBattery = status?.battery_present === true;
  const percent = status?.percent ?? null;
  const charging = status?.charging === true;
  const title = t(hasBattery ? "dash_battery" : "dash_power");
  const source = status?.ac_online === true
    ? "dash_ac_power"
    : status?.ac_online === false && hasBattery
      ? "dash_battery" : "dash_power_unavailable";
  let state: LanguageKey = "dash_power_unavailable";
  if (status?.battery_present === false) state = "dash_no_battery";
  if (hasBattery) {
    if (charging) state = "dash_charging";
    else if (status?.ac_online === false) state = "dash_discharging";
    else if (status?.charging === false && status.ac_online === true) {
      state = percent === 100 ? "dash_battery_full" : "dash_battery_paused";
    }
  }

  let fill = "bg-emerald-500";
  if (!charging && percent !== null) {
    if (percent < 20) fill = "bg-rose-500";
    else if (percent < 50) fill = "bg-amber-500";
  }
  const Icon = hasBattery ? (charging ? BatteryCharging : Battery) : Plug;
  const remaining = status?.remaining_seconds ?? null;
  const saver = status?.battery_saver ?? null;

  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="shrink-0 rounded-lg bg-emerald-500/10 p-2.5 text-emerald-700 dark:text-emerald-400">
            <Icon size={20} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">{title}</h3>
            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">{t(state)}</p>
          </div>
        </div>
        {percent !== null && <span className="font-mono text-2xl font-bold tabular-nums">{percent}%</span>}
      </div>
      {percent !== null && (
        <div
          className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
          role="meter"
          aria-label={t("dash_battery_level")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div className={`h-full rounded-full ${fill}`} style={{ width: `${percent}%` }} />
        </div>
      )}
      {status && <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-3 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
        <div>
          <dt className="text-slate-600 dark:text-slate-400">{t("dash_power_source")}</dt>
          <dd className="mt-1 font-semibold">{t(source)}</dd>
        </div>
        {saver !== null && (
          <div>
            <dt className="text-slate-600 dark:text-slate-400">{t("dash_battery_saver")}</dt>
            <dd className="mt-1 font-semibold">{t(saver ? "dash_power_on" : "dash_power_off")}</dd>
          </div>
        )}
        {remaining !== null && (
          <div>
            <dt className="text-slate-600 dark:text-slate-400">{t("dash_battery_remaining")}</dt>
            <dd className="mt-1 font-mono font-semibold tabular-nums">{formatRemaining(remaining)}</dd>
          </div>
        )}
      </dl>}
    </div>
  );
}
