import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface UpdateInfo {
  has_update: boolean;
  version: string;
  download_url: string;
  notes: string;
  current: string;
}

interface UpdateContextType {
  updateInfo: UpdateInfo | null;
  currentVersion: string;
  checking: boolean;
}

const UpdateContext = createContext<UpdateContextType>({
  updateInfo: null,
  currentVersion: "",
  checking: true,
});

export function useUpdate() {
  return useContext(UpdateContext);
}

export function UpdateProvider({ children }: { children: ReactNode }) {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [currentVersion, setCurrentVersion] = useState("");
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    invoke<string>("get_app_version")
      .then(v => setCurrentVersion(v))
      .catch(() => setCurrentVersion("1.0.0"));

    invoke<UpdateInfo>("check_for_update")
      .then(info => {
        if (info.has_update) setUpdateInfo(info);
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  return (
    <UpdateContext.Provider value={{ updateInfo, currentVersion, checking }}>
      {children}
    </UpdateContext.Provider>
  );
}
