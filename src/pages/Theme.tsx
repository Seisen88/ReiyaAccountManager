import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { THEMES, useTheme, type Theme } from "../context/ThemeContext";
import { useToast } from "../components/Toast";

type Tab = "dark" | "light";

export default function ThemePage() {
  const { activeTheme, setTheme } = useTheme();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>(() =>
    activeTheme.category === "light" ? "light" : "dark"
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSelect = async (theme: Theme) => {
    if (theme.id === activeTheme.id) return;
    setTheme(theme);
    setSaving(true); setSaved(false);
    try {
      await invoke("save_settings", {
        settings: { ThemeName: theme.id, AccentColor: theme.vars["--accent"] },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (e) {
      toast.error(`Failed to save theme: ${e}`);
    } finally { setSaving(false); }
  };

  const filtered = THEMES.filter(t => t.category === tab);
  const darkCount = THEMES.filter(t => t.category === "dark").length;
  const lightCount = THEMES.filter(t => t.category === "light").length;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)", overflow: "hidden" }}>

      {/* Header */}
      <div style={{
        padding: "20px 28px 0",
        borderBottom: "1px solid var(--g05)",
        flexShrink: 0,
        background: `linear-gradient(135deg, ${activeTheme.vars["--accent"]}08 0%, transparent 60%)`,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div>
            <h1 style={{ fontSize: 17, fontWeight: 900, letterSpacing: "-0.3px", color: "var(--t1)", margin: 0 }}>
              Theme
            </h1>
            <p style={{ fontSize: 11, color: "var(--t3)", marginTop: 3, margin: "3px 0 0" }}>
              Choose a visual style — changes apply instantly
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {(saving || saved) && (
              <span style={{
                fontSize: 11, fontWeight: 700,
                color: saved ? "var(--green)" : "var(--t2)",
                display: "flex", alignItems: "center", gap: 5,
                padding: "5px 12px", borderRadius: 8,
                background: saved ? "rgba(52,211,153,0.08)" : "var(--g04)",
                border: `1px solid ${saved ? "rgba(52,211,153,0.2)" : "var(--g06)"}`,
              }}>
                {saving ? "Saving..." : "✓ Saved"}
              </span>
            )}
            <div style={{
              padding: "6px 14px", borderRadius: 8,
              background: activeTheme.vars["--accent"] + "18",
              border: `1px solid ${activeTheme.vars["--accent"]}35`,
              fontSize: 11, fontWeight: 700,
              color: activeTheme.vars["--accent"],
              display: "flex", alignItems: "center", gap: 7,
            }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: activeTheme.vars["--accent"], boxShadow: `0 0 6px ${activeTheme.vars["--accent"]}` }} />
              {activeTheme.name}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 0 }}>
          {([
            { id: "dark" as Tab, label: "Dark", count: darkCount, icon: "🌙" },
            { id: "light" as Tab, label: "Light", count: lightCount, icon: "☀️" },
          ]).map(({ id, label, count, icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                style={{
                  display: "flex", alignItems: "center", gap: 7,
                  padding: "9px 18px",
                  border: "none", background: "transparent",
                  color: active ? "var(--t1)" : "var(--t3)",
                  fontSize: 12, fontWeight: active ? 700 : 500,
                  cursor: "pointer", transition: "all .15s",
                  borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
                  marginBottom: -1,
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.color = "var(--t2)"; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.color = "var(--t3)"; }}
              >
                <span style={{ fontSize: 13 }}>{icon}</span>
                {label}
                <span style={{
                  fontSize: 9, fontWeight: 800,
                  padding: "1px 6px", borderRadius: 99,
                  background: active ? "var(--accent)" + "22" : "var(--g05)",
                  color: active ? "var(--accent)" : "var(--t3)",
                  border: active ? `1px solid ${"var(--accent)"}30` : "1px solid var(--g06)",
                  transition: "all .15s",
                }}>{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Theme grid */}
      <div className="scroll" style={{ flex: 1, padding: "20px 28px 28px" }}>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 14,
        }}>
          {filtered.map(theme => (
            <ThemeCard
              key={theme.id}
              theme={theme}
              active={activeTheme.id === theme.id}
              onSelect={() => handleSelect(theme)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ThemeCard({ theme, active, onSelect }: { theme: Theme; active: boolean; onSelect: () => void }) {
  const [hovered, setHovered] = useState(false);
  const isLight = theme.category === "light";

  return (
    <button
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        all: "unset",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        borderRadius: 16,
        overflow: "hidden",
        border: active
          ? `2px solid ${theme.vars["--accent"]}`
          : hovered
            ? `2px solid ${theme.vars["--accent"]}50`
            : `2px solid ${isLight ? "rgba(0,0,0,0.10)" : "var(--g07)"}`,
        boxShadow: active
          ? `0 0 0 3px ${theme.vars["--accent"]}18, 0 8px 32px rgba(0,0,0,0.4)`
          : hovered
            ? "0 6px 24px rgba(0,0,0,0.3)"
            : "0 2px 12px rgba(0,0,0,0.25)",
        transition: "all .15s",
        transform: active ? "translateY(-2px)" : hovered ? "translateY(-1px)" : "none",
        position: "relative",
      }}
    >
      {/* ── Preview window mockup ── */}
      <div style={{
        height: 148,
        background: theme.vars["--bg"],
        padding: 12,
        display: "flex",
        gap: 8,
        position: "relative",
        overflow: "hidden",
      }}>
        {/* Accent glow */}
        <div style={{
          position: "absolute", top: -30, right: -30,
          width: 120, height: 120, borderRadius: "50%",
          background: theme.vars["--accent"] + "12",
          filter: "blur(30px)",
          pointerEvents: "none",
        }} />

        {/* Fake sidebar */}
        <div style={{
          width: 44, flexShrink: 0,
          background: theme.vars["--surface"],
          borderRadius: 8,
          padding: "8px 6px",
          display: "flex",
          flexDirection: "column",
          gap: 5,
          border: `1px solid ${theme.vars["--border"]}`,
        }}>
          <div style={{ width: 20, height: 20, borderRadius: 5, background: theme.vars["--accent"], marginBottom: 4, alignSelf: "center" }} />
          {[0, 1, 2, 3].map(i => (
            <div key={i} style={{
              width: "100%", height: 7, borderRadius: 3,
              background: i === 1 ? theme.vars["--accent"] + "25" : theme.vars["--surface-2"],
              border: i === 1 ? `1px solid ${theme.vars["--accent"]}35` : "none",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <div style={{
                width: "50%", height: 3, borderRadius: 2,
                background: i === 1 ? theme.vars["--accent"] + "90" : theme.vars["--t3"] + "70",
              }} />
            </div>
          ))}
        </div>

        {/* Fake main content */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
          {/* Header bar */}
          <div style={{
            background: theme.vars["--surface"],
            borderRadius: 6, padding: "5px 8px",
            display: "flex", alignItems: "center", gap: 5,
            border: `1px solid ${theme.vars["--border"]}`,
          }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: theme.vars["--accent"] }} />
            <div style={{ flex: 1, height: 3, borderRadius: 2, background: theme.vars["--t2"] + "30" }} />
            <div style={{ width: 18, height: 5, borderRadius: 3, background: theme.vars["--accent"], opacity: 0.7 }} />
          </div>

          {/* Cards row */}
          <div style={{ display: "flex", gap: 5, flex: 1 }}>
            {[theme.vars["--green"], theme.vars["--accent"], theme.vars["--t3"]].map((c, i) => (
              <div key={i} style={{
                flex: 1,
                background: theme.vars["--surface-2"],
                borderRadius: 6,
                border: `1px solid ${theme.vars["--border"]}`,
                padding: "6px 5px",
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}>
                <div style={{ width: "60%", height: 3, borderRadius: 2, background: c + "70" }} />
                <div style={{ width: "80%", height: 2, borderRadius: 2, background: theme.vars["--t3"] + "40" }} />
                <div style={{ width: "40%", height: 2, borderRadius: 2, background: theme.vars["--t3"] + "30" }} />
              </div>
            ))}
          </div>

          {/* Launch button row */}
          <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
            <div style={{
              padding: "4px 10px", borderRadius: 5,
              background: theme.vars["--accent"],
              fontSize: 7, fontWeight: 900,
              color: theme.vars["--accent-text"],
              letterSpacing: "0.05em",
            }}>LAUNCH</div>
            <div style={{ width: 30, height: 12, borderRadius: 4, background: theme.vars["--surface"], border: `1px solid ${theme.vars["--border"]}` }} />
          </div>
        </div>

        {/* Active check badge */}
        {active && (
          <div style={{
            position: "absolute", top: 8, right: 8,
            width: 22, height: 22, borderRadius: "50%",
            background: theme.vars["--accent"],
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: `0 0 10px ${theme.vars["--accent"]}80`,
          }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
              stroke={theme.vars["--accent-text"]} strokeWidth="3"
              strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        )}
      </div>

      {/* ── Label + color palette ── */}
      <div style={{
        padding: "11px 14px 13px",
        background: theme.vars["--surface"],
        borderTop: `1px solid ${theme.vars["--border"]}`,
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 9 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: theme.vars["--t1"], lineHeight: 1 }}>{theme.name}</div>
            <div style={{ fontSize: 10, color: theme.vars["--t3"], marginTop: 3 }}>{theme.description}</div>
          </div>
          {active && (
            <span style={{
              fontSize: 8.5, fontWeight: 800, letterSpacing: "0.06em",
              color: theme.vars["--accent"],
              padding: "2px 7px", borderRadius: 99,
              background: theme.vars["--accent"] + "18",
              border: `1px solid ${theme.vars["--accent"]}30`,
            }}>ACTIVE</span>
          )}
        </div>

        {/* Color swatch row */}
        <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
          {[
            { label: "BG",      color: theme.vars["--bg"] },
            { label: "Surface", color: theme.vars["--surface-2"] },
            { label: "Accent",  color: theme.vars["--accent"] },
            { label: "Text",    color: theme.vars["--t1"] },
            { label: "Green",   color: theme.vars["--green"] },
            { label: "Red",     color: theme.vars["--red"] },
          ].map(({ label, color }) => (
            <div key={label} title={`${label}: ${color}`} style={{
              width: 16, height: 16, borderRadius: 4,
              background: color,
              border: isLight ? "1px solid rgba(0,0,0,0.12)" : "1px solid var(--g08)",
              flexShrink: 0,
            }} />
          ))}
        </div>
      </div>
    </button>
  );
}
