import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { CATALOG } from "../data/catalog";
import { useNavigate, useLocation } from "react-router-dom";
import {
  UserIcon,
  MonitorIcon,
  BarChartIcon,
  ShieldCheckIcon,
  GamepadIcon,
  LockIcon,
  AlertTriangleIcon,
  SettingsIcon,
  PowerIcon,
  CheckIcon,
  XIcon,
  PlayIcon,
  PlusIcon,
  TrashIcon,
  LoaderIcon
} from "../components/Icons";

/* â”€â”€ Types â”€â”€ */
interface Account {
  user_id: number;
  username: string;
  display_name: string;
  avatar_url: string;
  is_favorite: boolean;
  cookie_status: string;
  last_launched_at: string | null;
  last_played_game: string;
  notes: string;
  tags: string[];
  default_place_id: string;
  default_game_name: string;
  safe_launch_enabled: boolean;
  auto_rejoin_enabled: boolean;
  launch_cooldown_seconds: number;
  password?: string;
  group?: string;
}

interface Session {
  pid: number;
  user_id: number | null;
  username: string | null;
  avatar_url: string | null;
}

interface EventEntry {
  timestamp: string;
  kind: string;
  user_id: number | null;
  username: string | null;
  avatar_url: string | null;
  detail: string;
}

interface SessionRecord {
  username: string;
  user_id: number;
  avatar_url: string;
  game_name: string;
  place_id: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
}

interface RecentGame {
  placeId: string;
  name: string;
  creator: string;
  iconUrl: string;
  playedAt: string;
  privateServer?: string;
}

interface BulkAddResult {
  preview: string;
  success: boolean;
  username: string | null;
  error: string | null;
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
export default function Home() {
  const navigate = useNavigate();
  const location = useLocation();
  const [accounts,       setAccounts]       = useState<Account[]>([]);
  const [sessions,       setSessions]       = useState<Session[]>([]);
  const [events,         setEvents]         = useState<EventEntry[]>([]);
  const [sessionHistory, setSessionHistory] = useState<SessionRecord[]>([]);
  const [recentGames,    setRecentGames]    = useState<RecentGame[]>([]);
  const [thumbs,         setThumbs]         = useState<Record<string, string>>({});
  const [, setThumbsLoading]  = useState(true);

  // Play stats modal state & computations
  const [showPlayStats, setShowPlayStats] = useState(false);
  const [bulkChecking, setBulkChecking] = useState(false);

  const playStatsData = useMemo(() => {
    if (sessionHistory.length === 0) {
      return {
        totalSessions: 0,
        totalPlayTime: "0m",
        topAccount: "â€”",
        byAccount: [],
        byGame: []
      };
    }

    const totalSessions = sessionHistory.length;
    const totalMin = sessionHistory.reduce((sum, r) => sum + r.duration_minutes, 0);
    const totalPlayTime = totalMin < 60 ? `${totalMin}m` : `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`;

    const accountGroups: Record<string, { sessions: number; minutes: number }> = {};
    const gameGroups: Record<string, { sessions: number; minutes: number }> = {};

    for (const r of sessionHistory) {
      const u = r.username || "(Unknown)";
      if (!accountGroups[u]) accountGroups[u] = { sessions: 0, minutes: 0 };
      accountGroups[u].sessions++;
      accountGroups[u].minutes += r.duration_minutes;

      const g = r.game_name || "(Unknown)";
      if (!gameGroups[g]) gameGroups[g] = { sessions: 0, minutes: 0 };
      gameGroups[g].sessions++;
      gameGroups[g].minutes += r.duration_minutes;
    }

    const formatTime = (mins: number) => mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;

    const accList = Object.entries(accountGroups)
      .map(([name, data]) => ({ name, sessions: data.sessions, minutes: data.minutes }))
      .sort((a, b) => b.minutes - a.minutes);

    const maxAccMin = accList[0]?.minutes || 1;
    const byAccount = accList.map((x, i) => ({
      rank: i + 1,
      name: x.name,
      sessionsLabel: `${x.sessions} play${x.sessions === 1 ? "" : "s"}`,
      timeText: formatTime(x.minutes),
      pct: Math.round((x.minutes / maxAccMin) * 100),
    }));

    const gameList = Object.entries(gameGroups)
      .map(([name, data]) => ({ name, sessions: data.sessions, minutes: data.minutes }))
      .sort((a, b) => b.minutes - a.minutes);

    const maxGameMin = gameList[0]?.minutes || 1;
    const byGame = gameList.map((x, i) => ({
      rank: i + 1,
      name: x.name,
      sessionsLabel: `${x.sessions} play${x.sessions === 1 ? "" : "s"}`,
      timeText: formatTime(x.minutes),
      pct: Math.round((x.minutes / maxGameMin) * 100),
    }));

    const topAccount = accList[0]?.name ?? "â€”";

    return {
      totalSessions,
      totalPlayTime,
      topAccount,
      byAccount,
      byGame
    };
  }, [sessionHistory]);

  const handleBulkCookieCheck = async () => {
    if (bulkChecking) return;
    setBulkChecking(true);
    try {
      for (const acc of accounts) {
        await handleCheckCookie(acc.user_id);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setBulkChecking(false);
    }
  };

  // Launch state
  const [selAccount,      setSelAccount]      = useState<number | null>(null);
  const [launchPlaceId,   setLaunchPlaceId]   = useState("");  // selected placeId (from recent or manual)
  const [jobId,           setJobId]           = useState("");
  const [accessCode,      setAccessCode]      = useState("");
  const [useBootstrapper, setUseBootstrapper] = useState<boolean>(() => {
    return localStorage.getItem("reiya_use_bootstrapper") === "true";
  });
  const handleToggleBootstrapper = (val: boolean) => {
    setUseBootstrapper(val);
    localStorage.setItem("reiya_use_bootstrapper", String(val));
  };
  const [launching,       setLaunching]       = useState(false);
  const [accountMenu, setAccountMenu] = useState<{
    x: number;
    y: number;
    account: Account;
  } | null>(null);
  const [launchError,     setLaunchError]     = useState("");

  // Add account
  const [addMenu,       setAddMenu]       = useState(false);
  const addMenuRef                        = useRef<HTMLDivElement>(null);
  const [showSingle,    setShowSingle]    = useState(false);   // single cookie modal
  const [showBulk,      setShowBulk]      = useState(false);   // bulk import modal
  const [addCookie,     setAddCookie]     = useState("");
  const [adding,        setAdding]        = useState(false);
  const [addError,      setAddError]      = useState("");
  const [bulkText,      setBulkText]      = useState("");
  const [bulkAdding,    setBulkAdding]    = useState(false);
  const [bulkResults,   setBulkResults]   = useState<BulkAddResult[]>([]);

  // User:Pass modal
  const [showUserPass,   setShowUserPass]   = useState(false);
  const [comboText,      setComboText]      = useState("");
  const [loginLoading,   setLoginLoading]   = useState(false);
  const [loginError,     setLoginError]     = useState("");

  // Cookie-check state per account
  const [checkingCookie, setCheckingCookie] = useState<Record<number, boolean>>({});

  // Custom dialog modals
  const [privateServerModal, setPrivateServerModal] = useState<{ placeId: string, name: string, currentValue: string } | null>(null);
  const [privateServerInput, setPrivateServerInput] = useState("");
  const [deleteConfirmModal, setDeleteConfirmModal] = useState<{ placeId: string, name: string } | null>(null);

  // Edit Account Modal State
  const [editAccountModal, setEditAccountModal] = useState<Account | null>(null);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editDefaultPlaceId, setEditDefaultPlaceId] = useState("");
  const [editCookie, setEditCookie] = useState("");
  const [editCooldown, setEditCooldown] = useState(-1);
  const [editIsFavorite, setEditIsFavorite] = useState(false);
  const [editSafeLaunch, setEditSafeLaunch] = useState(false);
  const [editAutoRejoin, setEditAutoRejoin] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState("");

  // Account Utilities Modal State
  const [utilAccount, setUtilAccount] = useState<Account | null>(null);
  const [utilNewDisplayName, setUtilNewDisplayName] = useState("");
  const [utilCurrentPassword, setUtilCurrentPassword] = useState("");
  const [utilNewPassword, setUtilNewPassword] = useState("");
  const [utilTargetUser, setUtilTargetUser] = useState("");
  const [utilStatus, setUtilStatus] = useState("");
  const [utilIsError, setUtilIsError] = useState(false);
  const [utilLoading, setUtilLoading] = useState(false);

  // Dump Details Modal State
  const [dumpAccount, setDumpAccount] = useState<Account | null>(null);

  // Health check status per account
  const [healthStatus, setHealthStatus] = useState<Record<number, "checking" | "valid" | "invalid" | "unknown">>({});
  const healthCheckedRef = useRef(false);

  // Group modal
  const [groupModal, setGroupModal] = useState<{ account: Account } | null>(null);
  const [groupInput, setGroupInput] = useState("");

  /* â”€â”€ Load on mount, poll sessions â”€â”€ */
  useEffect(() => {
    async function load() {
      const [accs, sess, evts, hist, recents] = await Promise.all([
        invoke<Account[]>("get_accounts").catch(() => [] as Account[]),
        invoke<Session[]>("get_live_sessions").catch(() => [] as Session[]),
        invoke<EventEntry[]>("get_event_log").catch(() => [] as EventEntry[]),
        invoke<SessionRecord[]>("get_session_history").catch(() => [] as SessionRecord[]),
        invoke<RecentGame[]>("get_recent_games").catch(() => [] as RecentGame[]),
      ]);
      setAccounts(accs);
      setSessions(sess);
      setEvents(evts);
      setSessionHistory(hist);
      setRecentGames(recents);
      // Restore last selected account, fall back to first account
      const lastAccId = Number(localStorage.getItem("reiya_last_account"));
      const restoredAcc = lastAccId && accs.find(a => a.user_id === lastAccId) ? lastAccId : accs[0]?.user_id ?? null;
      if (restoredAcc !== null) setSelAccount(restoredAcc);
      // Restore last selected game
      const lastPlace = localStorage.getItem("reiya_last_place_id");
      if (lastPlace) setLaunchPlaceId(lastPlace);
    }
    load();

    // Listen for session status changes to reload statistics and sessions dynamically
    let unlisten: (() => void) | null = null;
    const setupListener = async () => {
      unlisten = await listen("session-status-changed", () => {
        Promise.all([
          invoke<Session[]>("get_live_sessions").catch(() => []),
          invoke<EventEntry[]>("get_event_log").catch(() => []),
          invoke<SessionRecord[]>("get_session_history").catch(() => []),
          invoke<RecentGame[]>("get_recent_games").catch(() => []),
        ]).then(([sess, evts, hist, recents]) => {
          setSessions(sess);
          setEvents(evts);
          setSessionHistory(hist);
          setRecentGames(recents);
        });
      });
    };
    setupListener();

    const interval = setInterval(() => {
      invoke<Session[]>("get_live_sessions").then(setSessions).catch(() => {});
    }, 5000);

    return () => {
      clearInterval(interval);
      if (unlisten) unlisten();
    };
  }, []);

  // Fetch static catalog thumbnails using place IDs
  useEffect(() => {
    const placeIds = CATALOG.map(g => g.placeId);
    invoke<Record<string, string>>("fetch_thumbnails", { placeIds })
      .then(map => {
        setThumbs(prev => ({ ...prev, ...map }));
      })
      .catch(() => {});
  }, []);

  // Fetch recently played game thumbnails using place IDs
  useEffect(() => {
    const placeIds = recentGames
      .map(r => r.placeId)
      .filter(Boolean);
    if (placeIds.length > 0) {
      invoke<Record<string, string>>("fetch_place_thumbnails", { placeIds })
        .then(map => {
          setThumbs(prev => ({ ...prev, ...map }));
        })
        .catch(() => {})
        .finally(() => setThumbsLoading(false));
    } else {
      setThumbsLoading(false);
    }
  }, [recentGames]);

  useEffect(() => {
    if (location.state && typeof location.state === "object") {
      const state = location.state as { placeId?: string; jobId?: string };
      if (state.placeId) {
        setLaunchPlaceId(state.placeId);
      }
      if (state.jobId !== undefined) {
        setJobId(state.jobId || "");
      }
      invoke<RecentGame[]>("get_recent_games")
        .then(setRecentGames)
        .catch(() => {});
      navigate(".", { replace: true, state: {} });
    }
  }, [location.state]);

  // Per-account game history helpers
  const getAccGameHistory = useCallback((userId: number): RecentGame[] => {
    try { return JSON.parse(localStorage.getItem(`reiya_acc_games_${userId}`) ?? "[]"); }
    catch { return []; }
  }, []);

  const pushAccGameHistory = useCallback((userId: number, game: RecentGame) => {
    const prev = getAccGameHistory(userId).filter(g => g.placeId !== game.placeId);
    localStorage.setItem(`reiya_acc_games_${userId}`, JSON.stringify([game, ...prev].slice(0, 10)));
  }, [getAccGameHistory]);

  // Tray: when user clicks an account in the system tray, select it
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<number>("tray-account-selected", (event) => {
      setSelAccount(event.payload);
      setLaunchError("");
    }).then(fn => { unlisten = fn; });
    return () => { if (unlisten) unlisten(); };
  }, []);

  // Background health check — runs once when accounts first load
  useEffect(() => {
    if (accounts.length === 0 || healthCheckedRef.current) return;
    healthCheckedRef.current = true;
    for (const acc of accounts) {
      setHealthStatus(prev => ({ ...prev, [acc.user_id]: "checking" }));
      invoke<string>("check_account_health", { userId: acc.user_id })
        .then(status => setHealthStatus(prev => ({ ...prev, [acc.user_id]: status.toLowerCase() as "valid" | "invalid" })))
        .catch(() => setHealthStatus(prev => ({ ...prev, [acc.user_id]: "unknown" })));
    }
  }, [accounts.length]);

  // Pre-fill accessCode when launchPlaceId changes
  const prevLaunchPlaceIdRef = useRef("");
  useEffect(() => {
    if (launchPlaceId && launchPlaceId !== prevLaunchPlaceIdRef.current) {
      const game = recentGames.find(g => g.placeId === launchPlaceId);
      if (game) {
        setAccessCode(game.privateServer || "");
      } else {
        setAccessCode("");
      }
    }
    prevLaunchPlaceIdRef.current = launchPlaceId;
  }, [launchPlaceId, recentGames]);

  /* â”€â”€ Derived â”€â”€ */
  const hour     = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const validCookies = accounts.filter(a => a.cookie_status === "Valid").length;
  const favorites    = accounts.filter(a => a.is_favorite).length;

  const activeUserIds = new Set(sessions.map(s => s.user_id).filter(Boolean));

  // Weekly stats from session history (last 7 days)
  const weekStats = useMemo(() => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const week = sessionHistory.filter(r => new Date(r.start_time).getTime() >= cutoff);
    const sessCount = week.length;
    const minutes   = week.reduce((s, r) => s + r.duration_minutes, 0);
    const uniqueAcc = new Set(week.map(r => r.username)).size;
    const hours     = Math.floor(minutes / 60);
    const mins      = minutes % 60;
    const timeStr   = minutes < 60 ? `${minutes}m` : `${hours}h ${mins}m`;
    return { sessCount, minutes, uniqueAcc, timeStr };
  }, [sessionHistory]);

  // 7-day graph from session history (by start_time)
  const graphData = useMemo(() => {
    const days: { day: string; dateStr: string; sessions: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push({
        dateStr: d.toDateString(),
        day:     d.toLocaleDateString("en-US", { weekday: "short" }),
        sessions: 0,
      });
    }
    for (const r of sessionHistory) {
      const ds = new Date(r.start_time).toDateString();
      const bucket = days.find(b => b.dateStr === ds);
      if (bucket) bucket.sessions++;
    }
    return days.map(({ day, sessions }) => ({ day, sessions }));
  }, [sessionHistory]);

  // Last 5 session history records for "Recent Activity"
  const recentActivity = sessionHistory.slice(0, 5);

  // Top games by total playtime from all session history
  const topGames = useMemo(() => {
    const map = new Map<string, { name: string; minutes: number; sessions: number; thumbnailUrl?: string }>();
    for (const r of sessionHistory) {
      const key = r.place_id;
      const existing = map.get(key);
      if (existing) {
        existing.minutes += r.duration_minutes;
        existing.sessions++;
      } else {
        const rg = recentGames.find(g => g.placeId === r.place_id);
        map.set(key, { name: r.game_name || "Unknown", minutes: r.duration_minutes, sessions: 1, thumbnailUrl: rg?.iconUrl });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.minutes - a.minutes).slice(0, 6);
  }, [sessionHistory, recentGames]);

  // Accounts grouped by group name for the left panel
  const groupedAccounts = useMemo(() => {
    const map = new Map<string, Account[]>();
    for (const acc of accounts) {
      const key = acc.group?.trim() || "";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(acc);
    }
    // Sort: ungrouped ("") last, others alphabetically
    const sorted = Array.from(map.entries()).sort(([a], [b]) => {
      if (a === "" && b !== "") return 1;
      if (a !== "" && b === "") return -1;
      return a.localeCompare(b);
    });
    return sorted;
  }, [accounts]);

  // Per-account game options: show account-specific history first, then global recents
  const accountGameOptions = useMemo(() => {
    if (selAccount === null) return recentGames;
    const accHistory = getAccGameHistory(selAccount);
    const accIds = new Set(accHistory.map(g => g.placeId));
    const rest = recentGames.filter(g => !accIds.has(g.placeId));
    return [...accHistory, ...rest];
  }, [selAccount, recentGames, getAccGameHistory]);

  // Launch derived
  const launchGame            = recentGames.find(g => g.placeId === launchPlaceId.trim());

  // Handle right-click context menu to set/edit private server URL or code via custom modal
  const handleGameContextMenu = (e: React.MouseEvent, g: RecentGame) => {
    e.preventDefault();
    setPrivateServerInput(g.privateServer || "");
    setPrivateServerModal({
      placeId: g.placeId,
      name: g.name,
      currentValue: g.privateServer || ""
    });
  };

  const handleAccountContextMenu = (e: React.MouseEvent, a: Account) => {
    e.preventDefault();
    setAccountMenu({
      x: e.clientX,
      y: e.clientY,
      account: a,
    });
  };

  const handleSavePrivateServer = async () => {
    if (!privateServerModal) return;
    const { placeId } = privateServerModal;
    const trimmed = privateServerInput.trim();
    const value = trimmed === "" ? null : trimmed;
    try {
      await invoke("set_private_server", { placeId, privateServer: value });
      const recents = await invoke<RecentGame[]>("get_recent_games").catch(() => []);
      setRecentGames(recents);
      if (launchPlaceId === placeId) {
        setAccessCode(value || "");
      }
      setPrivateServerModal(null);
    } catch (err) {
      alert("Failed to save private server: " + err);
    }
  };

  const handleConfirmDeleteGame = async () => {
    if (!deleteConfirmModal) return;
    const { placeId } = deleteConfirmModal;
    try {
      await invoke("remove_recent_game", { placeId });
      const recents = await invoke<RecentGame[]>("get_recent_games").catch(() => []);
      setRecentGames(recents);
      if (launchPlaceId === placeId) {
        setLaunchPlaceId("");
        setAccessCode("");
      }
      setDeleteConfirmModal(null);
    } catch (err) {
      alert("Failed to remove game: " + err);
    }
  };

  const handleSaveEditAccount = async () => {
    if (!editAccountModal) return;
    setEditLoading(true);
    setEditError("");
    try {
      // 1. If cookie is updated, call add_account
      if (editCookie.trim()) {
        try {
          await invoke("add_account", { cookie: editCookie.trim() });
        } catch (err) {
          setEditError("Failed to update cookie: " + err);
          setEditLoading(false);
          return;
        }
      }

      // 2. If favorite state changed, call toggle_favorite
      if (editIsFavorite !== editAccountModal.is_favorite) {
        try {
          await invoke("toggle_favorite", { userId: editAccountModal.user_id });
        } catch (err) {
          setEditError("Failed to toggle favorite: " + err);
          setEditLoading(false);
          return;
        }
      }

      // 3. Save edit_account fields
      const tagsList = editTags
        .split(",")
        .map(t => t.trim())
        .filter(Boolean);

      await invoke("edit_account", {
        userId: editAccountModal.user_id,
        displayName: editDisplayName.trim(),
        notes: editNotes.trim(),
        tags: tagsList,
        defaultPlaceId: editDefaultPlaceId.trim(),
        safeLaunchEnabled: editSafeLaunch,
        autoRejoinEnabled: editAutoRejoin,
        launchCooldownSeconds: Number(editCooldown)
      });

      // Reload accounts state
      await refreshAccounts();
      setEditAccountModal(null);
    } catch (err) {
      setEditError(String(err));
    } finally {
      setEditLoading(false);
    }
  };

  const handleSetDisplayName = async () => {
    if (!utilAccount || !utilNewDisplayName.trim()) return;
    setUtilLoading(true);
    setUtilStatus("Updating display name...");
    setUtilIsError(false);
    try {
      const msg = await invoke<string>("set_display_name", {
        userId: utilAccount.user_id,
        newName: utilNewDisplayName.trim(),
      });
      setUtilStatus(msg);
      setAccounts(prev => prev.map(a => a.user_id === utilAccount.user_id ? { ...a, display_name: utilNewDisplayName.trim() } : a));
    } catch (e) {
      setUtilIsError(true);
      setUtilStatus(String(e));
    } finally {
      setUtilLoading(false);
    }
  };

  const handleChangePassword = async () => {
    if (!utilAccount || !utilCurrentPassword || !utilNewPassword) return;
    setUtilLoading(true);
    setUtilStatus("Changing password...");
    setUtilIsError(false);
    try {
      const msg = await invoke<string>("change_password", {
        userId: utilAccount.user_id,
        currentPw: utilCurrentPassword,
        newPw: utilNewPassword,
      });
      setUtilStatus(msg);
      setUtilCurrentPassword("");
      setUtilNewPassword("");
    } catch (e) {
      setUtilIsError(true);
      setUtilStatus(String(e));
    } finally {
      setUtilLoading(false);
    }
  };

  const handleSignOutAll = async () => {
    if (!utilAccount) return;
    if (!confirm("This will sign out all other sessions for this account. Continue?")) return;
    setUtilLoading(true);
    setUtilStatus("Signing out all sessions...");
    setUtilIsError(false);
    try {
      const msg = await invoke<string>("sign_out_all_sessions", {
        userId: utilAccount.user_id,
      });
      setUtilStatus(msg);
    } catch (e) {
      setUtilIsError(true);
      setUtilStatus(String(e));
    } finally {
      setUtilLoading(false);
    }
  };

  const handleSendFriendRequest = async () => {
    if (!utilAccount || !utilTargetUser.trim()) return;
    setUtilLoading(true);
    setUtilStatus(`Sending friend request to @${utilTargetUser}...`);
    setUtilIsError(false);
    try {
      const msg = await invoke<string>("send_friend_request", {
        userId: utilAccount.user_id,
        targetUsername: utilTargetUser.trim(),
      });
      setUtilStatus(msg);
    } catch (e) {
      setUtilIsError(true);
      setUtilStatus(String(e));
    } finally {
      setUtilLoading(false);
    }
  };

  const handleBlockUser = async () => {
    if (!utilAccount || !utilTargetUser.trim()) return;
    setUtilLoading(true);
    setUtilStatus(`Blocking @${utilTargetUser}...`);
    setUtilIsError(false);
    try {
      const msg = await invoke<string>("block_user", {
        userId: utilAccount.user_id,
        targetUsername: utilTargetUser.trim(),
      });
      setUtilStatus(msg);
    } catch (e) {
      setUtilIsError(true);
      setUtilStatus(String(e));
    } finally {
      setUtilLoading(false);
    }
  };
  const effectivePlaceId      = launchPlaceId.trim() || null;
  const effectiveGameName     = launchGame?.name ?? (launchPlaceId.trim() ? `Place ${launchPlaceId.trim()}` : null);
  const launchThumb           = launchPlaceId ? (thumbs[launchPlaceId] ?? null) : null;
  const selectedAccountIsActive = selAccount !== null && activeUserIds.has(selAccount);

  /* â”€â”€ Handlers â”€â”€ */
  const refreshAccounts = async () => {
    const [accs, evts] = await Promise.all([
      invoke<Account[]>("get_accounts").catch(() => [] as Account[]),
      invoke<EventEntry[]>("get_event_log").catch(() => [] as EventEntry[]),
    ]);
    setAccounts(accs);
    setEvents(evts);
  };

  const handleOpenCookieMenu = async () => {
    setAddMenu(false);
    try {
      const clip = await readText();
      if (clip && clip.includes(".ROBLOSECURITY")) {
        if (confirm("A Roblox cookie was detected in your clipboard. Import it?")) {
          setAdding(true);
          setAddError("");
          try {
            const acc = await invoke<Account>("add_account", { cookie: clip });
            setAccounts(prev => {
              const idx = prev.findIndex(a => a.user_id === acc.user_id);
              return idx >= 0 ? prev.map((a, i) => i === idx ? acc : a) : [...prev, acc];
            });
            await refreshAccounts();
            return;
          } catch (e) {
            setAddError(String(e));
          } finally {
            setAdding(false);
          }
        }
      }
    } catch { }
    setAddCookie("");
    setAddError("");
    setShowSingle(true);
  };

  const handleAddSingle = async () => {
    if (!addCookie.trim()) return;
    setAdding(true);
    setAddError("");
    try {
      const acc = await invoke<Account>("add_account", { cookie: addCookie });
      setAccounts(prev => {
        const idx = prev.findIndex(a => a.user_id === acc.user_id);
        return idx >= 0 ? prev.map((a, i) => i === idx ? acc : a) : [...prev, acc];
      });
      await refreshAccounts();
      setAddCookie("");
      setShowSingle(false);
    } catch (e) {
      setAddError(String(e));
    } finally {
      setAdding(false);
    }
  };

  const handleBulkImport = async () => {
    const lines = bulkText.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return;
    setBulkAdding(true);
    setBulkResults([]);
    try {
      const results = await invoke<BulkAddResult[]>("add_accounts_bulk", { cookies: lines });
      setBulkResults(results);
      await refreshAccounts();
    } catch (e) {
      setBulkResults([{ preview: "â€”", success: false, username: null, error: String(e) }]);
    } finally {
      setBulkAdding(false);
    }
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
          await invoke("open_login_window", { 
            username: username || null, 
            password: password || null 
          });
        } catch (e) {
          if (unlisten) unlisten();
          alert(`Failed to open login window: ${String(e)}`);
          resolve(null);
        }
      });
    });
  };

  const handleManualLogin = async () => {
    setAddMenu(false);
    setLoginLoading(true);
    try {
      const cookie = await loginOneAccount();
      if (cookie) {
        const acc = await invoke<Account>("add_account", { cookie });
        setAccounts(prev => {
          const idx = prev.findIndex(a => a.user_id === acc.user_id);
          return idx >= 0 ? prev.map((a, i) => i === idx ? acc : a) : [...prev, acc];
        });
        await refreshAccounts();
      }
    } catch (e) {
      alert(`Manual login failed: ${String(e)}`);
    } finally {
      setLoginLoading(false);
    }
  };

  const handleComboImport = async (combosText: string) => {
    const lines = combosText.split("\n")
      .map(l => l.trim())
      .filter(l => l.includes(":") && l.length > 2);
    
    if (lines.length === 0) {
      setLoginError("No valid combos found. Format: username:password");
      return;
    }

    setLoginLoading(true);
    setLoginError("");
    
    let successCount = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const [username, password] = lines[i].split(":", 2).map(s => s.trim());
      setLoginError(`Processing ${i + 1}/${lines.length}: ${username}...`);
      
      const cookie = await loginOneAccount(username, password);
      if (cookie) {
        try {
          const acc = await invoke<Account>("add_account", { cookie });
          if (password) {
            await invoke("save_account_password", { userId: acc.user_id, password }).catch(() => {});
          }
          setAccounts(prev => {
            const idx = prev.findIndex(a => a.user_id === acc.user_id);
            const updated = { ...acc, password };
            return idx >= 0 ? prev.map((a, i) => i === idx ? updated : a) : [...prev, updated];
          });
          successCount++;
        } catch (e) {
          console.error(`Failed to register ${username}: ${String(e)}`);
        }
      }
    }

    setLoginLoading(false);
    setShowUserPass(false);
    setComboText("");
    await refreshAccounts();
    alert(`Done! Successfully imported ${successCount} out of ${lines.length} account(s).`);
  };



  const handleCheckCookie = async (userId: number) => {
    setCheckingCookie(prev => ({ ...prev, [userId]: true }));
    try {
      const updated = await invoke<Account>("validate_cookie", { userId });
      setAccounts(prev => prev.map(a => a.user_id === userId ? updated : a));
      setEvents(await invoke<EventEntry[]>("get_event_log").catch(() => []));
    } catch {
    } finally {
      setCheckingCookie(prev => ({ ...prev, [userId]: false }));
    }
  };

  const handleLaunch = async () => {
    if (selAccount === null) return;
    const account = accounts.find(a => a.user_id === selAccount);
    if (!account) return;

    if (account.cookie_status !== "Valid") {
      setLaunchError("Cookie is not valid. Check the cookie first.");
      return;
    }

    setLaunching(true);
    setLaunchError("");
    try {
      await invoke("launch_account", {
        userId:         selAccount,
        placeId:        effectivePlaceId,
        jobId:          jobId    || null,
        accessCode:     accessCode || null,
        gameName:       effectiveGameName,
        useBootstrapper,
      });
      // Save to per-account game history
      if (effectivePlaceId && launchGame) {
        pushAccGameHistory(selAccount, launchGame);
      }
      setTimeout(async () => {
        const [sess, evts, hist, recents] = await Promise.all([
          invoke<Session[]>("get_live_sessions").catch(() => []),
          invoke<EventEntry[]>("get_event_log").catch(() => []),
          invoke<SessionRecord[]>("get_session_history").catch(() => []),
          invoke<RecentGame[]>("get_recent_games").catch(() => []),
        ]);
        setSessions(sess);
        setEvents(evts);
        setSessionHistory(hist);
        setRecentGames(recents);
      }, 3000);
    } catch (e) {
      setLaunchError(String(e));
    } finally {
      setLaunching(false);
    }
  };

  const handleLaunchApp = async () => {
    if (selAccount === null) return;
    const account = accounts.find(a => a.user_id === selAccount);
    if (!account) return;

    if (account.cookie_status !== "Valid") {
      setLaunchError("Cookie is not valid. Check the cookie first.");
      return;
    }

    setLaunching(true);
    setLaunchError("");
    try {
      await invoke("launch_account", {
        userId:         selAccount,
        placeId:        null,
        jobId:          null,
        accessCode:     null,
        gameName:       "Roblox App",
        useBootstrapper,
        appMode:        true,
      });
      setTimeout(async () => {
        const [sess, evts, hist, recents] = await Promise.all([
          invoke<Session[]>("get_live_sessions").catch(() => []),
          invoke<EventEntry[]>("get_event_log").catch(() => []),
          invoke<SessionRecord[]>("get_session_history").catch(() => []),
          invoke<RecentGame[]>("get_recent_games").catch(() => []),
        ]);
        setSessions(sess);
        setEvents(evts);
        setSessionHistory(hist);
        setRecentGames(recents);
      }, 3000);
    } catch (e) {
      setLaunchError(String(e));
    } finally {
      setLaunching(false);
    }
  };

  const handleKillOne = async (pid: number) => {
    await invoke("kill_session", { pid }).catch(() => {});
    setSessions(prev => prev.filter(s => s.pid !== pid));
    setEvents(await invoke<EventEntry[]>("get_event_log").catch(() => []));
  };

  const handleKillAll = async () => {
    if (!confirm("Kill all Roblox sessions?")) return;
    await invoke("kill_all_sessions").catch(() => {});
    setSessions([]);
  };

  const handleSelectRecentGame = (placeId: string) => {
    setLaunchPlaceId(placeId);
    setLaunchError("");
    const game = recentGames.find(g => g.placeId === placeId);
    setAccessCode(game?.privateServer || "");
  };

  const handleAccessCodeChange = (val: string) => {
    setAccessCode(val);
  };

  return (
  <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "var(--bg)" }} onClick={() => { setAddMenu(false); setAccountMenu(null); }}>

    {/* ── Single Cookie Modal ── */}
    {showSingle && (
      <HomeModal title="Import Cookie" onClose={() => { setShowSingle(false); setAddError(""); }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <FieldLabel>ROBLOSECURITY COOKIE</FieldLabel>
            <textarea className="field glass-input" rows={4} placeholder="Paste your .ROBLOSECURITY cookie here..."
              value={addCookie} onChange={e => setAddCookie(e.target.value)}
              style={{ resize: "vertical", fontFamily: "monospace", fontSize: 10 }} />
          </div>
          {addError && <ErrorMsg msg={addError} />}
          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button onClick={() => { setShowSingle(false); setAddError(""); }} className="btn btn-ghost" style={{ flex: 1 }}>
              Cancel
            </button>
            <button onClick={handleAddSingle} disabled={adding || !addCookie.trim()} className="btn"
              style={{ flex: 2, background: "#FFFFFF", color: "#000", fontWeight: 800, opacity: !addCookie.trim() ? 0.5 : 1 }}>
              {adding ? "Validating..." : "Import Cookie"}
            </button>
          </div>
        </div>
      </HomeModal>
    )}

    {/* ── Bulk Import Modal ── */}
    {showBulk && (
      <HomeModal title="Bulk Cookie Import" onClose={() => { if (!bulkAdding) { setShowBulk(false); setBulkText(""); setBulkResults([]); } }} wide>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ fontSize: 11.5, color: "var(--t2)" }}>Paste cookies from a .txt file — one per line. Each must contain <code style={{ background: "rgba(255,255,255,0.05)", padding: "2px 6px", borderRadius: 4, fontFamily: "monospace" }}>.ROBLOSECURITY</code>.</p>
          {bulkResults.length === 0 ? (
            <textarea className="field glass-input" rows={10} placeholder={"_|WARNING:-DO-NOT-SHARE-THIS.--Sharing-this...\n_|WARNING:-DO-NOT-SHARE-THIS.--Sharing-this...\n..."}
              value={bulkText} onChange={e => setBulkText(e.target.value)}
              style={{ fontFamily: "monospace", fontSize: 10, resize: "vertical" }} />
          ) : (
            <div style={{ maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
              {bulkResults.map((r, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 9, background: r.success ? "var(--green-dim)" : "var(--red-dim)", border: `1px solid ${r.success ? "rgba(52,211,153,.15)" : "rgba(248,113,113,.15)"}` }}>
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {r.success ? <CheckIcon size={14} color="var(--green)" /> : <XIcon size={14} color="var(--red)" />}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--t1)" }}>{r.username ?? r.preview}</span>
                  {r.error && <span style={{ fontSize: 10, color: "var(--red)", marginLeft: "auto", fontWeight: 600 }}>{r.error}</span>}
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button onClick={() => { setShowBulk(false); setBulkText(""); setBulkResults([]); }} disabled={bulkAdding} className="btn btn-ghost" style={{ flex: 1 }}>
              {bulkResults.length > 0 ? "Close" : "Cancel"}
            </button>
            {bulkResults.length === 0 && (
              <button onClick={handleBulkImport} disabled={bulkAdding || !bulkText.trim()} className="btn"
                style={{ flex: 2, background: "#FFFFFF", color: "#000", fontWeight: 850, opacity: !bulkText.trim() ? 0.5 : 1 }}>
                {bulkAdding ? "Importing..." : "Import All Cookies"}
              </button>
            )}
          </div>
        </div>
      </HomeModal>
    )}

    {/* ── User:Pass Modal ── */}
    {showUserPass && (
      <HomeModal title="User:Pass Combo Import" onClose={() => { if (!loginLoading) setShowUserPass(false); }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ fontSize: 11.5, color: "var(--t2)", lineHeight: 1.4 }}>
            Paste your <code style={{ color: "#FFFFFF", fontFamily: "monospace", fontWeight: 700 }}>username:password</code> combinations (one per line). A Roblox window will open for each account to capture its session.
          </p>
          <div>
            <FieldLabel>ACCOUNTS COMBOS</FieldLabel>
            <textarea
              className="field glass-input"
              rows={6}
              value={comboText}
              onChange={e => setComboText(e.target.value)}
              placeholder="username:password&#10;username:password&#10;..."
              style={{ resize: "vertical", fontFamily: "monospace", fontSize: 11 }}
              disabled={loginLoading}
            />
          </div>
          {loginError && <ErrorMsg msg={loginError} />}
          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button onClick={() => setShowUserPass(false)} disabled={loginLoading} className="btn btn-ghost" style={{ flex: 1 }}>
              Cancel
            </button>
            <button onClick={() => handleComboImport(comboText)} disabled={loginLoading || !comboText.trim()} className="btn"
              style={{ flex: 2, background: "#FFFFFF", color: "#000", fontWeight: 850, opacity: !comboText.trim() ? 0.5 : 1 }}>
              {loginLoading ? "Processing..." : "Start Combo Import"}
            </button>
          </div>
        </div>
      </HomeModal>
    )}

    {/* ── TOP HEADER BAR ── */}
    <div style={{ display: "flex", alignItems: "center", padding: "0 24px", height: 66, borderBottom: "1px solid rgba(255,255,255,0.05)", flexShrink: 0, gap: 20 }}>
      <div style={{ flexShrink: 0 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: "var(--t3)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 3 }}>
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        </div>
        <div style={{ fontSize: 17, fontWeight: 900, color: "var(--t1)", letterSpacing: "-0.5px", lineHeight: 1 }}>{greeting}</div>
      </div>
      <div style={{ width: 1, height: 28, background: "rgba(255,255,255,0.07)", flexShrink: 0 }} />
      <div style={{ display: "flex", gap: 6, flex: 1 }}>
        <HeaderStatPill icon={<UserIcon size={11} color="#93C5FD" />} label="Accounts" value={String(accounts.length)} sub={`${favorites} fav`} />
        <HeaderStatPill icon={<MonitorIcon size={11} color={sessions.length > 0 ? "var(--green)" : "var(--t3)"} />} label="Live" value={String(sessions.length)} sub="sessions" valueColor={sessions.length > 0 ? "var(--green)" : undefined} />
        <HeaderStatPill icon={<BarChartIcon size={11} color="#C4B5FD" />} label="This Week" value={weekStats.timeStr} sub={`${weekStats.sessCount} sessions`} />
        <HeaderStatPill
          icon={<ShieldCheckIcon size={11} color={accounts.length === 0 ? "var(--t3)" : validCookies === accounts.length ? "var(--green)" : "var(--red)"} />}
          label="Cookies" value={`${validCookies}/${accounts.length}`}
          sub={accounts.length === 0 ? "none added" : validCookies === accounts.length ? "all valid" : `${accounts.length - validCookies} expired`}
          valueColor={accounts.length === 0 ? undefined : validCookies === accounts.length ? "var(--green)" : "var(--red)"} />
      </div>
      <div style={{ display: "flex", gap: 7, flexShrink: 0, alignItems: "center" }}>
        {loginLoading && (
          <span style={{ fontSize: 10.5, color: "var(--t2)", display: "flex", alignItems: "center", gap: 5 }}>
            <LoaderIcon size={10} style={{ animation: "spin 1s linear infinite" }} /> Login open…
          </span>
        )}
        <div ref={addMenuRef} style={{ position: "relative" }}>
          <button onClick={e => { e.stopPropagation(); setAddMenu(v => !v); }} className="btn glow-btn"
            style={{ padding: "7px 14px", borderRadius: 8, fontSize: 11, fontWeight: 800, background: "#FFFFFF", color: "#07080a", border: "none", display: "flex", alignItems: "center", gap: 5 }}>
            <PlusIcon size={11} color="#07080a" /> Add Account
          </button>
          {addMenu && (
            <div onClick={e => e.stopPropagation()}
              style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 9999, background: "rgba(14,15,19,0.96)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 4, minWidth: 220, boxShadow: "0 12px 36px rgba(0,0,0,.8)" }}>
              <DropdownItem icon={<IconSvg><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></IconSvg>} label="Manual Login" sub="Open Roblox login popup" onClick={handleManualLogin} />
              <DropdownItem icon={<IconSvg><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" /></IconSvg>} label="User:Pass combo" sub="Auto-fill login credentials" onClick={() => { setAddMenu(false); setComboText(""); setLoginError(""); setShowUserPass(true); }} />
              <DropdownItem icon={<IconSvg><rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="2" y1="10" x2="22" y2="10" /><line x1="6" y1="6" x2="6.01" y2="6" /><line x1="10" y1="6" x2="10.01" y2="6" /></IconSvg>} label="From clipboard cookie" sub="Parse cookie in clipboard" onClick={handleOpenCookieMenu} />
              <DropdownItem icon={<IconSvg><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></IconSvg>} label="Bulk cookies .txt" sub="Import multiple, one per line" onClick={() => { setAddMenu(false); setBulkText(""); setBulkResults([]); setShowBulk(true); }} />
            </div>
          )}
        </div>
        <button onClick={() => setShowPlayStats(true)} className="btn btn-ghost glow-btn" style={{ padding: "7px 12px", borderRadius: 8, fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", gap: 5 }}>
          <BarChartIcon size={11} /> Play Stats
        </button>
        <button onClick={handleBulkCookieCheck} disabled={bulkChecking} className="btn btn-ghost glow-btn" style={{ padding: "7px 12px", borderRadius: 8, fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", gap: 5, opacity: bulkChecking ? 0.6 : 1 }}>
          <ShieldCheckIcon size={11} /> {bulkChecking ? "Checking..." : "Check Cookies"}
        </button>
        <button onClick={() => navigate("/utilities")} className="btn btn-ghost glow-btn" style={{ padding: "7px 12px", borderRadius: 8, fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", gap: 5 }}>
          <SettingsIcon size={11} /> Utilities
        </button>
      </div>
    </div>

    {/* ── 3-COLUMN BODY ── */}
    <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

    {/* LEFT: Accounts panel */}
    <div style={{ width: 216, borderRight: "1px solid rgba(255,255,255,0.05)", display: "flex", flexDirection: "column", overflow: "hidden", background: "rgba(8,9,12,0.5)", flexShrink: 0 }}>
      <div style={{ padding: "11px 14px 9px", flexShrink: 0, borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 9.5, fontWeight: 900, color: "var(--t3)", letterSpacing: "0.08em" }}>ACCOUNTS</span>
          <span style={{ fontSize: 9.5, color: "var(--t3)", background: "rgba(255,255,255,0.04)", padding: "1px 8px", borderRadius: 99, fontWeight: 700, border: "1px solid rgba(255,255,255,0.05)" }}>{accounts.length}</span>
        </div>
      </div>
      <div className="scroll" style={{ flex: 1 }}>
        {accounts.length === 0 ? (
          <div style={{ padding: "24px 14px", textAlign: "center", color: "var(--t3)", fontSize: 11, lineHeight: 1.7 }}>
            No accounts yet.<br />Add one to get started.
          </div>
        ) : (
          groupedAccounts.map(([groupName, accs]) => (
            <div key={groupName}>
              {groupName && (
                <div style={{ padding: "8px 14px 4px", fontSize: 8.5, fontWeight: 900, color: "var(--t3)", letterSpacing: "0.1em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 14, height: 1, background: "rgba(255,255,255,0.07)" }} />
                  {groupName}
                  <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.07)" }} />
                </div>
              )}
              {accs.map(a => (
                <CompactAccountRow key={a.user_id} account={a}
                  isActive={activeUserIds.has(a.user_id)}
                  isSelected={selAccount === a.user_id}
                  checking={!!checkingCookie[a.user_id]}
                  health={healthStatus[a.user_id] ?? "unknown"}
                  onCheck={() => handleCheckCookie(a.user_id)}
                  onSelect={() => { setSelAccount(a.user_id); localStorage.setItem("reiya_last_account", String(a.user_id)); setLaunchError(""); }}
                  onContextMenu={(e) => handleAccountContextMenu(e, a)} />
              ))}
            </div>
          ))
        )}
        <div onClick={e => { e.stopPropagation(); setAddMenu(v => !v); }}
          style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", cursor: "pointer", color: "var(--t3)", fontSize: 11, fontWeight: 700, transition: "color .12s" }}
          onMouseEnter={e => e.currentTarget.style.color = "var(--t2)"}
          onMouseLeave={e => e.currentTarget.style.color = "var(--t3)"}>
          <div style={{ width: 32, height: 32, borderRadius: "50%", border: "1.5px dashed rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <PlusIcon size={13} />
          </div>
          <span>Add account</span>
        </div>
      </div>
    </div>

    {/* CENTER: Launch console + scrollable content */}
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>

      {/* Launch Console */}
      <div style={{ display: "flex", height: 192, flexShrink: 0, borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        {/* Game Thumbnail */}
        <div style={{ width: 196, position: "relative", overflow: "hidden", flexShrink: 0, borderRight: "1px solid rgba(255,255,255,0.05)" }}>
          {launchThumb ? (
            <>
              <img src={launchThumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(0deg, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.1) 55%, transparent 100%)" }} />
            </>
          ) : (
            <div style={{ width: "100%", height: "100%", background: "var(--surface-2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <GamepadIcon size={30} color="rgba(255,255,255,0.08)" />
            </div>
          )}
          <div style={{ position: "absolute", bottom: 10, left: 12, right: 12 }}>
            {launchGame ? (
              <>
                <div style={{ fontSize: 12, fontWeight: 800, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{launchGame.name}</div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>by {launchGame.creator}</div>
              </>
            ) : (
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", fontWeight: 700 }}>No game selected</div>
            )}
          </div>
        </div>

        {/* Controls */}
        <div style={{ flex: 1, padding: "14px 18px", display: "flex", flexDirection: "column", gap: 9, overflow: "hidden", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#FFFFFF", boxShadow: "0 0 8px rgba(255,255,255,0.5)", flexShrink: 0 }} />
            <span style={{ fontSize: 9.5, fontWeight: 900, color: "#FFFFFF", letterSpacing: "0.09em" }}>LAUNCH CONSOLE</span>
          </div>
          <div style={{ width: "100%", minWidth: 0 }}>
            <select value={launchPlaceId} onChange={e => {
              const val = e.target.value;
              setLaunchPlaceId(val);
              localStorage.setItem("reiya_last_place_id", val);
              setLaunchError("");
              const game = accountGameOptions.find(g => g.placeId === val);
              setAccessCode(game?.privateServer || "");
            }} className="field glass-input" style={{ width: "100%", height: 32, fontSize: 11, cursor: "pointer", background: "#0e0f13", color: "#F0F1F6" }}>
              <option value="" style={{ background: "#0e0f13", color: "#8B8FA8" }}>— No game / Custom target —</option>
              {selAccount !== null && getAccGameHistory(selAccount).length > 0 && (
                <optgroup label="— Account History —" style={{ background: "#0e0f13", color: "#8B8FA8" }}>
                  {getAccGameHistory(selAccount).map(g => <option key={g.placeId} value={g.placeId} title={g.name} style={{ background: "#0e0f13", color: "#F0F1F6" }}>{g.name}</option>)}
                </optgroup>
              )}
              {recentGames.filter(g => selAccount === null || !getAccGameHistory(selAccount).some(h => h.placeId === g.placeId)).length > 0 && (
                <optgroup label="— All Recent Games —" style={{ background: "#0e0f13", color: "#8B8FA8" }}>
                  {recentGames.filter(g => selAccount === null || !getAccGameHistory(selAccount).some(h => h.placeId === g.placeId)).map(g => <option key={g.placeId} value={g.placeId} title={g.name} style={{ background: "#0e0f13", color: "#F0F1F6" }}>{g.name}</option>)}
                </optgroup>
              )}
            </select>
            {/* Full game name shown below dropdown so it never gets clipped */}
            {launchGame && (
              <div style={{ marginTop: 4, fontSize: 9.5, color: "var(--t2)", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                title={launchGame.name}>
                {launchGame.name}
              </div>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, flexShrink: 0 }}>
            <div>
              <div style={{ fontSize: 8.5, color: "var(--t3)", fontWeight: 800, letterSpacing: "0.06em", marginBottom: 3 }}>PLACE ID</div>
              <input value={launchPlaceId} onChange={e => { setLaunchPlaceId(e.target.value); localStorage.setItem("reiya_last_place_id", e.target.value); setLaunchError(""); }} placeholder="7882829745"
                className="field glass-input" style={{ height: 28, fontSize: 10.5, padding: "0 9px" }} />
            </div>
            <div>
              <div style={{ fontSize: 8.5, color: "var(--t3)", fontWeight: 800, letterSpacing: "0.06em", marginBottom: 3 }}>JOB ID</div>
              <input value={jobId} onChange={e => setJobId(e.target.value)} placeholder="server UUID..."
                className="field glass-input" style={{ height: 28, fontSize: 10.5, padding: "0 9px" }} />
            </div>
            <div>
              <div style={{ fontSize: 8.5, color: "var(--t3)", fontWeight: 800, letterSpacing: "0.06em", marginBottom: 3 }}>ACCESS CODE</div>
              <input value={accessCode} onChange={e => handleAccessCodeChange(e.target.value)} placeholder="private server..."
                className="field glass-input" style={{ height: 28, fontSize: 10.5, padding: "0 9px" }} />
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: "auto", flexShrink: 0, minWidth: 0 }}>
            {selAccount !== null && (() => {
              const acc = accounts.find(a => a.user_id === selAccount);
              if (!acc) return null;
              return (
                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 7, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", flexShrink: 0, maxWidth: 140, overflow: "hidden" }}>
                  {acc.avatar_url
                    ? <img src={acc.avatar_url} alt="" style={{ width: 20, height: 20, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                    : <div style={{ width: 20, height: 20, borderRadius: "50%", background: "var(--surface-3)", fontSize: 8, fontWeight: 700, color: "var(--t2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{acc.username.slice(0, 2).toUpperCase()}</div>
                  }
                  <span style={{ fontSize: 10.5, fontWeight: 750, color: "var(--t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{acc.display_name || acc.username}</span>
                  {selectedAccountIsActive && <AlertTriangleIcon size={10} color="var(--red)" />}
                </div>
              );
            })()}
            {launchError && <div style={{ fontSize: 10, color: "var(--red)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{launchError}</div>}
            <div style={{ display: "flex", gap: 7, marginLeft: "auto", alignItems: "center", flexShrink: 0 }}>
              <Toggle label="Bootstrapper" value={useBootstrapper} onChange={handleToggleBootstrapper} />
              <button onClick={handleLaunchApp} disabled={launching || selAccount === null || accounts.length === 0}
                className="btn btn-ghost glow-btn"
                style={{ padding: "7px 12px", borderRadius: 7, fontSize: 10.5, fontWeight: 800, display: "flex", alignItems: "center", gap: 5, opacity: selAccount === null || accounts.length === 0 ? 0.4 : 1, cursor: selAccount === null ? "not-allowed" : "pointer" }}>
                <MonitorIcon size={11} /> App
              </button>
              <button onClick={handleLaunch} disabled={launching || selAccount === null || accounts.length === 0}
                className="btn glow-btn"
                style={{ padding: "7px 18px", borderRadius: 7, fontSize: 11.5, fontWeight: 900, letterSpacing: "0.05em", background: launching || selAccount === null ? "rgba(255,255,255,0.04)" : "linear-gradient(135deg, #FFFFFF 0%, #E0E0E0 100%)", color: launching || selAccount === null ? "var(--t3)" : "#07080a", border: launching || selAccount === null ? "1px solid rgba(255,255,255,0.06)" : "none", cursor: launching || selAccount === null ? "not-allowed" : "pointer", opacity: selAccount === null || accounts.length === 0 ? 0.4 : 1, boxShadow: launching || selAccount === null ? "none" : "0 4px 18px rgba(255,255,255,0.18)", display: "flex", alignItems: "center", gap: 6 }}
                onMouseEnter={e => { if (!launching && selAccount !== null) e.currentTarget.style.filter = "brightness(1.06)"; }}
                onMouseLeave={e => { if (!launching && selAccount !== null) e.currentTarget.style.filter = "none"; }}>
                {launching
                  ? <><LoaderIcon size={11} style={{ animation: "spin 1s linear infinite" }} /> Launching...</>
                  : <><PlayIcon size={11} color="#07080a" /> LAUNCH</>}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Scrollable: Recently Played + Session Chart */}
      <div className="scroll" style={{ flex: 1, padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Recently Played */}
      {recentGames.length > 0 && (
        <div>
          <div className="section-header" style={{ marginBottom: 10 }}>
            <span className="section-title">
              <span className="section-dot" style={{ background: "#FCD34D", boxShadow: "0 0 6px rgba(252,211,77,0.35)" }} />
              RECENTLY PLAYED
            </span>
            <span style={{ fontSize: 10.5, color: "var(--t3)", fontWeight: 600 }}>right-click to set server · click to target</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 8 }}>
            {recentGames.slice(0, 12).map(g => {
              const isSelected = launchPlaceId === g.placeId;
              const hasPrivateServer = !!g.privateServer;
              return (
                <div key={g.placeId}
                  onClick={() => handleSelectRecentGame(g.placeId)}
                  onContextMenu={(e) => handleGameContextMenu(e, g)}
                  title={`${g.name}${hasPrivateServer ? "\nPrivate Server configured" : ""}`}
                  style={{ position: "relative", height: 70, borderRadius: 9, overflow: "hidden", cursor: "pointer", border: `1.5px solid ${isSelected ? "#FFFFFF" : "rgba(255,255,255,0.05)"}`, boxShadow: isSelected ? "0 4px 14px rgba(255,255,255,0.1)" : "none", transition: "all .15s", transform: isSelected ? "translateY(-2px)" : "none" }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.borderColor = "rgba(255,255,255,0.14)"; }}
                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.borderColor = "rgba(255,255,255,0.05)"; }}>
                  {g.iconUrl || thumbs[g.placeId] ? (
                    <img src={g.iconUrl || thumbs[g.placeId]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <div style={{ width: "100%", height: "100%", background: "var(--surface-3)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <GamepadIcon size={18} color="rgba(255,255,255,0.2)" />
                    </div>
                  )}
                  <div onClick={(e) => { e.stopPropagation(); setDeleteConfirmModal({ placeId: g.placeId, name: g.name }); }}
                    style={{ position: "absolute", top: 4, left: 4, width: 16, height: 16, borderRadius: "50%", background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(255,255,255,0.1)", zIndex: 2 }}>
                    <XIcon size={8} color="var(--red)" />
                  </div>
                  {hasPrivateServer && (
                    <div style={{ position: "absolute", top: 4, right: 4, width: 16, height: 16, borderRadius: "50%", background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(255,255,255,0.12)", zIndex: 2 }}>
                      <LockIcon size={8} color="#FFFFFF" />
                    </div>
                  )}
                  <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "linear-gradient(transparent, rgba(0,0,0,.9))", padding: "12px 5px 4px" }}>
                    <div style={{ fontSize: 8.5, fontWeight: 800, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Session Activity Chart */}
      <div className="glass-container" style={{ padding: 16 }}>
        <div className="section-header" style={{ marginBottom: 8 }}>
          <span className="section-title">
            <span className="section-dot" style={{ background: "var(--accent-2)", boxShadow: "0 0 6px rgba(160,160,160,0.4)" }} />
            SESSION ACTIVITY
          </span>
          <span style={{ fontSize: 10.5, color: "var(--t2)", fontWeight: 600 }}>{weekStats.sessCount} sessions · {weekStats.timeStr}</span>
        </div>
        <div style={{ height: 100 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={graphData} margin={{ top: 4, right: 4, left: -26, bottom: 0 }}>
              <defs>
                <linearGradient id="aG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.12} />
                  <stop offset="100%" stopColor="#FFFFFF" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
              <XAxis dataKey="day" tick={{ fill: "var(--t3)", fontSize: 9.5, fontWeight: 600 }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fill: "var(--t3)", fontSize: 9.5, fontWeight: 600 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: "rgba(10,11,16,0.95)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, fontSize: 11 }}
                labelStyle={{ color: "var(--t2)", fontWeight: 700 }} itemStyle={{ color: "#FFFFFF", fontWeight: 800 }}
                formatter={(v) => [`${v ?? 0} sessions`, "Sessions"]} />
              <Area type="monotone" dataKey="sessions" stroke="#FFFFFF" strokeWidth={1.8}
                fill="url(#aG)" dot={{ fill: "#FFFFFF", r: 3, strokeWidth: 0 }}
                activeDot={{ fill: "#FFFFFF", r: 5, strokeWidth: 0 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top Games by Playtime */}
      {topGames.length > 0 && (
        <div className="glass-container" style={{ padding: 16 }}>
          <div className="section-header" style={{ marginBottom: 12 }}>
            <span className="section-title">
              <span className="section-dot" style={{ background: "#818cf8", boxShadow: "0 0 6px rgba(129,140,248,0.5)" }} />
              TOP GAMES
            </span>
            <span style={{ fontSize: 10, color: "var(--t3)", fontWeight: 600 }}>by total playtime</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {topGames.map((g, i) => {
              const maxMin = topGames[0].minutes;
              const pct = maxMin > 0 ? (g.minutes / maxMin) * 100 : 0;
              const hrs = Math.floor(g.minutes / 60);
              const mins = g.minutes % 60;
              const timeStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
              const rankColors = ["#f59e0b", "#94a3b8", "#cd7c39", "var(--t3)", "var(--t3)", "var(--t3)"];
              return (
                <div key={g.name + i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 10, fontWeight: 900, color: rankColors[i], width: 14, textAlign: "center", flexShrink: 0 }}>{i + 1}</span>
                  {g.thumbnailUrl ? (
                    <img src={g.thumbnailUrl} alt="" style={{ width: 28, height: 28, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 28, height: 28, borderRadius: 6, background: "rgba(255,255,255,0.04)", flexShrink: 0 }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "60%" }}>{g.name}</span>
                      <span style={{ fontSize: 10, fontWeight: 800, color: "var(--t2)", flexShrink: 0 }}>{timeStr}</span>
                    </div>
                    <div style={{ height: 4, borderRadius: 99, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pct}%`, borderRadius: 99, background: i === 0 ? "linear-gradient(90deg, #818cf8, #a78bfa)" : "rgba(255,255,255,0.18)", transition: "width 0.6s ease" }} />
                    </div>
                    <span style={{ fontSize: 9, color: "var(--t3)", marginTop: 2, display: "block" }}>{g.sessions} session{g.sessions !== 1 ? "s" : ""}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      </div>{/* end center scroll */}
    </div>{/* end center column */}

    {/* RIGHT: Live sessions + Events */}
    <div style={{ width: 252, borderLeft: "1px solid rgba(255,255,255,0.05)", display: "flex", flexDirection: "column", overflow: "hidden", background: "rgba(8,9,12,0.5)", flexShrink: 0 }}>

      {/* Live Sessions */}
      <div style={{ padding: "12px 14px", flexShrink: 0, borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: sessions.length > 0 ? 10 : 0 }}>
          <span className="section-title" style={{ fontSize: 10 }}>
            <span className="section-dot" style={{ background: sessions.length > 0 ? "var(--green)" : "var(--t3)", animation: sessions.length > 0 ? "pulse-glow 2s ease-in-out infinite" : "none" }} />
            LIVE SESSIONS
            {sessions.length > 0 && (
              <span style={{ fontSize: 9, background: "var(--green-dim)", color: "var(--green)", padding: "1px 6px", borderRadius: 99, fontWeight: 800, marginLeft: 4 }}>{sessions.length}</span>
            )}
          </span>
          {sessions.length > 0 && (
            <button onClick={handleKillAll}
              style={{ padding: "3px 9px", borderRadius: 5, border: "1px solid rgba(248,113,113,.2)", background: "rgba(248,113,113,0.06)", color: "var(--red)", fontSize: 9, fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(248,113,113,0.14)")}
              onMouseLeave={e => (e.currentTarget.style.background = "rgba(248,113,113,0.06)")}>
              <PowerIcon size={9} color="var(--red)" /> Kill All
            </button>
          )}
        </div>
        {sessions.length === 0 ? (
          <div style={{ fontSize: 10.5, color: "var(--t3)", padding: "6px 0" }}>No active sessions running</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {sessions.map(s => <LiveSessionRow key={s.pid} session={s} onKill={() => handleKillOne(s.pid)} />)}
          </div>
        )}
      </div>

      {/* Scrollable: Recent history + Event log */}
      <div className="scroll" style={{ flex: 1 }}>
        {recentActivity.length > 0 && (
          <div style={{ padding: "12px 14px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <div style={{ width: 3, height: 10, background: "linear-gradient(180deg, #C4B5FD 0%, rgba(196,181,253,0.15) 100%)", borderRadius: 2, flexShrink: 0 }} />
              <span style={{ fontSize: 9, fontWeight: 900, color: "var(--t3)", letterSpacing: "0.08em" }}>RECENT HISTORY</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {recentActivity.map((r, i) => <ActivityRow key={i} record={r} />)}
            </div>
          </div>
        )}
        {events.length > 0 && (
          <div style={{ padding: "12px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <span className="section-dot" style={{ width: 5, height: 5, background: "#818CF8", boxShadow: "0 0 5px rgba(129,140,248,0.4)" }} />
              <span style={{ fontSize: 9, fontWeight: 900, color: "var(--t3)", letterSpacing: "0.08em" }}>EVENT LOG</span>
              <span style={{ fontSize: 8.5, color: "var(--t3)", opacity: 0.5 }}>— {events.length}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {events.slice(0, 40).map((ev, i) => <EventRow key={i} event={ev} />)}
            </div>
          </div>
        )}
      </div>

    </div>{/* end right panel */}
    </div>{/* end 3-col body */}

      {/* ── Play Stats Modal ── */}
      {showPlayStats && (
        <HomeModal title="Play Time Statistics" onClose={() => setShowPlayStats(false)} wide>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Stat Summary Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 12, padding: "12px 16px" }}>
                <div style={{ fontSize: 9.5, color: "var(--t3)", fontWeight: 800, letterSpacing: "0.06em" }}>TOTAL PLAYTIME</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: "#FFFFFF", marginTop: 4 }}>{playStatsData.totalPlayTime}</div>
              </div>
              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 12, padding: "12px 16px" }}>
                <div style={{ fontSize: 9.5, color: "var(--t3)", fontWeight: 800, letterSpacing: "0.06em" }}>TOTAL SESSIONS</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: "#FFFFFF", marginTop: 4 }}>{playStatsData.totalSessions}</div>
              </div>
              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 12, padding: "12px 16px" }}>
                <div style={{ fontSize: 9.5, color: "var(--t3)", fontWeight: 800, letterSpacing: "0.06em" }}>TOP ACCOUNT</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: "#FFFFFF", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 4 }} title={playStatsData.topAccount}>
                  {playStatsData.topAccount}
                </div>
              </div>
            </div>

            {/* Rankings Lists Container */}
            <div className="scroll" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, maxHeight: "50vh", overflowY: "auto", paddingRight: 4 }}>
              
              {/* By Account */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 850, color: "var(--t2)", letterSpacing: "0.05em", paddingBottom: 8, borderBottom: "1px solid rgba(255,255,255,0.05)", marginBottom: 12 }}>BY ACCOUNT</div>
                {playStatsData.byAccount.length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--t3)", textAlign: "center", padding: 20 }}>No records found</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {playStatsData.byAccount.map((x) => (
                      <div key={x.name} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11.5 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{
                              display: "inline-flex", alignItems: "center", justifyContent: "center",
                              width: 18, height: 18, borderRadius: "50%",
                              fontSize: 9.5, fontWeight: 900,
                              background: x.rank === 1 ? "#FFFFFF" : x.rank === 2 ? "rgba(255,255,255,0.6)" : x.rank === 3 ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.06)",
                              color: x.rank <= 3 ? "#000" : "var(--t2)"
                            }}>
                              {x.rank}
                            </span>
                            <span style={{ fontWeight: 750, color: "var(--t1)" }}>{x.name}</span>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <span style={{ fontWeight: 800, color: "#FFFFFF" }}>{x.timeText}</span>
                            <span style={{ fontSize: 9.5, color: "var(--t3)", marginLeft: 6 }}>({x.sessionsLabel})</span>
                          </div>
                        </div>
                        {/* Progress Bar */}
                        <div style={{ height: 5, width: "100%", background: "rgba(255,255,255,0.03)", borderRadius: 99, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${x.pct}%`, background: "#FFFFFF", borderRadius: 99, opacity: x.rank === 1 ? 1 : 0.4 }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* By Game */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 850, color: "var(--t2)", letterSpacing: "0.05em", paddingBottom: 8, borderBottom: "1px solid rgba(255,255,255,0.05)", marginBottom: 12 }}>BY GAME</div>
                {playStatsData.byGame.length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--t3)", textAlign: "center", padding: 20 }}>No records found</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {playStatsData.byGame.map((x) => (
                      <div key={x.name} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11.5 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{
                              display: "inline-flex", alignItems: "center", justifyContent: "center",
                              width: 18, height: 18, borderRadius: "50%",
                              fontSize: 9.5, fontWeight: 900,
                              background: x.rank === 1 ? "#FFFFFF" : x.rank === 2 ? "rgba(255,255,255,0.6)" : x.rank === 3 ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.06)",
                              color: x.rank <= 3 ? "#000" : "var(--t2)"
                            }}>
                              {x.rank}
                            </span>
                            <span style={{ fontWeight: 750, color: "var(--t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120 }} title={x.name}>
                              {x.name}
                            </span>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <span style={{ fontWeight: 800, color: "#FFFFFF" }}>{x.timeText}</span>
                            <span style={{ fontSize: 9.5, color: "var(--t3)", marginLeft: 6 }}>({x.sessionsLabel})</span>
                          </div>
                        </div>
                        {/* Progress Bar */}
                        <div style={{ height: 5, width: "100%", background: "rgba(255,255,255,0.03)", borderRadius: 99, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${x.pct}%`, background: "#FFFFFF", borderRadius: 99, opacity: x.rank === 1 ? 1 : 0.4 }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          </div>
        </HomeModal>
      )}

      {/* Private Server Setup Modal */}
      {privateServerModal && (
        <HomeModal title="Private Server Setup" onClose={() => setPrivateServerModal(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 12, color: "var(--t2)", lineHeight: 1.4 }}>
              Enter private server link or access code for <strong>"{privateServerModal.name}"</strong>:
            </div>
            <div>
              <FieldLabel>PRIVATE SERVER LINK OR CODE</FieldLabel>
              <input
                type="text"
                className="field glass-input"
                value={privateServerInput}
                onChange={e => setPrivateServerInput(e.target.value)}
                placeholder="https://www.roblox.com/share?code=...&type=Server"
                style={{ width: "100%", height: 36, fontSize: 12, outline: "none" }}
              />
            </div>
            <div style={{ fontSize: 10, color: "var(--t3)", lineHeight: 1.4 }}>
              Format: <code style={{ color: "#FFFFFF" }}>https://www.roblox.com/share?code=...&type=Server</code> or paste the access code directly. Leave blank to clear.
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <button onClick={() => setPrivateServerModal(null)} className="btn btn-ghost" style={{ flex: 1 }}>
                Cancel
              </button>
              <button onClick={handleSavePrivateServer} className="btn"
                style={{ flex: 2, background: "#FFFFFF", color: "#000", fontWeight: 800 }}>
                Save Settings
              </button>
            </div>
          </div>
        </HomeModal>
      )}

      {/* Custom Delete Confirmation Modal */}
      {deleteConfirmModal && (
        <HomeModal title="Remove Game" onClose={() => setDeleteConfirmModal(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ fontSize: 12, color: "var(--t2)", lineHeight: 1.5 }}>
              Are you sure you want to remove <strong>"{deleteConfirmModal.name}"</strong> from your recently played list?
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setDeleteConfirmModal(null)} className="btn btn-ghost" style={{ flex: 1 }}>
                Cancel
              </button>
              <button onClick={handleConfirmDeleteGame} className="btn"
                style={{ flex: 1, background: "rgba(248, 113, 113, 0.1)", color: "var(--red)", border: "1px solid rgba(248, 113, 113, 0.25)", fontWeight: 800 }}>
                Remove Game
              </button>
            </div>
          </div>
        </HomeModal>
      )}

      {/* Group Modal */}
      {groupModal && (
        <HomeModal title="Set Account Group" onClose={() => setGroupModal(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 12, color: "var(--t2)", lineHeight: 1.4 }}>
              Assign <strong>@{groupModal.account.username}</strong> to a group. Leave blank to remove from any group.
            </div>
            <div>
              <FieldLabel>GROUP NAME</FieldLabel>
              <input type="text" className="field glass-input" value={groupInput}
                onChange={e => setGroupInput(e.target.value)}
                onKeyDown={async e => { if (e.key === "Enter") { await invoke("set_account_group", { userId: groupModal.account.user_id, group: groupInput }); await refreshAccounts(); setGroupModal(null); } }}
                placeholder="e.g. Main, Alts, Trading…"
                style={{ width: "100%", height: 36, fontSize: 12, outline: "none" }} autoFocus />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {["Main", "Alts", "Trading", "Farming"].map(preset => (
                <button key={preset} onClick={() => setGroupInput(preset)} style={{ padding: "4px 12px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.08)", background: groupInput === preset ? "rgba(255,255,255,0.1)" : "transparent", color: groupInput === preset ? "var(--t1)" : "var(--t3)", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>{preset}</button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              <button onClick={() => setGroupModal(null)} className="btn btn-ghost" style={{ flex: 1 }}>Cancel</button>
              <button onClick={async () => {
                await invoke("set_account_group", { userId: groupModal.account.user_id, group: groupInput });
                await refreshAccounts();
                setGroupModal(null);
              }} className="btn" style={{ flex: 2, background: "#FFFFFF", color: "#000", fontWeight: 800 }}>
                Save Group
              </button>
            </div>
          </div>
        </HomeModal>
      )}

      {/* Account Context Menu */}
      {accountMenu && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: "fixed",
            top: Math.min(accountMenu.y, window.innerHeight - 520),
            left: Math.min(accountMenu.x, window.innerWidth - 220),
            zIndex: 9999,
            background: "rgba(10, 11, 15, 0.95)",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: 12,
            padding: 4,
            minWidth: 210,
            boxShadow: "0 12px 36px rgba(0, 0, 0, 0.7)",
            maxHeight: "85vh",
            overflowY: "auto"
          }}
        >
          <DropdownItem
            icon={<IconSvg><polygon points="5 3 19 12 5 21 5 3" /></IconSvg>}
            label="Launch Game"
            sub={launchPlaceId ? `Join place ${launchPlaceId}` : "Start game"}
            onClick={async () => {
              const acc = accountMenu.account;
              setAccountMenu(null);
              if (acc.cookie_status !== "Valid") {
                alert("Cookie is not valid. Validate the cookie first.");
                return;
              }
              setLaunching(true);
              setLaunchError("");
              try {
                await invoke("launch_account", {
                  userId: acc.user_id,
                  placeId: effectivePlaceId,
                  jobId: jobId || null,
                  accessCode: accessCode || null,
                  gameName: effectiveGameName,
                  useBootstrapper,
                });
              } catch (err) {
                setLaunchError(String(err));
              } finally {
                setLaunching(false);
              }
            }}
          />
          <DropdownItem
            icon={<IconSvg><path d="M4.5 16.5c-1.5 1.25-2.5 3.5-2.5 3.5s2.25-1 3.5-2.5L13 10 6 3 4.5 16.5zM12 9l3 3M19 2s.75 3-2.5 6.25L13 12l-1-1 3.75-3.5C19 4 19 2 19 2z" /></IconSvg>}
            label="Edit Account"
            sub="Change tags, notes, toggles"
            onClick={() => {
              const acc = accountMenu.account;
              setEditAccountModal(acc);
              setEditDisplayName(acc.display_name || "");
              setEditNotes(acc.notes || "");
              setEditTags((acc.tags || []).join(", "));
              setEditDefaultPlaceId(acc.default_place_id || "");
              setEditCookie("");
              setEditCooldown(acc.launch_cooldown_seconds ?? -1);
              setEditIsFavorite(acc.is_favorite || false);
              setEditSafeLaunch(acc.safe_launch_enabled || false);
              setEditAutoRejoin(acc.auto_rejoin_enabled || false);
              setEditError("");
              setAccountMenu(null);
            }}
          />
          <DropdownItem
            icon={<IconSvg><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></IconSvg>}
            label="Account Utilities"
            sub="Password, friends, sessions"
            onClick={() => {
              const acc = accountMenu.account;
              setUtilAccount(acc);
              setUtilNewDisplayName(acc.display_name || "");
              setUtilCurrentPassword("");
              setUtilNewPassword("");
              setUtilTargetUser("");
              setUtilStatus("");
              setUtilIsError(false);
              setAccountMenu(null);
            }}
          />
          <DropdownItem
            icon={<IconSvg><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></IconSvg>}
            label="Remove Account"
            sub="Delete from manager"
            onClick={async () => {
              const acc = accountMenu.account;
              setAccountMenu(null);
              if (confirm(`Are you sure you want to remove account @${acc.username}?`)) {
                try {
                  await invoke("remove_account", { userId: acc.user_id });
                  setAccounts(prev => prev.filter(a => a.user_id !== acc.user_id));
                  if (selAccount === acc.user_id) {
                    setSelAccount(null);
                  }
                } catch (err) {
                  alert("Failed to remove account: " + err);
                }
              }
            }}
          />
          <div style={{ height: 1, background: "rgba(255, 255, 255, 0.08)", margin: "2px 6px" }} />
          <DropdownItem
            icon={
              <IconSvg>
                <polygon
                  points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
                  fill={accountMenu.account.is_favorite ? "#FFFFFF" : "none"}
                  stroke={accountMenu.account.is_favorite ? "#FFFFFF" : "currentColor"}
                />
              </IconSvg>
            }
            label={accountMenu.account.is_favorite ? "Unfavorite Account" : "Favorite Account"}
            sub="Toggle quick pinning"
            onClick={async () => {
              const acc = accountMenu.account;
              setAccountMenu(null);
              try {
                const updated = await invoke<Account>("toggle_favorite", { userId: acc.user_id });
                setAccounts(prev => prev.map(a => a.user_id === acc.user_id ? updated : a));
              } catch (err) {
                alert("Failed to toggle favorite: " + err);
              }
            }}
          />
          <DropdownItem
            icon={
              <IconSvg>
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill={accountMenu.account.safe_launch_enabled ? "rgba(255, 255, 255, 0.15)" : "none"} />
              </IconSvg>
            }
            label="Toggle Safe Launch"
            sub={`Currently: ${accountMenu.account.safe_launch_enabled ? "Enabled" : "Disabled"}`}
            onClick={async () => {
              const acc = accountMenu.account;
              setAccountMenu(null);
              try {
                await invoke("edit_account", {
                  userId: acc.user_id,
                  displayName: acc.display_name,
                  notes: acc.notes,
                  tags: acc.tags,
                  defaultPlaceId: acc.default_place_id,
                  safeLaunchEnabled: !acc.safe_launch_enabled,
                  autoRejoinEnabled: acc.auto_rejoin_enabled,
                  launchCooldownSeconds: acc.launch_cooldown_seconds,
                });
                await refreshAccounts();
              } catch (err) {
                alert("Failed to toggle safe launch: " + err);
              }
            }}
          />
          <DropdownItem
            icon={
              <IconSvg>
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
              </IconSvg>
            }
            label="Toggle Auto-Rejoin"
            sub={`Currently: ${accountMenu.account.auto_rejoin_enabled ? "Enabled" : "Disabled"}`}
            onClick={async () => {
              const acc = accountMenu.account;
              setAccountMenu(null);
              try {
                await invoke("edit_account", {
                  userId: acc.user_id,
                  displayName: acc.display_name,
                  notes: acc.notes,
                  tags: acc.tags,
                  defaultPlaceId: acc.default_place_id,
                  safeLaunchEnabled: acc.safe_launch_enabled,
                  autoRejoinEnabled: !acc.auto_rejoin_enabled,
                  launchCooldownSeconds: acc.launch_cooldown_seconds,
                });
                await refreshAccounts();
              } catch (err) {
                alert("Failed to toggle auto rejoin: " + err);
              }
            }}
          />
          <DropdownItem
            icon={
              <IconSvg>
                <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />
              </IconSvg>
            }
            label="Set as Default Game"
            sub={launchPlaceId ? `Set ${launchPlaceId} as default` : "Clear default place ID"}
            onClick={async () => {
              const acc = accountMenu.account;
              setAccountMenu(null);
              try {
                await invoke("edit_account", {
                  userId: acc.user_id,
                  displayName: acc.display_name,
                  notes: acc.notes,
                  tags: acc.tags,
                  defaultPlaceId: launchPlaceId,
                  safeLaunchEnabled: acc.safe_launch_enabled,
                  autoRejoinEnabled: acc.auto_rejoin_enabled,
                  launchCooldownSeconds: acc.launch_cooldown_seconds,
                });
                await refreshAccounts();
                alert(`Default place ID for @${acc.username} updated to ${launchPlaceId || "none"}.`);
              } catch (err) {
                alert("Failed to update default place ID: " + err);
              }
            }}
          />
          <DropdownItem
            icon={<IconSvg><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></IconSvg>}
            label="Edit Tags"
            sub="Focus tags input"
            onClick={() => {
              const acc = accountMenu.account;
              setEditAccountModal(acc);
              setEditDisplayName(acc.display_name || "");
              setEditNotes(acc.notes || "");
              setEditTags((acc.tags || []).join(", "));
              setEditDefaultPlaceId(acc.default_place_id || "");
              setEditCookie("");
              setEditCooldown(acc.launch_cooldown_seconds ?? -1);
              setEditIsFavorite(acc.is_favorite || false);
              setEditSafeLaunch(acc.safe_launch_enabled || false);
              setEditAutoRejoin(acc.auto_rejoin_enabled || false);
              setEditError("");
              setAccountMenu(null);
            }}
          />
          <DropdownItem
            icon={<IconSvg><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></IconSvg>}
            label="Edit Notes"
            sub="Focus description notes"
            onClick={() => {
              const acc = accountMenu.account;
              setEditAccountModal(acc);
              setEditDisplayName(acc.display_name || "");
              setEditNotes(acc.notes || "");
              setEditTags((acc.tags || []).join(", "));
              setEditDefaultPlaceId(acc.default_place_id || "");
              setEditCookie("");
              setEditCooldown(acc.launch_cooldown_seconds ?? -1);
              setEditIsFavorite(acc.is_favorite || false);
              setEditSafeLaunch(acc.safe_launch_enabled || false);
              setEditAutoRejoin(acc.auto_rejoin_enabled || false);
              setEditError("");
              setAccountMenu(null);
            }}
          />
          <DropdownItem
            icon={<IconSvg><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></IconSvg>}
            label="Set Group"
            sub={accountMenu.account.group ? `Currently: ${accountMenu.account.group}` : "No group assigned"}
            onClick={() => {
              const acc = accountMenu.account;
              setGroupModal({ account: acc });
              setGroupInput(acc.group || "");
              setAccountMenu(null);
            }}
          />
          <DropdownItem
            icon={<IconSvg><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" /></IconSvg>}
            label="Export Account Config"
            sub="Copy config to clipboard"
            onClick={async () => {
              const acc = accountMenu.account;
              setAccountMenu(null);
              try {
                const cfg = {
                  Username: acc.username,
                  UserId: acc.user_id,
                  Tags: acc.tags || [],
                  Notes: acc.notes || "",
                  DefaultPlaceId: acc.default_place_id || "",
                  DefaultGameName: acc.default_game_name || "",
                  IsFavorite: acc.is_favorite,
                  SafeLaunchEnabled: acc.safe_launch_enabled,
                  AutoRejoinEnabled: acc.auto_rejoin_enabled,
                  LaunchCooldownSeconds: acc.launch_cooldown_seconds
                };
                await navigator.clipboard.writeText(JSON.stringify(cfg, null, 2));
                alert("Account configuration copied to clipboard!");
              } catch (err) {
                alert("Export failed: " + err);
              }
            }}
          />
          <DropdownItem
            icon={<IconSvg><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></IconSvg>}
            label="Import Account Config"
            sub="Load config from clipboard"
            onClick={async () => {
              const acc = accountMenu.account;
              setAccountMenu(null);
              try {
                const clipText = await readText();
                if (!clipText) {
                  alert("Clipboard is empty.");
                  return;
                }
                const parsed = JSON.parse(clipText);
                if (typeof parsed !== "object" || parsed === null) {
                  alert("Invalid clipboard JSON format.");
                  return;
                }
                const displayName = parsed.DisplayName || parsed.displayName || acc.display_name;
                const notes = parsed.Notes !== undefined ? String(parsed.Notes) : parsed.notes !== undefined ? String(parsed.notes) : acc.notes;
                const tagsList = Array.isArray(parsed.Tags) ? parsed.Tags.map(String) : Array.isArray(parsed.tags) ? parsed.tags.map(String) : acc.tags;
                const defaultPlaceId = parsed.DefaultPlaceId !== undefined ? String(parsed.DefaultPlaceId) : parsed.defaultPlaceId !== undefined ? String(parsed.defaultPlaceId) : acc.default_place_id;
                const safeLaunchEnabled = parsed.SafeLaunchEnabled !== undefined ? Boolean(parsed.SafeLaunchEnabled) : parsed.safeLaunchEnabled !== undefined ? Boolean(parsed.safeLaunchEnabled) : acc.safe_launch_enabled;
                const autoRejoinEnabled = parsed.AutoRejoinEnabled !== undefined ? Boolean(parsed.AutoRejoinEnabled) : parsed.autoRejoinEnabled !== undefined ? Boolean(parsed.autoRejoinEnabled) : acc.auto_rejoin_enabled;
                const launchCooldownSeconds = parsed.LaunchCooldownSeconds !== undefined ? Number(parsed.LaunchCooldownSeconds) : parsed.launchCooldownSeconds !== undefined ? Number(parsed.launchCooldownSeconds) : acc.launch_cooldown_seconds;

                await invoke("edit_account", {
                  userId: acc.user_id,
                  displayName: displayName,
                  notes: notes,
                  tags: tagsList,
                  defaultPlaceId: defaultPlaceId,
                  safeLaunchEnabled: safeLaunchEnabled,
                  autoRejoinEnabled: autoRejoinEnabled,
                  launchCooldownSeconds: launchCooldownSeconds
                });
                await refreshAccounts();
                alert("Account configuration imported successfully from clipboard!");
              } catch (err) {
                alert("Import failed: " + err);
              }
            }}
          />
          <DropdownItem
            icon={<IconSvg><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" /></IconSvg>}
            label="Re-login"
            sub="Re-auth Roblox cookie"
            onClick={async () => {
              const acc = accountMenu.account;
              setAccountMenu(null);
              await handleCheckCookie(acc.user_id);
            }}
          />
          <div style={{ height: 1, background: "rgba(255, 255, 255, 0.08)", margin: "2px 6px" }} />
          <DropdownItem
            icon={<IconSvg><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" /></IconSvg>}
            label="Copy Cookie"
            sub="Security warning"
            onClick={async () => {
              const acc = accountMenu.account;
              setAccountMenu(null);
              if (confirm("WARNING: Storing/sharing Roblox cookies exposes your account to security risks. Copy cookie to clipboard anyway?")) {
                try {
                  const cookie = await invoke<string>("get_account_cookie", { userId: acc.user_id });
                  await navigator.clipboard.writeText(cookie);
                  alert("Cookie copied to clipboard!");
                } catch (err) {
                  alert("Failed to decrypt/copy cookie: " + err);
                }
              }
            }}
          />
          <DropdownItem
            icon={<IconSvg><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" /></IconSvg>}
            label="Copy Username"
            sub="Copy username text"
            onClick={async () => {
              const acc = accountMenu.account;
              setAccountMenu(null);
              await navigator.clipboard.writeText(acc.username);
            }}
          />
          <DropdownItem
            icon={<IconSvg><line x1="4" y1="9" x2="20" y2="9" /><line x1="4" y1="15" x2="20" y2="15" /><line x1="10" y1="3" x2="8" y2="21" /><line x1="16" y1="3" x2="14" y2="21" /></IconSvg>}
            label="Copy User ID"
            sub="Copy ID digits"
            onClick={async () => {
              const acc = accountMenu.account;
              setAccountMenu(null);
              await navigator.clipboard.writeText(String(acc.user_id));
            }}
          />
          {accountMenu.account.password && (
            <DropdownItem
              icon={<IconSvg><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></IconSvg>}
              label="Copy Password"
              sub="Copy stored password"
              onClick={async () => {
                const acc = accountMenu.account;
                setAccountMenu(null);
                await navigator.clipboard.writeText(acc.password!);
              }}
            />
          )}
          <DropdownItem
            icon={<IconSvg><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v2z" /><line x1="12" y1="5" x2="12" y2="19" /></IconSvg>}
            label="Get Auth Ticket"
            sub="Generate launch ticket"
            onClick={async () => {
              const acc = accountMenu.account;
              setAccountMenu(null);
              try {
                const ticket = await invoke<string>("get_auth_ticket_command", { userId: acc.user_id });
                await navigator.clipboard.writeText(ticket);
                alert("Authentication ticket copied to clipboard!");
              } catch (err) {
                alert("Failed to get authentication ticket: " + err);
              }
            }}
          />
          <DropdownItem
            icon={<IconSvg><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></IconSvg>}
            label="Copy rbx-player Link"
            sub="Construct launcher URI"
            onClick={async () => {
              const acc = accountMenu.account;
              setAccountMenu(null);
              try {
                const ticket = await invoke<string>("get_auth_ticket_command", { userId: acc.user_id });
                const timestamp = Date.now().toString();
                const browserTrackerId = Math.floor(Math.random() * 900000000 + 100000000).toString();
                const pId = launchPlaceId.trim() || "7882829745";
                const placeLauncherUrl = `https://assetgame.roblox.com/game/PlaceLauncher.ashx?request=RequestGame&placeId=${pId}&isPlayTogetherGame=false`;
                const encodedUrl = encodeURIComponent(placeLauncherUrl);
                const launchLink = `roblox-player:1+launchmode:play+gameinfo:${ticket}+launchtime:${timestamp}+platfrom:Windows+placelauncherurl:${encodedUrl}+browserTrackerId:${browserTrackerId}`;
                await navigator.clipboard.writeText(launchLink);
                alert("rbx-player launch link copied to clipboard!");
              } catch (err) {
                alert("Failed to generate launch link: " + err);
              }
            }}
          />
          <DropdownItem
            icon={<IconSvg><circle cx="12" cy="12" r="3" /><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /></IconSvg>}
            label="Dump Details"
            sub="Display raw JSON printout"
            onClick={() => {
              setDumpAccount(accountMenu.account);
              setAccountMenu(null);
            }}
          />
        </div>
      )}

      {/* Edit Account Modal */}
      {editAccountModal && (
        <HomeModal title="Edit Account Settings" onClose={() => { if (!editLoading) { setEditAccountModal(null); setEditError(""); } }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 11, color: "var(--t3)", marginTop: -4 }}>
              Edit details for @{editAccountModal.username}
            </div>

            {/* Display Name */}
            <div>
              <FieldLabel>DISPLAY NAME</FieldLabel>
              <input className="field glass-input" value={editDisplayName} onChange={e => setEditDisplayName(e.target.value)}
                placeholder="Leave empty to use username" style={{ width: "100%", height: 36, fontSize: 12, outline: "none" }} disabled={editLoading} />
            </div>

            {/* Notes */}
            <div>
              <FieldLabel>DESCRIPTION / NOTES</FieldLabel>
              <textarea className="field glass-input" rows={3} value={editNotes} onChange={e => setEditNotes(e.target.value)}
                placeholder="Notes about this account..." style={{ width: "100%", fontSize: 12, outline: "none", resize: "vertical" }} disabled={editLoading} />
            </div>

            {/* Tags */}
            <div>
              <FieldLabel>TAGS (comma-separated)</FieldLabel>
              <input className="field glass-input" value={editTags} onChange={e => setEditTags(e.target.value)}
                placeholder="alt, trade, farming..." style={{ width: "100%", height: 36, fontSize: 12, outline: "none" }} disabled={editLoading} />
            </div>

            {/* Default Place ID */}
            <div>
              <FieldLabel>DEFAULT PLACE ID</FieldLabel>
              <input className="field glass-input" value={editDefaultPlaceId} onChange={e => setEditDefaultPlaceId(e.target.value)}
                placeholder="Roblox Game/Place ID" style={{ width: "100%", height: 36, fontSize: 12, outline: "none" }} disabled={editLoading} />
            </div>

            {/* Cooldown */}
            <div>
              <FieldLabel>LAUNCH COOLDOWN (seconds, -1 = use global)</FieldLabel>
              <input type="number" className="field glass-input" value={editCooldown} onChange={e => setEditCooldown(Number(e.target.value))}
                style={{ width: "100%", height: 36, fontSize: 12, outline: "none" }} disabled={editLoading} />
            </div>

            {/* Cookie */}
            <div>
              <FieldLabel>ROBLOSECURITY COOKIE (leave blank to keep current)</FieldLabel>
              <textarea className="field glass-input" rows={2} value={editCookie} onChange={e => setEditCookie(e.target.value)}
                placeholder="Paste new .ROBLOSECURITY here to update..." style={{ width: "100%", fontSize: 11, fontFamily: "monospace", outline: "none", resize: "vertical" }} disabled={editLoading} />
            </div>

            {/* Checkboxes */}
            <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
              <Toggle label="Favorite" value={editIsFavorite} onChange={setEditIsFavorite} />
              <Toggle label="Safe Launch" value={editSafeLaunch} onChange={setEditSafeLaunch} />
              <Toggle label="Auto-Rejoin" value={editAutoRejoin} onChange={setEditAutoRejoin} />
            </div>

            {editError && <ErrorMsg msg={editError} />}

            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <button onClick={() => { setEditAccountModal(null); setEditError(""); }} disabled={editLoading} className="btn btn-ghost" style={{ flex: 1 }}>
                Cancel
              </button>
              <button onClick={handleSaveEditAccount} disabled={editLoading} className="btn"
                style={{ flex: 2, background: "#FFFFFF", color: "#000", fontWeight: 800 }}>
                {editLoading ? "Saving Changes..." : "Save Changes"}
              </button>
            </div>
          </div>
        </HomeModal>
      )}

      {/* Account Utilities Modal */}
      {utilAccount && (
        <HomeModal title="Account Utilities" onClose={() => { if (!utilLoading) { setUtilAccount(null); setUtilStatus(""); } }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <p style={{ fontSize: 11, color: "var(--t3)", margin: 0 }}>
              Manage settings for <code style={{ color: "#FFFFFF", fontFamily: "monospace" }}>@{utilAccount.username}</code> (ID: {utilAccount.user_id})
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Set Display Name */}
              <div style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: 16 }}>
                <FieldLabel>DISPLAY NAME</FieldLabel>
                <div style={{ display: "flex", gap: 8 }}>
                  <input className="field glass-input" value={utilNewDisplayName} onChange={e => setUtilNewDisplayName(e.target.value)}
                    placeholder="New display name" style={{ height: 34, fontSize: 12, flex: 1, outline: "none" }}
                    disabled={utilLoading} />
                  <button onClick={handleSetDisplayName} disabled={utilLoading || !utilNewDisplayName.trim()} className="btn"
                    style={{ padding: "0 14px", height: 34, fontSize: 11.5, background: "#FFFFFF", color: "#000", fontWeight: 800, borderRadius: 8, border: "none", opacity: !utilNewDisplayName.trim() ? 0.5 : 1 }}>
                    Set Name
                  </button>
                </div>
              </div>

              {/* Password */}
              <div style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: 16 }}>
                <FieldLabel>CHANGE PASSWORD</FieldLabel>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <input type="password" className="field glass-input" value={utilCurrentPassword} onChange={e => setUtilCurrentPassword(e.target.value)}
                    placeholder="Current Password" style={{ height: 34, fontSize: 12, flex: 1, outline: "none" }}
                    disabled={utilLoading} />
                  <input type="password" className="field glass-input" value={utilNewPassword} onChange={e => setUtilNewPassword(e.target.value)}
                    placeholder="New Password" style={{ height: 34, fontSize: 12, flex: 1, outline: "none" }}
                    disabled={utilLoading} />
                </div>
                <button onClick={handleChangePassword} disabled={utilLoading || !utilCurrentPassword || !utilNewPassword} className="btn"
                  style={{ padding: "0 14px", height: 34, fontSize: 11.5, background: "#FFFFFF", color: "#000", fontWeight: 800, borderRadius: 8, border: "none", opacity: (!utilCurrentPassword || !utilNewPassword) ? 0.5 : 1 }}>
                  Change Password
                </button>
              </div>

              {/* Sessions */}
              <div style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: 16 }}>
                <FieldLabel>SESSIONS</FieldLabel>
                <button onClick={handleSignOutAll} disabled={utilLoading} className="btn"
                  style={{ padding: "0 14px", height: 34, fontSize: 11.5, background: "rgba(248,113,113,0.1)", color: "var(--red)", fontWeight: 800, borderRadius: 8, border: "1px solid rgba(248,113,113,0.25)" }}>
                  Sign Out of All Other Sessions
                </button>
              </div>

              {/* Friend / Block */}
              <div>
                <FieldLabel>FRIEND / BLOCK</FieldLabel>
                <div style={{ display: "flex", gap: 8 }}>
                  <input className="field glass-input" value={utilTargetUser} onChange={e => setUtilTargetUser(e.target.value)}
                    placeholder="Target Username" style={{ height: 34, fontSize: 12, flex: 1, outline: "none" }}
                    disabled={utilLoading} />
                  <button onClick={handleSendFriendRequest} disabled={utilLoading || !utilTargetUser.trim()} className="btn"
                    style={{ padding: "0 14px", height: 34, fontSize: 11.5, background: "#FFFFFF", color: "#000", fontWeight: 800, borderRadius: 8, border: "none", opacity: !utilTargetUser.trim() ? 0.5 : 1 }}>
                    Add Friend
                  </button>
                  <button onClick={handleBlockUser} disabled={utilLoading || !utilTargetUser.trim()} className="btn"
                    style={{ padding: "0 14px", height: 34, fontSize: 11.5, background: "rgba(248,113,113,0.1)", color: "var(--red)", fontWeight: 800, borderRadius: 8, border: "1px solid rgba(248,113,113,0.25)", opacity: !utilTargetUser.trim() ? 0.5 : 1 }}>
                    Block
                  </button>
                </div>
              </div>
            </div>

            {utilStatus && (
              <div style={{
                marginTop: 16, padding: "8px 12px", borderRadius: 8, fontSize: 11.5,
                background: utilIsError ? "rgba(248,113,113,0.08)" : "rgba(52,211,153,0.08)",
                border: `1px solid ${utilIsError ? "rgba(248,113,113,.2)" : "rgba(52,211,153,.2)"}`,
                color: utilIsError ? "var(--red)" : "var(--green)",
                wordBreak: "break-all"
              }}>
                {utilStatus}
              </div>
            )}
          </div>
        </HomeModal>
      )}

      {/* Dump Details Modal */}
      {dumpAccount && (
        <HomeModal title="Account Details Dump" onClose={() => setDumpAccount(null)} wide>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 11, color: "var(--t3)", marginTop: -4 }}>
              Raw data properties for @{dumpAccount.username}
            </div>
            <textarea
              className="field glass-input"
              rows={12}
              readOnly
              value={JSON.stringify(dumpAccount, null, 2)}
              style={{ width: "100%", fontFamily: "monospace", fontSize: 11, resize: "vertical", background: "rgba(255,255,255,0.02)", color: "var(--t2)", padding: 12, outline: "none" }}
            />
            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              <button onClick={() => setDumpAccount(null)} className="btn btn-ghost" style={{ flex: 1 }}>
                Close
              </button>
              <button onClick={async () => {
                try {
                  await navigator.clipboard.writeText(JSON.stringify(dumpAccount, null, 2));
                  alert("Details copied to clipboard!");
                } catch (err) {
                  alert("Failed to copy details: " + err);
                }
              }} className="btn"
                style={{ flex: 1, background: "#FFFFFF", color: "#000", fontWeight: 800 }}>
                Copy to Clipboard
              </button>
            </div>
          </div>
        </HomeModal>
      )}
    </div>
  );
}

/* â•â• Sub-components â•â• */

function CompactAccountRow({ account, isActive, isSelected, checking, health, onCheck, onSelect, onContextMenu }: {
  account: Account; isActive: boolean; isSelected: boolean;
  checking: boolean; health: "checking" | "valid" | "invalid" | "unknown";
  onCheck: () => void; onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const [hov, setHov] = useState(false);
  const isValid   = account.cookie_status === "Valid";
  const isExpired = account.cookie_status === "Expired";

  const healthColor = health === "valid" ? "var(--green)" : health === "invalid" ? "var(--red)" : health === "checking" ? "#FBBF24" : "var(--t3)";
  const healthTitle = health === "valid" ? "Cookie valid" : health === "invalid" ? "Cookie invalid/expired" : health === "checking" ? "Checking…" : "Not yet checked";

  return (
    <div
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      onClick={onSelect} onContextMenu={onContextMenu}
      style={{
        display: "flex", alignItems: "center", gap: 9, padding: "7px 14px",
        cursor: "pointer",
        background: isSelected ? "rgba(255,255,255,0.05)" : hov ? "rgba(255,255,255,0.02)" : "transparent",
        borderLeft: `2px solid ${isSelected ? "rgba(255,255,255,0.6)" : "transparent"}`,
        transition: "all .12s", userSelect: "none",
      }}>
      <div style={{ position: "relative", flexShrink: 0 }}>
        {account.avatar_url
          ? <img src={account.avatar_url} alt="" style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover" }} />
          : <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--surface-3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: "var(--t2)" }}>{account.username.slice(0, 2).toUpperCase()}</div>
        }
        {/* Health indicator dot — bottom-right of avatar */}
        {!isActive && (
          <span title={healthTitle} style={{ position: "absolute", bottom: 0, right: 0, width: 9, height: 9, borderRadius: "50%", background: healthColor, border: "2px solid var(--bg)", transition: "background .3s" }} />
        )}
        {isActive && <span style={{ position: "absolute", bottom: 0, right: 0, width: 9, height: 9, borderRadius: "50%", background: "var(--green)", border: "2px solid var(--bg)", animation: "pulse-glow 2s ease-in-out infinite" }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: isSelected ? "#FFFFFF" : "var(--t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.2 }}>
          {account.display_name || account.username}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 1 }}>
          <span style={{ fontSize: 9, color: "var(--t3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{account.username}</span>
          {account.group && (
            <span style={{ fontSize: 7.5, fontWeight: 800, padding: "1px 5px", borderRadius: 4, background: "rgba(255,255,255,0.04)", color: "var(--t3)", flexShrink: 0 }}>{account.group}</span>
          )}
        </div>
      </div>
      <button onClick={e => { e.stopPropagation(); onCheck(); }} disabled={checking}
        style={{ flexShrink: 0, padding: "2px 6px", borderRadius: 4, fontSize: 9, fontWeight: 700,
          border: `1px solid ${isValid ? "rgba(52,211,153,.25)" : isExpired ? "rgba(248,113,113,.25)" : "rgba(255,255,255,0.06)"}`,
          background: isValid ? "var(--green-dim)" : isExpired ? "var(--red-dim)" : "rgba(255,255,255,0.03)",
          color: isValid ? "var(--green)" : isExpired ? "var(--red)" : "var(--t3)",
          cursor: checking ? "not-allowed" : "pointer" }}>
        {checking ? "…" : isValid ? "✓" : isExpired ? "!" : "?"}
      </button>
    </div>
  );
}

function HeaderStatPill({ icon, label, value, sub, valueColor }: { icon: React.ReactNode; label: string; value: string; sub: string; valueColor?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderRadius: 8, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)", flexShrink: 0 }}>
      <span style={{ display: "flex", alignItems: "center" }}>{icon}</span>
      <div>
        <div style={{ fontSize: 9, fontWeight: 700, color: "var(--t3)", letterSpacing: "0.06em", lineHeight: 1 }}>{label}</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 900, color: valueColor ?? "var(--t1)", lineHeight: 1, letterSpacing: "-0.3px" }}>{value}</span>
          <span style={{ fontSize: 9, color: "var(--t3)", fontWeight: 600 }}>{sub}</span>
        </div>
      </div>
    </div>
  );
}

function LiveSessionRow({ session, onKill }: { session: Session; onKill: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <div onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, background: hov ? "var(--surface-2)" : "var(--surface-3)", border: "1px solid var(--border)", transition: "background .1s" }}>
      <div style={{ position: "relative", flexShrink: 0 }}>
        {session.avatar_url ? (
          <img src={session.avatar_url} alt="" style={{ width: 30, height: 30, borderRadius: "50%", objectFit: "cover" }} />
        ) : (
          <div style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--surface-2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <GamepadIcon size={16} color="var(--t2)" />
          </div>
        )}
        <span style={{ position: "absolute", bottom: 0, right: 0, width: 8, height: 8, borderRadius: "50%", background: "var(--green)", border: "2px solid var(--surface)", animation: "pulse-glow 2s ease-in-out infinite" }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--t1)" }}>{session.username ?? "Unknown"}</div>
        <div style={{ fontSize: 9, color: "var(--t3)" }}>PID {session.pid}</div>
      </div>
      <button onClick={onKill} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(248,113,113,.3)", background: "var(--red-dim)", color: "var(--red)", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
        Kill
      </button>
    </div>
  );
}

const EVENT_COLORS: Record<string, string> = {
  launched:       "var(--green)",
  added:          "var(--accent)",
  removed:        "var(--red)",
  cookie_valid:   "var(--green)",
  cookie_expired: "var(--red)",
  killed:         "rgba(255, 255, 255, 0.4)",
};

const EVENT_ICONS: Record<string, React.ReactNode> = {
  launched:       <PlayIcon size={10} />,
  added:          <PlusIcon size={10} />,
  removed:        <TrashIcon size={10} />,
  cookie_valid:   <CheckIcon size={10} />,
  cookie_expired: <XIcon size={10} />,
  killed:         <PowerIcon size={10} />,
};

function EventRow({ event }: { event: EventEntry }) {
  const color = EVENT_COLORS[event.kind] ?? "var(--t3)";
  const icon  = EVENT_ICONS[event.kind]  ?? <span style={{ fontSize: 10 }}>•</span>;
  const rel   = timeAgo(new Date(event.timestamp));

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 6px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
      <span style={{ color, display: "flex", alignItems: "center", justifyContent: "center", width: 14, flexShrink: 0 }}>{icon}</span>
      {event.avatar_url ? (
        <img src={event.avatar_url} alt="" style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
      ) : (
        <div style={{ width: 22, height: 22, borderRadius: "50%", background: "rgba(255,255,255,0.03)", flexShrink: 0 }} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10.5, color: "var(--t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {event.detail}
        </div>
      </div>
      <div style={{ fontSize: 9, color: "var(--t3)", flexShrink: 0 }}>{rel}</div>
    </div>
  );
}

function ActivityRow({ record }: { record: SessionRecord }) {
  const dur = record.duration_minutes < 60
    ? `${record.duration_minutes}m`
    : `${Math.floor(record.duration_minutes / 60)}h ${record.duration_minutes % 60}m`;
  const ts = timeAgo(new Date(record.start_time));

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 6px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
      {record.avatar_url ? (
        <img src={record.avatar_url} alt="" style={{ width: 26, height: 26, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
      ) : (
        <div style={{ width: 26, height: 26, borderRadius: "50%", background: "rgba(255,255,255,0.03)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: "var(--t2)", flexShrink: 0 }}>
          {record.username.slice(0, 2).toUpperCase()}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: "var(--t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {record.username}
        </div>
        <div style={{ fontSize: 9.5, color: "var(--t3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>
          {record.game_name}
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontSize: 11, color: "var(--t2)", fontWeight: 700 }}>{dur}</div>
        <div style={{ fontSize: 9, color: "var(--t3)", marginTop: 1 }}>{ts}</div>
      </div>
    </div>
  );
}

/* ── Small primitives ── */
function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }} onClick={() => onChange(!value)}>
      <div style={{
        width: 32, height: 18, borderRadius: 99,
        background: value ? "#FFFFFF" : "rgba(255, 255, 255, 0.05)",
        border: `1.5px solid ${value ? "#FFFFFF" : "rgba(255, 255, 255, 0.15)"}`,
        position: "relative", transition: "all .2s cubic-bezier(0.4, 0, 0.2, 1)"
      }}>
        <div style={{
          position: "absolute", top: 2, left: value ? 16 : 2,
          width: 11, height: 11, borderRadius: "50%",
          background: value ? "#000000" : "rgba(255, 255, 255, 0.4)",
          transition: "all .2s cubic-bezier(0.4, 0, 0.2, 1)"
        }} />
      </div>
      <span style={{ fontSize: 10.5, color: value ? "var(--t1)" : "var(--t3)", fontWeight: 750, transition: "color 0.15s" }}>{label}</span>
    </div>
  );
}

const IconSvg = ({ children }: { children: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
    {children}
  </svg>
);

function DropdownItem({ icon, label, sub, onClick }: { icon: React.ReactNode; label: string; sub: string; onClick: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <div onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)} onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "5px 10px",
        borderRadius: 7,
        background: hov ? "rgba(255, 255, 255, 0.04)" : "transparent",
        cursor: "pointer",
        transition: "all .1s",
        userSelect: "none"
      }}
    >
      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", color: hov ? "#FFFFFF" : "var(--t2)", flexShrink: 0, width: 13, height: 13 }}>
        {icon}
      </span>
      <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: "var(--t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
        {sub && <div style={{ fontSize: 9, color: "var(--t3)", marginTop: 0.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>}
      </div>
    </div>
  );
}

function timeAgo(date: Date): string {
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 60)   return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

interface HomeModalProps {
  title: string;
  onClose: () => void;
  wide?: boolean;
  children: React.ReactNode;
}

function HomeModal({ title, onClose, wide, children }: HomeModalProps) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(12px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20
      }}
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "linear-gradient(135deg, rgba(10, 11, 15, 0.98) 0%, rgba(5, 6, 8, 0.99) 100%)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: 20,
          padding: 24,
          width: wide ? 560 : 420,
          maxWidth: "100%",
          boxShadow: "0 24px 60px rgba(0, 0, 0, 0.8)",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          maxHeight: "90vh",
          overflowY: "auto",
          position: "relative"
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 15, fontWeight: 850, color: "var(--t1)", letterSpacing: "-0.3px" }}>{title}</span>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--t3)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 4,
              borderRadius: "50%",
              transition: "background 0.15s, color 0.15s",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.05)";
              e.currentTarget.style.color = "var(--t1)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = "none";
              e.currentTarget.style.color = "var(--t3)";
            }}
          >
            <XIcon size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 9.5, color: "var(--t3)", fontWeight: 800, letterSpacing: "0.1em", marginBottom: 8, textTransform: "uppercase" }}>
      {children}
    </div>
  );
}

function ErrorMsg({ msg }: { msg: string }) {
  return (
    <div style={{
      fontSize: 11.5, color: "var(--red)", marginBottom: 10, padding: "8px 12px",
      background: "rgba(248, 113, 113, 0.08)", borderRadius: 9,
      border: "1px solid rgba(248, 113, 113, 0.2)",
    }}>{msg}</div>
  );
}
