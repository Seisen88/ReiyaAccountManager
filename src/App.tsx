import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import TitleBar     from "./components/TitleBar";
import Sidebar      from "./components/Sidebar";
import Home         from "./pages/Home";
import Accounts     from "./pages/Accounts";
import Hub          from "./pages/Hub";
import Utilities    from "./pages/Utilities";
import Settings     from "./pages/Settings";
import Bootstrapper from "./pages/Bootstrapper";
import LaunchProgress from "./pages/LaunchProgress";
import Onboarding    from "./pages/Onboarding";
import KeyGate       from "./pages/KeyGate";
import UpdatePrompt  from "./pages/UpdatePrompt";
import { BootstrapperProvider } from "./context/BootstrapperContext";
import { UpdateProvider, useUpdate } from "./context/UpdateContext";

interface LicenseStatus {
  needs_key: boolean;
  key: string;
  expires_at: string | null;
  reason: "missing" | "expired" | "valid";
}

function AppContent() {
  const location = useLocation();
  const isProgressWindow = location.pathname === "/launch-progress";

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
            <Route path="/settings"     element={<Settings />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function AppInner() {
  const { updateInfo } = useUpdate();
  const [licenseChecked, setLicenseChecked] = useState(false);
  const [licenseStatus, setLicenseStatus]   = useState<LicenseStatus | null>(null);
  const [onboardingDone, setOnboardingDone] = useState(
    () => localStorage.getItem("reiya_onboarding_v1") === "done"
  );

  useEffect(() => {
    invoke<LicenseStatus>("check_license")
      .then(status => { setLicenseStatus(status); setLicenseChecked(true); })
      .catch(() => {
        setLicenseStatus({ needs_key: false, key: "", expires_at: null, reason: "valid" });
        setLicenseChecked(true);
      });
  }, []);

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
          <span style={{ fontSize: 11, color: "var(--t3)", fontWeight: 600 }}>Starting Reiya…</span>
        </div>
      </div>
    );
  }

  const needsKey   = licenseStatus?.needs_key ?? false;
  const keyReason  = licenseStatus?.reason ?? "missing";

  return (
    <BrowserRouter>
      <BootstrapperProvider>
        {/* Update gate — mandatory, shown before everything else once license passes */}
        {!needsKey && updateInfo && (
          <UpdatePrompt info={updateInfo} />
        )}
        {needsKey && (
          <KeyGate
            reason={keyReason as "missing" | "expired"}
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

export default function App() {
  return (
    <UpdateProvider>
      <AppInner />
    </UpdateProvider>
  );
}
