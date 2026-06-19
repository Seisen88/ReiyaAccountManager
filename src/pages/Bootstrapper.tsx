import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useBootstrapper } from "../context/BootstrapperContext";
import type { RobloxInstall } from "../context/BootstrapperContext";
import {
  SettingsIcon, FlagIcon, GamepadIcon, StarIcon, LinkIcon,
  DownloadIcon, PackageIcon, RefreshIcon, ActivityIcon,
  ShieldCheckIcon, ZapIcon, CheckIcon, XIcon,
  SearchIcon, CpuIcon,
} from "../components/Icons";

interface FastFlagPreset {
  id: string; name: string; description: string;
  category: string; flags: Record<string, any>;
}

const KIND_COLORS: Record<string, string> = {
  official: "#60A5FA", bloxstrap: "#A78BFA", fishstrap: "#34D399", reiya: "#E8E8E8",
};

const KindIcon = ({ kind, size = 14, color }: { kind: string; size?: number; color?: string }) => {
  const c = color ?? KIND_COLORS[kind] ?? "var(--t2)";
  switch (kind) {
    case "official":  return <GamepadIcon size={size} color={c} />;
    case "bloxstrap": return <PackageIcon size={size} color={c} />;
    case "fishstrap": return <ActivityIcon size={size} color={c} />;
    case "reiya":     return <StarIcon size={size} color={c} />;
    case "protocol":  return <LinkIcon size={size} color={c} />;
    case "auto":      return <SettingsIcon size={size} color={c} />;
    default:          return <CpuIcon size={size} color={c} />;
  }
};

const LAUNCHER_OPTIONS = [
  { id: "auto",      name: "Auto-detect",     subtitle: "Recommended", desc: "Tries Reiya, then official, then Windows default.", accentColor: "#8B8FA8", alwaysAvailable: true },
  { id: "reiya",     name: "Reiya",           subtitle: "Built-in",    desc: "Runs Reiya's standalone Roblox build directly.",      accentColor: "#E8E8E8", alwaysAvailable: false },
  { id: "bloxstrap", name: "Bloxstrap",       subtitle: "Third-party", desc: "Runs Bloxstrap launcher directly if installed.",       accentColor: "#A78BFA", alwaysAvailable: false },
  { id: "fishstrap", name: "Fishstrap",       subtitle: "Third-party", desc: "Runs Fishstrap launcher directly if installed.",       accentColor: "#34D399", alwaysAvailable: false },
  { id: "official",  name: "Official Roblox", subtitle: "Vanilla",     desc: "Runs official vanilla Roblox client directly.",        accentColor: "#60A5FA", alwaysAvailable: false },
  { id: "protocol",  name: "System Protocol", subtitle: "URL Handler", desc: "Launches roblox-player:// via default Windows handler.",accentColor: "#818CF8", alwaysAvailable: true },
] as const;

export default function Bootstrapper() {
  const [tab, setTab] = useState<"bootstrapper" | "fastflags">("bootstrapper");
  const [flagsCount, setFlagsCount] = useState(0);

  const fetchFlagsCount = () => {
    invoke<Record<string, any>>("get_fastflags")
      .then(d => setFlagsCount(Object.keys(d).length)).catch(() => {});
  };

  useEffect(() => { fetchFlagsCount(); }, [tab]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)", overflow: "hidden" }}>
      {tab === "bootstrapper"
        ? <BootstrapperTab flagsCount={flagsCount} onSwitchTab={() => setTab("fastflags")} />
        : <FastFlagsTab flagsCount={flagsCount} onFlagsChanged={fetchFlagsCount} onSwitchTab={() => setTab("bootstrapper")} />
      }
    </div>
  );
}

function BootstrapperTab({ flagsCount, onSwitchTab }: { flagsCount: number; onSwitchTab: () => void }) {
  const {
    status, progress, installing, checking, error, successMsg,
    detectedInstalls, detecting, preferredLauncher,
    checkUpdate, startInstall, scanInstalls, updateLauncherPreference,
  } = useBootstrapper();

  const [registering, setRegistering] = useState(false);
  const [regError, setRegError] = useState("");
  const [regSuccess, setRegSuccess] = useState("");

  const handleRegisterProtocol = async () => {
    setRegistering(true); setRegError(""); setRegSuccess("");
    try {
      await invoke("bootstrapper_register_protocol");
      setRegSuccess("roblox-player:// protocol registered to Reiya successfully!");
    } catch (e) { setRegError(String(e)); } finally { setRegistering(false); }
  };

  const isInstalled = !!status?.exe_path;
  const needsUpdate = status?.needs_update ?? true;
  const statusColor = !isInstalled ? "#F87171" : needsUpdate ? "#FBBF24" : "#34D399";
  const statusLabel = !isInstalled ? "Not Installed" : needsUpdate ? "Update Available" : "Up to Date";

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* Hero status section */}
      <div style={{
        padding: "24px 28px",
        background: `linear-gradient(135deg, ${statusColor}08 0%, rgba(8,9,12,0.5) 60%)`,
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20 }}>

          {/* Left: main status */}
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 14,
              background: statusColor + "14",
              border: `1px solid ${statusColor}30`,
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: `0 0 24px ${statusColor}15`,
              flexShrink: 0,
            }}>
              <ShieldCheckIcon size={26} color={statusColor} />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                <span style={{ fontSize: 20, fontWeight: 900, color: "var(--t1)", letterSpacing: "-0.4px" }}>
                  Reiya Bootstrapper
                </span>
                <span style={{
                  fontSize: 10, fontWeight: 800, padding: "3px 9px", borderRadius: 99,
                  background: statusColor + "18", color: statusColor,
                  border: `1px solid ${statusColor}35`,
                  display: "flex", alignItems: "center", gap: 5,
                }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: statusColor, boxShadow: `0 0 6px ${statusColor}`, display: "inline-block" }} />
                  {statusLabel}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, color: "var(--t3)" }}>
                  Version: <span style={{ color: "var(--t2)", fontFamily: "monospace", fontWeight: 700 }}>
                    {status?.installed_version?.substring(0, 16) ?? "—"}
                  </span>
                </span>
                <span style={{ fontSize: 11, color: "var(--t3)" }}>
                  Launcher: <span style={{ color: "var(--amber)", fontWeight: 700 }}>{preferredLauncher}</span>
                </span>
                <span style={{ fontSize: 11, color: "var(--t3)" }}>
                  FastFlags: <span style={{ color: flagsCount > 0 ? "#A78BFA" : "var(--t3)", fontWeight: 700 }}>{flagsCount} active</span>
                </span>
              </div>
            </div>
          </div>

          {/* Right: action buttons + fastflags shortcut */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <button onClick={checkUpdate} disabled={checking || installing} className="glow-btn" style={ghostBtnStyle(checking || installing)}>
              <RefreshIcon size={12} />{checking ? "Checking..." : "Check"}
            </button>
            <button onClick={startInstall} disabled={installing || checking} className="glow-btn"
              style={{
                ...ghostBtnStyle(installing || checking),
                ...(needsUpdate ? { background: "rgba(232,232,232,0.9)", color: "#0a0a0a", border: "none", boxShadow: "0 4px 14px rgba(232,232,232,0.15)" } : {}),
              }}>
              <DownloadIcon size={12} />{installing ? `${progress?.percent ?? 0}%` : isInstalled ? "Update" : "Install"}
            </button>
            {isInstalled && (
              <button onClick={handleRegisterProtocol} disabled={registering || installing} className="glow-btn" style={{ ...ghostBtnStyle(registering || installing), color: "#818CF8", border: "1px solid rgba(129,140,248,0.25)", background: "rgba(129,140,248,0.05)" }}>
                <LinkIcon size={12} />{registering ? "Registering..." : "Register Protocol"}
              </button>
            )}
            <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.08)" }} />
            <button onClick={onSwitchTab} className="glow-btn" style={{ ...ghostBtnStyle(false), color: "#A78BFA", border: "1px solid rgba(167,139,250,0.2)", background: "rgba(167,139,250,0.05)" }}>
              <FlagIcon size={12} />FastFlags
            </button>
          </div>
        </div>

        {/* Progress bar */}
        {(installing || (progress && !progress.done)) && progress && (
          <div style={{ marginTop: 18, padding: "14px 18px", background: "rgba(255,255,255,0.02)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, color: "var(--t1)" }}>{progress.stage}</div>
                <div style={{ fontSize: 10, color: "var(--t2)", marginTop: 2 }}>{progress.package} · {progress.package_index}/{progress.total_packages}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 16, fontWeight: 900, color: "var(--amber)" }}>{progress.percent}%</div>
                {progress.speed_kbps > 0 && <div style={{ fontSize: 10, color: "var(--t2)" }}>{formatSpeed(progress.speed_kbps)}</div>}
              </div>
            </div>
            <div style={{ height: 5, background: "rgba(255,255,255,0.04)", borderRadius: 99, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${progress.percent}%`, background: "linear-gradient(90deg, #FBBF24, #F59E0B)", borderRadius: 99, transition: "width .3s ease" }} />
            </div>
          </div>
        )}

        {/* Messages */}
        {(error || regError) && (
          <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.18)", borderRadius: 10, color: "var(--red)", fontSize: 12 }}>{error || regError}</div>
        )}
        {(successMsg || regSuccess) && (
          <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(52,211,153,0.06)", border: "1px solid rgba(52,211,153,0.18)", borderRadius: 10, color: "var(--green)", fontSize: 12, fontWeight: 700 }}>{successMsg || regSuccess}</div>
        )}
      </div>

      {/* Main content — 3 columns */}
      <div className="scroll" style={{ flex: 1, padding: "20px 28px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, alignContent: "start" }}>

        {/* Launcher preference — spans 2 cols */}
        <div style={{ gridColumn: "span 2" }}>
          <SectionHeader icon={<ZapIcon size={12} color="var(--amber)" />} title="LAUNCHER PREFERENCE" accent="var(--amber)" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
            {LAUNCHER_OPTIONS.map(opt => {
              const isSelected = preferredLauncher === opt.id;
              const available = opt.alwaysAvailable || !!detectedInstalls?.installs.find(i => i.kind === opt.id)?.found;
              return <LauncherCard key={opt.id} id={opt.id} name={opt.name} subtitle={opt.subtitle} desc={opt.desc} accentColor={opt.accentColor} isSelected={isSelected} available={available} onSelect={() => updateLauncherPreference(opt.id)} />;
            })}
          </div>
        </div>

        {/* Right column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Detected installs */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <SectionHeader icon={<SearchIcon size={12} color="var(--t2)" />} title="INSTALLATIONS" accent="var(--t2)" inline />
              <button onClick={scanInstalls} disabled={detecting} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.06)", background: "transparent", color: "var(--t3)", fontSize: 10, fontWeight: 700, cursor: detecting ? "not-allowed" : "pointer" }}
                onMouseEnter={e => { if (!detecting) e.currentTarget.style.color = "var(--t2)"; }}
                onMouseLeave={e => { if (!detecting) e.currentTarget.style.color = "var(--t3)"; }}>
                <RefreshIcon size={10} />{detecting ? "Scanning…" : "Scan"}
              </button>
            </div>
            {!detectedInstalls
              ? <div style={{ color: "var(--t3)", fontSize: 11.5, padding: "8px 0" }}>Scanning…</div>
              : <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {detectedInstalls.installs.map(i => <InstallCard key={i.kind} install={i} />)}
                </div>
            }
          </div>

          {/* How it works */}
          <div>
            <SectionHeader icon={<ActivityIcon size={12} color="var(--t3)" />} title="HOW IT WORKS" accent="var(--t3)" />
            <div style={{ marginTop: 10 }}>
              {[
                { n: "01", a: "Check",   d: "Queries Roblox API for the latest client version hash." },
                { n: "02", a: "Pull",    d: "Downloads changed packages from the Roblox CDN." },
                { n: "03", a: "Extract", d: "Installs files to local version subdirectories." },
                { n: "04", a: "Bind",    d: "Writes registry protocols for local launching." },
              ].map(({ n, a, d }) => (
                <div key={n} style={{ display: "flex", gap: 10, padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                  <span style={{ fontSize: 9, fontWeight: 900, color: "rgba(255,255,255,0.12)", fontFamily: "monospace", minWidth: 16 }}>{n}</span>
                  <span style={{ fontSize: 10, fontWeight: 800, color: "var(--amber)", minWidth: 46, flexShrink: 0 }}>{a}</span>
                  <span style={{ fontSize: 10, color: "var(--t3)", lineHeight: 1.4 }}>{d}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ icon, title, accent, inline }: { icon: React.ReactNode; title: string; accent: string; inline?: boolean }) {
  const el = (
    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
      {icon}
      <span style={{ fontSize: 10, fontWeight: 900, color: accent, letterSpacing: "0.1em" }}>{title}</span>
    </div>
  );
  return inline ? el : <div>{el}</div>;
}

function LauncherCard({ id, name, subtitle, desc, accentColor, isSelected, available, onSelect }: {
  id: string; name: string; subtitle: string; desc: string;
  accentColor: string; isSelected: boolean; available: boolean; onSelect: () => void;
}) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        padding: "12px 14px", borderRadius: 12, cursor: "pointer",
        background: isSelected ? accentColor + "07" : hov ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.01)",
        border: `1px solid ${isSelected ? accentColor + "50" : hov ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.04)"}`,
        opacity: available ? 1 : 0.35,
        transition: "all .15s ease",
        display: "flex", alignItems: "center", gap: 12, position: "relative", overflow: "hidden",
      }}
    >
      {/* Selected glow edge */}
      {isSelected && (
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: accentColor, borderRadius: "12px 0 0 12px" }} />
      )}

      <div style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, background: isSelected ? accentColor + "18" : "rgba(255,255,255,0.04)", border: `1px solid ${isSelected ? accentColor + "35" : "rgba(255,255,255,0.06)"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <KindIcon kind={id} size={15} color={isSelected ? accentColor : "var(--t3)"} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: isSelected ? "var(--t1)" : "var(--t2)" }}>{name}</span>
          <span style={{ fontSize: 8.5, color: "var(--t3)", background: "rgba(255,255,255,0.04)", padding: "1px 5px", borderRadius: 4, fontWeight: 600 }}>{subtitle}</span>
        </div>
        <div style={{ fontSize: 9.5, color: "var(--t3)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{desc}</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
        <div style={{ width: 16, height: 16, borderRadius: "50%", border: `2px solid ${isSelected ? accentColor : "rgba(255,255,255,0.15)"}`, background: isSelected ? accentColor : "transparent", display: "flex", alignItems: "center", justifyContent: "center", transition: "all .12s" }}>
          {isSelected && <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#07080a" }} />}
        </div>
        <span style={{ fontSize: 7.5, fontWeight: 800, padding: "1.5px 5px", borderRadius: 4, color: available ? "var(--green)" : "var(--t3)", background: available ? "rgba(52,211,153,0.08)" : "rgba(255,255,255,0.03)" }}>
          {available ? "READY" : "N/A"}
        </span>
      </div>
    </div>
  );
}

function InstallCard({ install }: { install: RobloxInstall }) {
  const color = KIND_COLORS[install.kind] ?? "var(--t2)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", background: "rgba(255,255,255,0.01)", borderRadius: 10, border: `1px solid ${install.found ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.02)"}`, opacity: install.found ? 1 : 0.45 }}>
      <div style={{ width: 26, height: 26, borderRadius: 7, flexShrink: 0, background: install.found ? color + "12" : "rgba(255,255,255,0.02)", border: `1px solid ${install.found ? color + "28" : "rgba(255,255,255,0.04)"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <KindIcon kind={install.kind} size={12} color={install.found ? color : "var(--t3)"} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: install.found ? "var(--t1)" : "var(--t3)" }}>{install.name}</span>
          {install.is_protocol_handler && <span style={{ fontSize: 7.5, padding: "1px 5px", borderRadius: 4, background: color + "20", color, fontWeight: 800 }}>ACTIVE</span>}
        </div>
        {install.version && <div style={{ fontSize: 9, color: "var(--t3)", fontFamily: "monospace" }}>{install.version}</div>}
      </div>
      <span style={{ fontSize: 8, fontWeight: 800, padding: "2px 6px", borderRadius: 4, color: install.found ? "var(--green)" : "var(--t3)", background: install.found ? "rgba(52,211,153,0.08)" : "rgba(255,255,255,0.03)", flexShrink: 0 }}>
        {install.found ? "FOUND" : "MISSING"}
      </span>
    </div>
  );
}

function FastFlagsTab({ flagsCount, onFlagsChanged, onSwitchTab }: { flagsCount: number; onFlagsChanged: () => void; onSwitchTab: () => void }) {
  const [flags, setFlags] = useState<Record<string, any>>({});
  const [presets, setPresets] = useState<FastFlagPreset[]>([]);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");

  useEffect(() => {
    invoke<Record<string, any>>("get_fastflags").then(setFlags).catch(() => {});
    invoke<FastFlagPreset[]>("get_fastflag_presets").then(setPresets).catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true); setError(""); setSaveSuccess(false);
    try { await invoke("save_fastflags", { flags }); setSaveSuccess(true); onFlagsChanged(); setTimeout(() => setSaveSuccess(false), 3000); }
    catch (e) { setError(String(e)); } finally { setSaving(false); }
  };

  const applyPreset = (p: FastFlagPreset) => setFlags(prev => ({ ...prev, ...p.flags }));
  const removeFlag = (key: string) => setFlags(prev => { const n = { ...prev }; delete n[key]; return n; });
  const addFlag = () => {
    if (!newKey.trim()) return;
    let v: any = newVal;
    if (newVal === "true") v = true; else if (newVal === "false") v = false;
    else if (!isNaN(Number(newVal)) && newVal !== "") v = Number(newVal);
    setFlags(prev => ({ ...prev, [newKey.trim()]: v }));
    setNewKey(""); setNewVal("");
  };
  const updateFlagValue = (key: string, raw: string) => {
    let v: any = raw;
    if (raw === "true") v = true; else if (raw === "false") v = false;
    else if (!isNaN(Number(raw)) && raw !== "") v = Number(raw);
    setFlags(prev => ({ ...prev, [key]: v }));
  };

  const filteredFlags = Object.entries(flags).filter(([k]) => k.toLowerCase().includes(search.toLowerCase()));
  const categories = ["All", ...Array.from(new Set(presets.map(p => p.category)))];
  const filteredPresets = presets.filter(p => activeCategory === "All" || p.category === activeCategory);

  const exportFlags = () => {
    const blob = new Blob([JSON.stringify(flags, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "ClientAppSettings.json"; a.click();
    URL.revokeObjectURL(url);
  };
  const importFlags = () => {
    const input = document.createElement("input"); input.type = "file"; input.accept = ".json";
    input.onchange = e => {
      const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return;
      const r = new FileReader();
      r.onload = ev => { try { setFlags(prev => ({ ...prev, ...JSON.parse(ev.target?.result as string) })); } catch { setError("Failed to parse JSON."); } };
      r.readAsText(file);
    };
    input.click();
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* FastFlags hero header */}
      <div style={{
        padding: "20px 28px", flexShrink: 0,
        background: "linear-gradient(135deg, rgba(167,139,250,0.06) 0%, transparent 60%)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 46, height: 46, borderRadius: 12, background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.25)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 20px rgba(167,139,250,0.1)" }}>
              <FlagIcon size={20} color="#A78BFA" />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 18, fontWeight: 900, color: "var(--t1)", letterSpacing: "-0.3px" }}>FastFlags</span>
                <span style={{ fontSize: 10, fontWeight: 800, padding: "3px 9px", borderRadius: 99, background: "rgba(167,139,250,0.12)", color: "#A78BFA", border: "1px solid rgba(167,139,250,0.25)" }}>
                  {flagsCount} active
                </span>
              </div>
              <div style={{ fontSize: 11, color: "var(--t3)", marginTop: 2 }}>Inject client-side flags into the Roblox runtime before launch</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={importFlags} style={ghostBtnStyle(false)}><DownloadIcon size={11} />Import</button>
            <button onClick={exportFlags} style={ghostBtnStyle(false)}><PackageIcon size={11} />Export</button>
            <button onClick={() => { if (confirm("Clear all FastFlags?")) setFlags({}); }} style={{ ...ghostBtnStyle(false), color: "var(--red)", border: "1px solid rgba(248,113,113,0.2)", background: "rgba(248,113,113,0.04)" }}>
              <XIcon size={11} />Clear All
            </button>
            <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.08)", alignSelf: "center" }} />
            <button onClick={onSwitchTab} style={ghostBtnStyle(false)}><DownloadIcon size={11} />Bootstrapper</button>
          </div>
        </div>
      </div>

      {/* Body: presets left + editor right */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* Presets panel */}
        <div style={{ width: 256, flexShrink: 0, borderRight: "1px solid rgba(255,255,255,0.05)", display: "flex", flexDirection: "column", background: "rgba(8,9,12,0.3)" }}>
          <div style={{ padding: "12px 12px 8px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <div style={{ fontSize: 9.5, fontWeight: 800, color: "var(--t3)", letterSpacing: "0.12em", marginBottom: 8 }}>PRESET CATEGORIES</div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {categories.map(cat => (
                <button key={cat} onClick={() => setActiveCategory(cat)} style={{ padding: "3px 9px", borderRadius: 7, border: "none", fontSize: 9.5, fontWeight: 700, cursor: "pointer", transition: "all .15s", background: activeCategory === cat ? "rgba(167,139,250,0.14)" : "rgba(255,255,255,0.03)", color: activeCategory === cat ? "#A78BFA" : "var(--t2)" }}>{cat}</button>
              ))}
            </div>
          </div>
          <div className="scroll" style={{ flex: 1, padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            {filteredPresets.map(preset => (
              <div key={preset.id} style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 11, padding: "11px 12px", transition: "border-color .15s" }}
                onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(255,255,255,0.09)"}
                onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(255,255,255,0.05)"}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--t1)" }}>{preset.name}</div>
                  <span style={{ fontSize: 8, padding: "2px 6px", borderRadius: 4, background: "rgba(255,255,255,0.04)", color: "var(--t3)", fontWeight: 800, flexShrink: 0, marginLeft: 6 }}>{preset.category}</span>
                </div>
                <div style={{ fontSize: 10, color: "var(--t3)", lineHeight: 1.4, marginBottom: 8 }}>{preset.description}</div>
                <div style={{ fontSize: 9, color: "var(--t3)", fontWeight: 700, marginBottom: 7 }}>{Object.keys(preset.flags).length} flags</div>
                <button onClick={() => applyPreset(preset)} className="glow-btn" style={{ width: "100%", padding: "5px 0", borderRadius: 7, border: "1px solid rgba(167,139,250,0.2)", background: "rgba(167,139,250,0.05)", color: "#A78BFA", fontSize: 10, fontWeight: 700, cursor: "pointer", transition: "all .12s", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(167,139,250,0.12)"}
                  onMouseLeave={e => e.currentTarget.style.background = "rgba(167,139,250,0.05)"}>
                  <PackageIcon size={10} color="#A78BFA" /> Apply
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Editor */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Toolbar */}
          <div style={{ padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(8,9,12,0.2)", display: "flex", alignItems: "center", gap: 9 }}>
            <div style={{ flex: 1, position: "relative" }}>
              <SearchIcon size={11} color="var(--t3)" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
              <input type="text" placeholder="Search flag name…" value={search} onChange={e => setSearch(e.target.value)} className="field glass-input" style={{ paddingLeft: 30, padding: "7px 12px 7px 30px", fontSize: 11.5, outline: "none" }} />
            </div>
            <span style={{ fontSize: 10.5, color: "var(--t3)", fontWeight: 700, flexShrink: 0 }}>{filteredFlags.length} / {Object.keys(flags).length}</span>
          </div>

          <div className="scroll" style={{ flex: 1, padding: "14px 16px" }}>
            {/* Add new */}
            <div style={{ display: "flex", gap: 8, marginBottom: 12, padding: "10px 12px", background: "rgba(255,255,255,0.01)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.05)" }}>
              <input type="text" placeholder="FFlag name…" value={newKey} onChange={e => setNewKey(e.target.value)} onKeyDown={e => e.key === "Enter" && addFlag()} className="field glass-input" style={{ flex: 2, padding: "7px 11px", fontSize: 11, outline: "none" }} />
              <input type="text" placeholder="Value" value={newVal} onChange={e => setNewVal(e.target.value)} onKeyDown={e => e.key === "Enter" && addFlag()} className="field glass-input" style={{ flex: 1, padding: "7px 11px", fontSize: 11, outline: "none" }} />
              <button onClick={addFlag} className="glow-btn" style={{ padding: "7px 16px", borderRadius: 8, border: "none", background: "rgba(232,232,232,0.9)", color: "#0a0a0a", fontSize: 11.5, fontWeight: 800, cursor: "pointer" }}
                onMouseEnter={e => e.currentTarget.style.filter = "brightness(1.1)"}
                onMouseLeave={e => e.currentTarget.style.filter = "none"}>
                Add
              </button>
            </div>

            {filteredFlags.length === 0
              ? <div style={{ textAlign: "center", padding: "48px 0", color: "var(--t3)", fontSize: 12 }}>
                  {Object.keys(flags).length === 0 ? "No flags configured. Apply a preset or add one above." : "No flags match your search."}
                </div>
              : <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {filteredFlags.map(([k, v]) => <FlagRow key={k} flagKey={k} value={v} onChange={raw => updateFlagValue(k, raw)} onRemove={() => removeFlag(k)} />)}
                </div>
            }
          </div>

          {/* Save footer */}
          <div style={{ padding: "11px 16px", borderTop: "1px solid rgba(255,255,255,0.05)", background: "rgba(8,9,12,0.4)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              {saveSuccess && <span style={{ color: "var(--green)", fontSize: 11.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}><CheckIcon size={12} color="var(--green)" /> FastFlags saved and applied.</span>}
              {error && <span style={{ color: "var(--red)", fontSize: 12 }}>{error}</span>}
            </div>
            <button onClick={handleSave} disabled={saving} className="glow-btn" style={{ padding: "8px 20px", borderRadius: 9, border: "none", background: saving ? "rgba(232,232,232,0.08)" : "rgba(232,232,232,0.9)", color: saving ? "var(--t3)" : "#0a0a0a", fontSize: 12, fontWeight: 800, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1, boxShadow: "0 4px 14px rgba(232,232,232,.15)", display: "flex", alignItems: "center", gap: 6 }}
              onMouseEnter={e => { if (!saving) e.currentTarget.style.filter = "brightness(1.1)"; }}
              onMouseLeave={e => { if (!saving) e.currentTarget.style.filter = "none"; }}>
              <CheckIcon size={12} color={saving ? "var(--t3)" : "#0a0a0a"} />
              {saving ? "Saving…" : "Save FastFlags"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FlagRow({ flagKey, value, onChange, onRemove }: { flagKey: string; value: any; onChange: (v: string) => void; onRemove: () => void }) {
  const isBool = typeof value === "boolean";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "rgba(255,255,255,0.008)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.04)", transition: "border-color .15s" }}
      onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.08)"}
      onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.04)"}>
      <div style={{ flex: 2, fontSize: 10.5, color: "var(--t1)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{flagKey}</div>
      {isBool
        ? <div onClick={() => onChange(value ? "false" : "true")} style={{ width: 34, height: 18, borderRadius: 99, background: value ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.04)", border: `1px solid ${value ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.08)"}`, position: "relative", cursor: "pointer", transition: "all .15s", flexShrink: 0 }}>
            <div style={{ position: "absolute", top: 2, left: value ? 17 : 2, width: 12, height: 12, borderRadius: "50%", background: value ? "#E8E8E8" : "#8B8FA8", transition: "all .15s" }} />
          </div>
        : <input type="text" value={String(value)} onChange={e => onChange(e.target.value)} className="glass-input" style={{ flex: 1, padding: "5px 9px", fontSize: 10.5, fontFamily: "monospace", color: typeof value === "number" ? "#60A5FA" : "var(--t2)", outline: "none" }} />
      }
      <span style={{ fontSize: 8.5, padding: "2px 6px", borderRadius: 4, background: "rgba(255,255,255,0.03)", color: "var(--t3)", fontWeight: 800, flexShrink: 0 }}>{typeof value}</span>
      <button onClick={onRemove} className="glow-btn" style={{ width: 22, height: 22, borderRadius: 5, border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
        onMouseEnter={e => e.currentTarget.style.background = "rgba(248,113,113,0.1)"}
        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
        <XIcon size={10} color="var(--t3)" />
      </button>
    </div>
  );
}

function ghostBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    display: "flex", alignItems: "center", gap: 6,
    padding: "7px 13px", borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.07)",
    background: "rgba(255,255,255,0.02)", color: "var(--t2)",
    fontSize: 11.5, fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1, transition: "all .12s",
  };
}

function formatSpeed(kbps: number) {
  return kbps >= 1024 ? `${(kbps / 1024).toFixed(1)} MB/s` : `${kbps} KB/s`;
}
