import { createContext, useContext, useState, useEffect, useRef, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ── Types ─────────────────────────────────────────────────────────────────────
export interface BootstrapperStatus {
  installed_version: string | null;
  latest_version: string | null;
  install_path: string;
  needs_update: boolean;
  exe_path: string | null;
}

export interface BootstrapperProgress {
  stage: string;
  package: string;
  package_index: number;
  total_packages: number;
  percent: number;
  speed_kbps: number;
  done: boolean;
  error: string | null;
}

export interface RobloxInstall {
  name: string;
  kind: "official" | "bloxstrap" | "fishstrap" | "reiya";
  exe_path: string | null;
  version: string | null;
  install_dir: string;
  found: boolean;
  is_protocol_handler: boolean;
}

export interface DetectedInstalls {
  installs: RobloxInstall[];
  protocol_handler_path: string | null;
}

interface BootstrapperContextValue {
  status: BootstrapperStatus | null;
  progress: BootstrapperProgress | null;
  installing: boolean;
  checking: boolean;
  error: string;
  successMsg: string;
  detectedInstalls: DetectedInstalls | null;
  detecting: boolean;
  preferredLauncher: string;
  refreshStatus: () => Promise<void>;
  checkUpdate: () => Promise<void>;
  startInstall: () => Promise<void>;
  scanInstalls: () => Promise<void>;
  updateLauncherPreference: (kind: string) => Promise<void>;
  clearMessages: () => void;
}

// ── Context ───────────────────────────────────────────────────────────────────
const BootstrapperContext = createContext<BootstrapperContextValue | null>(null);

export function useBootstrapper() {
  const ctx = useContext(BootstrapperContext);
  if (!ctx) throw new Error("useBootstrapper must be used inside BootstrapperProvider");
  return ctx;
}

// ── Provider ──────────────────────────────────────────────────────────────────
export function BootstrapperProvider({ children }: { children: ReactNode }) {
  const [status, setStatus]             = useState<BootstrapperStatus | null>(null);
  const [progress, setProgress]         = useState<BootstrapperProgress | null>(null);
  const [installing, setInstalling]     = useState(false);
  const [checking, setChecking]         = useState(false);
  const [error, setError]               = useState("");
  const [successMsg, setSuccessMsg]     = useState("");
  const [detectedInstalls, setDetected] = useState<DetectedInstalls | null>(null);
  const [detecting, setDetecting]       = useState(false);
  const [preferredLauncher, setPreferredLauncher] = useState<string>("auto");
  const unlistenRef                     = useRef<(() => void) | null>(null);

  // Load initial status once on mount and register the persistent event listener
  useEffect(() => {
    if ((window as any).__TAURI_INTERNALS__) {
      refreshStatus();
      scanInstalls();
      
      // Load launcher preference
      invoke<string>("get_launcher_preference")
        .then(setPreferredLauncher)
        .catch(() => {});

      // Register the event listener at app level — survives navigation
      const setupListener = async () => {
        if (unlistenRef.current) unlistenRef.current();
        unlistenRef.current = await listen<BootstrapperProgress>("bootstrapper-progress", ({ payload }) => {
          setProgress(payload);
          if (payload.done) {
            setInstalling(false);
            setSuccessMsg("Roblox installed successfully! Protocol registered.");
            refreshStatus();
            scanInstalls(); // Re-scan after install
          }
          if (payload.error) {
            setInstalling(false);
            setError(payload.error);
          }
        });
      };
      setupListener();
    } else {
      // Mock data for browser testing
      setDetected({
        installs: [
          {
            name: "Roblox (Official)",
            kind: "official",
            found: true,
            exe_path: "C:\\Users\\Mock\\AppData\\Local\\Roblox\\Versions\\version-mock1\\RobloxPlayerBeta.exe",
            version: "version-mock1",
            install_dir: "C:\\Users\\Mock\\AppData\\Local\\Roblox",
            is_protocol_handler: false,
          },
          {
            name: "Bloxstrap",
            kind: "bloxstrap",
            found: true,
            exe_path: "C:\\Users\\Mock\\AppData\\Local\\Bloxstrap\\Bloxstrap.exe",
            version: "version-mock2",
            install_dir: "C:\\Users\\Mock\\AppData\\Local\\Bloxstrap",
            is_protocol_handler: true,
          },
          {
            name: "Fishstrap",
            kind: "fishstrap",
            found: false,
            exe_path: null,
            version: null,
            install_dir: "",
            is_protocol_handler: false,
          },
          {
            name: "Reiya (Built-in)",
            kind: "reiya",
            found: true,
            exe_path: "C:\\Users\\Mock\\AppData\\Local\\Seistem\\Versions\\version-mock3\\RobloxPlayerBeta.exe",
            version: "version-mock3",
            install_dir: "C:\\Users\\Mock\\AppData\\Local\\Seistem",
            is_protocol_handler: false,
          }
        ],
        protocol_handler_path: "\"C:\\Users\\Mock\\AppData\\Local\\Bloxstrap\\Bloxstrap.exe\" \"%1\""
      });
      setStatus({
        installed_version: "version-mock3",
        latest_version: "version-mock3",
        install_path: "C:\\Users\\Mock\\AppData\\Local\\Seistem\\Versions",
        needs_update: false,
        exe_path: "C:\\Users\\Mock\\AppData\\Local\\Seistem\\Versions\\version-mock3\\RobloxPlayerBeta.exe"
      });
      setPreferredLauncher("auto");
    }

    return () => {
      if (unlistenRef.current) unlistenRef.current();
    };
  }, []);

  const refreshStatus = async () => {
    try {
      const s = await invoke<BootstrapperStatus>("bootstrapper_get_status");
      setStatus(s);
    } catch {}
  };

  const checkUpdate = async () => {
    setChecking(true);
    setError("");
    setSuccessMsg("");
    try {
      const s = await invoke<BootstrapperStatus>("bootstrapper_check_update");
      setStatus(s);
      if (!s.needs_update) setSuccessMsg("Roblox is already up to date!");
    } catch (e) {
      setError(String(e));
    } finally {
      setChecking(false);
    }
  };

  const startInstall = async () => {
    // Don't start if already running
    if (installing) return;
    setInstalling(true);
    setError("");
    setSuccessMsg("");
    setProgress(null);
    try {
      await invoke("bootstrapper_install");
    } catch (e) {
      setError(String(e));
      setInstalling(false);
    }
  };

  const scanInstalls = async () => {
    setDetecting(true);
    try {
      const result = await invoke<DetectedInstalls>("detect_roblox_installs");
      setDetected(result);
    } catch {}
    setDetecting(false);
  };

  const updateLauncherPreference = async (kind: string) => {
    try {
      await invoke("set_launcher_preference", { kind });
      setPreferredLauncher(kind);
    } catch (e) {
      setError(`Failed to set preference: ${e}`);
    }
  };

  const clearMessages = () => {
    setError("");
    setSuccessMsg("");
  };

  return (
    <BootstrapperContext.Provider value={{
      status, progress, installing, checking, error, successMsg,
      detectedInstalls, detecting, preferredLauncher,
      refreshStatus, checkUpdate, startInstall, scanInstalls, updateLauncherPreference, clearMessages,
    }}>
      {children}
    </BootstrapperContext.Provider>
  );
}
