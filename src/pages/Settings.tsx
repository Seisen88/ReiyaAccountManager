import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import {
  ChevronLeftIcon, CheckIcon, LoaderIcon,
  SlidersIcon, ZapIcon, ClockIcon, LayoutIcon,
  GamepadIcon, KeyIcon, ActivityIcon, WatchIcon,
  BellIcon, MessageSquareIcon, ServerIcon, ShieldIcon,
  SettingsIcon, DatabaseIcon, TerminalIcon,
} from "../components/Icons";

const TABS = [
  { id: "app",       label: "App",        Icon: SettingsIcon,  accent: "#A78BFA",
    desc: "General application behavior and UI preferences" },
  { id: "client",    label: "Client",     Icon: GamepadIcon,   accent: "#60A5FA",
    desc: "Roblox client, mutex, and credential options" },
  { id: "watchdog",  label: "Watchdog",   Icon: WatchIcon,     accent: "#34D399",
    desc: "Auto-rejoin and session history settings" },
  { id: "alerts",    label: "Alerts",     Icon: BellIcon,      accent: "#FBBF24",
    desc: "Notifications, sounds, and Discord webhooks" },
  { id: "developer", label: "Developer",  Icon: TerminalIcon,  accent: "#F87171",
    desc: "Local web server API and endpoint permissions" },
] as const;

type TabId = typeof TABS[number]["id"];

const APP_SECTIONS = [
  {
    id: "app-options", Icon: SlidersIcon, title: "App Options", accent: "#A78BFA",
    fields: (s: any, u: (k: string, v: any) => void) => (<>
      <SettingRow label="Check for updates on launch" desc="Automatically checks for a new version of Reiya every time you open the app."><ToggleSwitch value={s.CheckForUpdates} onChange={v => u("CheckForUpdates", v)} /></SettingRow>
      <SettingRow label="Launch app on Windows startup" desc="Reiya will start automatically when you log into Windows."><ToggleSwitch value={s.RunOnStartup} onChange={v => u("RunOnStartup", v)} /></SettingRow>
      <SettingRow label="Close to system tray instead of exiting" desc="When enabled, clicking × hides the window. Use the tray icon to reopen or quit."><ToggleSwitch value={s.MinimizeToTray} onChange={v => u("MinimizeToTray", v)} /></SettingRow>
      <SettingRow label="Show account presence status" desc="Shows whether each account is currently online or in-game."><ToggleSwitch value={s.ShowAccountPresence} onChange={v => u("ShowAccountPresence", v)} /></SettingRow>
    </>),
  },
  {
    id: "optimization", Icon: ZapIcon, title: "Client Optimization", accent: "#34D399",
    fields: (s: any, u: (k: string, v: any) => void) => (<>
      <SettingRow label="Unlock FPS Limit" desc="Removes the default 60fps cap via FastFlag injection"><ToggleSwitch value={s.UnlockFps} onChange={v => u("UnlockFps", v)} /></SettingRow>
      <SettingRow label="Use custom client settings override" desc="Applies ClientAppSettings.json on each launch"><ToggleSwitch value={s.UseCustomSettings} onChange={v => u("UseCustomSettings", v)} /></SettingRow>
      <SettingRow label="Max FPS Limit" desc="Target framerate when FPS unlock is active"><NumberInput value={s.MaxFps} onChange={v => u("MaxFps", v)} /></SettingRow>
    </>),
  },
  {
    id: "limits", Icon: ClockIcon, title: "Limits & Delays", accent: "#FBBF24",
    fields: (s: any, u: (k: string, v: any) => void) => (<>
      <SettingRow label="Launch Delay (seconds)" desc="Wait time between successive account launches"><NumberInput value={s.LaunchDelay} onChange={v => u("LaunchDelay", v)} /></SettingRow>
      <SettingRow label="Global Launch Cooldown (s)" desc="Minimum gap between any two launches globally"><NumberInput value={s.GlobalLaunchCooldownSeconds} onChange={v => u("GlobalLaunchCooldownSeconds", v)} /></SettingRow>
      <SettingRow label="Daily Play Goal (minutes)" desc="Target play time shown on the dashboard"><NumberInput value={s.DailyPlayGoalMinutes} onChange={v => u("DailyPlayGoalMinutes", v)} /></SettingRow>
    </>),
  },
  {
    id: "ui", Icon: LayoutIcon, title: "UI Preferences", accent: "#60A5FA",
    fields: (s: any, u: (k: string, v: any) => void) => (<>
      <SettingRow label="Language" desc="Choose the display language for the app.">
        <SelectInput value={s.Language ?? "en"} onChange={v => u("Language", v)} options={LANGUAGES} />
      </SettingRow>
      <SettingRow label="Max Recent Games limit" desc="How many recent games to show in the launcher"><NumberInput value={s.MaxRecentGames} onChange={v => u("MaxRecentGames", v)} /></SettingRow>
      <SettingRow label="Region Format" desc="Template for displaying player location"><TextInput value={s.RegionFormat} onChange={v => u("RegionFormat", v)} placeholder="<city>, <countryCode>" /></SettingRow>
      <SettingRow label="Presence Refresh (sec)" desc="How often to re-fetch online presence data"><NumberInput value={s.PresenceRefreshInterval} onChange={v => u("PresenceRefreshInterval", v)} /></SettingRow>
    </>),
  },
];

const CLIENT_SECTIONS = [
  {
    id: "mutex", Icon: GamepadIcon, title: "Mutex & Multi-Instance", accent: "#60A5FA",
    fields: (s: any, u: (k: string, v: any) => void) => (<>
      <SettingRow label="Enable Multi-Instance" desc="Bypasses the Roblox singleton mutex lock"><ToggleSwitch value={s.MultiRoblox} onChange={v => u("MultiRoblox", v)} /></SettingRow>
      <SettingRow label="Use Bootstrapper to launch" desc="Routes launches through the Reiya bootstrapper"><ToggleSwitch value={s.UseBootstrapperLaunch} onChange={v => u("UseBootstrapperLaunch", v)} /></SettingRow>
      <SettingRow label="Shuffle lowest player count server" desc="Joins a low-population server automatically"><ToggleSwitch value={s.ShuffleLowestServer} onChange={v => u("ShuffleLowestServer", v)} /></SettingRow>
    </>),
  },
  {
    id: "credentials", Icon: KeyIcon, title: "Credential Options", accent: "#34D399",
    fields: (s: any, u: (k: string, v: any) => void) => (<>
      <SettingRow label="Save account passwords" desc="Stores user:pass alongside the session cookie"><ToggleSwitch value={s.SavePasswords} onChange={v => u("SavePasswords", v)} /></SettingRow>
      <SettingRow label="Clipboard cookie auto-detection" desc="Watches clipboard for .ROBLOSECURITY values"><ToggleSwitch value={s.ClipboardCookieDetect} onChange={v => u("ClipboardCookieDetect", v)} /></SettingRow>
      <SettingRow label="Auto-refresh expired cookies" desc="Re-authenticates cookies in the background"><ToggleSwitch value={s.AutoRefreshCookies} onChange={v => u("AutoRefreshCookies", v)} /></SettingRow>
    </>),
  },
  {
    id: "health", Icon: ActivityIcon, title: "Health Monitoring", accent: "#F87171",
    fields: (s: any, u: (k: string, v: any) => void) => (<>
      <SettingRow label="Cookie Health Monitor" desc="Background task that periodically validates cookies"><ToggleSwitch value={s.CookieHealthMonitorEnabled} onChange={v => u("CookieHealthMonitorEnabled", v)} /></SettingRow>
      <SettingRow label="Cookie check interval (min)" desc="How often the health monitor runs its checks"><NumberInput value={s.CookieHealthIntervalMinutes} onChange={v => u("CookieHealthIntervalMinutes", v)} /></SettingRow>
      <SettingRow label="Auto-Daily Backup" desc="Creates a daily snapshot of your accounts file"><ToggleSwitch value={s.AutoDailyBackup} onChange={v => u("AutoDailyBackup", v)} /></SettingRow>
    </>),
  },
];

const WATCHDOG_SECTIONS = [
  {
    id: "rejoin", Icon: WatchIcon, title: "Auto-Rejoin Watchdog", accent: "#34D399",
    fields: (s: any, u: (k: string, v: any) => void) => (<>
      <SettingRow label="Enable Auto-Rejoin" desc="Restarts disconnected Roblox sessions automatically"><ToggleSwitch value={s.AutoRejoinEnabled} onChange={v => u("AutoRejoinEnabled", v)} /></SettingRow>
      <SettingRow label="Rejoin Delay (seconds)" desc="Wait before attempting to rejoin after disconnect"><NumberInput value={s.AutoRejoinDelaySeconds} onChange={v => u("AutoRejoinDelaySeconds", v)} /></SettingRow>
      <SettingRow label="Max Rejoin Attempts" desc="Stop retrying after this many failed rejoins"><NumberInput value={s.AutoRejoinMaxAttempts} onChange={v => u("AutoRejoinMaxAttempts", v)} /></SettingRow>
    </>),
  },
  {
    id: "history", Icon: DatabaseIcon, title: "Session History", accent: "#60A5FA",
    fields: (s: any, u: (k: string, v: any) => void) => (<>
      <SettingRow label="Record session activity" desc="Saves launch time, duration, and game per session"><ToggleSwitch value={s.SessionHistoryEnabled} onChange={v => u("SessionHistoryEnabled", v)} /></SettingRow>
      <SettingRow label="Max history records" desc="Oldest records are pruned beyond this limit"><NumberInput value={s.SessionHistoryMaxRecords} onChange={v => u("SessionHistoryMaxRecords", v)} /></SettingRow>
    </>),
  },
];

const ALERTS_SECTIONS = [
  {
    id: "notifications", Icon: BellIcon, title: "Notifications & Alerts", accent: "#FBBF24",
    fields: (s: any, u: (k: string, v: any) => void) => (<>
      <SettingRow label="Toast notifications" desc="System tray popup alerts for key events"><ToggleSwitch value={s.ToastNotificationsEnabled} onChange={v => u("ToastNotificationsEnabled", v)} /></SettingRow>
      <SettingRow label="Audio alert sounds" desc="Plays a sound when sessions start or disconnect"><ToggleSwitch value={s.SoundAlertsEnabled} onChange={v => u("SoundAlertsEnabled", v)} /></SettingRow>
      <SettingRow label="Warn on disconnect" desc="Alert when any account session is lost"><ToggleSwitch value={s.DisconnectAlertEnabled} onChange={v => u("DisconnectAlertEnabled", v)} /></SettingRow>
      <SettingRow label="Notify on launch success" desc="Confirms when a launch completes without errors"><ToggleSwitch value={s.LaunchSuccessAlert} onChange={v => u("LaunchSuccessAlert", v)} /></SettingRow>
    </>),
  },
  {
    id: "discord", Icon: MessageSquareIcon, title: "Discord Webhook", accent: "#818CF8",
    fields: (s: any, u: (k: string, v: any) => void) => (<>
      <SettingRow label="Webhook URL" desc="POST target for disconnect and crash events">
        <TextInput value={s.DiscordWebhookUrl} onChange={v => u("DiscordWebhookUrl", v)} placeholder="https://discord.com/api/webhooks/..." wide />
      </SettingRow>
    </>),
  },
];

const DEVELOPER_SECTIONS = [
  {
    id: "webserver", Icon: ServerIcon, title: "Local Web Server", accent: "#34D399",
    fields: (s: any, u: (k: string, v: any) => void) => (<>
      <SettingRow label="Developer mode" desc="Unlocks advanced override options"><ToggleSwitch value={s.DeveloperModeEnabled} onChange={v => u("DeveloperModeEnabled", v)} /></SettingRow>
      <SettingRow label="Enable Web Server API" desc="Starts a local HTTP server for remote control"><ToggleSwitch value={s.WebServerEnabled} onChange={v => u("WebServerEnabled", v)} /></SettingRow>
      <SettingRow label="Web Server Port" desc="Port the local API listens on"><NumberInput value={s.WebServerPort} onChange={v => u("WebServerPort", v)} /></SettingRow>
      <SettingRow label="Require API password" desc="Adds authentication to all API requests"><ToggleSwitch value={s.RequirePassword} onChange={v => u("RequirePassword", v)} /></SettingRow>
      <SettingRow label="API access key" desc="Password required for authenticated requests">
        <TextInput value={s.WebServerPassword} onChange={v => u("WebServerPassword", v)} placeholder="Leave blank for open access" />
      </SettingRow>
    </>),
  },
  {
    id: "permissions", Icon: ShieldIcon, title: "Endpoint Permissions", accent: "#F87171",
    fields: (s: any, u: (k: string, v: any) => void) => (<>
      <SettingRow label="Allow GET cookie" desc="Remote callers can read .ROBLOSECURITY values"><ToggleSwitch value={s.AllowGetCookie} onChange={v => u("AllowGetCookie", v)} /></SettingRow>
      <SettingRow label="Allow GET accounts" desc="Remote callers can list all managed accounts"><ToggleSwitch value={s.AllowGetAccounts} onChange={v => u("AllowGetAccounts", v)} /></SettingRow>
      <SettingRow label="Allow remote launch" desc="Remote callers can trigger account launches"><ToggleSwitch value={s.AllowLaunchAccount} onChange={v => u("AllowLaunchAccount", v)} /></SettingRow>
      <SettingRow label="Allow account edits" desc="Remote callers can modify account configuration"><ToggleSwitch value={s.AllowAccountModifications} onChange={v => u("AllowAccountModifications", v)} /></SettingRow>
      <SettingRow label="Disable remote image loading" desc="Skips avatar/thumbnail fetches to save bandwidth"><ToggleSwitch value={s.DisableImageLoading} onChange={v => u("DisableImageLoading", v)} /></SettingRow>
      <SettingRow label="Allow LAN / WAN connections" desc="Accepts connections from outside localhost"><ToggleSwitch value={s.AllowExternalConnections} onChange={v => u("AllowExternalConnections", v)} /></SettingRow>
    </>),
  },
];

const SECTIONS_BY_TAB: Record<TabId, any[]> = {
  app: APP_SECTIONS, client: CLIENT_SECTIONS, watchdog: WATCHDOG_SECTIONS,
  alerts: ALERTS_SECTIONS, developer: DEVELOPER_SECTIONS,
};

export default function Settings() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>("app");
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { loadSettings(); }, []);

  const loadSettings = async () => {
    try {
      const data = await invoke<any>("get_settings");
      const defaults = {
        CheckForUpdates: true, SavePasswords: true, DisableAgingAlert: false,
        HideMultiRobloxAlert: false, RunOnStartup: false, MinimizeToTray: true,
        AutoRefreshCookies: true, MultiRoblox: true, ShuffleLowestServer: false,
        UseCustomSettings: false, UseBootstrapperLaunch: false, UnlockFps: false,
        MaxFps: 120, LaunchDelay: 3.0, MaxRecentGames: 8,
        RegionFormat: "<city>, <countryCode>", ShowAccountPresence: true,
        PresenceRefreshInterval: 30, CookieHealthMonitorEnabled: true,
        CookieHealthIntervalMinutes: 60, AutoRejoinEnabled: false,
        AutoRejoinDelaySeconds: 30, AutoRejoinMaxAttempts: 3,
        SessionHistoryEnabled: true, SessionHistoryMaxRecords: 500,
        Language: "en", ThemeName: "Default", AccentColor: "#E8E8E8", ColorMode: "Dark",
        ToastNotificationsEnabled: true, DisconnectAlertEnabled: true,
        LaunchSuccessAlert: false, SoundAlertsEnabled: false,
        AppLockEnabled: false, AppLockOnMinimize: false, AppLockPinHash: "",
        AutoDailyBackup: true, GlobalLaunchCooldownSeconds: 0,
        DailyPlayGoalMinutes: 0, ClipboardCookieDetect: false,
        DiscordWebhookUrl: "", DeveloperModeEnabled: false,
        WebServerEnabled: false, WebServerPort: 7963, RequirePassword: false,
        WebServerPassword: "", AllowGetCookie: true, AllowGetAccounts: true,
        AllowLaunchAccount: true, AllowAccountModifications: true,
        DisableImageLoading: false, AllowExternalConnections: false,
      };
      setSettings({ ...defaults, ...data });
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  };

  const handleSave = async () => {
    setSaving(true); setError(""); setSaveSuccess(false);
    try {
      await invoke("save_settings", { settings });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e) { setError(String(e)); } finally { setSaving(false); }
  };

  const updateField = (key: string, value: any) => setSettings((prev: any) => ({ ...prev, [key]: value }));

  if (loading) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
        <div style={{ color: "var(--t2)", display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
          <LoaderIcon size={16} style={{ animation: "spin 1s linear infinite" }} />
          Loading configuration…
        </div>
      </div>
    );
  }

  const sections = SECTIONS_BY_TAB[activeTab] ?? [];
  const activeTabDef = TABS.find(t => t.id === activeTab)!;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)", overflow: "hidden" }}>

      {/* Top navigation bar */}
      <div style={{
        padding: "0 24px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(8,9,12,0.7)",
        display: "flex", alignItems: "stretch", justifyContent: "space-between",
        flexShrink: 0, height: 48,
      }}>
        {/* Tabs */}
        <div style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
          {TABS.map(({ id, label, Icon, accent }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => setActiveTab(id as TabId)}
                style={{
                  display: "flex", alignItems: "center", gap: 7,
                  padding: "0 16px", border: "none", background: "transparent",
                  color: active ? "var(--t1)" : "var(--t3)",
                  fontSize: 12, fontWeight: active ? 700 : 500,
                  cursor: "pointer", transition: "all .15s",
                  borderBottom: active ? `2px solid ${accent}` : "2px solid transparent",
                  marginBottom: -1,
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.color = "var(--t2)"; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.color = "var(--t3)"; }}
              >
                <Icon size={13} color={active ? accent : "currentColor"} />
                {label}
              </button>
            );
          })}
        </div>

        {/* Back button */}
        <button
          onClick={() => navigate("/")}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "0 12px", border: "none", background: "transparent",
            color: "var(--t3)", fontSize: 11.5, fontWeight: 600,
            cursor: "pointer", transition: "color .12s",
          }}
          onMouseEnter={e => e.currentTarget.style.color = "var(--t2)"}
          onMouseLeave={e => e.currentTarget.style.color = "var(--t3)"}
        >
          <ChevronLeftIcon size={12} /> Back
        </button>
      </div>

      {/* Page header for active tab */}
      <div style={{
        padding: "20px 28px 16px",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        flexShrink: 0,
        background: `linear-gradient(135deg, ${activeTabDef.accent}06 0%, transparent 60%)`,
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 38, height: 38, borderRadius: 10, flexShrink: 0,
              background: activeTabDef.accent + "14",
              border: `1px solid ${activeTabDef.accent}28`,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <activeTabDef.Icon size={17} color={activeTabDef.accent} />
            </div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 900, color: "var(--t1)", letterSpacing: "-0.3px" }}>
                {activeTabDef.label} Settings
              </div>
              <div style={{ fontSize: 11, color: "var(--t3)", marginTop: 2 }}>{activeTabDef.desc}</div>
            </div>
          </div>

          {error && (
            <div style={{ padding: "7px 13px", borderRadius: 8, background: "rgba(248,113,113,0.07)", border: "1px solid rgba(248,113,113,0.18)", color: "var(--red)", fontSize: 11.5 }}>
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Settings content — 2 col grid */}
      <div className="scroll" style={{ flex: 1, padding: "20px 28px 24px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, maxWidth: 1100 }}>
          {settings && sections.map((section: any) => (
            <div key={section.id} style={{
              background: "rgba(255,255,255,0.015)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 14,
              overflow: "hidden",
              transition: "border-color .2s",
            }}
              onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"}
              onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"}
            >
              {/* Section header */}
              <div style={{
                padding: "12px 18px",
                borderBottom: "1px solid rgba(255,255,255,0.05)",
                background: section.accent + "06",
                display: "flex", alignItems: "center", gap: 9,
              }}>
                <div style={{
                  width: 26, height: 26, borderRadius: 7,
                  background: section.accent + "18",
                  border: `1px solid ${section.accent}30`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <section.Icon size={12} color={section.accent} />
                </div>
                <span style={{ fontSize: 11, fontWeight: 800, color: "var(--t1)", letterSpacing: "0.04em" }}>{section.title}</span>
              </div>

              {/* Fields */}
              <div style={{ padding: "4px 18px" }}>
                {section.fields(settings, updateField)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer save bar */}
      <div style={{
        padding: "11px 28px",
        borderTop: "1px solid rgba(255,255,255,0.05)",
        background: "rgba(8,9,12,0.8)",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        flexShrink: 0,
      }}>
        <div style={{ minHeight: 20 }}>
          {saveSuccess && (
            <span style={{ color: "var(--green)", fontSize: 11.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
              <CheckIcon size={12} color="var(--green)" /> Settings saved successfully.
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => navigate("/")} disabled={saving} style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)", background: "transparent", color: "var(--t2)", fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all .15s" }}
            onMouseEnter={e => { e.currentTarget.style.color = "var(--t1)"; e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "var(--t2)"; e.currentTarget.style.background = "transparent"; }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} style={{ padding: "7px 20px", borderRadius: 8, border: "none", background: saving ? "rgba(232,232,232,0.08)" : "rgba(232,232,232,0.9)", color: saving ? "var(--t3)" : "#0a0a0a", fontSize: 12, fontWeight: 800, cursor: saving ? "not-allowed" : "pointer", boxShadow: saving ? "none" : "0 2px 12px rgba(232,232,232,0.1)", transition: "all .15s", display: "flex", alignItems: "center", gap: 6 }}
            onMouseEnter={e => { if (!saving) e.currentTarget.style.filter = "brightness(1.06)"; }}
            onMouseLeave={e => { if (!saving) e.currentTarget.style.filter = "none"; }}>
            {saving
              ? <><LoaderIcon size={12} style={{ animation: "spin 1s linear infinite" }} /> Saving…</>
              : <><CheckIcon size={12} color="#0a0a0a" /> Save Settings</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingRow({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "11px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", gap: 12,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--t1)", lineHeight: 1.3 }}>{label}</div>
        {desc && <div style={{ fontSize: 10, color: "var(--t3)", marginTop: 2, lineHeight: 1.4 }}>{desc}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

function ToggleSwitch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      style={{
        width: 38, height: 20, borderRadius: 99,
        background: value ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.04)",
        border: value ? "1px solid rgba(255,255,255,0.35)" : "1px solid rgba(255,255,255,0.1)",
        position: "relative", cursor: "pointer", transition: "all 0.2s ease", flexShrink: 0,
      }}
      onClick={() => onChange(!value)}
    >
      <div style={{
        position: "absolute", top: 2, left: value ? 20 : 2,
        width: 14, height: 14, borderRadius: "50%",
        background: value ? "#F0F1F6" : "#4B4E64",
        boxShadow: value ? "0 0 6px rgba(240,241,246,0.4)" : "none",
        transition: "all 0.2s cubic-bezier(0.25,0.8,0.25,1)",
      }} />
    </div>
  );
}

function NumberInput({ value, onChange }: { value: number; onChange: (v: any) => void }) {
  return (
    <input
      type="number"
      className="field glass-input"
      value={value ?? ""}
      onChange={e => onChange(e.target.value === "" ? "" : Number(e.target.value))}
      style={{ width: 80, padding: "6px 10px", fontSize: 12, outline: "none", textAlign: "right" }}
    />
  );
}

function TextInput({ value, onChange, placeholder, wide }: { value: string; onChange: (v: string) => void; placeholder?: string; wide?: boolean }) {
  return (
    <input
      type="text"
      className="field glass-input"
      value={value ?? ""}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ width: wide ? 260 : 160, padding: "6px 10px", fontSize: 11.5, outline: "none" }}
    />
  );
}

const LANGUAGES = [
  { value: "en",    label: "English" },
  { value: "es",    label: "Español" },
  { value: "pt",    label: "Português" },
  { value: "fr",    label: "Français" },
  { value: "de",    label: "Deutsch" },
  { value: "it",    label: "Italiano" },
  { value: "nl",    label: "Nederlands" },
  { value: "pl",    label: "Polski" },
  { value: "ru",    label: "Русский" },
  { value: "tr",    label: "Türkçe" },
  { value: "ar",    label: "العربية" },
  { value: "ja",    label: "日本語" },
  { value: "ko",    label: "한국어" },
  { value: "zh-cn", label: "中文 (简体)" },
  { value: "zh-tw", label: "中文 (繁體)" },
  { value: "id",    label: "Bahasa Indonesia" },
  { value: "ms",    label: "Bahasa Melayu" },
  { value: "th",    label: "ภาษาไทย" },
  { value: "vi",    label: "Tiếng Việt" },
  { value: "tl",    label: "Filipino" },
];

function SelectInput({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        width: 160, padding: "6px 10px", fontSize: 11.5, outline: "none",
        background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 8, color: "var(--t1)", cursor: "pointer",
        appearance: "none", backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='rgba(255,255,255,0.3)'/%3E%3C/svg%3E")`,
        backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center",
      }}
    >
      {options.map(o => <option key={o.value} value={o.value} style={{ background: "#0e0f13" }}>{o.label}</option>)}
    </select>
  );
}
