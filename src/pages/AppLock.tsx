import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LockIcon } from "../components/Icons";

interface Props {
  onUnlocked: () => void;
}

export default function AppLock({ onUnlocked }: Props) {
  const [pin, setPin]         = useState("");
  const [error, setError]     = useState("");
  const [shaking, setShaking] = useState(false);
  const inputRef              = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = async (value: string) => {
    if (value.length < 4) return;
    try {
      const ok = await invoke<boolean>("verify_pin", { pin: value });
      if (ok) {
        onUnlocked();
      } else {
        setPin("");
        setError("Incorrect PIN");
        setShaking(true);
        setTimeout(() => setShaking(false), 500);
        inputRef.current?.focus();
      }
    } catch {
      setPin("");
      setError("Could not verify PIN");
    }
  };

  const handleKey = (digit: string) => {
    if (pin.length >= 4) return;
    const next = pin + digit;
    setPin(next);
    setError("");
    if (next.length === 4) submit(next);
  };

  const handleBackspace = () => {
    setPin(p => p.slice(0, -1));
    setError("");
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 99999,
      background: "rgba(7,8,10,0.97)",
      backdropFilter: "blur(20px)",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 32,
    }}>
      {/* Icon */}
      <div style={{
        width: 64, height: 64, borderRadius: 18,
        background: "rgba(167,139,250,0.1)",
        border: "1px solid rgba(167,139,250,0.25)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <LockIcon size={28} color="rgba(167,139,250,0.9)" />
      </div>

      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 20, fontWeight: 900, color: "var(--t1)", marginBottom: 6 }}>
          App Locked
        </div>
        <div style={{ fontSize: 12, color: "var(--t3)" }}>Enter your 4-digit PIN to continue</div>
      </div>

      {/* PIN dots */}
      <div
        style={{
          display: "flex", gap: 14,
          animation: shaking ? "lock-shake 0.4s ease" : "none",
        }}
      >
        {[0, 1, 2, 3].map(i => (
          <div key={i} style={{
            width: 16, height: 16, borderRadius: "50%",
            background: i < pin.length ? "rgba(167,139,250,0.9)" : "var(--g12)",
            border: `2px solid ${i < pin.length ? "rgba(167,139,250,0.5)" : "var(--g10)"}`,
            transition: "background 0.12s, border-color 0.12s",
            boxShadow: i < pin.length ? "0 0 8px rgba(167,139,250,0.5)" : "none",
          }} />
        ))}
      </div>

      {error && (
        <div style={{ fontSize: 11.5, color: "var(--red)", fontWeight: 700 }}>{error}</div>
      )}

      {/* Hidden input for keyboard entry */}
      <input
        ref={inputRef}
        type="password"
        inputMode="numeric"
        maxLength={4}
        value={pin}
        onChange={e => {
          const val = e.target.value.replace(/\D/g, "").slice(0, 4);
          setPin(val);
          setError("");
          if (val.length === 4) submit(val);
        }}
        style={{ position: "absolute", opacity: 0, pointerEvents: "none", width: 1, height: 1 }}
      />

      {/* Numpad */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        {["1","2","3","4","5","6","7","8","9","","0","⌫"].map((d, i) => (
          <button
            key={i}
            onClick={() => d === "⌫" ? handleBackspace() : d !== "" ? handleKey(d) : undefined}
            disabled={d === ""}
            style={{
              width: 70, height: 70, borderRadius: 14,
              border: "1px solid var(--g07)",
              background: d === "⌫"
                ? "rgba(248,113,113,0.07)"
                : d === ""
                  ? "transparent"
                  : "var(--g03)",
              color: d === "⌫" ? "var(--red)" : "var(--t1)",
              fontSize: d === "⌫" ? 18 : 22,
              fontWeight: 700,
              cursor: d === "" ? "default" : "pointer",
              transition: "all 0.12s",
              opacity: d === "" ? 0 : 1,
            }}
            onMouseEnter={e => { if (d) { e.currentTarget.style.background = d === "⌫" ? "rgba(248,113,113,0.15)" : "var(--g07)"; } }}
            onMouseLeave={e => { if (d) { e.currentTarget.style.background = d === "⌫" ? "rgba(248,113,113,0.07)" : "var(--g03)"; } }}
          >
            {d}
          </button>
        ))}
      </div>

      <style>{`
        @keyframes lock-shake {
          0%, 100% { transform: translateX(0); }
          20%       { transform: translateX(-8px); }
          40%       { transform: translateX(8px); }
          60%       { transform: translateX(-6px); }
          80%       { transform: translateX(6px); }
        }
      `}</style>
    </div>
  );
}
