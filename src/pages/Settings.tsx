import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext";
import {
  ChevronLeftIcon, CheckIcon, LoaderIcon,
  SlidersIcon, ZapIcon, ClockIcon, LayoutIcon,
  GamepadIcon, KeyIcon, ActivityIcon, WatchIcon,
  BellIcon, MessageSquareIcon, ServerIcon, ShieldIcon,
  SettingsIcon, DatabaseIcon, TerminalIcon,
} from "../components/Icons";

const TABS = [
  { id: "app",       label: "app_tab",        Icon: SettingsIcon,  accent: "#A78BFA",
    desc: "app_tab_desc" },
  { id: "client",    label: "client_tab",     Icon: GamepadIcon,   accent: "#60A5FA",
    desc: "client_tab_desc" },
  { id: "watchdog",  label: "watchdog_tab",   Icon: WatchIcon,     accent: "#34D399",
    desc: "watchdog_tab_desc" },
  { id: "alerts",    label: "alerts_tab",     Icon: BellIcon,      accent: "#FBBF24",
    desc: "alerts_tab_desc" },
  { id: "developer", label: "developer_tab",  Icon: TerminalIcon,  accent: "#F87171",
    desc: "developer_tab_desc" },
] as const;

type TabId = typeof TABS[number]["id"];

const APP_SECTIONS = [
  {
    id: "app-options", Icon: SlidersIcon, title: "app_options", accent: "#A78BFA",
    fields: (s: any, u: (k: string, v: any) => void, t: any) => (<>
      <SettingRow label={t("check_for_updates")} desc={t("check_for_updates_desc")}><ToggleSwitch value={s.CheckForUpdates} onChange={v => u("CheckForUpdates", v)} /></SettingRow>
      <SettingRow label={t("run_on_startup")} desc={t("run_on_startup_desc")}><ToggleSwitch value={s.RunOnStartup} onChange={v => u("RunOnStartup", v)} /></SettingRow>
      <SettingRow label={t("minimize_to_tray")} desc={t("minimize_to_tray_desc")}><ToggleSwitch value={s.MinimizeToTray} onChange={v => u("MinimizeToTray", v)} /></SettingRow>
      <SettingRow label={t("show_presence")} desc={t("show_presence_desc")}><ToggleSwitch value={s.ShowAccountPresence} onChange={v => u("ShowAccountPresence", v)} /></SettingRow>
    </>),
  },
  {
    id: "optimization", Icon: ZapIcon, title: "client_opt", accent: "#34D399",
    fields: (s: any, u: (k: string, v: any) => void, t: any) => (<>
      <SettingRow label={t("unlock_fps")} desc={t("unlock_fps_desc")}><ToggleSwitch value={s.UnlockFps} onChange={v => u("UnlockFps", v)} /></SettingRow>
      <SettingRow label={t("custom_client_settings")} desc={t("custom_client_settings_desc")}><ToggleSwitch value={s.UseCustomSettings} onChange={v => u("UseCustomSettings", v)} /></SettingRow>
      <SettingRow label={t("max_fps_limit")} desc={t("max_fps_limit_desc")}><NumberInput value={s.MaxFps} onChange={v => u("MaxFps", v)} /></SettingRow>
    </>),
  },
  {
    id: "limits", Icon: ClockIcon, title: "limits_delays", accent: "#FBBF24",
    fields: (s: any, u: (k: string, v: any) => void, t: any) => (<>
      <SettingRow label={t("launch_delay")} desc={t("launch_delay_desc")}><NumberInput value={s.LaunchDelay} onChange={v => u("LaunchDelay", v)} /></SettingRow>
      <SettingRow label={t("global_cooldown")} desc={t("global_cooldown_desc")}><NumberInput value={s.GlobalLaunchCooldownSeconds} onChange={v => u("GlobalLaunchCooldownSeconds", v)} /></SettingRow>
      <SettingRow label={t("daily_play_goal")} desc={t("daily_play_goal_desc")}><NumberInput value={s.DailyPlayGoalMinutes} onChange={v => u("DailyPlayGoalMinutes", v)} /></SettingRow>
    </>),
  },
  {
    id: "ui", Icon: LayoutIcon, title: "ui_pref", accent: "#60A5FA",
    fields: (s: any, u: (k: string, v: any) => void, t: any) => (<>
      <SettingRow label={t("lang_label")} desc={t("lang_label_desc")}>
        <SelectInput value={s.Language ?? "en"} onChange={v => u("Language", v)} options={LANGUAGES} />
      </SettingRow>
      <SettingRow label={t("max_recent_games")} desc={t("max_recent_games_desc")}><NumberInput value={s.MaxRecentGames} onChange={v => u("MaxRecentGames", v)} /></SettingRow>
      <SettingRow label={t("region_format")} desc={t("region_format_desc")}><TextInput value={s.RegionFormat} onChange={v => u("RegionFormat", v)} placeholder="<city>, <countryCode>" /></SettingRow>
      <SettingRow label={t("presence_refresh")} desc={t("presence_refresh_desc")}><NumberInput value={s.PresenceRefreshInterval} onChange={v => u("PresenceRefreshInterval", v)} /></SettingRow>
    </>),
  },
];

const CLIENT_SECTIONS = [
  {
    id: "mutex", Icon: GamepadIcon, title: "mutex_multi", accent: "#60A5FA",
    fields: (s: any, u: (k: string, v: any) => void, t: any) => (<>
      <SettingRow label={t("enable_multi_instance")} desc={t("enable_multi_instance_desc")}><ToggleSwitch value={s.MultiRoblox} onChange={v => u("MultiRoblox", v)} /></SettingRow>
      <SettingRow label={t("use_bootstrapper_launch")} desc={t("use_bootstrapper_launch_desc")}><ToggleSwitch value={s.UseBootstrapperLaunch} onChange={v => u("UseBootstrapperLaunch", v)} /></SettingRow>
      <SettingRow label={t("shuffle_lowest_server")} desc={t("shuffle_lowest_server_desc")}><ToggleSwitch value={s.ShuffleLowestServer} onChange={v => u("ShuffleLowestServer", v)} /></SettingRow>
    </>),
  },
  {
    id: "credentials", Icon: KeyIcon, title: "credentials_opt", accent: "#34D399",
    fields: (s: any, u: (k: string, v: any) => void, t: any) => (<>
      <SettingRow label={t("save_account_passwords")} desc={t("save_account_passwords_desc")}><ToggleSwitch value={s.SavePasswords} onChange={v => u("SavePasswords", v)} /></SettingRow>
      <SettingRow label={t("clipboard_cookie_detection")} desc={t("clipboard_cookie_detection_desc")}><ToggleSwitch value={s.ClipboardCookieDetect} onChange={v => u("ClipboardCookieDetect", v)} /></SettingRow>
      <SettingRow label={t("auto_refresh_cookies")} desc={t("auto_refresh_cookies_desc")}><ToggleSwitch value={s.AutoRefreshCookies} onChange={v => u("AutoRefreshCookies", v)} /></SettingRow>
    </>),
  },
  {
    id: "health", Icon: ActivityIcon, title: "health_monitoring", accent: "#F87171",
    fields: (s: any, u: (k: string, v: any) => void, t: any) => (<>
      <SettingRow label={t("cookie_health_monitor")} desc={t("cookie_health_monitor_desc")}><ToggleSwitch value={s.CookieHealthMonitorEnabled} onChange={v => u("CookieHealthMonitorEnabled", v)} /></SettingRow>
      <SettingRow label={t("cookie_check_interval")} desc={t("cookie_check_interval_desc")}><NumberInput value={s.CookieHealthIntervalMinutes} onChange={v => u("CookieHealthIntervalMinutes", v)} /></SettingRow>
      <SettingRow label={t("auto_daily_backup")} desc={t("auto_daily_backup_desc")}><ToggleSwitch value={s.AutoDailyBackup} onChange={v => u("AutoDailyBackup", v)} /></SettingRow>
    </>),
  },
];

const WATCHDOG_SECTIONS = [
  {
    id: "rejoin", Icon: WatchIcon, title: "rejoin_watchdog", accent: "#34D399",
    fields: (s: any, u: (k: string, v: any) => void, t: any) => (<>
      <SettingRow label={t("enable_auto_rejoin")} desc={t("enable_auto_rejoin_desc")}><ToggleSwitch value={s.AutoRejoinEnabled} onChange={v => u("AutoRejoinEnabled", v)} /></SettingRow>
      <SettingRow label={t("rejoin_delay_sec")} desc={t("rejoin_delay_sec_desc")}><NumberInput value={s.AutoRejoinDelaySeconds} onChange={v => u("AutoRejoinDelaySeconds", v)} /></SettingRow>
      <SettingRow label={t("max_rejoin_attempts")} desc={t("max_rejoin_attempts_desc")}><NumberInput value={s.AutoRejoinMaxAttempts} onChange={v => u("AutoRejoinMaxAttempts", v)} /></SettingRow>
    </>),
  },
  {
    id: "history", Icon: DatabaseIcon, title: "session_history", accent: "#60A5FA",
    fields: (s: any, u: (k: string, v: any) => void, t: any) => (<>
      <SettingRow label={t("record_session_activity")} desc={t("record_session_activity_desc")}><ToggleSwitch value={s.SessionHistoryEnabled} onChange={v => u("SessionHistoryEnabled", v)} /></SettingRow>
      <SettingRow label={t("max_history_records")} desc={t("max_history_records_desc")}><NumberInput value={s.SessionHistoryMaxRecords} onChange={v => u("SessionHistoryMaxRecords", v)} /></SettingRow>
    </>),
  },
];

const ALERTS_SECTIONS = [
  {
    id: "notifications", Icon: BellIcon, title: "alerts_notifications", accent: "#FBBF24",
    fields: (s: any, u: (k: string, v: any) => void, t: any) => (<>
      <SettingRow label={t("toast_notifications")} desc={t("toast_notifications_desc")}><ToggleSwitch value={s.ToastNotificationsEnabled} onChange={v => u("ToastNotificationsEnabled", v)} /></SettingRow>
      <SettingRow label={t("audio_alert_sounds")} desc={t("audio_alert_sounds_desc")}><ToggleSwitch value={s.SoundAlertsEnabled} onChange={v => u("SoundAlertsEnabled", v)} /></SettingRow>
      <SettingRow label={t("warn_on_disconnect")} desc={t("warn_on_disconnect_desc")}><ToggleSwitch value={s.DisconnectAlertEnabled} onChange={v => u("DisconnectAlertEnabled", v)} /></SettingRow>
      <SettingRow label={t("notify_launch_success")} desc={t("notify_launch_success_desc")}><ToggleSwitch value={s.LaunchSuccessAlert} onChange={v => u("LaunchSuccessAlert", v)} /></SettingRow>
    </>),
  },
  {
    id: "discord", Icon: MessageSquareIcon, title: "discord_webhook", accent: "#818CF8",
    fields: (s: any, u: (k: string, v: any) => void, t: any) => (<>
      <SettingRow label={t("webhook_url")} desc={t("webhook_url_desc")}>
        <TextInput value={s.DiscordWebhookUrl} onChange={v => u("DiscordWebhookUrl", v)} placeholder="https://discord.com/api/webhooks/..." wide />
      </SettingRow>
    </>),
  },
];

const DEVELOPER_SECTIONS = [
  {
    id: "webserver", Icon: ServerIcon, title: "local_webserver", accent: "#34D399",
    fields: (s: any, u: (k: string, v: any) => void, t: any) => (<>
      <SettingRow label={t("developer_mode")} desc={t("developer_mode_desc")}><ToggleSwitch value={s.DeveloperModeEnabled} onChange={v => u("DeveloperModeEnabled", v)} /></SettingRow>
      <SettingRow label={t("enable_web_server")} desc={t("enable_web_server_desc")}><ToggleSwitch value={s.WebServerEnabled} onChange={v => u("WebServerEnabled", v)} /></SettingRow>
      <SettingRow label={t("web_server_port")} desc={t("web_server_port_desc")}><NumberInput value={s.WebServerPort} onChange={v => u("WebServerPort", v)} /></SettingRow>
      <SettingRow label={t("require_api_password")} desc={t("require_api_password_desc")}><ToggleSwitch value={s.RequirePassword} onChange={v => u("RequirePassword", v)} /></SettingRow>
      <SettingRow label={t("api_access_key")} desc={t("api_access_key_desc")}>
        <TextInput value={s.WebServerPassword} onChange={v => u("WebServerPassword", v)} placeholder="Leave blank for open access" />
      </SettingRow>
    </>),
  },
  {
    id: "permissions", Icon: ShieldIcon, title: "endpoint_permissions", accent: "#F87171",
    fields: (s: any, u: (k: string, v: any) => void, t: any) => (<>
      <SettingRow label={t("allow_get_cookie")} desc={t("allow_get_cookie_desc")}><ToggleSwitch value={s.AllowGetCookie} onChange={v => u("AllowGetCookie", v)} /></SettingRow>
      <SettingRow label={t("allow_get_accounts")} desc={t("allow_get_accounts_desc")}><ToggleSwitch value={s.AllowGetAccounts} onChange={v => u("AllowGetAccounts", v)} /></SettingRow>
      <SettingRow label={t("allow_remote_launch")} desc={t("allow_remote_launch_desc")}><ToggleSwitch value={s.AllowLaunchAccount} onChange={v => u("AllowLaunchAccount", v)} /></SettingRow>
      <SettingRow label={t("allow_account_edits")} desc={t("allow_account_edits_desc")}><ToggleSwitch value={s.AllowAccountModifications} onChange={v => u("AllowAccountModifications", v)} /></SettingRow>
      <SettingRow label={t("disable_remote_image")} desc={t("disable_remote_image_desc")}><ToggleSwitch value={s.DisableImageLoading} onChange={v => u("DisableImageLoading", v)} /></SettingRow>
      <SettingRow label={t("allow_lan_wan")} desc={t("allow_lan_wan_desc")}><ToggleSwitch value={s.AllowExternalConnections} onChange={v => u("AllowExternalConnections", v)} /></SettingRow>
    </>),
  },
];

const SECTIONS_BY_TAB: Record<TabId, any[]> = {
  app: APP_SECTIONS, client: CLIENT_SECTIONS, watchdog: WATCHDOG_SECTIONS,
  alerts: ALERTS_SECTIONS, developer: DEVELOPER_SECTIONS,
};

export default function Settings() {
  const navigate = useNavigate();
  const { t, setLanguage } = useLanguage();
  const [activeTab, setActiveTab] = useState<TabId>("app");
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState("");
  const [originalLanguage, setOriginalLanguage] = useState("en");
  const isSaved = useRef(false);

  useEffect(() => { loadSettings(); }, []);

  useEffect(() => {
    return () => {
      if (!isSaved.current) {
        setLanguage(originalLanguage);
      }
    };
  }, [originalLanguage]);

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
      const loadedLanguage = data?.Language || "en";
      setOriginalLanguage(loadedLanguage);
      setSettings({ ...defaults, ...data });
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  };

  const handleSave = async () => {
    setSaving(true); setError(""); setSaveSuccess(false);
    try {
      await invoke("save_settings", { settings });
      isSaved.current = true;
      setOriginalLanguage(settings.Language || "en");
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e) { setError(String(e)); } finally { setSaving(false); }
  };

  const updateField = (key: string, value: any) => {
    setSettings((prev: any) => ({ ...prev, [key]: value }));
    if (key === "Language") {
      setLanguage(value);
    }
  };

  if (loading) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
        <div style={{ color: "var(--t2)", display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
          <LoaderIcon size={16} style={{ animation: "spin 1s linear infinite" }} />
          {t("loading_config")}
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
                {t(label)}
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
          <ChevronLeftIcon size={12} /> {t("back_btn")}
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
                {t(activeTabDef.label)} {t("settings")}
              </div>
              <div style={{ fontSize: 11, color: "var(--t3)", marginTop: 2 }}>{t(activeTabDef.desc)}</div>
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
                <span style={{ fontSize: 11, fontWeight: 800, color: "var(--t1)", letterSpacing: "0.04em" }}>{t(section.title)}</span>
              </div>

              {/* Fields */}
              <div style={{ padding: "4px 18px" }}>
                {section.fields(settings, updateField, t)}
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
              <CheckIcon size={12} color="var(--green)" /> {t("settings_saved_success")}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => navigate("/")} disabled={saving} style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)", background: "transparent", color: "var(--t2)", fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all .15s" }}
            onMouseEnter={e => { e.currentTarget.style.color = "var(--t1)"; e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "var(--t2)"; e.currentTarget.style.background = "transparent"; }}>
            {t("cancel")}
          </button>
          <button onClick={handleSave} disabled={saving} style={{ padding: "7px 20px", borderRadius: 8, border: "none", background: saving ? "rgba(232,232,232,0.08)" : "rgba(232,232,232,0.9)", color: saving ? "var(--t3)" : "#0a0a0a", fontSize: 12, fontWeight: 800, cursor: saving ? "not-allowed" : "pointer", boxShadow: saving ? "none" : "0 2px 12px rgba(232,232,232,0.1)", transition: "all .15s", display: "flex", alignItems: "center", gap: 6 }}
            onMouseEnter={e => { if (!saving) e.currentTarget.style.filter = "brightness(1.06)"; }}
            onMouseLeave={e => { if (!saving) e.currentTarget.style.filter = "none"; }}>
            {saving
              ? <><LoaderIcon size={12} style={{ animation: "spin 1s linear infinite" }} /> {t("saving_settings_status")}</>
              : <><CheckIcon size={12} color="#0a0a0a" /> {t("save_settings")}</>
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
