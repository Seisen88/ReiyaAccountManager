import { createContext, useContext, useState, useCallback, ReactNode } from "react";

type ToastType = "success" | "error" | "info" | "warning";

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastCtx {
  success: (msg: string) => void;
  error: (msg: string) => void;
  info: (msg: string) => void;
  warning: (msg: string) => void;
}

const ToastContext = createContext<ToastCtx | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be inside ToastProvider");
  return ctx;
}

let _id = 0;

const STYLES: Record<ToastType, { bg: string; border: string; text: string; icon: string }> = {
  success: { bg: "rgba(34,197,94,0.1)",   border: "rgba(34,197,94,0.35)",  text: "#4ade80", icon: "✓" },
  error:   { bg: "rgba(239,68,68,0.12)",  border: "rgba(239,68,68,0.4)",   text: "#f87171", icon: "✕" },
  warning: { bg: "rgba(251,146,60,0.1)",  border: "rgba(251,146,60,0.35)", text: "#fb923c", icon: "!" },
  info:    { bg: "rgba(251,191,36,0.1)",  border: "rgba(251,191,36,0.35)", text: "#fbbf24", icon: "i" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const add = useCallback((message: string, type: ToastType) => {
    const id = ++_id;
    setToasts(p => [...p, { id, message, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4500);
  }, []);

  const ctx: ToastCtx = {
    success: m => add(m, "success"),
    error:   m => add(m, "error"),
    warning: m => add(m, "warning"),
    info:    m => add(m, "info"),
  };

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <div style={{
        position: "fixed",
        top: 44,
        right: 14,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxWidth: 340,
        pointerEvents: "none",
      }}>
        {toasts.map(t => {
          const s = STYLES[t.type];
          return (
            <div
              key={t.id}
              onClick={() => setToasts(p => p.filter(x => x.id !== t.id))}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "10px 14px",
                borderRadius: 10,
                background: s.bg,
                border: `1px solid ${s.border}`,
                backdropFilter: "blur(12px)",
                boxShadow: "0 4px 20px rgba(0,0,0,0.35)",
                animation: "toastSlideIn 0.2s ease-out",
                pointerEvents: "all",
                cursor: "pointer",
              }}
            >
              <span style={{
                width: 18, height: 18, borderRadius: 99,
                background: s.border, color: s.text,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 10, fontWeight: 800, flexShrink: 0, marginTop: 1,
              }}>{s.icon}</span>
              <span style={{ fontSize: 12, fontWeight: 500, color: "var(--t1)", lineHeight: 1.55, flex: 1 }}>
                {t.message}
              </span>
            </div>
          );
        })}
      </div>
      <style>{`
        @keyframes toastSlideIn {
          from { opacity: 0; transform: translateX(16px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </ToastContext.Provider>
  );
}
