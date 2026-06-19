import { NavLink } from "react-router-dom";

const NAV = [
  { to: "/",             label: "Home",         Icon: IcHome },
  { to: "/accounts",    label: "Accounts",     Icon: IcAccounts },
  { to: "/hub",         label: "Hub",          Icon: IcHub },
  { to: "/utilities",   label: "Utilities",    Icon: IcGrid },
  { to: "/bootstrapper",label: "Bootstrapper", Icon: IcBootstrapper },
  { to: "/settings",   label: "Settings",     Icon: IcSettings },
];

export default function Sidebar() {
  return (
    <aside style={{
      width: 210,
      flexShrink: 0,
      background: "var(--surface)",
      borderRight: "1px solid var(--border)",
      display: "flex",
      flexDirection: "column",
      padding: "20px 12px",
      gap: 4,
    }}>
      {/* Brand */}
      <div style={{ padding: "0 8px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img
            src="/logo.png"
            alt="Reiya Logo"
            style={{
              width: 40,
              height: 40,
              objectFit: "contain",
            }}
          />
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: "var(--t1)", lineHeight: 1 }}>Reiya</div>
            <div style={{ fontSize: 10, color: "var(--t3)", marginTop: 2 }}>Account Manager</div>
          </div>
        </div>
      </div>

      <div className="divider" style={{ marginBottom: 12 }} />

      <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", color: "var(--t3)", padding: "0 10px", marginBottom: 6 }}>
        MENU
      </p>

      {NAV.map(({ to, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === "/"}
          className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
        >
          <span className="nav-icon"><Icon /></span>
          {label}
        </NavLink>
      ))}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Socials */}
      <div style={{ marginBottom: 10 }}>
        <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", color: "var(--t3)", padding: "0 10px", marginBottom: 8 }}>
          COMMUNITY
        </p>
        <div style={{ display: "flex", gap: 4, padding: "0 4px", flexWrap: "wrap" }}>
          {SOCIALS.map(({ label, href, Icon, color }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              title={label}
              style={{
                width: 30, height: 30,
                borderRadius: 8,
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "var(--t3)",
                textDecoration: "none",
                transition: "all .12s",
                flexShrink: 0,
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLAnchorElement).style.background = color + "22";
                (e.currentTarget as HTMLAnchorElement).style.borderColor = color + "55";
                (e.currentTarget as HTMLAnchorElement).style.color = color;
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLAnchorElement).style.background = "var(--surface-2)";
                (e.currentTarget as HTMLAnchorElement).style.borderColor = "var(--border)";
                (e.currentTarget as HTMLAnchorElement).style.color = "var(--t3)";
              }}
            >
              <Icon />
            </a>
          ))}
        </div>
      </div>

      {/* Version pill */}
      <div style={{
        padding: "8px 10px",
        background: "var(--surface-2)",
        borderRadius: 10,
        border: "1px solid var(--border)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--t2)" }}>v1.0.0</div>
          <div style={{ fontSize: 9, color: "var(--t3)", marginTop: 1 }}>Up to date</div>
        </div>
        <span className="chip chip-green" style={{ fontSize: 9, padding: "2px 7px" }}>●  Live</span>
      </div>
    </aside>
  );
}

/* ── Socials config — update hrefs to real links ── */
const SOCIALS = [
  {
    label: "Discord",
    href: "https://discord.gg/F4sAf6z8Ph",
    color: "#5865F2",
    Icon: () => (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
      </svg>
    ),
  },
  {
    label: "YouTube",
    href: "https://www.youtube.com/@SeisenHub",
    color: "#FF0000",
    Icon: () => (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
      </svg>
    ),
  },
  {
    label: "TikTok",
    href: "https://www.tiktok.com/@seisen.hub",
    color: "#EE1D52",
    Icon: () => (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.18 8.18 0 0 0 4.78 1.52V6.76a4.85 4.85 0 0 1-1.01-.07z"/>
      </svg>
    ),
  },
  {
    label: "Website",
    href: "https://seisen.vercel.app/",
    color: "#34D399",
    Icon: () => (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
  },
  {
    label: "Facebook",
    href: "https://facebook.com/",
    color: "#1877F2",
    Icon: () => (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
      </svg>
    ),
  },
  {
    label: "Twitter / X",
    href: "https://x.com/",
    color: "#E7E9EA",
    Icon: () => (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
      </svg>
    ),
  },
  {
    label: "GitHub",
    href: "https://github.com/Seisen88",
    color: "#E8E8E8",
    Icon: () => (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"/>
      </svg>
    ),
  },
];

/* ── Nav icons ── */
function IcHome() {
  return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M2 6.8L8 2l6 4.8V14a1 1 0 01-1 1H3a1 1 0 01-1-1V6.8z"/></svg>;
}
function IcAccounts() {
  return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="5.5" r="2.5"/><path d="M1 14c0-2.5 2-4 5-4s5 1.5 5 4"/><path d="M11.5 2.5a2.5 2.5 0 010 5M15 14c0-2-1.5-3.3-3.5-3.7"/></svg>;
}
function IcHub() {
  return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><polygon points="8,1.5 10.2,6 15,6.5 11.5,10 12.5,15 8,12.5 3.5,15 4.5,10 1,6.5 5.8,6"/></svg>;
}
function IcGrid() {
  return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1.5"/><rect x="9" y="1.5" width="5.5" height="5.5" rx="1.5"/><rect x="1.5" y="9" width="5.5" height="5.5" rx="1.5"/><rect x="9" y="9" width="5.5" height="5.5" rx="1.5"/></svg>;
}
function IcBootstrapper() {
  return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v8M5 7l3 3 3-3"/><rect x="2" y="12" width="12" height="2" rx="1"/></svg>;
}
function IcSettings() {
  return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/></svg>;
}
