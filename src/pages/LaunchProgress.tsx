import { useState, useEffect } from "react";
import { listen, emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useLanguage } from "../context/LanguageContext";

interface LaunchProgressEvent {
  status: string;
  percent: number;
}

interface LaunchProgressErrorEvent {
  message: string;
}

export default function LaunchProgress() {
  const { t } = useLanguage();
  const [status, setStatus] = useState("Initializing launcher...");
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unlistenProgress = listen<LaunchProgressEvent>("launch-progress", (event) => {
      setStatus(event.payload.status);
      setPercent(event.payload.percent);
    });

    const unlistenError = listen<LaunchProgressErrorEvent>("launch-progress-error", (event) => {
      setError(event.payload.message);
    });

    // Tell the backend the listener is registered — it's waiting for this before emitting
    emit("launch-progress-ready", {}).catch(() => {});

    return () => {
      unlistenProgress.then((u) => u());
      unlistenError.then((u) => u());
    };
  }, []);

  const handleClose = () => {
    getCurrentWindow().close();
  };

  return (
    <div
      data-tauri-drag-region
      style={{
        width: "100vw",
        height: "100vh",
        background: "radial-gradient(circle at center, #1e1f29 0%, #0c0d12 100%)",
        border: "1px solid var(--g08)",
        borderRadius: 16,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "32px 24px",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Background glow — red on error, amber normally */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 200,
          height: 200,
          background: error
            ? "radial-gradient(circle, rgba(239,68,68,0.12) 0%, transparent 70%)"
            : "radial-gradient(circle, rgba(251,191,36,0.12) 0%, transparent 70%)",
          zIndex: 0,
          pointerEvents: "none",
          transition: "background 0.4s ease",
        }}
      />

      {/* Header */}
      <div
        data-tauri-drag-region
        style={{
          display: "flex",
          justifyContent: "space-between",
          width: "100%",
          fontSize: 10,
          fontWeight: 700,
          color: "var(--t3)",
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          zIndex: 1,
        }}
      >
        <span data-tauri-drag-region>{t("channel")}: production</span>
        <span data-tauri-drag-region>{t("launcher")}: Reiya Bootstrapper</span>
      </div>

      {/* Logo */}
      <div
        data-tauri-drag-region
        style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, zIndex: 1 }}
      >
        <div
          data-tauri-drag-region
          style={{
            width: 76,
            height: 76,
            borderRadius: 20,
            background: "var(--g02)",
            border: `1px solid ${error ? "rgba(239,68,68,0.4)" : "var(--g06)"}`,
            boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            transition: "border-color 0.3s ease",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: -6,
              borderRadius: 24,
              border: `2px solid ${error ? "rgba(239,68,68,0.6)" : "var(--amber)"}`,
              opacity: error ? 0.7 : 0.3,
              animation: error ? "none" : "pulse 2s infinite ease-in-out",
              transition: "border-color 0.3s ease, opacity 0.3s ease",
            }}
          />
          <img
            src="/logo.png"
            alt="Logo"
            data-tauri-drag-region
            style={{ width: 48, height: 48, objectFit: "contain" }}
          />
        </div>
      </div>

      {/* Footer */}
      <div
        data-tauri-drag-region
        style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 16, zIndex: 1 }}
      >
        {error ? (
          <div
            style={{
              width: "100%",
              padding: "10px 14px",
              borderRadius: 8,
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.3)",
              fontSize: 11,
              fontWeight: 500,
              color: "#f87171",
              textAlign: "center",
              lineHeight: 1.6,
            }}
          >
            {error}
          </div>
        ) : (
          <>
            <div
              data-tauri-drag-region
              style={{
                display: "flex",
                justifyContent: "space-between",
                width: "100%",
                fontSize: 11.5,
                fontWeight: 500,
                color: "var(--t2)",
                padding: "0 4px",
              }}
            >
              <span style={{ fontWeight: 600, color: "var(--t1)" }}>
                {status === "Initializing launcher..." ? t("initializing_launcher") : status}
              </span>
              <span>{percent}%</span>
            </div>

            <div
              style={{
                width: "100%",
                height: 6,
                background: "var(--g04)",
                borderRadius: 99,
                overflow: "hidden",
                border: "1px solid var(--g02)",
              }}
            >
              <div
                style={{
                  width: `${percent}%`,
                  height: "100%",
                  background: "linear-gradient(90deg, #F59E0B 0%, #D97706 100%)",
                  boxShadow: "0 0 10px rgba(245,158,11,0.5)",
                  borderRadius: 99,
                  transition: "width 0.3s ease-out",
                }}
              />
            </div>
          </>
        )}

        <button
          onClick={handleClose}
          style={{
            padding: "8px 24px",
            borderRadius: 8,
            border: `1px solid ${error ? "rgba(239,68,68,0.4)" : "var(--border-mid)"}`,
            background: error ? "rgba(239,68,68,0.1)" : "var(--surface-2)",
            color: error ? "#f87171" : "var(--t2)",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.15s ease",
            marginTop: 4,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = error ? "#fca5a5" : "var(--t1)";
            e.currentTarget.style.borderColor = error ? "rgba(239,68,68,0.7)" : "var(--g20)";
            e.currentTarget.style.background = error ? "rgba(239,68,68,0.2)" : "var(--surface-3)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = error ? "#f87171" : "var(--t2)";
            e.currentTarget.style.borderColor = error ? "rgba(239,68,68,0.4)" : "var(--border-mid)";
            e.currentTarget.style.background = error ? "rgba(239,68,68,0.1)" : "var(--surface-2)";
          }}
        >
          {error ? "Dismiss" : t("cancel")}
        </button>
      </div>

      <style>{`
        @keyframes pulse {
          0%   { transform: scale(1);    opacity: 0.3; }
          50%  { transform: scale(1.08); opacity: 0.6; }
          100% { transform: scale(1);    opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
