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
  const [accounts,  setAccounts]  = useState<Account[]>([]);
  const [filter,    setFilter]    = useState<FilterTab>("all");
  const [search,    setSearch]    = useState("");
  const [loading,   setLoading]   = useState(true);
  const [launching, setLaunching] = useState<number | null>(null);

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
    if (!confirm(`Remove account @${username}?`)) return;
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
    } catch (e) { setBulkResults([{ preview: "â€”", success: false, username: null, error: String(e) }]); }
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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#07080a" }}>

      {/* â”€â”€ HEADER â”€â”€ */}
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
              ACCOUNT MANAGER
            </h1>
            <p style={{ fontSize: 10, fontWeight: 700, color: "var(--t3)", letterSpacing: "0.1em", marginTop: 3 }}>
              MANAGE Â· LAUNCH Â· VALIDATE ROBLOX ACCOUNTS
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* Stat pills */}
            <AccountStatPill value={accounts.length} label="TOTAL" color="var(--t1)" />
            <AccountStatPill value={favCount} label="FAVORITES" color="var(--amber)" />
            <AccountStatPill value={online} label="ACTIVE" color="var(--green)" />

            {/* Add Account dropdown */}
            <div ref={addMenuRef} style={{ position: "relative" }}>
              <button
                onClick={e => { e.stopPropagation(); setAddMenu(v => !v); }}
                style={{
                  display: "flex", alignItems: "center", gap: 7,
                  padding: "9px 16px", borderRadius: 10, border: "none",
                  background: "rgba(232,232,232,0.92)",
                  color: "#0a0a0a", fontSize: 12, fontWeight: 800, cursor: "pointer",
                  boxShadow: "0 4px 14px rgba(232,232,232,0.25)", transition: "filter .12s",
                }}
                onMouseEnter={e => e.currentTarget.style.filter = "brightness(1.1)"}
                onMouseLeave={e => e.currentTarget.style.filter = "none"}
              >
                + Add Account
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
                  <DropdownItem icon={<GlobeIcon size={14} />} label="Manual Login" sub="Open Roblox login in a popup" onClick={handleManualLogin} />
                  <DropdownItem icon={<KeyIcon size={14} />} label="User:Pass" sub="Auto-fill credentials in popup" onClick={() => { setAddMenu(false); setComboText(""); setLoginError(""); setShowUserPass(true); }} />
                  <DropdownItem icon={<ShieldCheckIcon size={14} />} label="Cookie(s)" sub="Paste or detect from clipboard" onClick={handleOpenCookieMenu} />
                  <DropdownItem icon={<FileTextIcon size={14} />} label="Cookies from .txt file" sub="Bulk import, one per line" onClick={() => { setAddMenu(false); setBulkText(""); setBulkResults([]); setShowBulk(true); }} />
                  <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "4px 8px" }} />
                  <DropdownItem icon={<SettingsIcon size={14} />} label="Custom (URL + JS)" sub="Not implemented" onClick={() => setAddMenu(false)} />
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
              placeholder="Search by username or display name..."
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
            {([["all", "All"], ["favorites", "Favorites"]] as [FilterTab, string][]).map(([id, label]) => (
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

      {/* â”€â”€ ACCOUNT LIST â”€â”€ */}
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
            Loading accounts...
          </div>
        ) : visible.length === 0 ? (
          <div style={{
            textAlign: "center", padding: "60px 20px",
            color: "var(--t3)", fontSize: 12.5,
            border: "1px dashed rgba(255,255,255,0.06)", borderRadius: 16,
          }}>
            {accounts.length === 0
              ? 'No accounts yet â€” click "+ Add Account" to get started'
              : search ? `No accounts match "${search}"` : "No accounts in this view"}
          </div>
        ) : (
          visible.map(account => (
            <AccountCard
              key={account.user_id}
              account={account}
              isLaunching={launching === account.user_id}
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

      {/* â”€â”€ MODALS â”€â”€ */}

      {/* Single Cookie */}
      {showSingle && (
        <AccountModal title="Import Cookie" onClose={() => { setShowSingle(false); setAddError(""); }}>
          <FieldLabel>ROBLOSECURITY COOKIE</FieldLabel>
          <textarea
            rows={4}
            placeholder="Paste your .ROBLOSECURITY cookie here..."
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
            <ModalBtn label="Cancel" onClick={() => { setShowSingle(false); setAddError(""); }} />
            <ModalBtn label={adding ? "Validating..." : "Import Cookie"} onClick={handleAddSingle} primary disabled={adding || !addCookie.trim()} />
          </ModalActions>
        </AccountModal>
      )}

      {/* Bulk Import */}
      {showBulk && (
        <AccountModal title="Bulk Cookie Import" onClose={() => { if (!bulkAdding) { setShowBulk(false); setBulkText(""); setBulkResults([]); } }}>
          <p style={{ fontSize: 11, color: "var(--t2)", marginBottom: 14, lineHeight: 1.6 }}>
            Paste cookies â€” one per line. Each must contain <code style={{ color: "var(--amber)", fontFamily: "monospace" }}>.ROBLOSECURITY</code>.
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
            <ModalBtn label={bulkResults.length > 0 ? "Close" : "Cancel"} onClick={() => { setShowBulk(false); setBulkText(""); setBulkResults([]); }} disabled={bulkAdding} />
            {bulkResults.length === 0 && (
              <ModalBtn label={bulkAdding ? "Importing..." : "Import All"} onClick={handleBulkImport} primary disabled={bulkAdding || !bulkText.trim()} />
            )}
          </ModalActions>
        </AccountModal>
      )}

      {/* User:Pass */}
      {showUserPass && (
        <AccountModal title="User:Pass Combo Import" onClose={() => { if (!loginLoading) setShowUserPass(false); }}>
          <p style={{ fontSize: 11, color: "var(--t2)", marginBottom: 14, lineHeight: 1.6 }}>
            Paste <code style={{ color: "var(--amber)", fontFamily: "monospace" }}>username:password</code> combos (one per line). A login window will open for each account.
          </p>
          <FieldLabel>ACCOUNT COMBOS</FieldLabel>
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
            <ModalBtn label="Cancel" onClick={() => setShowUserPass(false)} disabled={loginLoading} />
            <ModalBtn label={loginLoading ? "Processing..." : "Start Import"} onClick={() => handleComboImport(comboText)} primary disabled={loginLoading || !comboText.trim()} />
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
              <div style={{ fontSize: 10.5, color: "var(--amber)", fontFamily: "monospace" }}>@{selectedUtilAccount.username} Â· ID {selectedUtilAccount.user_id}</div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Display Name */}
            <UtilSection label="DISPLAY NAME" Icon={UserIcon}>
              <div style={{ display: "flex", gap: 8 }}>
                <UtilInput value={utilNewDisplayName} onChange={setUtilNewDisplayName} placeholder="New display name" disabled={utilLoading} />
                <UtilAction label="Set Name" onClick={handleSetDisplayName} disabled={utilLoading || !utilNewDisplayName.trim()} />
              </div>
            </UtilSection>

            {/* Password */}
            <UtilSection label="CHANGE PASSWORD" Icon={KeyIcon}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <UtilInput type="password" value={utilCurrentPassword} onChange={setUtilCurrentPassword} placeholder="Current password" disabled={utilLoading} />
                <div style={{ display: "flex", gap: 8 }}>
                  <UtilInput type="password" value={utilNewPassword} onChange={setUtilNewPassword} placeholder="New password" disabled={utilLoading} />
                  <UtilAction label="Change" onClick={handleChangePassword} disabled={utilLoading || !utilCurrentPassword || !utilNewPassword} />
                </div>
              </div>
            </UtilSection>

            {/* Friends */}
            <UtilSection label="FRIENDS & BLOCKS" Icon={GamepadIcon}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <UtilInput value={utilTargetUser} onChange={setUtilTargetUser} placeholder="Target Roblox username" disabled={utilLoading} />
                <div style={{ display: "flex", gap: 8 }}>
                  <UtilAction label="Add Friend" onClick={handleSendFriendRequest} disabled={utilLoading || !utilTargetUser.trim()} />
                  <UtilAction label="Block User" onClick={handleBlockUser} disabled={utilLoading || !utilTargetUser.trim()} danger />
                </div>
              </div>
            </UtilSection>

            {/* Security */}
            <UtilSection label="SECURITY" Icon={ShieldIcon}>
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
    </div>
  );
}

/* â”€â”€ Account Card â”€â”€ */
function AccountCard({ account, isLaunching, onToggleFav, onRemove, onLaunch, onValidate, onOpenUtilities }: {
  account: Account; isLaunching: boolean;
  onToggleFav: () => void; onRemove: () => void;
  onLaunch: () => void; onValidate: () => void; onOpenUtilities: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const isValid = account.cookie_status === "Valid";
  const isUnknown = account.cookie_status === "Unknown";
  const statusColor = isValid ? "var(--green)" : isUnknown ? "var(--amber)" : "var(--red)";
  const statusLabel = isValid ? "Valid" : isUnknown ? "Unknown" : "Expired";

  const lastLaunchedDisplay = account.last_launched_at
    ? new Date(account.last_launched_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "Never";

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "center", gap: 14,
        padding: "14px 18px",
        background: hovered ? "rgba(255,255,255,0.025)" : "rgba(255,255,255,0.015)",
        border: `1px solid ${hovered ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.04)"}`,
        borderRadius: 16, transition: "all .15s", cursor: "default",
      }}
    >
      {/* Avatar */}
      <div style={{ position: "relative", flexShrink: 0 }}>
        <Avatar name={account.username} avatarUrl={account.avatar_url} size={48} />
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
        <div style={{ fontSize: 11, color: "var(--t2)", marginBottom: 3 }}>
          @{account.username} <span style={{ color: "var(--t3)" }}>Â·</span> ID: {account.user_id}
        </div>
        {account.last_played_game && (
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
        <div style={{ fontSize: 9.5, color: "var(--t3)" }}>Last: {lastLaunchedDisplay}</div>
        <button
          onClick={onValidate}
          style={{
            marginTop: 5, fontSize: 9, padding: "2px 9px", borderRadius: 5,
            border: "1px solid rgba(255,255,255,0.06)", background: "transparent",
            color: "var(--t3)", cursor: "pointer", fontWeight: 600,
            opacity: hovered ? 1 : 0, transition: "opacity .12s",
          }}
        >
          Re-validate
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
              ? "rgba(232,232,232,0.92)"
              : "rgba(255,255,255,0.04)",
          color: isLaunching ? "var(--t3)" : isValid ? "#0a0a0a" : "var(--t3)",
          fontSize: 12, fontWeight: 800,
          cursor: isLaunching || !isValid ? "not-allowed" : "pointer",
          flexShrink: 0,
          boxShadow: isValid && !isLaunching ? "0 4px 14px rgba(232,232,232,0.2)" : "none",
          transition: "all .12s",
          filter: hovered && isValid && !isLaunching ? "brightness(1.08)" : "none",
        }}
      >
        <ZapIcon size={12} color={isValid && !isLaunching ? "#0a0a0a" : "var(--t3)"} />
        {isLaunching ? "Launching..." : "Quick Launch"}
      </button>
    </div>
  );
}

/* â”€â”€ Stat Pill â”€â”€ */
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

/* â”€â”€ Modal wrapper â”€â”€ */
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

/* â”€â”€ Utility section â”€â”€ */
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

/* â”€â”€ Dropdown item â”€â”€ */
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

/* â”€â”€ Avatar â”€â”€ */
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

