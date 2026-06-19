import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Props {
  reason: "missing" | "expired";
  onValidated: () => void;
}

export default function KeyGate({ reason, onValidated }: Props) {
  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [exiting, setExiting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  const handleValidate = async () => {
    const trimmed = key.trim();
    if (!trimmed) return;
    setLoading(true);
    setError("");
    try {
      await invoke("validate_license_key", { key: trimmed });
      setExiting(true);
      setTimeout(onValidated, 400);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleGetKey = () => {
    invoke("open_key_website").catch(() => {});
  };

  const isExpired = reason === "expired";

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 99998,
      background: "#07080a",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      opacity: exiting ? 0 : 1,
      transition: "opacity 0.35s ease",
    }}>
      {/* Ambient glow */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: isExpired
          ? "radial-gradient(ellipse 50% 35% at 50% 0%, rgba(248,113,113,0.05) 0%, transparent 70%)"
          : "radial-gradient(ellipse 50% 35% at 50% 0%, rgba(232,232,232,0.04) 0%, transparent 70%)",
      }} />

      <div style={{ width: "100%", maxWidth: 440, padding: "0 28px", display: "flex", flexDirection: "column", alignItems: "center" }}>

        {/* Logo / Icon */}
        <div style={{
          width: 72, height: 72, borderRadius: 18, marginBottom: 28,
          background: isExpired ? "rgba(248,113,113,0.08)" : "rgba(232,232,232,0.06)",
          border: `1px solid ${isExpired ? "rgba(248,113,113,0.2)" : "rgba(232,232,232,0.14)"}`,
          boxShadow: `0 0 36px ${isExpired ? "rgba(248,113,113,0.08)" : "rgba(232,232,232,0.06)"}`,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {isExpired ? (
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          ) : (
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="rgba(232,232,232,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          )}
        </div>

        {/* Title */}
        <h1 style={{ fontSize: 26, fontWeight: 900, color: "#F0F1F6", letterSpacing: "-0.6px", marginBottom: 8, textAlign: "center" }}>
          {isExpired ? "Your key has expired" : "License Required"}
        </h1>

        <p style={{ fontSize: 12.5, color: "var(--t2)", textAlign: "center", lineHeight: 1.6, marginBottom: 32, maxWidth: 340 }}>
          {isExpired
            ? "Your Reiya license key has expired. Get a new key from the website and enter it below to continue."
            : "Reiya requires a valid license key to use. Get your free key from the website and paste it below."
          }
        </p>

        {/* Key input area */}
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ position: "relative" }}>
            <input
              ref={inputRef}
              type="text"
              value={key}
              onChange={e => { setKey(e.target.value.toUpperCase()); setError(""); }}
              onKeyDown={e => e.key === "Enter" && !loading && key.trim() && handleValidate()}
              placeholder="RAM-XXXX-XXXX-XXXX-XXXX"
              spellCheck={false}
              style={{
                width: "100%", height: 46,
                background: "#0e0f13",
                border: `1px solid ${error ? "rgba(248,113,113,0.4)" : "rgba(255,255,255,0.1)"}`,
                borderRadius: 12, outline: "none",
                color: "#F0F1F6", fontSize: 14, fontWeight: 700,
                fontFamily: "monospace", letterSpacing: "0.06em",
                padding: "0 16px", transition: "border-color .15s",
                boxShadow: error ? "0 0 0 3px rgba(248,113,113,0.08)" : "none",
              }}
              onFocus={e => { if (!error) e.target.style.borderColor = "rgba(232,232,232,0.25)"; }}
              onBlur={e => { if (!error) e.target.style.borderColor = "rgba(255,255,255,0.1)"; }}
            />
          </div>

          {/* Error */}
          {error && (
            <div style={{
              padding: "10px 14px", borderRadius: 10,
              background: "rgba(248,113,113,0.06)",
              border: "1px solid rgba(248,113,113,0.18)",
              color: "var(--red)", fontSize: 12, lineHeight: 1.4,
            }}>
              {error}
            </div>
          )}

          {/* Validate button */}
          <button onClick={handleValidate} disabled={loading || !key.trim()} style={{
            height: 46, borderRadius: 12, border: "none",
            background: loading || !key.trim() ? "rgba(232,232,232,0.06)" : "rgba(232,232,232,0.92)",
            color: loading || !key.trim() ? "var(--t3)" : "#07080a",
            fontSize: 13, fontWeight: 800, letterSpacing: "-0.1px",
            cursor: loading || !key.trim() ? "not-allowed" : "pointer",
            transition: "all .15s", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            boxShadow: loading || !key.trim() ? "none" : "0 4px 18px rgba(232,232,232,0.12)",
          }}
            onMouseEnter={e => { if (!loading && key.trim()) e.currentTarget.style.filter = "brightness(1.08)"; }}
            onMouseLeave={e => { e.currentTarget.style.filter = "none"; }}>
            {loading ? (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "spin 1s linear infinite" }}>
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                Validating…
              </>
            ) : (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Activate Key
              </>
            )}
          </button>

          {/* Divider */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0" }}>
            <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.05)" }} />
            <span style={{ fontSize: 10, color: "var(--t3)", fontWeight: 600 }}>DON'T HAVE A KEY?</span>
            <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.05)" }} />
          </div>

          {/* Get key button */}
          <button onClick={handleGetKey} style={{
            height: 42, borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.02)", color: "var(--t1)",
            fontSize: 12.5, fontWeight: 700,
            cursor: "pointer", transition: "all .15s",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.14)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.02)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            Get a Free Key — seistem.vercel.app
          </button>
        </div>

        <p style={{ marginTop: 24, fontSize: 10, color: "var(--t3)", textAlign: "center", lineHeight: 1.6 }}>
          Keys are free — valid for <strong style={{ color: "var(--t2)" }}>24h</strong> or <strong style={{ color: "var(--t2)" }}>48h</strong>.<br />
          Each key is locked to the device it's first used on.
        </p>
      </div>
    </div>
  );
}
