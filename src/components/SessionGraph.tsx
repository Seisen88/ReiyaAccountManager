import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, BarChart, Bar,
} from "recharts";
import { useState } from "react";

/* ── Placeholder data — replace with real data from Tauri backend later ── */
const WEEK_DATA = [
  { day: "Mon", sessions: 8,  hours: 5.2 },
  { day: "Tue", sessions: 12, hours: 8.1 },
  { day: "Wed", sessions: 5,  hours: 3.4 },
  { day: "Thu", sessions: 18, hours: 11.6 },
  { day: "Fri", sessions: 22, hours: 14.2 },
  { day: "Sat", sessions: 30, hours: 18.9 },
  { day: "Sun", sessions: 15, hours: 9.5 },
];

const MONTH_DATA = Array.from({ length: 30 }, (_, i) => ({
  day: `${i + 1}`,
  sessions: Math.floor(Math.random() * 25 + 2),
  hours: parseFloat((Math.random() * 16 + 1).toFixed(1)),
}));

type View = "week" | "month";
type Metric = "sessions" | "hours";

/* ── Custom tooltip ── */
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "var(--surface-3)",
      border: "1px solid var(--border-mid)",
      borderRadius: 10,
      padding: "10px 14px",
      fontSize: 11,
      boxShadow: "0 8px 24px rgba(0,0,0,.5)",
    }}>
      <p style={{ color: "var(--t2)", marginBottom: 4, fontWeight: 600 }}>{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: "var(--t1)", fontWeight: 700, fontSize: 13 }}>
          {p.value} {p.dataKey === "hours" ? "h" : "sessions"}
        </p>
      ))}
    </div>
  );
}

export default function SessionGraph() {
  const [view, setView]     = useState<View>("week");
  const [metric, setMetric] = useState<Metric>("sessions");

  const data = view === "week" ? WEEK_DATA : MONTH_DATA;
  const total = data.reduce((s, d) => s + (metric === "sessions" ? d.sessions : d.hours), 0);
  const peak  = Math.max(...data.map(d => metric === "sessions" ? d.sessions : d.hours));

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Header row */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <div className="section-title" style={{ marginBottom: 4 }}>
            <span className="section-dot" style={{ background: "var(--accent-2)" }} />
            Session Activity
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 6 }}>
            <Stat label={metric === "sessions" ? "Total sessions" : "Total hours"} value={metric === "sessions" ? `${total}` : `${total.toFixed(1)}h`} />
            <Stat label="Peak day" value={metric === "sessions" ? `${peak} sess.` : `${peak}h`} />
            <Stat label="Daily avg" value={metric === "sessions"
              ? `${(total / data.length).toFixed(1)}`
              : `${(total / data.length).toFixed(1)}h`}
            />
          </div>
        </div>

        {/* Controls */}
        <div style={{ display: "flex", gap: 6, flexDirection: "column", alignItems: "flex-end" }}>
          {/* View toggle */}
          <div style={{
            display: "flex", gap: 2,
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            borderRadius: 8, padding: 2,
          }}>
            {(["week", "month"] as View[]).map(v => (
              <button key={v} onClick={() => setView(v)}
                style={{
                  padding: "4px 10px", borderRadius: 6, border: "none",
                  fontSize: 11, fontWeight: 600, cursor: "pointer",
                  background: view === v ? "var(--surface-3)" : "transparent",
                  color: view === v ? "var(--t1)" : "var(--t3)",
                  transition: "all .12s",
                }}
              >
                {v === "week" ? "7d" : "30d"}
              </button>
            ))}
          </div>
          {/* Metric toggle */}
          <div style={{
            display: "flex", gap: 2,
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            borderRadius: 8, padding: 2,
          }}>
            {(["sessions", "hours"] as Metric[]).map(m => (
              <button key={m} onClick={() => setMetric(m)}
                style={{
                  padding: "4px 10px", borderRadius: 6, border: "none",
                  fontSize: 11, fontWeight: 600, cursor: "pointer",
                  background: metric === m ? "var(--surface-3)" : "transparent",
                  color: metric === m ? "var(--t1)" : "var(--t3)",
                  transition: "all .12s",
                }}
              >
                {m === "sessions" ? "Sessions" : "Hours"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chart */}
      <div style={{ height: 160 }}>
        <ResponsiveContainer width="100%" height="100%">
          {view === "week" ? (
            <AreaChart data={data} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
              <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#E8E8E8" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="#E8E8E8" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="day" tick={{ fill: "var(--t3)", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "var(--t3)", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: "var(--border-mid)", strokeWidth: 1 }} />
              <Area
                type="monotone"
                dataKey={metric}
                stroke="#E8E8E8"
                strokeWidth={2}
                fill="url(#areaGrad)"
                dot={{ fill: "#E8E8E8", r: 3, strokeWidth: 0 }}
                activeDot={{ fill: "#fff", r: 5, strokeWidth: 0 }}
              />
            </AreaChart>
          ) : (
            <BarChart data={data} margin={{ top: 4, right: 4, left: -28, bottom: 0 }} barSize={6}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="day" tick={{ fill: "var(--t3)", fontSize: 10 }} axisLine={false} tickLine={false}
                interval={4} />
              <YAxis tick={{ fill: "var(--t3)", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,.04)" }} />
              <Bar dataKey={metric} fill="#E8E8E8" radius={[3, 3, 0, 0]} opacity={0.85} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>

    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 800, color: "var(--t1)", letterSpacing: "-0.5px" }}>{value}</div>
      <div style={{ fontSize: 10, color: "var(--t3)", marginTop: 1 }}>{label}</div>
    </div>
  );
}
