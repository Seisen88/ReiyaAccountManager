import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useLanguage } from "../context/LanguageContext";

interface LaunchProgressEvent {
  status: string;
  percent: number;
}

export default function LaunchProgress() {
  const { t } = useLanguage();
  const [status, setStatus] = useState("Initializing launcher...");
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    // Listen to backend progress updates
    const unlistenPromise = listen<LaunchProgressEvent>("launch-progress", (event) => {
      setStatus(event.payload.status);
      setPercent(event.payload.percent);
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const handleCancel = () => {
    // Simply close the window. The backend will detect that the window is gone and cancel.
    const appWindow = getCurrentWindow();
    appWindow.close();
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
      {/* Soft background glow */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 200,
          height: 200,
          background: "radial-gradient(circle, rgba(251, 191, 36, 0.12) 0%, transparent 70%)",
          zIndex: 0,
          pointerEvents: "none",
        }}
      />

      {/* Header Info */}
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

      {/* Main Content (Logo + Pulse Effect) */}
      <div
        data-tauri-drag-region
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
          zIndex: 1,
        }}
      >
        <div
          data-tauri-drag-region
          style={{
            width: 76,
            height: 76,
            borderRadius: 20,
            background: "var(--g02)",
            border: "1px solid var(--g06)",
            boxShadow: "0 12px 32px rgba(0, 0, 0, 0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
          }}
        >
          {/* Animated pulsing outer ring */}
          <div
            style={{
              position: "absolute",
              inset: -6,
              borderRadius: 24,
              border: "2px solid var(--amber)",
              opacity: 0.3,
              animation: "pulse 2s infinite ease-in-out",
            }}
          />
          <img
            src="/logo.png"
            alt="Logo"
            data-tauri-drag-region
            style={{
              width: 48,
              height: 48,
              objectFit: "contain",
            }}
          />
        </div>
      </div>

      {/* Footer (Status, Progress Bar, Cancel Button) */}
      <div
        data-tauri-drag-region
        style={{
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
          zIndex: 1,
        }}
      >
        {/* Status and Percentage */}
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
          <span style={{ fontWeight: 600, color: "var(--t1)" }}>{status === "Initializing launcher..." ? t("initializing_launcher") : status}</span>
          <span>{percent}%</span>
        </div>

        {/* Progress Bar Track */}
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
          {/* Progress Bar Fill */}
          <div
            style={{
              width: `${percent}%`,
              height: "100%",
              background: "linear-gradient(90deg, #F59E0B 0%, #D97706 100%)",
              boxShadow: "0 0 10px rgba(245, 158, 11, 0.5)",
              borderRadius: 99,
              transition: "width 0.3s ease-out",
            }}
          />
        </div>

        {/* Cancel Button */}
        <button
          onClick={handleCancel}
          style={{
            padding: "8px 24px",
            borderRadius: 8,
            border: "1px solid var(--border-mid)",
            background: "var(--surface-2)",
            color: "var(--t2)",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.15s ease",
            marginTop: 4,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--t1)";
            e.currentTarget.style.borderColor = "var(--g20)";
            e.currentTarget.style.background = "var(--surface-3)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--t2)";
            e.currentTarget.style.borderColor = "var(--border-mid)";
            e.currentTarget.style.background = "var(--surface-2)";
          }}
        >
          {t("cancel")}
        </button>
      </div>

      {/* Pulse Keyframe Animation Inject */}
      <style>{`
        @keyframes pulse {
          0% { transform: scale(1); opacity: 0.3; }
          50% { transform: scale(1.08); opacity: 0.6; }
          100% { transform: scale(1); opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
