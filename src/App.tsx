import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import TitleBar     from "./components/TitleBar";
import Sidebar      from "./components/Sidebar";
import Home         from "./pages/Home";
import Accounts     from "./pages/Accounts";
import Hub          from "./pages/Hub";
import Utilities    from "./pages/Utilities";
import Settings     from "./pages/Settings";
import Bootstrapper from "./pages/Bootstrapper";
import ThemePage    from "./pages/Theme";
import LaunchProgress from "./pages/LaunchProgress";
import Onboarding    from "./pages/Onboarding";
import KeyGate       from "./pages/KeyGate";
import UpdatePrompt  from "./pages/UpdatePrompt";
import AppLock       from "./pages/AppLock";
import { BootstrapperProvider } from "./context/BootstrapperContext";
import { UpdateProvider, useUpdate } from "./context/UpdateContext";
import { useLanguage } from "./context/LanguageContext";

interface LicenseStatus {
  needs_key: boolean;
  key: string;
  expires_at: string | null;
  reason: "missing" | "expired" | "tampered" | "valid";
}

const PAGE_LABELS: Record<string, string> = {
  "/":             "On Home",
  "/accounts":     "Managing Accounts",
  "/hub":          "Using Hub",
  "/utilities":    "Using Utilities",
  "/bootstrapper": "Using Bootstrapper",
  "/theme":        "Customizing Themes",
  "/settings":     "In Settings",
};

function AppContent() {
  const location = useLocation();
  const isProgressWindow = location.pathname === "/launch-progress";

  useEffect(() => {
    if (isProgressWindow) return;
    const label = PAGE_LABELS[location.pathname] ?? "In App";
    invoke("update_discord_rpc", { page: label }).catch(() => {});
  }, [location.pathname]);

  if (isProgressWindow) {
    return (
      <Routes>
        <Route path="/launch-progress" element={<LaunchProgress />} />
      </Routes>
    );
  }

  return (
    <div className="app">
      <TitleBar />
      <div className="app-body">
        <Sidebar />
        <main className="main">
          <Routes>
            <Route path="/"             element={<Home />} />
            <Route path="/accounts"     element={<Accounts />} />
            <Route path="/hub"          element={<Hub />} />
            <Route path="/utilities"    element={<Utilities />} />
            <Route path="/bootstrapper" element={<Bootstrapper />} />
            <Route path="/theme"        element={<ThemePage />} />
            <Route path="/settings"     element={<Settings />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function AppInner() {
  const { updateInfo } = useUpdate();
  const { t, setLanguage } = useLanguage();
  const { setTheme } = useTheme();
  const [licenseChecked, setLicenseChecked] = useState(false);
  const [licenseStatus, setLicenseStatus]   = useState<LicenseStatus | null>(null);
  const [onboardingDone, setOnboardingDone] = useState(
    () => localStorage.getItem("reiya_onboarding_v1") === "done"
  );
  const [locked, setLocked]               = useState(false);
  const [lockOnMinimize, setLockOnMinimize] = useState(false);
  // Force re-render every 800ms while an update is pending so DevTools DOM removal is undone by React
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!updateInfo) return;
    const id = setInterval(() => setTick(t => t + 1), 800);
    return () => clearInterval(id);
  }, [updateInfo]);

  useEffect(() => {
    Promise.all([
      invoke<LicenseStatus>("check_license").catch(() => ({ needs_key: false, key: "", expires_at: null, reason: "valid" } as LicenseStatus)),
      invoke<any>("get_settings").catch(() => ({})),
    ]).then(([status, settings]) => {
      setLicenseStatus(status);
      setLicenseChecked(true);
      if (settings?.Language) setLanguage(settings.Language);
      if (settings?.ThemeName) {
        const saved = THEMES.find(t => t.id === settings.ThemeName);
        if (saved) setTheme(saved);
        else applyTheme(THEMES[0]);
      }
      if (settings?.AppLockEnabled) setLocked(true);
      if (settings?.AppLockOnMinimize) setLockOnMinimize(true);
      localStorage.setItem("reiya_use_bootstrapper", settings?.UseBootstrapperLaunch !== false ? "true" : "false");
      invoke("start_discord_rpc").catch(() => {});
    });
  }, []);

  useEffect(() => {
    if (!lockOnMinimize) return;
    let unlisten: (() => void) | null = null;
    listen("window-restored-from-tray", () => setLocked(true)).then(u => { unlisten = u; });
    return () => { if (unlisten) unlisten(); };
  }, [lockOnMinimize]);

  if (!licenseChecked) {
    return (
      <div style={{
        position: "fixed", inset: 0, background: "#07080a",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "spin 1s linear infinite" }}>
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          <span style={{ fontSize: 11, color: "var(--t3)", fontWeight: 600 }}>{t("loading_config")}</span>
        </div>
      </div>
    );
  }

  const needsKey   = licenseStatus?.needs_key ?? false;
  const keyReason  = licenseStatus?.reason ?? "missing";

  return (
    <BrowserRouter>
      <BootstrapperProvider>
        {locked && <AppLock onUnlocked={() => setLocked(false)} />}
        {/* Mandatory update blocker — cannot be dismissed, survives restarts */}
        {updateInfo && <UpdatePrompt info={updateInfo} />}
        {needsKey && (
          <KeyGate
            reason={keyReason as "missing" | "expired" | "tampered"}
            onValidated={() => setLicenseStatus(s => s ? { ...s, needs_key: false, reason: "valid" } : s)}
          />
        )}
        {!needsKey && !updateInfo && !onboardingDone && (
          <Onboarding onDone={() => setOnboardingDone(true)} />
        )}
        <AppContent />
      </BootstrapperProvider>
    </BrowserRouter>
  );
}

import { LanguageProvider } from "./context/LanguageContext";
import { ThemeProvider, useTheme, THEMES, applyTheme } from "./context/ThemeContext";
import { ToastProvider } from "./components/Toast";

export default function App() {
  // The launch_progress window loads index.html with pathname replaced via initialization_script.
  // Render it immediately — no license check, no settings load, no delay.
  if (window.location.pathname === "/launch-progress") {
    return (
      <LanguageProvider>
        <ThemeProvider>
          <LaunchProgress />
        </ThemeProvider>
      </LanguageProvider>
    );
  }

  return (
    <UpdateProvider>
      <LanguageProvider>
        <ThemeProvider>
          <ToastProvider>
            <AppInner />
          </ToastProvider>
        </ThemeProvider>
      </LanguageProvider>
    </UpdateProvider>
  );
}
