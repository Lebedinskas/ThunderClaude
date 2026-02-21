import { useState, useEffect, useCallback } from "react";
import { type AnalyticsSummary, type DailySummary, loadAnalytics } from "../../lib/cost-tracker";

interface CostPanelProps {
  onClose: () => void;
}

type TimeRange = "today" | "week" | "month" | "allTime";

const RANGE_LABELS: Record<TimeRange, string> = {
  today: "Today",
  week: "7 Days",
  month: "30 Days",
  allTime: "All Time",
};

export function CostPanel({ onClose }: CostPanelProps) {
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [range, setRange] = useState<TimeRange>("today");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setData(await loadAnalytics());
    } catch {
      // File doesn't exist yet — empty state
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const summary: DailySummary | null = data ? data[range] : null;

  return (
    <div className="h-full flex flex-col bg-zinc-900">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-zinc-800/80">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-amber-500/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <span className="text-[13px] font-medium text-zinc-300">Cost Analytics</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={refresh}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-600 hover:text-zinc-400 transition-colors"
            title="Refresh"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Time range tabs */}
      <div className="flex gap-0.5 px-3 pt-2 pb-1">
        {(Object.keys(RANGE_LABELS) as TimeRange[]).map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
              range === r
                ? "bg-amber-600/15 text-amber-400 border border-amber-600/25"
                : "text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800 border border-transparent"
            }`}
          >
            {RANGE_LABELS[r]}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {loading ? (
          <div className="text-center text-zinc-600 text-[12px] py-8">Loading...</div>
        ) : !summary || summary.queryCount === 0 ? (
          <div className="text-center text-zinc-600 text-[12px] py-8">
            <div className="mb-1">No data yet</div>
            <div className="text-zinc-700">Cost tracking starts automatically with your next query.</div>
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-2">
              <StatCard label="Total Cost" value={`$${summary.totalCost.toFixed(4)}`} accent="amber" />
              <StatCard label="Queries" value={summary.queryCount.toString()} accent="blue" />
              <StatCard
                label="Tokens In"
                value={formatTokens(summary.totalTokensIn)}
                accent="emerald"
              />
              <StatCard
                label="Tokens Out"
                value={formatTokens(summary.totalTokensOut)}
                accent="purple"
              />
            </div>

            {/* Mode breakdown */}
            <Section title="By Mode">
              {(["direct", "commander", "researcher"] as const).map((mode) => {
                const s = summary.byMode[mode];
                if (!s || s.count === 0) return null;
                return (
                  <div key={mode} className="flex items-center justify-between py-1">
                    <div className="flex items-center gap-2">
                      <ModeIcon mode={mode} />
                      <span className="text-[11px] text-zinc-400 capitalize">{mode}</span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] font-mono">
                      <span className="text-zinc-500">{s.count}x</span>
                      {s.cost > 0 && <span className="text-amber-400/70">${s.cost.toFixed(4)}</span>}
                    </div>
                  </div>
                );
              })}
            </Section>

            {/* Model breakdown */}
            <Section title="By Model">
              {Object.entries(summary.byModel)
                .sort(([, a], [, b]) => b.count - a.count)
                .map(([model, s]) => (
                  <div key={model} className="flex items-center justify-between py-1">
                    <span className="text-[11px] text-zinc-400 truncate max-w-[120px]" title={model}>
                      {model.replace(/^(claude-|gemini-)/, "")}
                    </span>
                    <div className="flex items-center gap-3 text-[11px] font-mono">
                      <span className="text-zinc-500">{s.count}x</span>
                      {s.cost > 0 && <span className="text-amber-400/70">${s.cost.toFixed(4)}</span>}
                      <span className="text-zinc-600">{formatTokens(s.tokensIn + s.tokensOut)}</span>
                    </div>
                  </div>
                ))}
            </Section>

            {/* Recent activity sparkline (last 10 queries) */}
            {data && data.entries.length > 1 && (
              <Section title="Recent Queries">
                <div className="flex items-end gap-px h-8 mt-1">
                  {data.entries.slice(-20).map((e, i) => {
                    const maxCost = Math.max(...data.entries.slice(-20).map((x) => x.cost || 0.001));
                    const height = Math.max(4, ((e.cost || 0.001) / maxCost) * 32);
                    return (
                      <div
                        key={i}
                        className="flex-1 rounded-t bg-amber-500/30 hover:bg-amber-500/50 transition-colors"
                        style={{ height: `${height}px` }}
                        title={`${e.model}: $${e.cost.toFixed(4)} (${e.mode})`}
                      />
                    );
                  })}
                </div>
                <div className="flex justify-between text-[9px] text-zinc-700 mt-0.5">
                  <span>older</span>
                  <span>recent</span>
                </div>
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  const colors: Record<string, string> = {
    amber: "text-amber-400 bg-amber-600/10 border-amber-600/15",
    blue: "text-blue-400 bg-blue-600/10 border-blue-600/15",
    emerald: "text-emerald-400 bg-emerald-600/10 border-emerald-600/15",
    purple: "text-purple-400 bg-purple-600/10 border-purple-600/15",
  };
  return (
    <div className={`rounded-lg border p-2 ${colors[accent] || colors.amber}`}>
      <div className="text-[10px] text-zinc-500 mb-0.5">{label}</div>
      <div className="text-[14px] font-mono font-medium">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-medium text-zinc-600 uppercase tracking-wider mb-1">{title}</div>
      <div className="rounded-lg border border-zinc-800/80 bg-zinc-850 px-2.5 py-1.5 divide-y divide-zinc-800/50">
        {children}
      </div>
    </div>
  );
}

function ModeIcon({ mode }: { mode: string }) {
  if (mode === "commander") {
    return (
      <svg className="w-3 h-3 text-purple-500/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    );
  }
  if (mode === "researcher") {
    return (
      <svg className="w-3 h-3 text-teal-500/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    );
  }
  return (
    <svg className="w-3 h-3 text-zinc-500/60" fill="currentColor" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

function formatTokens(n: number): string {
  if (n === 0) return "0";
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}
