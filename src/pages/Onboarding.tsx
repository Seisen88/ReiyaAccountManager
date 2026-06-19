import { useState } from "react";

interface Props {
  onDone: () => void;
}

const STEPS = [
  {
    id: "welcome",
    badge: "WELCOME",
    title: "Welcome to Reiya",
    subtitle: "Your all-in-one Roblox account manager",
    body: "Manage multiple Roblox accounts, track sessions, launch games, and configure your client — all from one place.",
    visual: <WelcomeVisual />,
  },
  {
    id: "features",
    badge: "WHAT YOU GET",
    title: "Everything you need",
    subtitle: "Built for serious players",
    body: null,
    visual: <FeaturesVisual />,
  },
  {
    id: "accounts",
    badge: "ACCOUNTS",
    title: "Add your first account",
    subtitle: "Paste a cookie, log in, or import a list",
    body: "Click the + button on the home screen to add accounts. You can import via cookie, browser login, or username:password combos.",
    visual: <AccountVisual />,
  },
  {
    id: "ready",
    badge: "ALL SET",
    title: "You're ready to go",
    subtitle: "Explore at your own pace",
    body: "Explore the sidebar: launch games from Home, manage accounts, browse the Hub, and configure your client via Bootstrapper.",
    visual: <ReadyVisual />,
  },
];

export default function Onboarding({ onDone }: Props) {
  const [step, setStep] = useState(0);
  const [exiting, setExiting] = useState(false);

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const handleNext = () => {
    if (isLast) {
      handleFinish();
    } else {
      setStep(s => s + 1);
    }
  };

  const handleFinish = () => {
    setExiting(true);
    localStorage.setItem("reiya_onboarding_v1", "done");
    setTimeout(onDone, 400);
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 99999,
      background: "#07080a",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      opacity: exiting ? 0 : 1,
      transition: "opacity 0.4s ease",
      overflow: "hidden",
    }}>
      {/* Ambient glow */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: "radial-gradient(ellipse 60% 40% at 50% 0%, rgba(232,232,232,0.04) 0%, transparent 70%)",
      }} />

      {/* Step dots */}
      <div style={{ position: "absolute", top: 28, display: "flex", gap: 8 }}>
        {STEPS.map((_, i) => (
          <div key={i} onClick={() => i < step && setStep(i)} style={{
            width: i === step ? 20 : 6, height: 6, borderRadius: 99,
            background: i === step ? "#E8E8E8" : i < step ? "rgba(232,232,232,0.35)" : "rgba(255,255,255,0.1)",
            transition: "all 0.3s ease", cursor: i < step ? "pointer" : "default",
          }} />
        ))}
      </div>

      {/* Skip button */}
      {!isLast && (
        <button onClick={handleFinish} style={{
          position: "absolute", top: 22, right: 28,
          padding: "6px 14px", borderRadius: 8,
          border: "1px solid rgba(255,255,255,0.06)",
          background: "transparent", color: "var(--t3)",
          fontSize: 11.5, fontWeight: 600, cursor: "pointer",
          transition: "color 0.15s",
        }}
          onMouseEnter={e => e.currentTarget.style.color = "var(--t2)"}
          onMouseLeave={e => e.currentTarget.style.color = "var(--t3)"}>
          Skip
        </button>
      )}

      {/* Main card */}
      <div style={{
        width: "100%", maxWidth: 720,
        padding: "0 32px",
        display: "flex", flexDirection: "column", alignItems: "center",
        gap: 0,
      }}>
        {/* Visual area */}
        <div style={{
          width: "100%", height: 280,
          display: "flex", alignItems: "center", justifyContent: "center",
          marginBottom: 36,
        }}>
          {current.visual}
        </div>

        {/* Badge */}
        <div style={{
          fontSize: 9.5, fontWeight: 900, letterSpacing: "0.14em",
          color: "rgba(232,232,232,0.4)", marginBottom: 12,
        }}>
          {current.badge}
        </div>

        {/* Title */}
        <h1 style={{
          fontSize: 32, fontWeight: 900, color: "#F0F1F6",
          letterSpacing: "-0.8px", lineHeight: 1.1,
          textAlign: "center", marginBottom: 10,
        }}>
          {current.title}
        </h1>

        {/* Subtitle */}
        <p style={{
          fontSize: 14, color: "var(--t2)", fontWeight: 500,
          textAlign: "center", marginBottom: current.body ? 12 : 0,
        }}>
          {current.subtitle}
        </p>

        {/* Body */}
        {current.body && (
          <p style={{
            fontSize: 12.5, color: "var(--t3)", textAlign: "center",
            lineHeight: 1.6, maxWidth: 500,
          }}>
            {current.body}
          </p>
        )}

        {/* Features grid on step 2 */}
        {current.id === "features" && (
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(2, 1fr)",
            gap: 10, marginTop: 18, width: "100%", maxWidth: 520,
          }}>
            {FEATURES.map(f => (
              <div key={f.label} style={{
                display: "flex", alignItems: "flex-start", gap: 12,
                padding: "12px 14px", borderRadius: 12,
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.05)",
              }}>
                <div style={{
                  width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                  background: f.color + "15", border: `1px solid ${f.color}25`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 14,
                }}>
                  {f.icon}
                </div>
                <div>
                  <div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--t1)", marginBottom: 2 }}>{f.label}</div>
                  <div style={{ fontSize: 10, color: "var(--t3)", lineHeight: 1.4 }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* CTA button */}
        <button onClick={handleNext} style={{
          marginTop: 32,
          padding: "12px 40px", borderRadius: 12,
          border: "none",
          background: isLast ? "rgba(232,232,232,0.95)" : "rgba(232,232,232,0.9)",
          color: "#07080a",
          fontSize: 13.5, fontWeight: 800, letterSpacing: "-0.1px",
          cursor: "pointer",
          boxShadow: "0 4px 20px rgba(232,232,232,0.15)",
          transition: "all 0.15s ease",
          display: "flex", alignItems: "center", gap: 8,
        }}
          onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 6px 24px rgba(232,232,232,0.22)"; }}
          onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "0 4px 20px rgba(232,232,232,0.15)"; }}>
          {isLast ? "Get Started" : "Continue"}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            {isLast
              ? <><polyline points="20 6 9 17 4 12" /></>
              : <><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></>
            }
          </svg>
        </button>

        {/* Step counter */}
        <div style={{ marginTop: 16, fontSize: 10, color: "var(--t3)", fontWeight: 600 }}>
          {step + 1} of {STEPS.length}
        </div>
      </div>
    </div>
  );
}

/* ── Visuals ── */

function WelcomeVisual() {
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%" }}>
      {/* Outer glow rings */}
      {[160, 200, 240].map((size, i) => (
        <div key={i} style={{
          position: "absolute",
          width: size, height: size, borderRadius: "50%",
          border: `1px solid rgba(232,232,232,${0.06 - i * 0.015})`,
          animation: `pulse-ring ${2.5 + i * 0.5}s ease-in-out infinite`,
        }} />
      ))}
      {/* Logo box */}
      <div style={{
        width: 96, height: 96, borderRadius: 22,
        background: "linear-gradient(135deg, rgba(232,232,232,0.12) 0%, rgba(232,232,232,0.04) 100%)",
        border: "1px solid rgba(232,232,232,0.2)",
        boxShadow: "0 0 40px rgba(232,232,232,0.08), inset 0 1px 0 rgba(255,255,255,0.1)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 42, position: "relative",
      }}>
        🎮
      </div>
    </div>
  );
}

function FeaturesVisual() {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "center", width: "100%" }}>
      {[
        { icon: "👤", label: "Multi-Account", color: "#60A5FA" },
        { icon: "🚀", label: "Quick Launch", color: "#34D399" },
        { icon: "📊", label: "Session Stats", color: "#A78BFA" },
        { icon: "⚙️", label: "Bootstrapper", color: "#FBBF24" },
      ].map((item, i) => (
        <div key={i} style={{
          display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
          padding: "18px 16px", borderRadius: 16,
          background: `${item.color}08`,
          border: `1px solid ${item.color}25`,
          minWidth: 90,
          boxShadow: `0 0 20px ${item.color}08`,
        }}>
          <div style={{ fontSize: 28 }}>{item.icon}</div>
          <div style={{ fontSize: 10, fontWeight: 700, color: item.color, textAlign: "center", whiteSpace: "nowrap" }}>{item.label}</div>
        </div>
      ))}
    </div>
  );
}

function AccountVisual() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: 360 }}>
      {[
        { name: "Player1", tag: "Main", color: "#34D399", avatar: "🙂" },
        { name: "AltAccount", tag: "Alt", color: "#60A5FA", avatar: "😎" },
        { name: "TradingAcc", tag: "Trade", color: "#A78BFA", avatar: "💎" },
      ].map((acc, i) => (
        <div key={i} style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "10px 14px", borderRadius: 12,
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.06)",
          opacity: i === 0 ? 1 : 0.5 + i * 0.1,
        }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>
            {acc.avatar}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--t1)" }}>{acc.name}</div>
            <div style={{ fontSize: 10, color: "var(--t3)" }}>User #{1000 + i * 337}</div>
          </div>
          <span style={{ fontSize: 9, fontWeight: 800, padding: "3px 8px", borderRadius: 6, background: acc.color + "18", color: acc.color }}>
            {acc.tag}
          </span>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#34D399", boxShadow: "0 0 6px #34D399" }} />
        </div>
      ))}
    </div>
  );
}

function ReadyVisual() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
      <div style={{
        width: 100, height: 100, borderRadius: "50%",
        background: "rgba(52,211,153,0.08)",
        border: "1px solid rgba(52,211,153,0.25)",
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: "0 0 40px rgba(52,211,153,0.1)",
      }}>
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {["Home", "Accounts", "Hub", "Bootstrapper", "Settings"].map(page => (
          <div key={page} style={{
            padding: "5px 11px", borderRadius: 8,
            background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
            fontSize: 10, fontWeight: 700, color: "var(--t3)",
          }}>
            {page}
          </div>
        ))}
      </div>
    </div>
  );
}

const FEATURES = [
  { icon: "👥", label: "Multi-Account", desc: "Manage unlimited Roblox accounts in one place.", color: "#60A5FA" },
  { icon: "🚀", label: "Quick Launch", desc: "Launch any account into any game in one click.", color: "#34D399" },
  { icon: "📊", label: "Session Tracking", desc: "See playtime stats, top games, and history.", color: "#A78BFA" },
  { icon: "⚡", label: "FastFlags", desc: "Inject client flags to customize the Roblox runtime.", color: "#FBBF24" },
  { icon: "🔒", label: "Secure Storage", desc: "Cookies are AES-encrypted at rest on your machine.", color: "#F87171" },
  { icon: "🖥️", label: "Bootstrapper", desc: "Install and update Roblox without the official launcher.", color: "#818CF8" },
];
