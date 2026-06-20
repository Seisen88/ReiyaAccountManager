import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface UpdateInfo {
  has_update: boolean;
  version: string;
  download_url: string;
  notes: string;
  current: string;
}

interface ProgressPayload {
  downloaded: number;
  total: number;
  percent: number;
  phase: "downloading" | "installing" | "done";
}

interface Props {
  info: UpdateInfo;
  onDismiss?: () => void;
}

function fmtBytes(b: number) {
  if (b >= 1_048_576) return `${(b / 1_048_576).toFixed(1)} MB`;
  if (b >= 1024)      return `${(b / 1024).toFixed(0)} KB`;
  return `${b} B`;
}

export default function UpdatePrompt({ info, onDismiss }: Props) {
  const [uiPhase, setUiPhase] = useState<"idle" | "downloading" | "installing" | "done">("idle");
  const [progress, setProgress] = useState<ProgressPayload>({
    downloaded: 0, total: 0, percent: 0, phase: "downloading",
  });
  const [error, setError] = useState("");

  useEffect(() => {
    const unlisten = listen<ProgressPayload>("update-progress", e => {
      setProgress(e.payload);
      setUiPhase(e.payload.phase === "done" ? "done" : e.payload.phase);
    });
    return () => { unlisten.then(f => f()); };
  }, []);

  const handleUpdate = async () => {
    setUiPhase("downloading");
    setError("");
    try {
      await invoke("download_and_install_update", { url: info.download_url });
    } catch (e) {
      setError(String(e));
      setUiPhase("idle");
    }
  };

  const bar = Math.min(progress.percent, 100);

  const statusLabel = () => {
    if (uiPhase === "downloading") {
      return progress.total > 0
        ? `Downloading… ${fmtBytes(progress.downloaded)} / ${fmtBytes(progress.total)}`
        : "Downloading…";
    }
    if (uiPhase === "installing") return "Installing update…";
    if (uiPhase === "done")       return "Done! Restarting…";
    return "";
  };

  const barColor = uiPhase === "done" ? "var(--green)" : uiPhase === "installing" ? "#60a5fa" : "var(--green)";

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 99999,
      background: "rgba(7,8,10,0.94)",
      backdropFilter: "blur(16px)",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
    }}>
      {/* Dismiss button — only when not in progress */}
      {uiPhase === "idle" && onDismiss && (
        <button
          onClick={onDismiss}
          title="Remind me later"
          style={{
            position: "absolute", top: 18, right: 18,
            background: "var(--g04)",
            border: "1px solid var(--g08)",
            borderRadius: 8, width: 32, height: 32,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", color: "var(--t3)", fontSize: 16, lineHeight: 1,
            transition: "all .12s",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = "var(--g08)"; e.currentTarget.style.color = "var(--t1)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "var(--g04)"; e.currentTarget.style.color = "var(--t3)"; }}
        >
          ✕
        </button>
      )}

      {/* Top glow — shifts colour per phase */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: uiPhase === "installing" || uiPhase === "done"
          ? "radial-gradient(ellipse 55% 30% at 50% 0%, rgba(96,165,250,0.07) 0%, transparent 70%)"
          : "radial-gradient(ellipse 55% 30% at 50% 0%, rgba(34,197,94,0.07) 0%, transparent 70%)",
        transition: "background 0.4s",
      }} />

      <div style={{ width: "100%", maxWidth: 440, padding: "0 28px", display: "flex", flexDirection: "column", alignItems: "center" }}>

        {/* Icon */}
        <div style={{
          width: 72, height: 72, borderRadius: 18, marginBottom: 28,
          background: uiPhase === "installing" ? "rgba(96,165,250,0.08)" : "rgba(34,197,94,0.08)",
          border: `1px solid ${uiPhase === "installing" ? "rgba(96,165,250,0.22)" : "rgba(34,197,94,0.22)"}`,
          boxShadow: uiPhase === "installing" ? "0 0 40px rgba(96,165,250,0.08)" : "0 0 40px rgba(34,197,94,0.08)",
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all 0.4s",
        }}>
          {uiPhase === "done" ? (
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : uiPhase === "installing" ? (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "spin 1.2s linear infinite" }}>
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          ) : (
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="8 17 12 21 16 17" />
              <line x1="12" y1="12" x2="12" y2="21" />
              <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29" />
            </svg>
          )}
        </div>

        {/* Title */}
        <h1 style={{ fontSize: 24, fontWeight: 900, color: "#F0F1F6", letterSpacing: "-0.5px", marginBottom: 8, textAlign: "center" }}>
          {uiPhase === "done"
            ? "All done!"
            : uiPhase === "installing"
              ? "Installing…"
              : "Update Available"}
        </h1>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24 }}>
          <span style={{ fontSize: 11, color: "var(--t3)", fontWeight: 600, fontFamily: "monospace" }}>v{info.current}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--t3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span style={{ fontSize: 11, color: "var(--green)", fontWeight: 700, fontFamily: "monospace" }}>v{info.version}</span>
        </div>

        {info.notes && uiPhase === "idle" && (
          <div style={{
            width: "100%", marginBottom: 24,
            padding: "12px 16px", borderRadius: 12,
            background: "var(--g03)",
            border: "1px solid var(--g07)",
            color: "var(--t2)", fontSize: 12, lineHeight: 1.6,
            maxHeight: 80, overflowY: "auto",
          }}>
            {info.notes}
          </div>
        )}

        {/* Progress bar */}
        {uiPhase !== "idle" && (
          <div style={{ width: "100%", marginBottom: 20 }}>
            <div style={{
              width: "100%", height: 6, borderRadius: 99,
              background: "var(--g07)", overflow: "hidden",
              marginBottom: 10,
            }}>
              <div style={{
                height: "100%", borderRadius: 99,
                background: barColor,
                width: `${bar}%`,
                transition: "width 0.15s ease, background 0.4s",
                boxShadow: `0 0 10px ${barColor}66`,
              }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "var(--t3)", fontWeight: 600 }}>
                {statusLabel()}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: barColor }}>{bar}%</span>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            width: "100%", marginBottom: 16,
            padding: "10px 14px", borderRadius: 10,
            background: "rgba(248,113,113,0.06)",
            border: "1px solid rgba(248,113,113,0.18)",
            color: "var(--red)", fontSize: 12, lineHeight: 1.4,
          }}>
            {error}
          </div>
        )}

        {/* Update Now button — only when idle */}
        {uiPhase === "idle" && (
          <button onClick={handleUpdate} style={{
            width: "100%", height: 46, borderRadius: 12, border: "none",
            background: "rgba(34,197,94,0.9)",
            color: "#07080a", fontSize: 13, fontWeight: 800,
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            boxShadow: "0 4px 20px rgba(34,197,94,0.25)",
            transition: "filter .15s",
          }}
            onMouseEnter={e => { e.currentTarget.style.filter = "brightness(1.1)"; }}
            onMouseLeave={e => { e.currentTarget.style.filter = "none"; }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="8 17 12 21 16 17" />
              <line x1="12" y1="12" x2="12" y2="21" />
              <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29" />
            </svg>
            Update Now
          </button>
        )}

        {/* Locked state during download / install */}
        {(uiPhase === "downloading" || uiPhase === "installing") && (
          <div style={{
            width: "100%", height: 46, borderRadius: 12,
            background: uiPhase === "installing" ? "rgba(96,165,250,0.06)" : "rgba(34,197,94,0.06)",
            border: `1px solid ${uiPhase === "installing" ? "rgba(96,165,250,0.15)" : "rgba(34,197,94,0.15)"}`,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            color: uiPhase === "installing" ? "#60a5fa" : "var(--green)",
            fontSize: 13, fontWeight: 700,
            transition: "all 0.4s",
          }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "spin 1s linear infinite" }}>
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            {uiPhase === "installing" ? "Installing, please wait…" : "Downloading update…"}
          </div>
        )}

        <p style={{ marginTop: 20, fontSize: 10, color: "var(--t3)", textAlign: "center", lineHeight: 1.6 }}>
          {uiPhase === "done"
            ? "The app will relaunch automatically in a moment."
            : "This update is required to continue using Reiya.\nThe app will restart automatically after installing."}
        </p>
      </div>
    </div>
  );
}
