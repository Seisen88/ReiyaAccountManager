import { useLanguage } from "../context/LanguageContext";
import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import {
  GlobeIcon, KeyIcon, ShieldCheckIcon, FileTextIcon, SettingsIcon,
  SearchIcon, StarIcon, TrashIcon, XIcon, ChevronDownIcon, CheckIcon,
  GamepadIcon, ZapIcon, ShieldIcon, UserIcon,
} from "../components/Icons";

interface BulkAddResult {
  preview: string;
  success: boolean;
  username: string | null;
  error: string | null;
}

interface Account {
  user_id: number;
  username: string;
  display_name: string;
  avatar_url: string;
  is_favorite: boolean;
  cookie_status: string;
  added_at: string;
  last_launched_at: string | null;
  last_played_game: string;
  notes: string;
  tags: string[];
  default_place_id: string;
  default_game_name: string;
  safe_launch_enabled: boolean;
  auto_rejoin_enabled: boolean;
  launch_cooldown_seconds: number;
}

type FilterTab = "all" | "favorites";

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
export default function Accounts() {
  const { t } = useLanguage();
  const [accounts,  setAccounts]  = useState<Account[]>([]);
  const [filter,    setFilter]    = useState<FilterTab>("all");
  const [search,    setSearch]    = useState("");
  const [loading,   setLoading]   = useState(true);
  const [launching, setLaunching] = useState<number | null>(null);

  // Bulk selection
  const [selected,       setSelected]       = useState<Set<number>>(new Set());
  const [bulkLaunching,  setBulkLaunching]  = useState(false);
  const [bulkStatus,     setBulkStatus]     = useState("");
  const [moveGroupModal, setMoveGroupModal] = useState(false);
  const [groupInput,     setGroupInput]     = useState("");

  const [addMenu,       setAddMenu]       = useState(false);
  const addMenuRef                        = useRef<HTMLDivElement>(null);
  const [showSingle,    setShowSingle]    = useState(false);
  const [showBulk,      setShowBulk]      = useState(false);
  const [addCookie,     setAddCookie]     = useState("");
  const [adding,        setAdding]        = useState(false);
  const [addError,      setAddError]      = useState("");
  const [bulkText,      setBulkText]      = useState("");
  const [bulkAdding,    setBulkAdding]    = useState(false);
  const [bulkResults,   setBulkResults]   = useState<BulkAddResult[]>([]);

  const [showUserPass,   setShowUserPass]   = useState(false);
  const [comboText,      setComboText]      = useState("");
  const [loginLoading,   setLoginLoading]   = useState(false);
  const [loginError,     setLoginError]     = useState("");

  // Import / Export
  const [showExport, setShowExport] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [exportPwd,  setExportPwd]  = useState("");
  const [importPwd,  setImportPwd]  = useState("");
  const [exportLoading, setExportLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [exportErr, setExportErr] = useState("");
  const [importErr, setImportErr] = useState("");
  const [exportOk,  setExportOk]  = useState("");
  const [importOk,  setImportOk]  = useState("");

  const handleExport = async () => {
    if (!exportPwd.trim()) { setExportErr("Enter a password to protect the backup."); return; }
    setExportLoading(true); setExportErr(""); setExportOk("");
    try {
      const path = await invoke<string>("export_accounts", { password: exportPwd });
      setExportOk(`Saved to: ${path}`);
      setExportPwd("");
    } catch (e) {
      if (String(e) !== "cancelled") setExportErr(String(e));
    } finally { setExportLoading(false); }
  };

  const handleImport = async () => {
    if (!importPwd.trim()) { setImportErr("Enter the backup password."); return; }
    setImportLoading(true); setImportErr(""); setImportOk("");
    try {
      const added = await invoke<number>("import_accounts", { password: importPwd });
      setImportOk(`Imported ${added} new account${added !== 1 ? "s" : ""}.`);
      setImportPwd("");
      await loadAccounts();
    } catch (e) {
      if (String(e) !== "cancelled") setImportErr(String(e));
    } finally { setImportLoading(false); }
  };

  const [selectedUtilAccount, setSelectedUtilAccount] = useState<Account | null>(null);
  const [utilNewDisplayName, setUtilNewDisplayName] = useState("");
  const [utilCurrentPassword, setUtilCurrentPassword] = useState("");
  const [utilNewPassword, setUtilNewPassword] = useState("");
  const [utilTargetUser, setUtilTargetUser] = useState("");
  const [utilStatus, setUtilStatus] = useState("");
  const [utilIsError, setUtilIsError] = useState(false);
  const [utilLoading, setUtilLoading] = useState(false);

  const loadAccounts = useCallback(async () => {
    try {
      const data = await invoke<Account[]>("get_accounts");
      setAccounts(data);
    } catch (e) { console.error("Failed to load accounts:", e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    loadAccounts();
    const handleOutsideClick = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) setAddMenu(false);
    };
    document.addEventListener("click", handleOutsideClick);
    return () => document.removeEventListener("click", handleOutsideClick);
  }, [loadAccounts]);

  const online    = 0;
  const favCount  = accounts.filter(a => a.is_favorite).length;

  const visible = accounts.filter(a => {
    const q = search.toLowerCase();
    const matchSearch = !q || a.username.toLowerCase().includes(q) || a.display_name.toLowerCase().includes(q);
    const matchFilter = filter === "all" || a.is_favorite;
    return matchSearch && matchFilter;
  });

  const handleToggleFav = async (userId: number) => {
    try {
      const updated = await invoke<Account>("toggle_favorite", { userId });
      setAccounts(prev => prev.map(a => a.user_id === userId ? updated : a));
    } catch (e) { console.error(e); }
  };

  const handleRemove = async (userId: number, username: string) => {
    if (!confirm(`${t("remove_account_confirm")}${username}?`)) return;
    try {
      await invoke("remove_account", { userId });
      setAccounts(prev => prev.filter(a => a.user_id !== userId));
    } catch (e) { console.error(e); }
  };

  const handleLaunch = async (userId: number) => {
    setLaunching(userId);
    try {
      await invoke("launch_account", {
        userId, placeId: null, jobId: null, accessCode: null,
        useBootstrapper: localStorage.getItem("reiya_use_bootstrapper") === "true",
      });
    } catch (e) { alert(`Launch failed: ${e}`); }
    finally { setLaunching(null); }
  };

  const handleValidate = async (userId: number) => {
    try {
      const updated = await invoke<Account>("validate_cookie", { userId });
      setAccounts(prev => prev.map(a => a.user_id === userId ? updated : a));
    } catch (e) { console.error(e); }
  };

  const handleOpenCookieMenu = async () => {
    setAddMenu(false);
    try {
      const clip = await readText();
      if (clip && clip.includes(".ROBLOSECURITY")) {
        if (confirm("A Roblox cookie was detected in your clipboard. Import it?")) {
          setAdding(true); setAddError("");
          try {
            const acc = await invoke<Account>("add_account", { cookie: clip });
            setAccounts(prev => {
              const idx = prev.findIndex(a => a.user_id === acc.user_id);
              return idx >= 0 ? prev.map((a, i) => i === idx ? acc : a) : [...prev, acc];
            });
            return;
          } catch (e) { setAddError(String(e)); }
          finally { setAdding(false); }
        }
      }
    } catch { }
    setAddCookie(""); setAddError(""); setShowSingle(true);
  };

  const handleAddSingle = async () => {
    if (!addCookie.trim()) return;
    setAdding(true); setAddError("");
    try {
      const acc = await invoke<Account>("add_account", { cookie: addCookie });
      setAccounts(prev => {
        const idx = prev.findIndex(a => a.user_id === acc.user_id);
        return idx >= 0 ? prev.map((a, i) => i === idx ? acc : a) : [...prev, acc];
      });
      setAddCookie(""); setShowSingle(false);
    } catch (e) { setAddError(String(e)); }
    finally { setAdding(false); }
  };

  const handleBulkImport = async () => {
    const lines = bulkText.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return;
    setBulkAdding(true); setBulkResults([]);
    try {
      const results = await invoke<BulkAddResult[]>("add_accounts_bulk", { cookies: lines });
      setBulkResults(results);
      const data = await invoke<Account[]>("get_accounts");
      setAccounts(data);
    } catch (e) { setBulkResults([{ preview: "-", success: false, username: null, error: String(e) }]); }
    finally { setBulkAdding(false); }
  };

  const loginOneAccount = (username?: string, password?: string): Promise<string | null> => {
    return new Promise((resolve) => {
      let unlisten: (() => void) | null = null;
      const setupListener = async () => {
        unlisten = await listen<string | null>("login-cookie-result", (event) => {
          if (unlisten) unlisten();
          resolve(event.payload);
        });
      };
      setupListener().then(async () => {
        try {
          await invoke("open_login_window", { username: username || null, password: password || null });
        } catch (e) {
          if (unlisten) unlisten();
          alert(`Failed to open login window: ${String(e)}`);
          resolve(null);
        }
      });
    });
  };

  const handleManualLogin = async () => {
    setAddMenu(false); setLoginLoading(true);
    try {
      const cookie = await loginOneAccount();
      if (cookie) {
        const acc = await invoke<Account>("add_account", { cookie });
        setAccounts(prev => {
          const idx = prev.findIndex(a => a.user_id === acc.user_id);
          return idx >= 0 ? prev.map((a, i) => i === idx ? acc : a) : [...prev, acc];
        });
      }
    } catch (e) { alert(`Manual login failed: ${String(e)}`); }
    finally { setLoginLoading(false); }
  };

  const handleComboImport = async (combosText: string) => {
    const lines = combosText.split("\n").map(l => l.trim()).filter(l => l.includes(":") && l.length > 2);
    if (lines.length === 0) { setLoginError("No valid combos found. Format: username:password"); return; }
    setLoginLoading(true); setLoginError(""); let successCount = 0;
    for (let i = 0; i < lines.length; i++) {
      const [username, password] = lines[i].split(":", 2).map(s => s.trim());
      setLoginError(`Processing ${i + 1}/${lines.length}: ${username}...`);
      const cookie = await loginOneAccount(username, password);
      if (cookie) {
        try {
          const acc = await invoke<Account>("add_account", { cookie });
          setAccounts(prev => {
            const idx = prev.findIndex(a => a.user_id === acc.user_id);
            return idx >= 0 ? prev.map((a, i) => i === idx ? acc : a) : [...prev, acc];
          });
          successCount++;
        } catch (e) { console.error(`Failed to register ${username}: ${String(e)}`); }
      }
    }
    setLoginLoading(false); setShowUserPass(false); setComboText("");
    alert(`Done! Successfully imported ${successCount} out of ${lines.length} account(s).`);
  };

  const handleSetDisplayName = async () => {
    if (!selectedUtilAccount || !utilNewDisplayName.trim()) return;
    setUtilLoading(true); setUtilStatus("Updating display name..."); setUtilIsError(false);
    try {
      const msg = await invoke<string>("set_display_name", { userId: selectedUtilAccount.user_id, newName: utilNewDisplayName.trim() });
      setUtilStatus(msg);
      setAccounts(prev => prev.map(a => a.user_id === selectedUtilAccount.user_id ? { ...a, display_name: utilNewDisplayName.trim() } : a));
    } catch (e) { setUtilIsError(true); setUtilStatus(String(e)); }
    finally { setUtilLoading(false); }
  };

  const handleChangePassword = async () => {
    if (!selectedUtilAccount || !utilCurrentPassword || !utilNewPassword) return;
    setUtilLoading(true); setUtilStatus("Changing password..."); setUtilIsError(false);
    try {
      const msg = await invoke<string>("change_password", { userId: selectedUtilAccount.user_id, currentPw: utilCurrentPassword, newPw: utilNewPassword });
      setUtilStatus(msg); setUtilCurrentPassword(""); setUtilNewPassword("");
    } catch (e) { setUtilIsError(true); setUtilStatus(String(e)); }
    finally { setUtilLoading(false); }
  };

  const handleSignOutAll = async () => {
    if (!selectedUtilAccount) return;
    if (!confirm("This will sign out all other sessions for this account. Continue?")) return;
    setUtilLoading(true); setUtilStatus("Signing out all sessions..."); setUtilIsError(false);
    try {
      const msg = await invoke<string>("sign_out_all_sessions", { userId: selectedUtilAccount.user_id });
      setUtilStatus(msg);
    } catch (e) { setUtilIsError(true); setUtilStatus(String(e)); }
    finally { setUtilLoading(false); }
  };

  const handleSendFriendRequest = async () => {
    if (!selectedUtilAccount || !utilTargetUser.trim()) return;
    setUtilLoading(true); setUtilStatus(`Sending friend request to @${utilTargetUser}...`); setUtilIsError(false);
    try {
      const msg = await invoke<string>("send_friend_request", { userId: selectedUtilAccount.user_id, targetUsername: utilTargetUser.trim() });
      setUtilStatus(msg);
    } catch (e) { setUtilIsError(true); setUtilStatus(String(e)); }
    finally { setUtilLoading(false); }
  };

  const handleBlockUser = async () => {
    if (!selectedUtilAccount || !utilTargetUser.trim()) return;
    setUtilLoading(true); setUtilStatus(`Blocking @${utilTargetUser}...`); setUtilIsError(false);
    try {
      const msg = await invoke<string>("block_user", { userId: selectedUtilAccount.user_id, targetUsername: utilTargetUser.trim() });
      setUtilStatus(msg);
    } catch (e) { setUtilIsError(true); setUtilStatus(String(e)); }
    finally { setUtilLoading(false); }
  };

  // ── Bulk actions ──────────────────────────────────────────────────
  const toggleSelect = (userId: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(visible.map(a => a.user_id)));
  const clearSelection = () => setSelected(new Set());

  const handleBulkLaunch = async () => {
    const targets = accounts.filter(a => selected.has(a.user_id) && a.cookie_status === "Valid");
    if (targets.length === 0) return;
    setBulkLaunching(true); setBulkStatus(`Launching ${targets.length} accounts...`);
    for (const acc of targets) {
      try {
        await invoke("launch_account", {
          userId: acc.user_id, placeId: null, jobId: null, accessCode: null,
          useBootstrapper: localStorage.getItem("reiya_use_bootstrapper") === "true",
        });
      } catch { }
      await new Promise(r => setTimeout(r, 1500));
    }
    setBulkLaunching(false); setBulkStatus(`Launched ${targets.length} accounts`);
    setTimeout(() => setBulkStatus(""), 3000);
  };

  const handleBulkValidate = async () => {
    const targets = accounts.filter(a => selected.has(a.user_id));
    if (targets.length === 0) return;
    setBulkStatus(`Validating ${targets.length} cookies...`);
    let updated = [...accounts];
    for (const acc of targets) {
      try {
        const result = await invoke<Account>("validate_cookie", { userId: acc.user_id });
        updated = updated.map(a => a.user_id === acc.user_id ? result : a);
      } catch { }
    }
    setAccounts(updated);
    setBulkStatus(`Validated ${targets.length} cookies`);
    setTimeout(() => setBulkStatus(""), 3000);
  };

  const handleBulkDelete = async () => {
    const targets = accounts.filter(a => selected.has(a.user_id));
    if (targets.length === 0) return;
    if (!confirm(`Remove ${targets.length} selected account(s)?`)) return;
    for (const acc of targets) {
      try { await invoke("remove_account", { userId: acc.user_id }); } catch { }
    }
    setAccounts(prev => prev.filter(a => !selected.has(a.user_id)));
    setSelected(new Set());
    setBulkStatus("");
  };

  const handleBulkMoveGroup = async () => {
    const targets = accounts.filter(a => selected.has(a.user_id));
    for (const acc of targets) {
      try { await invoke("set_account_group", { userId: acc.user_id, group: groupInput.trim() }); } catch { }
    }
    setAccounts(prev => prev.map(a => selected.has(a.user_id) ? { ...a, group: groupInput.trim() } as any : a));
    setMoveGroupModal(false); setGroupInput(""); clearSelection();
    setBulkStatus(`Moved ${targets.length} accounts to group "${groupInput.trim() || "none"}"`);
    setTimeout(() => setBulkStatus(""), 3000);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#07080a" }}>

      {/* â"€â"€ HEADER â"€â"€ */}
      <div style={{
        padding: "18px 24px",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        background: "rgba(255,255,255,0.01)",
        backdropFilter: "blur(12px)",
        flexShrink: 0,
      }}>
        {/* Title + Actions */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <h1 style={{ fontSize: 14, fontWeight: 900, letterSpacing: "0.06em", color: "var(--t1)", margin: 0 }}>
              {t("accounts_manager_title")}
            </h1>
            <p style={{ fontSize: 10, fontWeight: 700, color: "var(--t3)", letterSpacing: "0.1em", marginTop: 3 }}>
              MANAGE · LAUNCH · VALIDATE ROBLOX ACCOUNTS
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* Stat pills */}
            <AccountStatPill value={accounts.length} label={t("total").toUpperCase()} color="var(--t1)" />
            <AccountStatPill value={favCount} label={t("favorites").toUpperCase()} color="var(--amber)" />
            <AccountStatPill value={online} label={t("active").toUpperCase()} color="var(--green)" />
            {selected.size > 0 && (
              <AccountStatPill value={selected.size} label="SELECTED" color="#A78BFA" />
            )}

            {/* Import / Export */}
            <button
              onClick={() => { setImportErr(""); setImportOk(""); setImportPwd(""); setShowImport(true); }}
              title="Import Backup"
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "8px 14px", borderRadius: 10, fontSize: 11.5, fontWeight: 700,
                border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)",
                color: "var(--t2)", cursor: "pointer", transition: "all .12s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "var(--t1)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.color = "var(--t2)"; }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              Import
            </button>
            <button
              onClick={() => { setExportErr(""); setExportOk(""); setExportPwd(""); setShowExport(true); }}
              title="Export Backup"
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "8px 14px", borderRadius: 10, fontSize: 11.5, fontWeight: 700,
                border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)",
                color: "var(--t2)", cursor: "pointer", transition: "all .12s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "var(--t1)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.color = "var(--t2)"; }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Export
            </button>

            {/* Add Account dropdown */}
            <div ref={addMenuRef} style={{ position: "relative" }}>
              <button
                onClick={e => { e.stopPropagation(); setAddMenu(v => !v); }}
                style={{
                  display: "flex", alignItems: "center", gap: 7,
                  padding: "9px 16px", borderRadius: 10, border: "none",
                  background: "var(--accent)",
                  color: "var(--accent-text)", fontSize: 12, fontWeight: 800, cursor: "pointer",
                  boxShadow: "0 4px 14px rgba(232,232,232,0.18)", transition: "filter .12s",
                }}
                onMouseEnter={e => e.currentTarget.style.filter = "brightness(1.1)"}
                onMouseLeave={e => e.currentTarget.style.filter = "none"}
              >
                {t("add_account_btn_label")}
                <ChevronDownIcon size={11} color="#0a0a0a" />
              </button>

              {addMenu && (
                <div
                  onClick={e => e.stopPropagation()}
                  style={{
                    position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 999,
                    background: "linear-gradient(135deg, rgba(19,20,27,0.99) 0%, rgba(13,14,20,0.99) 100%)",
                    border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14,
                    padding: 6, minWidth: 220,
                    boxShadow: "0 16px 40px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)",
                  }}
                >
                  <DropdownItem icon={<GlobeIcon size={14} />} label={t("manual_login_title")} sub={t("manual_login_sub")} onClick={handleManualLogin} />
                  <DropdownItem icon={<KeyIcon size={14} />} label={t("user_pass_title")} sub={t("user_pass_sub")} onClick={() => { setAddMenu(false); setComboText(""); setLoginError(""); setShowUserPass(true); }} />
                  <DropdownItem icon={<ShieldCheckIcon size={14} />} label={t("cookie_title")} sub={t("cookie_sub")} onClick={handleOpenCookieMenu} />
                  <DropdownItem icon={<FileTextIcon size={14} />} label={t("cookies_file_title")} sub={t("cookies_file_sub")} onClick={() => { setAddMenu(false); setBulkText(""); setBulkResults([]); setShowBulk(true); }} />
                  <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "4px 8px" }} />
                  <DropdownItem icon={<SettingsIcon size={14} />} label={t("custom_login_title")} sub={t("custom_login_sub")} onClick={() => setAddMenu(false)} />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Search + Filter */}
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ position: "relative", flex: 1 }}>
            <SearchIcon size={13} color="var(--t3)" style={{
              position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none",
            }} />
            <input
              placeholder={t("search_accounts_placeholder")}
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                width: "100%", paddingLeft: 36, padding: "9px 12px 9px 36px",
                background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)",
                borderRadius: 10, color: "var(--t1)", fontSize: 12, outline: "none",
                transition: "border-color .15s",
              }}
              onFocus={e => e.currentTarget.style.borderColor = "rgba(232,232,232,0.4)"}
              onBlur={e => e.currentTarget.style.borderColor = "rgba(255,255,255,0.05)"}
            />
          </div>

          {/* Filter tabs */}
          <div className="premium-tab-track" style={{ flexShrink: 0 }}>
            {([["all", t("all_profiles").split(" ")[0]], ["favorites", t("favorites")]] as [FilterTab, string][]).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setFilter(id)}
                className={`premium-tab ${filter === id ? "active" : ""}`}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px" }}
              >
                {id === "favorites" && (
                  <StarIcon size={11} fill={filter === "favorites" ? "var(--amber)" : "none"} color={filter === "favorites" ? "var(--amber)" : "var(--t3)"} />
                )}
                <span style={{ fontSize: 11, fontWeight: 700 }}>{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── BULK ACTION BAR ── */}
      {selected.size > 0 && (
        <div style={{
          padding: "10px 24px", display: "flex", alignItems: "center", gap: 10,
          background: "rgba(167,139,250,0.06)",
          borderBottom: "1px solid rgba(167,139,250,0.15)",
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: "#A78BFA", marginRight: 4 }}>
            {selected.size} selected
          </span>
          <BulkBtn label="Launch All" onClick={handleBulkLaunch} disabled={bulkLaunching} accent="#34D399" />
          <BulkBtn label="Validate All" onClick={handleBulkValidate} disabled={bulkLaunching} />
          <BulkBtn label="Move to Group" onClick={() => { setGroupInput(""); setMoveGroupModal(true); }} disabled={bulkLaunching} />
          <BulkBtn label="Select All" onClick={selectAll} disabled={bulkLaunching} />
          <BulkBtn label="Delete All" onClick={handleBulkDelete} disabled={bulkLaunching} danger />
          {bulkStatus && (
            <span style={{ fontSize: 11, color: "var(--t2)", marginLeft: "auto" }}>{bulkStatus}</span>
          )}
          <button
            onClick={clearSelection}
            style={{ marginLeft: bulkStatus ? 0 : "auto", background: "none", border: "none", cursor: "pointer", color: "var(--t3)", display: "flex", alignItems: "center", padding: 4, borderRadius: 5 }}
            title="Clear selection"
          >
            <XIcon size={14} />
          </button>
        </div>
      )}

      {/* ── ACCOUNT LIST ── */}
      <div
        className="scroll"
        style={{
          flex: 1, overflowY: "auto", padding: "16px 20px",
          display: "grid", gridTemplateColumns: "1fr",
          gap: 10, alignContent: "start",
          background: "radial-gradient(circle at top right, rgba(232,232,232,0.02) 0%, transparent 60%)",
        }}
      >
        {loading ? (
          <div style={{ textAlign: "center", padding: "50px 20px", color: "var(--t3)", fontSize: 12 }}>
            {t("loading_accounts")}
          </div>
        ) : visible.length === 0 ? (
          <div style={{
            textAlign: "center", padding: "60px 20px",
            color: "var(--t3)", fontSize: 12.5,
            border: "1px dashed rgba(255,255,255,0.06)", borderRadius: 16,
          }}>
            {accounts.length === 0
              ? '{t("no_accounts_yet")}'
              : search ? `${t("no_accounts_match")} "${search}"` : t("no_accounts_in_view")}
          </div>
        ) : (
          visible.map(account => (
            <AccountCard
              key={account.user_id}
              account={account}
              isLaunching={launching === account.user_id}
              isSelected={selected.has(account.user_id)}
              onToggleSelect={() => toggleSelect(account.user_id)}
              onToggleFav={() => handleToggleFav(account.user_id)}
              onRemove={() => handleRemove(account.user_id, account.username)}
              onLaunch={() => handleLaunch(account.user_id)}
              onValidate={() => handleValidate(account.user_id)}
              onOpenUtilities={() => {
                setSelectedUtilAccount(account);
                setUtilNewDisplayName(account.display_name || "");
                setUtilCurrentPassword(""); setUtilNewPassword("");
                setUtilTargetUser(""); setUtilStatus(""); setUtilIsError(false);
              }}
            />
          ))
        )}
      </div>

      {/* â"€â"€ MODALS â"€â"€ */}

      {/* Single Cookie */}
      {showSingle && (
        <AccountModal title={t("import_cookie_title")} onClose={() => { setShowSingle(false); setAddError(""); }}>
          <FieldLabel>{t("roblosecurity_cookie_label")}</FieldLabel>
          <textarea
            rows={4}
            placeholder={t("paste_roblosecurity_placeholder")}
            value={addCookie}
            onChange={e => setAddCookie(e.target.value)}
            style={{
              width: "100%", resize: "vertical", fontFamily: "monospace", fontSize: 10.5,
              padding: "10px 13px", borderRadius: 10, outline: "none",
              background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
              color: "var(--t1)", marginBottom: 12,
            }}
          />
          {addError && <ErrorMsg msg={addError} />}
          <ModalActions>
            <ModalBtn label={t("cancel")} onClick={() => { setShowSingle(false); setAddError(""); }} />
            <ModalBtn label={adding ? t("validating_btn") : t("import_cookie_title")} onClick={handleAddSingle} primary disabled={adding || !addCookie.trim()} />
          </ModalActions>
        </AccountModal>
      )}

      {/* Bulk Import */}
      {showBulk && (
        <AccountModal title={t("bulk_cookie_import_title")} onClose={() => { if (!bulkAdding) { setShowBulk(false); setBulkText(""); setBulkResults([]); } }}>
          <p style={{ fontSize: 11, color: "var(--t2)", marginBottom: 14, lineHeight: 1.6 }}>
            `{t("paste_cookies_one_per_line_desc")}` <code style={{ color: "var(--amber)", fontFamily: "monospace" }}>.ROBLOSECURITY</code>.
          </p>
          {bulkResults.length === 0 ? (
            <textarea
              rows={10}
              placeholder={"_|WARNING:-DO-NOT-SHARE-THIS.--Sharing-this...\n..."}
              value={bulkText}
              onChange={e => setBulkText(e.target.value)}
              style={{
                width: "100%", resize: "vertical", fontFamily: "monospace", fontSize: 10,
                padding: "10px 13px", borderRadius: 10, outline: "none",
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
                color: "var(--t1)", marginBottom: 12,
              }}
            />
          ) : (
            <div style={{ maxHeight: 250, overflowY: "auto", display: "flex", flexDirection: "column", gap: 5, marginBottom: 12 }}>
              {bulkResults.map((r, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 9,
                  background: r.success ? "rgba(52,211,153,0.06)" : "rgba(248,113,113,0.06)",
                  border: `1px solid ${r.success ? "rgba(52,211,153,0.2)" : "rgba(248,113,113,0.2)"}`,
                }}>
                  {r.success ? <CheckIcon size={12} color="var(--green)" /> : <XIcon size={12} color="var(--red)" />}
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--t1)" }}>{r.username ?? r.preview}</span>
                  {r.error && <span style={{ fontSize: 9.5, color: "var(--red)", marginLeft: "auto" }}>{r.error}</span>}
                </div>
              ))}
            </div>
          )}
          <ModalActions>
            <ModalBtn label={bulkResults.length > 0 ? t("close_btn") : t("cancel")} onClick={() => { setShowBulk(false); setBulkText(""); setBulkResults([]); }} disabled={bulkAdding} />
            {bulkResults.length === 0 && (
              <ModalBtn label={bulkAdding ? t("importing_btn") : t("import_all_btn")} onClick={handleBulkImport} primary disabled={bulkAdding || !bulkText.trim()} />
            )}
          </ModalActions>
        </AccountModal>
      )}

      {/* User:Pass */}
      {showUserPass && (
        <AccountModal title={t("user_pass_combo_import_title")} onClose={() => { if (!loginLoading) setShowUserPass(false); }}>
          <p style={{ fontSize: 11, color: "var(--t2)", marginBottom: 14, lineHeight: 1.6 }}>
            `{t("paste_combos_desc")}` A login window will open for each account.
          </p>
          <FieldLabel>{t("account_combos_label")}</FieldLabel>
          <textarea
            rows={6}
            value={comboText}
            onChange={e => setComboText(e.target.value)}
            placeholder={"username:password\nusername:password\n..."}
            disabled={loginLoading}
            style={{
              width: "100%", resize: "vertical", fontFamily: "monospace", fontSize: 11,
              padding: "10px 13px", borderRadius: 10, outline: "none",
              background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
              color: "var(--t1)", marginBottom: 12, opacity: loginLoading ? 0.5 : 1,
            }}
          />
          {loginError && <ErrorMsg msg={loginError} />}
          <ModalActions>
            <ModalBtn label={t("cancel")} onClick={() => setShowUserPass(false)} disabled={loginLoading} />
            <ModalBtn label={loginLoading ? t("validating_btn") : t("start_import_btn")} onClick={() => handleComboImport(comboText)} primary disabled={loginLoading || !comboText.trim()} />
          </ModalActions>
        </AccountModal>
      )}

      {/* Account Utilities */}
      {selectedUtilAccount && (
        <AccountModal
          title="Account Utilities"
          onClose={() => { if (!utilLoading) { setSelectedUtilAccount(null); setUtilStatus(""); } }}
          wide
        >
          <div style={{
            display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
            background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)",
            borderRadius: 12, marginBottom: 20,
          }}>
            <Avatar name={selectedUtilAccount.username} avatarUrl={selectedUtilAccount.avatar_url} size={40} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--t1)" }}>{selectedUtilAccount.display_name}</div>
              <div style={{ fontSize: 10.5, color: "var(--amber)", fontFamily: "monospace" }}>@{selectedUtilAccount.username} · ID {selectedUtilAccount.user_id}</div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Display Name */}
            <UtilSection label={t("display_name_label")} Icon={UserIcon}>
              <div style={{ display: "flex", gap: 8 }}>
                <UtilInput value={utilNewDisplayName} onChange={setUtilNewDisplayName} placeholder={t("new_display_name_placeholder")} disabled={utilLoading} />
                <UtilAction label={t("set_name")} onClick={handleSetDisplayName} disabled={utilLoading || !utilNewDisplayName.trim()} />
              </div>
            </UtilSection>

            {/* Password */}
            <UtilSection label={t("change_password_label")} Icon={KeyIcon}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <UtilInput type="password" value={utilCurrentPassword} onChange={setUtilCurrentPassword} placeholder={t("current_password_placeholder")} disabled={utilLoading} />
                <div style={{ display: "flex", gap: 8 }}>
                  <UtilInput type="password" value={utilNewPassword} onChange={setUtilNewPassword} placeholder={t("new_password_placeholder")} disabled={utilLoading} />
                  <UtilAction label={t("change_password_btn")} onClick={handleChangePassword} disabled={utilLoading || !utilCurrentPassword || !utilNewPassword} />
                </div>
              </div>
            </UtilSection>

            {/* Friends */}
            <UtilSection label={t("friend_block_label")} Icon={GamepadIcon}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <UtilInput value={utilTargetUser} onChange={setUtilTargetUser} placeholder={t("target_username_placeholder")} disabled={utilLoading} />
                <div style={{ display: "flex", gap: 8 }}>
                  <UtilAction label={t("add_friend_btn")} onClick={handleSendFriendRequest} disabled={utilLoading || !utilTargetUser.trim()} />
                  <UtilAction label={t("block_user_btn")} onClick={handleBlockUser} disabled={utilLoading || !utilTargetUser.trim()} danger />
                </div>
              </div>
            </UtilSection>

            {/* Security */}
            <UtilSection label={t("security_label")} Icon={ShieldIcon}>
              <UtilAction label="Sign Out All Other Sessions" onClick={handleSignOutAll} disabled={utilLoading} fullWidth />
            </UtilSection>
          </div>

          {utilStatus && (
            <div style={{
              fontSize: 11.5, fontWeight: 700,
              color: utilIsError ? "var(--red)" : "var(--green)",
              marginTop: 16, padding: "10px 14px", borderRadius: 10, textAlign: "center",
              background: utilIsError ? "rgba(248,113,113,0.08)" : "rgba(52,211,153,0.08)",
              border: `1px solid ${utilIsError ? "rgba(248,113,113,0.2)" : "rgba(52,211,153,0.2)"}`,
            }}>
              {utilStatus}
            </div>
          )}
        </AccountModal>
      )}

      {/* Export Backup */}
      {showExport && (
        <AccountModal title="Export Backup" onClose={() => { if (!exportLoading) setShowExport(false); }}>
          <p style={{ fontSize: 11, color: "var(--t2)", marginBottom: 16, lineHeight: 1.7 }}>
            All accounts will be exported to an encrypted <code style={{ color: "var(--amber)", fontFamily: "monospace" }}>.reiya</code> backup file.
            Choose a strong password — it is required to restore the backup.
          </p>
          <FieldLabel>BACKUP PASSWORD</FieldLabel>
          <input
            type="password"
            autoFocus
            value={exportPwd}
            onChange={e => setExportPwd(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleExport(); }}
            placeholder="Enter a password to encrypt the backup"
            disabled={exportLoading}
            style={{
              width: "100%", height: 38, padding: "0 13px", borderRadius: 10, outline: "none",
              background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
              color: "var(--t1)", fontSize: 12, marginBottom: 12, opacity: exportLoading ? 0.5 : 1,
            }}
          />
          {exportErr && <ErrorMsg msg={exportErr} />}
          {exportOk && (
            <div style={{ fontSize: 11, color: "var(--green)", marginBottom: 10, padding: "8px 12px", background: "rgba(52,211,153,0.08)", borderRadius: 9, border: "1px solid rgba(52,211,153,0.2)" }}>
              {exportOk}
            </div>
          )}
          <ModalActions>
            <ModalBtn label="Cancel" onClick={() => setShowExport(false)} disabled={exportLoading} />
            <ModalBtn label={exportLoading ? "Exporting..." : "Export Backup"} onClick={handleExport} primary disabled={exportLoading || !exportPwd.trim()} />
          </ModalActions>
        </AccountModal>
      )}

      {/* Import Backup */}
      {showImport && (
        <AccountModal title="Import Backup" onClose={() => { if (!importLoading) setShowImport(false); }}>
          <p style={{ fontSize: 11, color: "var(--t2)", marginBottom: 16, lineHeight: 1.7 }}>
            Select a <code style={{ color: "var(--amber)", fontFamily: "monospace" }}>.reiya</code> backup file to restore.
            Duplicate accounts (matching User ID) will be skipped.
          </p>
          <FieldLabel>BACKUP PASSWORD</FieldLabel>
          <input
            type="password"
            autoFocus
            value={importPwd}
            onChange={e => setImportPwd(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleImport(); }}
            placeholder="Enter the backup password"
            disabled={importLoading}
            style={{
              width: "100%", height: 38, padding: "0 13px", borderRadius: 10, outline: "none",
              background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
              color: "var(--t1)", fontSize: 12, marginBottom: 12, opacity: importLoading ? 0.5 : 1,
            }}
          />
          {importErr && <ErrorMsg msg={importErr} />}
          {importOk && (
            <div style={{ fontSize: 11, color: "var(--green)", marginBottom: 10, padding: "8px 12px", background: "rgba(52,211,153,0.08)", borderRadius: 9, border: "1px solid rgba(52,211,153,0.2)" }}>
              {importOk}
            </div>
          )}
          <ModalActions>
            <ModalBtn label="Cancel" onClick={() => setShowImport(false)} disabled={importLoading} />
            <ModalBtn label={importLoading ? "Importing..." : "Choose File & Import"} onClick={handleImport} primary disabled={importLoading || !importPwd.trim()} />
          </ModalActions>
        </AccountModal>
      )}

      {/* Move to Group modal */}
      {moveGroupModal && (
        <AccountModal title="Move to Group" onClose={() => setMoveGroupModal(false)}>
          <p style={{ fontSize: 11, color: "var(--t2)", marginBottom: 14, lineHeight: 1.6 }}>
            Assign {selected.size} selected account(s) to a group. Leave blank to remove from group.
          </p>
          <FieldLabel>GROUP NAME</FieldLabel>
          <input
            autoFocus
            value={groupInput}
            onChange={e => setGroupInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleBulkMoveGroup(); }}
            placeholder="e.g. Main, Alts, Farming..."
            style={{
              width: "100%", height: 38, padding: "0 13px", borderRadius: 10, outline: "none",
              background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
              color: "var(--t1)", fontSize: 12, marginBottom: 12,
            }}
          />
          <ModalActions>
            <ModalBtn label="Cancel" onClick={() => setMoveGroupModal(false)} />
            <ModalBtn label="Move" onClick={handleBulkMoveGroup} primary />
          </ModalActions>
        </AccountModal>
      )}
    </div>
  );
}

/* ── Bulk Action Button ── */
function BulkBtn({ label, onClick, disabled, danger, accent }: {
  label: string; onClick: () => void; disabled?: boolean; danger?: boolean; accent?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "5px 12px", borderRadius: 7, fontSize: 11, fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
        border: `1px solid ${danger ? "rgba(248,113,113,0.3)" : accent ? `${accent}40` : "rgba(255,255,255,0.1)"}`,
        background: danger ? "rgba(248,113,113,0.08)" : accent ? `${accent}14` : "rgba(255,255,255,0.04)",
        color: danger ? "var(--red)" : accent ?? "var(--t2)",
        transition: "all .12s",
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.filter = "brightness(1.2)"; }}
      onMouseLeave={e => { e.currentTarget.style.filter = "none"; }}
    >
      {label}
    </button>
  );
}

/* ── Account Card ── */
function AccountCard({ account, isLaunching, isSelected, onToggleSelect, onToggleFav, onRemove, onLaunch, onValidate, onOpenUtilities }: {
  account: Account; isLaunching: boolean; isSelected: boolean;
  onToggleSelect: () => void;
  onToggleFav: () => void; onRemove: () => void;
  onLaunch: () => void; onValidate: () => void; onOpenUtilities: () => void;
}) {
  const { t } = useLanguage();
  const [hovered, setHovered] = useState(false);
  const isValid = account.cookie_status === "Valid";
  const isUnknown = account.cookie_status === "Unknown";
  const statusColor = isValid ? "var(--green)" : isUnknown ? "var(--amber)" : "var(--red)";
  const statusLabel = isValid ? "Valid" : isUnknown ? "Unknown" : "Expired";

  const lastLaunchedDisplay = account.last_launched_at
    ? new Date(account.last_launched_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : t("never");

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "center", gap: 14,
        padding: "14px 18px",
        background: isSelected
          ? "rgba(167,139,250,0.06)"
          : hovered ? "rgba(255,255,255,0.025)" : "rgba(255,255,255,0.015)",
        border: `1px solid ${isSelected ? "rgba(167,139,250,0.25)" : hovered ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.04)"}`,
        borderRadius: 16, transition: "all .15s", cursor: "default",
      }}
    >
      {/* Checkbox */}
      <div
        onClick={onToggleSelect}
        style={{
          width: 18, height: 18, borderRadius: 5, flexShrink: 0,
          border: `2px solid ${isSelected ? "#A78BFA" : "rgba(255,255,255,0.12)"}`,
          background: isSelected ? "#A78BFA" : "transparent",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", transition: "all .12s",
          opacity: hovered || isSelected ? 1 : 0,
        }}
      >
        {isSelected && <CheckIcon size={11} color="#fff" />}
      </div>

      {/* Avatar */}
      <div style={{ position: "relative", flexShrink: 0 }}>
        <LazyAvatar name={account.username} avatarUrl={account.avatar_url} size={48} />
        <span style={{
          position: "absolute", bottom: 1, right: 1,
          width: 10, height: 10, borderRadius: "50%",
          background: isValid ? "var(--green)" : "rgba(58,61,80,0.9)",
          border: "2px solid #07080a",
          boxShadow: isValid ? "0 0 5px var(--green)" : "none",
        }} />
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: "var(--t1)" }}>{account.display_name}</span>
          {account.is_favorite && <StarIcon size={11} fill="var(--amber)" color="var(--amber)" />}
        </div>
        <div style={{ fontSize: 11, color: "var(--t2)", marginBottom: account.tags?.length || account.notes ? 4 : 3 }}>
          @{account.username} <span style={{ color: "var(--t3)" }}>·</span> ID: {account.user_id}
        </div>
        {/* Tags */}
        {account.tags && account.tags.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 3 }}>
            {account.tags.map(tag => (
              <span key={tag} style={{
                fontSize: 9, fontWeight: 700, padding: "1px 7px", borderRadius: 4,
                background: "rgba(96,165,250,0.1)", color: "#60A5FA",
                border: "1px solid rgba(96,165,250,0.2)",
              }}>{tag}</span>
            ))}
          </div>
        )}
        {/* Notes */}
        {account.notes && (
          <div style={{ fontSize: 10, color: "var(--t3)", fontStyle: "italic", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {account.notes}
          </div>
        )}
        {!account.notes && account.last_played_game && (
          <div style={{ fontSize: 10, color: "var(--t3)", display: "flex", alignItems: "center", gap: 4 }}>
            <GamepadIcon size={10} color="var(--t3)" />
            {account.last_played_game}
          </div>
        )}
      </div>

      {/* Cookie status */}
      <div style={{ textAlign: "right", flexShrink: 0, minWidth: 110 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 5, marginBottom: 4 }}>
          <span style={{
            fontSize: 9, fontWeight: 800, padding: "2px 8px", borderRadius: 5,
            background: statusColor + "14",
            color: statusColor,
            border: `1px solid ${statusColor}30`,
            letterSpacing: "0.05em",
          }}>
            {statusLabel.toUpperCase()}
          </span>
        </div>
        <div style={{ fontSize: 9.5, color: "var(--t3)" }}>{t("last_launched")}: {lastLaunchedDisplay}</div>
        <button
          onClick={onValidate}
          style={{
            marginTop: 5, fontSize: 9, padding: "2px 9px", borderRadius: 5,
            border: "1px solid rgba(255,255,255,0.06)", background: "transparent",
            color: "var(--t3)", cursor: "pointer", fontWeight: 600,
            opacity: hovered ? 1 : 0, transition: "opacity .12s",
          }}
        >
          {t("re_validate_btn")}
        </button>
      </div>

      {/* Icon actions */}
      <div style={{ display: "flex", flexDirection: "column", gap: 5, flexShrink: 0 }}>
        <button
          onClick={onOpenUtilities}
          title="Account Utilities"
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: "var(--t3)", padding: 5, borderRadius: 7,
            opacity: hovered ? 1 : 0.4, transition: "all .12s",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
          onMouseEnter={e => { e.currentTarget.style.color = "var(--amber)"; e.currentTarget.style.background = "rgba(232,232,232,0.08)"; }}
          onMouseLeave={e => { e.currentTarget.style.color = "var(--t3)"; e.currentTarget.style.background = "none"; }}
        >
          <SettingsIcon size={14} />
        </button>
        <button
          onClick={onToggleFav}
          title="Toggle favorite"
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: account.is_favorite ? "var(--amber)" : "var(--t3)",
            transition: "all .12s", padding: 5, borderRadius: 7,
            opacity: hovered || account.is_favorite ? 1 : 0.4,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = "rgba(232,232,232,0.08)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "none"; }}
        >
          <StarIcon size={13} fill={account.is_favorite ? "var(--amber)" : "none"} color={account.is_favorite ? "var(--amber)" : "var(--t3)"} />
        </button>
        <button
          onClick={onRemove}
          title="Remove account"
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: "var(--red)", padding: 5, borderRadius: 7,
            opacity: hovered ? 0.7 : 0, transition: "all .12s",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
          onMouseEnter={e => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.background = "rgba(248,113,113,0.08)"; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = "0.7"; e.currentTarget.style.background = "none"; }}
        >
          <TrashIcon size={13} color="var(--red)" />
        </button>
      </div>

      {/* Launch button */}
      <button
        onClick={onLaunch}
        disabled={isLaunching || !isValid}
        style={{
          display: "flex", alignItems: "center", gap: 7,
          padding: "9px 18px", borderRadius: 10, border: "none",
          background: isLaunching
            ? "rgba(255,255,255,0.04)"
            : isValid
              ? "var(--accent)"
              : "rgba(255,255,255,0.04)",
          color: isLaunching ? "var(--t3)" : isValid ? "var(--accent-text)" : "var(--t3)",
          fontSize: 12, fontWeight: 800,
          cursor: isLaunching || !isValid ? "not-allowed" : "pointer",
          flexShrink: 0,
          boxShadow: isValid && !isLaunching ? "0 4px 14px rgba(232,232,232,0.2)" : "none",
          transition: "all .12s",
          filter: hovered && isValid && !isLaunching ? "brightness(1.08)" : "none",
        }}
      >
        <ZapIcon size={12} color={isValid && !isLaunching ? "var(--accent-text)" : "var(--t3)"} />
        {isLaunching ? t("launching_suffix") : t("quick_launch_btn")}
      </button>
    </div>
  );
}

/* â"€â"€ Stat Pill â"€â"€ */
function AccountStatPill({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div style={{
      textAlign: "center", padding: "6px 16px", borderRadius: 10,
      background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)",
    }}>
      <div style={{ fontSize: 16, fontWeight: 900, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 8.5, color: "var(--t3)", marginTop: 3, fontWeight: 800, letterSpacing: "0.08em" }}>{label}</div>
    </div>
  );
}

/* â"€â"€ Modal wrapper â"€â"€ */
function AccountModal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(10px)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "linear-gradient(135deg, rgba(19,20,27,0.99) 0%, rgba(13,14,20,0.99) 100%)",
        border: "1px solid rgba(255,255,255,0.08)", borderRadius: 20,
        padding: 26, width: wide ? 500 : 440, maxWidth: "93vw", maxHeight: "88vh", overflowY: "auto",
        boxShadow: "0 24px 60px rgba(0,0,0,0.7)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 900, color: "var(--t1)" }}>{title}</div>
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "var(--t3)", display: "flex", alignItems: "center", justifyContent: "center",
              padding: 4, borderRadius: 6, transition: "all .12s",
            }}
            onMouseEnter={e => { e.currentTarget.style.color = "var(--t1)"; e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "var(--t3)"; e.currentTarget.style.background = "none"; }}
          >
            <XIcon size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalBtn({ label, onClick, primary, danger, disabled }: {
  label: string; onClick: () => void; primary?: boolean; danger?: boolean; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1, padding: "10px 0", borderRadius: 10, fontSize: 12, fontWeight: 800,
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, transition: "all .12s",
        border: primary ? "none" : danger ? "1px solid rgba(248,113,113,0.3)" : "1px solid rgba(255,255,255,0.07)",
        background: primary ? "rgba(232,232,232,0.92)" : danger ? "rgba(248,113,113,0.1)" : "rgba(255,255,255,0.03)",
        color: primary ? "#0a0a0a" : danger ? "var(--red)" : "var(--t2)",
        boxShadow: primary && !disabled ? "0 4px 14px rgba(232,232,232,0.2)" : "none",
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.filter = "brightness(1.1)"; }}
      onMouseLeave={e => { if (!disabled) e.currentTarget.style.filter = "none"; }}
    >
      {label}
    </button>
  );
}

function ModalActions({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", gap: 10, marginTop: 16 }}>{children}</div>;
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 9.5, color: "var(--t3)", fontWeight: 800, letterSpacing: "0.1em", marginBottom: 8 }}>
      {children}
    </div>
  );
}

function ErrorMsg({ msg }: { msg: string }) {
  return (
    <div style={{
      fontSize: 11.5, color: "var(--red)", marginBottom: 10, padding: "8px 12px",
      background: "rgba(248,113,113,0.08)", borderRadius: 9,
      border: "1px solid rgba(248,113,113,0.2)",
    }}>{msg}</div>
  );
}

/* â"€â"€ Utility section â"€â"€ */
function UtilSection({ label, Icon, children }: { label: string; Icon: React.ComponentType<any>; children: ReactNode }) {
  return (
    <div style={{
      padding: "14px 16px", borderRadius: 12,
      background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.05)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
        <Icon size={12} color="var(--t3)" />
        <span style={{ fontSize: 9.5, fontWeight: 800, color: "var(--t3)", letterSpacing: "0.1em" }}>{label}</span>
      </div>
      {children}
    </div>
  );
}

function UtilInput({ value, onChange, placeholder, type, disabled }: { value: string; onChange: (v: string) => void; placeholder: string; type?: string; disabled?: boolean }) {
  return (
    <input
      type={type ?? "text"}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      style={{
        flex: 1, height: 34, padding: "0 12px", borderRadius: 9, outline: "none", fontSize: 12,
        background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
        color: "var(--t1)", opacity: disabled ? 0.5 : 1, transition: "border-color .15s",
      }}
      onFocus={e => e.currentTarget.style.borderColor = "rgba(232,232,232,0.4)"}
      onBlur={e => e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)"}
    />
  );
}

function UtilAction({ label, onClick, disabled, danger, fullWidth }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; fullWidth?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: fullWidth ? "1 1 100%" : undefined,
        height: 34, padding: "0 16px", borderRadius: 9, fontSize: 11.5, fontWeight: 800,
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.4 : 1, transition: "all .12s",
        background: danger ? "rgba(248,113,113,0.08)" : "rgba(255,255,255,0.04)",
        color: danger ? "var(--red)" : "var(--t1)",
        border: danger ? "1px solid rgba(248,113,113,0.2)" : "1px solid rgba(255,255,255,0.07)",
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.filter = "brightness(1.15)"; }}
      onMouseLeave={e => { if (!disabled) e.currentTarget.style.filter = "none"; }}
    >
      {label}
    </button>
  );
}

/* â"€â"€ Dropdown item â"€â"€ */
function DropdownItem({ icon, label, sub, onClick }: { icon: ReactNode; label: string; sub: string; onClick: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
        borderRadius: 9, background: hov ? "rgba(255,255,255,0.05)" : "transparent",
        cursor: "pointer", transition: "background .1s",
      }}
    >
      <span style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 28, height: 28, borderRadius: 7, flexShrink: 0,
        background: hov ? "rgba(232,232,232,0.1)" : "rgba(255,255,255,0.04)",
        color: hov ? "var(--amber)" : "var(--t2)",
        border: `1px solid ${hov ? "rgba(232,232,232,0.2)" : "rgba(255,255,255,0.06)"}`,
        transition: "all .12s",
      }}>
        {icon}
      </span>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--t1)" }}>{label}</div>
        <div style={{ fontSize: 10, color: "var(--t3)", marginTop: 1 }}>{sub}</div>
      </div>
    </div>
  );
}

/* â"€â"€ Avatar â"€â"€ */
function Avatar({ name, avatarUrl, size }: { name: string; avatarUrl: string; size: number }) {
  const [imgFailed, setImgFailed] = useState(false);
  const hue = name.split("").reduce((n, c) => n + c.charCodeAt(0), 0) % 360;
  if (avatarUrl && !imgFailed) {
    return (
      <img
        src={avatarUrl} alt={name}
        onError={() => setImgFailed(true)}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", display: "block" }}
      />
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: `hsl(${hue},20%,18%)`, border: `2px solid hsl(${hue},20%,28%)`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.3, fontWeight: 800, color: `hsl(${hue},50%,65%)`,
    }}>
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}

function LazyAvatar({ name, avatarUrl, size }: { name: string; avatarUrl: string; size: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); obs.disconnect(); }
    }, { rootMargin: "80px" });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ width: size, height: size }}>
      {visible
        ? <Avatar name={name} avatarUrl={avatarUrl} size={size} />
        : <div style={{ width: size, height: size, borderRadius: "50%", background: "rgba(255,255,255,0.05)" }} />
      }
    </div>
  );
}

