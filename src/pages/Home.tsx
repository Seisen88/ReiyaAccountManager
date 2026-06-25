import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { CATALOG } from "../data/catalog";
import { useNavigate, useLocation } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext";
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
  LoaderIcon,
  StarIcon
} from "../components/Icons";

/* â"€â"€ Types â"€â"€ */
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

interface LoginResultPayload {
  cookie: string | null;
  window_label: string;
  target_username: string | null;
  error: string | null;
}

interface Session {
  pid: number;
  user_id: number | null;
  username: string | null;
  avatar_url: string | null;
  game_name: string | null;
  start_time: string | null;
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
interface Toast {
  id: number;
  msg: string;
  type: "success" | "error" | "info";
}

export default function Home() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, language } = useLanguage();
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
        topAccount: "-",
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
      sessionsLabel: `${x.sessions} ${x.sessions === 1 ? t("session") : t("sessions_plural")}`,
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
      sessionsLabel: `${x.sessions} ${x.sessions === 1 ? t("session") : t("sessions_plural")}`,
      timeText: formatTime(x.minutes),
      pct: Math.round((x.minutes / maxGameMin) * 100),
    }));

    const topAccount = accList[0]?.name ?? "-";

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

  // Discord RPC playing state — tracks active game session (refs, no re-render needed)
  const playingUserIdRef = useRef<number | null>(null);
  const setPlayingUserId = (v: number | null) => { playingUserIdRef.current = v; };
  const setPlayingGame   = (_v: string) => {};

  // Launch state
  const [selAccount,      setSelAccount]      = useState<number | null>(null);
  const [launchPlaceId,   setLaunchPlaceId]   = useState("");  // selected placeId (from recent or manual)
  const [jobId,           setJobId]           = useState("");
  const [accessCode,      setAccessCode]      = useState("");
  const [useBootstrapper, setUseBootstrapper] = useState<boolean>(() => {
    return localStorage.getItem("reiya_use_bootstrapper") === "true";
  });
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

  // Home QoL state
  const [accSearch,  setAccSearch]  = useState("");
  const [accFilter,  setAccFilter]  = useState<"all" | "valid" | "favorites">("all");
  const [accGroup,   setAccGroup]   = useState<string | null>(null);
  // Feature 1: Toast notification system
  const [toasts, setToasts] = useState<Toast[]>([]);
  const showToast = useCallback((msg: string, type: Toast["type"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts(p => [...p, { id, msg, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3200);
  }, []);

  // Feature 8: Launch history
  const [launchHistory, setLaunchHistory] = useState<Array<{userId:number; username:string; placeId:string; gameName:string}>>(() => {
    try { return JSON.parse(localStorage.getItem("reiya_launch_history") || "[]"); } catch { return []; }
  });
  const pushLaunchHistory = useCallback((userId: number, username: string, placeId: string, gameName: string) => {
    setLaunchHistory(prev => {
      const entry = {userId,username,placeId,gameName};
      const next = [entry, ...prev.filter(h => !(h.userId===userId && h.placeId===placeId))].slice(0,3);
      localStorage.setItem("reiya_launch_history", JSON.stringify(next));
      return next;
    });
  }, []);

  // Feature 9: Pinned games
  const [pinnedGames, setPinnedGames] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("reiya_pinned_games") || "[]"); } catch { return []; }
  });
  const togglePinGame = useCallback((placeId: string) => {
    setPinnedGames(prev => {
      const next = prev.includes(placeId) ? prev.filter(id => id !== placeId) : [...prev, placeId];
      localStorage.setItem("reiya_pinned_games", JSON.stringify(next));
      return next;
    });
  }, []);

  // Feature 10: Session detail popover
  const [sessionDetail, setSessionDetail] = useState<Session | null>(null);

  // Feature 5: Refs for arrow key navigation
  const selAccountRef = useRef<number|null>(null);
  const flatAccountsRef = useRef<Account[]>([]);

  // Feature 2: Ref for launchPlaceId (to avoid stale closure in selAccount effect)
  const launchPlaceIdRef = useRef(launchPlaceId);

  // Feature 6: Game search state
  const [gameSearch, setGameSearch] = useState("");

  // Feature 4: Checking state for re-validate button
  const [reValidating, setReValidating] = useState(false);
  const [savePasswordPrompt, setSavePasswordPrompt] = useState<{ userId: number; username: string } | null>(null);
  const [savePasswordInput, setSavePasswordInput] = useState("");

  /* â"€â"€ Load on mount, poll sessions â"€â"€ */
  useEffect(() => {
    async function load() {
      const [accs, sess, evts, hist, recents, settingsData] = await Promise.all([
        invoke<Account[]>("get_accounts").catch(() => [] as Account[]),
        invoke<Session[]>("get_live_sessions").catch(() => [] as Session[]),
        invoke<EventEntry[]>("get_event_log").catch(() => [] as EventEntry[]),
        invoke<SessionRecord[]>("get_session_history").catch(() => [] as SessionRecord[]),
        invoke<RecentGame[]>("get_recent_games").catch(() => [] as RecentGame[]),
        invoke<any>("get_settings").catch(() => ({})),
      ]);
      setAccounts(accs);
      setSessions(sess);
      setEvents(evts);
      setSessionHistory(hist);
      setRecentGames(recents);

      // Sync bootstrapper from global settings
      if (settingsData && settingsData.UseBootstrapperLaunch !== undefined) {
        setUseBootstrapper(settingsData.UseBootstrapperLaunch);
        localStorage.setItem("reiya_use_bootstrapper", settingsData.UseBootstrapperLaunch ? "true" : "false");
      }

      // Sync language from settings
      if (settingsData && settingsData.Language) {
        localStorage.setItem("reiya_language", settingsData.Language);
      }

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
    let unlistenAccounts: (() => void) | null = null;
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
          // If the playing session ended, reset presence to current page
          const uid = playingUserIdRef.current;
          if (uid !== null && !sess.some((s: Session) => s.user_id === uid)) {
            playingUserIdRef.current = null;
            invoke("clear_game_rpc").catch(() => {});
          }
        });
      });
      unlistenAccounts = await listen("accounts-updated", () => {
        refreshAccounts();
      });
    };
    setupListener();

    const interval = setInterval(() => {
      invoke<Session[]>("get_live_sessions").then(setSessions).catch(() => {});
    }, 5000);

    // Keyboard shortcuts
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Enter") {
        e.preventDefault();
        // Trigger launch via a custom event the launch button can listen to
        document.dispatchEvent(new CustomEvent("reiya-launch-shortcut"));
      }
      if (e.key === "Escape") {
        setAccSearch("");
      }
      // Feature 5: Arrow key navigation in account list
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const flat = flatAccountsRef.current;
        if (flat.length === 0) return;
        const cur = selAccountRef.current;
        const idx = flat.findIndex(a => a.user_id === cur);
        let next: number;
        if (e.key === "ArrowDown") {
          next = idx < flat.length - 1 ? idx + 1 : 0;
        } else {
          next = idx > 0 ? idx - 1 : flat.length - 1;
        }
        const nextId = flat[next].user_id;
        setSelAccount(nextId);
        localStorage.setItem("reiya_last_account", String(nextId));
      }
    };
    document.addEventListener("keydown", handleKey);

    return () => {
      clearInterval(interval);
      if (unlisten) unlisten();
      if (unlistenAccounts) unlistenAccounts();
      document.removeEventListener("keydown", handleKey);
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

  // When recentGames is empty but we have session history, reconstruct from sessions
  useEffect(() => {
    if (recentGames.length > 0 || sessionHistory.length === 0) return;
    const seen = new Set<string>();
    const synthetic: RecentGame[] = [];
    for (const r of [...sessionHistory].reverse()) {
      if (!r.place_id || seen.has(r.place_id)) continue;
      seen.add(r.place_id);
      synthetic.push({
        placeId: r.place_id,
        name: r.game_name || `Place ${r.place_id}`,
        creator: "",
        iconUrl: "",
        playedAt: r.start_time,
      });
    }
    if (synthetic.length > 0) setRecentGames(synthetic.slice(0, 20));
  }, [recentGames, sessionHistory]);

  // Fetch thumbnails for all known place IDs (recent games + session history)
  useEffect(() => {
    const fromRecent = recentGames.map(r => r.placeId);
    const fromHistory = sessionHistory.map(r => r.place_id).filter(Boolean);
    const placeIds = [...new Set([...fromRecent, ...fromHistory])].filter(Boolean);
    if (placeIds.length === 0) { setThumbsLoading(false); return; }
    invoke<Record<string, string>>("fetch_place_thumbnails", { placeIds })
      .then(map => setThumbs(prev => ({ ...prev, ...map })))
      .catch(() => {})
      .finally(() => setThumbsLoading(false));
  }, [recentGames, sessionHistory]);

  useEffect(() => {
    if (location.state && typeof location.state === "object") {
      const state = location.state as { placeId?: string; jobId?: string };
      if (state.placeId) {
        setLaunchPlaceId(state.placeId);
        localStorage.setItem("reiya_last_place_id", state.placeId);
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
      localStorage.setItem("reiya_last_account", String(event.payload));
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

  /* â"€â"€ Derived â"€â"€ */
  const hour     = new Date().getHours();
  const greeting = hour < 12 ? t("good_morning") : hour < 18 ? t("good_afternoon") : t("good_evening");

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

  // Top games {t("by_total_playtime_lbl")} from all session history
  const topGames = useMemo(() => {
    const map = new Map<string, { placeId: string; name: string; minutes: number; sessions: number }>();
    for (const r of sessionHistory) {
      const key = r.place_id;
      const existing = map.get(key);
      if (existing) {
        existing.minutes += r.duration_minutes;
        existing.sessions++;
      } else {
        map.set(key, { placeId: r.place_id, name: r.game_name || "Unknown", minutes: r.duration_minutes, sessions: 1 });
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 6)
      .map(g => {
        const rg = recentGames.find(x => x.placeId === g.placeId);
        const thumbnailUrl = rg?.iconUrl || thumbs[g.placeId];
        return { ...g, thumbnailUrl };
      });
  }, [sessionHistory, recentGames, thumbs]);

  // Accounts grouped by group name for the left panel
  const accGroups = useMemo(() => {
    const PRESET_ORDER = ["Main", "Alts", "Trading", "Farming"];
    const seen = Array.from(new Set(accounts.map(a => a.group?.trim()).filter((g): g is string => !!g)));
    return seen.sort((a, b) => {
      const ai = PRESET_ORDER.indexOf(a);
      const bi = PRESET_ORDER.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [accounts]);

  // Reset accGroup if the group no longer exists
  useEffect(() => {
    if (accGroup !== null && !accGroups.includes(accGroup)) setAccGroup(null);
  }, [accGroups, accGroup]);

  const groupedAccounts = useMemo(() => {
    const q = accSearch.toLowerCase();
    const filtered = accounts.filter(acc => {
      const matchSearch = !q || acc.username.toLowerCase().includes(q) || (acc.display_name || "").toLowerCase().includes(q);
      const matchFilter = accFilter === "all" || (accFilter === "valid" && acc.cookie_status === "Valid") || (accFilter === "favorites" && acc.is_favorite);
      const matchGroup = accGroup === null || (acc.group?.trim() || "") === accGroup;
      return matchSearch && matchFilter && matchGroup;
    });
    // Always flat — tabs communicate the group, dividers add no value
    return [["", filtered]] as [string, Account[]][];
  }, [accounts, accSearch, accFilter, accGroup]);

  // Feature 5: Keep selAccountRef up to date
  useEffect(() => { selAccountRef.current = selAccount; }, [selAccount]);
  // Feature 5: Keep flatAccountsRef up to date (after groupedAccounts is declared)
  useEffect(() => {
    flatAccountsRef.current = groupedAccounts.flatMap(([, accs]) => accs);
  }, [groupedAccounts]);

  // Feature 2: Keep launchPlaceIdRef up to date
  useEffect(() => { launchPlaceIdRef.current = launchPlaceId; }, [launchPlaceId]);

  // Feature 2: Auto-populate game when selecting an account
  useEffect(() => {
    if (selAccount === null) return;
    const account = accounts.find(a => a.user_id === selAccount);
    if (account && account.default_place_id && !launchPlaceIdRef.current) {
      setLaunchPlaceId(account.default_place_id);
      localStorage.setItem("reiya_last_place_id", account.default_place_id);
    }
  }, [selAccount, accounts]);

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
      showToast("Failed to save private server: " + err, "error");
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
      showToast("Failed to remove game: " + err, "error");
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

  const handlePastePlaceId = async () => {
    try {
      const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
      const clip = await readText();
      if (clip) {
        const match = clip.match(/\d{6,}/);
        const id = match ? match[0] : clip.trim();
        setLaunchPlaceId(id);
        localStorage.setItem("reiya_last_place_id", id);
        setLaunchError("");
      }
    } catch { }
  };

  /* â"€â"€ Handlers â"€â"€ */
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
      setBulkResults([{ preview: "-", success: false, username: null, error: String(e) }]);
    } finally {
      setBulkAdding(false);
    }
  };

  const loginOneAccount = (username?: string, password?: string): Promise<LoginResultPayload | null> => {
    return new Promise((resolve) => {
      let unlisten: (() => void) | null = null;
      const windowLabel = `login-${Math.floor(Math.random() * 1000000000)}`;

      const setupListener = async () => {
        unlisten = await listen<LoginResultPayload>("login-cookie-result", (event) => {
          if (event.payload.window_label === windowLabel) {
            if (unlisten) unlisten();
            resolve(event.payload);
          }
        });
      };

      setupListener().then(async () => {
        try {
          await invoke("open_login_window", { 
            windowLabel,
            username: username || null, 
            password: password || null 
          });
        } catch (e) {
          if (unlisten) unlisten();
          showToast(`Failed to open login window: ${String(e)}`, "error");
          resolve(null);
        }
      });
    });
  };

  const handleManualLogin = async () => {
    setAddMenu(false);
    setLoginLoading(true);
    try {
      const res = await loginOneAccount();
      if (res && res.cookie) {
        const acc = await invoke<Account>("add_account", { cookie: res.cookie });
        setAccounts(prev => {
          const idx = prev.findIndex(a => a.user_id === acc.user_id);
          return idx >= 0 ? prev.map((a, i) => i === idx ? acc : a) : [...prev, acc];
        });
        await refreshAccounts();
        setSavePasswordInput("");
        setSavePasswordPrompt({ userId: acc.user_id, username: acc.username });
      } else {
        const reason = res?.error || "Login window was closed or cookie extraction failed.";
        showToast("Manual login not saved: " + reason, "error");
      }
    } catch (e) {
      showToast(`Manual login failed: ${String(e)}`, "error");
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
    const total = lines.length;
    let successCount = 0;
    let doneCount = 0;

    const pwMap: Record<string, string> = {};
    for (const line of lines) {
      const [u, p] = line.split(":", 2).map(s => s.trim());
      if (u) pwMap[u.toLowerCase()] = p ?? "";
    }

    const failedAccounts: string[] = [];
    const succeededAccounts: string[] = [];

    // Process all imports in parallel (staggered window opening)
    const promises = lines.map(async (line, index) => {
      const [username, password] = line.split(":", 2).map(s => s.trim());
      // Stagger window opens by 800ms each so WebView2 environments initialise cleanly
      await new Promise(r => setTimeout(r, index * 800));
      
      setLoginError(`Opening window ${index + 1}/${total}: ${username}...`);
      const res = await loginOneAccount(username, password);
      doneCount++;
      setLoginError(`${doneCount}/${total} windows completed...`);

      if (res && res.cookie) {
        try {
          const acc = await invoke<Account>("add_account", { cookie: res.cookie });
          const pw = pwMap[acc.username.toLowerCase()] ?? "";
          if (pw) await invoke("save_account_password", { userId: acc.user_id, password: pw }).catch(() => {});
          setAccounts(prev => {
            const idx = prev.findIndex(a => a.user_id === acc.user_id);
            const updated = { ...acc, password: pw };
            return idx >= 0 ? prev.map((a, i) => i === idx ? updated : a) : [...prev, updated];
          });
          succeededAccounts.push(acc.username);
          successCount++;
        } catch (err) {
          console.error("add_account failed:", err);
          failedAccounts.push(`${username} (add_account error: ${err})`);
        }
      } else {
        const reason = res?.error || "Window closed or interception timed out.";
        failedAccounts.push(`${username} (${reason})`);
      }
    });

    setLoginError(`All ${total} windows opened — waiting for logins...`);
    await Promise.all(promises);

    setLoginLoading(false);
    setShowUserPass(false);
    setComboText("");
    await refreshAccounts();

    let msg = `Done! Imported ${successCount}/${total} account(s).`;
    if (succeededAccounts.length > 0) msg += `\n\n✓ Success:\n${succeededAccounts.map(u => `  • ${u}`).join("\n")}`;
    if (failedAccounts.length > 0) msg += `\n\n✗ Failed (${failedAccounts.length}):\n${failedAccounts.map(f => `  • ${f}`).join("\n")}`;
    showToast(`Imported ${successCount}/${total} account(s).`, successCount > 0 ? "success" : "error");
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

  // Wire Enter shortcut → launch
  useEffect(() => {
    const handler = () => { handleLaunch(); };
    document.addEventListener("reiya-launch-shortcut", handler);
    return () => document.removeEventListener("reiya-launch-shortcut", handler);
  });

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
    const rpcLabel = effectiveGameName ? `Launching ${effectiveGameName}` : "Launching Roblox";
    invoke("update_discord_rpc", { page: rpcLabel }).catch(() => {});
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
      // Feature 8: Push launch history
      pushLaunchHistory(selAccount, account.username, effectivePlaceId || "", effectiveGameName || "");
      // Mark as playing — presence stays until session closes
      const gameName = effectiveGameName || "Roblox";
      setPlayingUserId(selAccount);
      setPlayingGame(gameName);
      invoke("update_discord_rpc", { page: `Playing ${gameName}` }).catch(() => {});
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
      invoke("clear_game_rpc").catch(() => {});
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
    invoke("update_discord_rpc", { page: "Launching Roblox App" }).catch(() => {});
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
      setPlayingUserId(selAccount);
      setPlayingGame("Roblox App");
      invoke("update_discord_rpc", { page: "Playing Roblox App" }).catch(() => {});
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
      invoke("clear_game_rpc").catch(() => {});
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
    localStorage.setItem("reiya_last_place_id", placeId);
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
      <HomeModal title={t("import_cookie_title")} onClose={() => { setShowSingle(false); setAddError(""); }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <FieldLabel>{t("roblosecurity_cookie_label")}</FieldLabel>
            <textarea className="field glass-input" rows={4} placeholder={t("paste_roblosecurity_placeholder")}
              value={addCookie} onChange={e => setAddCookie(e.target.value)}
              style={{ resize: "vertical", fontFamily: "monospace", fontSize: 10 }} />
          </div>
          {addError && <ErrorMsg msg={addError} />}
          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button onClick={() => { setShowSingle(false); setAddError(""); }} className="btn btn-ghost" style={{ flex: 1 }}>
              {t("cancel")}
            </button>
            <button onClick={handleAddSingle} disabled={adding || !addCookie.trim()} className="btn"
              style={{ flex: 2, background: "#FFFFFF", color: "#000", fontWeight: 800, opacity: !addCookie.trim() ? 0.5 : 1 }}>
              {adding ? t("validating_btn") : t("import_cookie_title")}
            </button>
          </div>
        </div>
      </HomeModal>
    )}

    {/* ── Bulk Import Modal ── */}
    {showBulk && (
      <HomeModal title={t("bulk_cookie_import_title")} onClose={() => { if (!bulkAdding) { setShowBulk(false); setBulkText(""); setBulkResults([]); } }} wide>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ fontSize: 11.5, color: "var(--t2)" }}>{t("paste_cookies_one_per_line_desc")}</p>
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
              {bulkResults.length > 0 ? t("close_btn") : t("cancel")}
            </button>
            {bulkResults.length === 0 && (
              <button onClick={handleBulkImport} disabled={bulkAdding || !bulkText.trim()} className="btn"
                style={{ flex: 2, background: "#FFFFFF", color: "#000", fontWeight: 850, opacity: !bulkText.trim() ? 0.5 : 1 }}>
                {bulkAdding ? t("importing_btn") : t("import_all_btn")}
              </button>
            )}
          </div>
        </div>
      </HomeModal>
    )}

    {/* ── User:Pass Modal ── */}
    {showUserPass && (
      <HomeModal title={t("user_pass_combo_import_title")} onClose={() => { if (!loginLoading) setShowUserPass(false); }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ fontSize: 11.5, color: "var(--t2)", lineHeight: 1.4 }}>
            {t("paste_combos_desc")}
          </p>
          <div>
            <FieldLabel>{t("account_combos_label")}</FieldLabel>
            <textarea
              className="field glass-input"
              rows={6}
              value={comboText}
              onChange={e => setComboText(e.target.value)}
              placeholder={t("username_password_placeholder") + "\n" + t("username_password_placeholder") + "\n..."}
              style={{ resize: "vertical", fontFamily: "monospace", fontSize: 11 }}
              disabled={loginLoading}
            />
          </div>
          {loginError && <ErrorMsg msg={loginError} />}
          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button onClick={() => setShowUserPass(false)} disabled={loginLoading} className="btn btn-ghost" style={{ flex: 1 }}>
              {t("cancel")}
            </button>
            <button onClick={() => handleComboImport(comboText)} disabled={loginLoading || !comboText.trim()} className="btn"
              style={{ flex: 2, background: "#FFFFFF", color: "#000", fontWeight: 850, opacity: !comboText.trim() ? 0.5 : 1 }}>
              {loginLoading ? t("processing") : t("start_combo_import_btn")}
            </button>
          </div>
        </div>
      </HomeModal>
    )}

    {/* ── TOP HEADER BAR ── */}
    <div style={{ display: "flex", alignItems: "center", padding: "0 24px", height: 66, borderBottom: "1px solid var(--glass-line)", flexShrink: 0, gap: 20 }}>
      <div style={{ flexShrink: 0 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: "var(--t3)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 3 }}>
          {new Date().toLocaleDateString(language === "zh-cn" ? "zh-CN" : language, { weekday: "long", month: "long", day: "numeric" })}
        </div>
        <div style={{ fontSize: 17, fontWeight: 900, color: "var(--t1)", letterSpacing: "-0.5px", lineHeight: 1 }}>{greeting}</div>
      </div>
      <div style={{ width: 1, height: 28, background: "var(--g07)", flexShrink: 0 }} />
      <div style={{ display: "flex", gap: 6, flex: 1 }}>
        <HeaderStatPill icon={<UserIcon size={11} color="#93C5FD" />} label={t("accounts")} value={String(accounts.length)} sub={`${favorites} ${t("favorites").toLowerCase()}`} />
        <HeaderStatPill icon={<MonitorIcon size={11} color={sessions.length > 0 ? "var(--green)" : "var(--t3)"} />} label={t("live")} value={String(sessions.length)} sub={t("sessions_plural")} valueColor={sessions.length > 0 ? "var(--green)" : undefined} />
        <HeaderStatPill icon={<BarChartIcon size={11} color="#C4B5FD" />} label={t("this_week")} value={weekStats.timeStr} sub={`${weekStats.sessCount} ${t("sessions_plural")}`} />
        <HeaderStatPill
          icon={<ShieldCheckIcon size={11} color={accounts.length === 0 ? "var(--t3)" : validCookies === accounts.length ? "var(--green)" : "var(--red)"} />}
          label={t("cookie_title")} value={`${validCookies}/${accounts.length}`}
          sub={accounts.length === 0 ? t("none_added") : validCookies === accounts.length ? t("all_valid") : `${accounts.length - validCookies} ${t("expired_suffix")}`}
          valueColor={accounts.length === 0 ? undefined : validCookies === accounts.length ? "var(--green)" : "var(--red)"} />
      </div>
      <div style={{ display: "flex", gap: 7, flexShrink: 0, alignItems: "center" }}>
        {loginLoading && (
          <span style={{ fontSize: 10.5, color: "var(--t2)", display: "flex", alignItems: "center", gap: 5 }}>
            <LoaderIcon size={10} style={{ animation: "spin 1s linear infinite" }} /> {t("login_open")}
          </span>
        )}
        <div ref={addMenuRef} style={{ position: "relative" }}>
          <button onClick={e => { e.stopPropagation(); setAddMenu(v => !v); }} className="btn glow-btn"
            style={{ padding: "7px 14px", borderRadius: 8, fontSize: 11, fontWeight: 800, background: "#FFFFFF", color: "#07080a", border: "none", display: "flex", alignItems: "center", gap: 5 }}>
            <PlusIcon size={11} color="#07080a" /> {t("add_account")}
          </button>
          {addMenu && (
            <div onClick={e => e.stopPropagation()}
              style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 9999, background: "var(--modal-bg)", backdropFilter: "blur(16px)", border: "1px solid var(--modal-border)", borderRadius: 12, padding: 4, minWidth: 220, boxShadow: "0 12px 36px rgba(0,0,0,.4)" }}>
              <DropdownItem icon={<IconSvg><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></IconSvg>} label={t("manual_login_title")} sub={t("manual_login_sub")} onClick={handleManualLogin} />
              <DropdownItem icon={<IconSvg><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" /></IconSvg>} label={t("user_pass_combo")} sub={t("user_pass_sub")} onClick={() => { setAddMenu(false); setComboText(""); setLoginError(""); setShowUserPass(true); }} />
              <DropdownItem icon={<IconSvg><rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="2" y1="10" x2="22" y2="10" /><line x1="6" y1="6" x2="6.01" y2="6" /><line x1="10" y1="6" x2="10.01" y2="6" /></IconSvg>} label={t("clipboard_cookie")} sub={t("cookie_sub")} onClick={handleOpenCookieMenu} />
              <DropdownItem icon={<IconSvg><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></IconSvg>} label={t("bulk_cookies")} sub={t("cookies_file_sub")} onClick={() => { setAddMenu(false); setBulkText(""); setBulkResults([]); setShowBulk(true); }} />
            </div>
          )}
        </div>
        <button onClick={() => setShowPlayStats(true)} className="btn btn-ghost glow-btn" style={{ padding: "7px 12px", borderRadius: 8, fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", gap: 5 }}>
          <BarChartIcon size={11} /> {t("play_stats")}
        </button>
        <button onClick={handleBulkCookieCheck} disabled={bulkChecking} className="btn btn-ghost glow-btn" style={{ padding: "7px 12px", borderRadius: 8, fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", gap: 5, opacity: bulkChecking ? 0.6 : 1 }}>
          <ShieldCheckIcon size={11} /> {bulkChecking ? t("checking") : t("check_cookies")}
        </button>
        <button onClick={() => navigate("/utilities")} className="btn btn-ghost glow-btn" style={{ padding: "7px 12px", borderRadius: 8, fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", gap: 5 }}>
          <SettingsIcon size={11} /> {t("utilities")}
        </button>
      </div>
    </div>

    {/* ── 3-COLUMN BODY ── */}
    <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

    {/* LEFT: Accounts panel */}
    <div style={{ width: 216, borderRight: "1px solid var(--glass-line)", display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--panel-bg)", flexShrink: 0 }}>
      <div style={{ padding: "10px 14px 8px", flexShrink: 0, borderBottom: "1px solid var(--glass-line-2)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
          <span style={{ fontSize: 9.5, fontWeight: 900, color: "var(--t3)", letterSpacing: "0.08em" }}>{t("accounts").toUpperCase()}</span>
          <span style={{ fontSize: 9.5, color: "var(--t3)", background: "var(--g04)", padding: "1px 8px", borderRadius: 99, fontWeight: 700, border: "1px solid var(--g05)" }}>{accounts.length}</span>
        </div>
        {/* Search */}
        <input
          value={accSearch}
          onChange={e => setAccSearch(e.target.value)}
          placeholder="Search accounts…"
          style={{
            width: "100%", height: 26, padding: "0 9px", borderRadius: 7, outline: "none",
            background: "var(--g03)", border: "1px solid var(--g06)",
            color: "var(--t1)", fontSize: 10.5, marginBottom: 6,
          }}
        />
        {/* Group tabs — primary (only when groups exist) */}
        {accGroups.length > 0 && (
          <div style={{ display: "flex", gap: 3, marginBottom: 4 }}>
            <button onClick={() => setAccGroup(null)}
              style={{
                flex: 1, padding: "3px 0", borderRadius: 5, border: "none", cursor: "pointer", fontSize: 9, fontWeight: 800,
                background: accGroup === null ? "var(--g12)" : "transparent",
                color: accGroup === null ? "var(--t1)" : "var(--t3)", transition: "all .1s",
              }}>All</button>
            {accGroups.map(g => (
              <button key={g} onClick={() => setAccGroup(accGroup === g ? null : g)}
                style={{
                  flex: 1, padding: "3px 0", borderRadius: 5, border: "none", cursor: "pointer", fontSize: 9, fontWeight: 800,
                  background: accGroup === g ? "rgba(167,139,250,0.22)" : "transparent",
                  color: accGroup === g ? "#A78BFA" : "var(--t3)", transition: "all .1s",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{g}</button>
            ))}
          </div>
        )}
        {/* Sub-filter tabs: All / Valid / Fav */}
        <div style={{ display: "flex", gap: 4 }}>
          {(["all", "valid", "favorites"] as const).map(f => (
            <button key={f} onClick={() => setAccFilter(f)}
              style={{
                flex: 1, padding: "2px 0", borderRadius: 5, border: "none", cursor: "pointer", fontSize: 9, fontWeight: 800,
                background: accFilter === f ? "var(--g12)" : "transparent",
                color: accFilter === f ? "var(--t1)" : "var(--t3)",
                transition: "all .1s",
              }}>
              {f === "all" ? "All" : f === "valid" ? "✓ Valid" : "★ Fav"}
            </button>
          ))}
        </div>
      </div>
      <div className="scroll" style={{ flex: 1 }}>
        {accounts.length === 0 ? (
          <div style={{ padding: "24px 14px", textAlign: "center", color: "var(--t3)", fontSize: 11, lineHeight: 1.7 }}>
            {t("no_accounts_added")}
          </div>
        ) : (
          groupedAccounts.map(([groupName, accs]) => (
            <div key={groupName}>
              {groupName && (
                <div style={{ padding: "8px 14px 4px", fontSize: 8.5, fontWeight: 900, color: "var(--t3)", letterSpacing: "0.1em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 14, height: 1, background: "var(--g07)" }} />
                  {groupName}
                  <div style={{ flex: 1, height: 1, background: "var(--g07)" }} />
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
                  onDoubleClick={() => {
                    setSelAccount(a.user_id);
                    localStorage.setItem("reiya_last_account", String(a.user_id));
                    setLaunchError("");
                    setTimeout(() => document.dispatchEvent(new CustomEvent("reiya-launch-shortcut")), 50);
                  }}
                  onContextMenu={(e) => handleAccountContextMenu(e, a)}
                  onToggleFav={async () => {
                    try {
                      const updated = await invoke<Account>("toggle_favorite", { userId: a.user_id });
                      setAccounts(prev => prev.map(acc => acc.user_id === a.user_id ? updated : acc));
                    } catch (err) {
                      showToast("Failed to toggle favorite: " + err, "error");
                    }
                  }} />
              ))}
            </div>
          ))
        )}
        <div onClick={e => { e.stopPropagation(); setAddMenu(v => !v); }}
          style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", cursor: "pointer", color: "var(--t3)", fontSize: 11, fontWeight: 700, transition: "color .12s" }}
          onMouseEnter={e => e.currentTarget.style.color = "var(--t2)"}
          onMouseLeave={e => e.currentTarget.style.color = "var(--t3)"}>
          <div style={{ width: 32, height: 32, borderRadius: "50%", border: "1.5px dashed var(--g10)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <PlusIcon size={13} />
          </div>
          <span>{t("add_account_compact")}</span>
        </div>
      </div>

      {/* Live Sessions — bottom of accounts panel */}
      <div style={{ flexShrink: 0, borderTop: "1px solid var(--glass-line)", padding: "10px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: sessions.length > 0 ? 8 : 0 }}>
          <span className="section-title" style={{ fontSize: 9.5 }}>
            <span className="section-dot" style={{ background: sessions.length > 0 ? "var(--green)" : "var(--t3)", animation: sessions.length > 0 ? "pulse-glow 2s ease-in-out infinite" : "none" }} />
            {t("live_sessions")}
            {sessions.length > 0 && (
              <span style={{ fontSize: 8.5, background: "var(--green-dim)", color: "var(--green)", padding: "1px 5px", borderRadius: 99, fontWeight: 800, marginLeft: 4 }}>{sessions.length}</span>
            )}
          </span>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <button
              onClick={() => invoke<Session[]>("get_live_sessions").then(setSessions).catch(() => {})}
              title="Refresh sessions"
              style={{ padding: "2px 5px", borderRadius: 4, border: "1px solid var(--g06)", background: "transparent", color: "var(--t3)", fontSize: 9, cursor: "pointer" }}>
              ↻
            </button>
          {sessions.length > 0 && (
            <button onClick={handleKillAll}
              style={{ padding: "2px 7px", borderRadius: 5, border: "1px solid rgba(248,113,113,.2)", background: "rgba(248,113,113,0.06)", color: "var(--red)", fontSize: 8.5, fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(248,113,113,0.14)")}
              onMouseLeave={e => (e.currentTarget.style.background = "rgba(248,113,113,0.06)")}>
              <PowerIcon size={8} color="var(--red)" /> {t("kill_all")}
            </button>
          )}
          </div>
        </div>
        {sessions.length === 0 ? (
          <div style={{ fontSize: 10, color: "var(--t3)", paddingTop: 4 }}>{t("no_active_sessions_lbl")}</div>
        ) : (
          <div className="scroll" style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 120, overflowY: "auto" }}>
            {sessions.map(s => <LiveSessionRow key={s.pid} session={s} onKill={() => handleKillOne(s.pid)} onShowDetail={() => setSessionDetail(s)} />)}
          </div>
        )}
      </div>
    </div>

    {/* CENTER: Launch console + scrollable content */}
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>

      {/* Launch Console */}
      <div style={{ display: "flex", height: 225, flexShrink: 0, borderBottom: "1px solid var(--glass-line)" }}>
        {/* Game Thumbnail */}
        <div style={{ width: 196, position: "relative", overflow: "hidden", flexShrink: 0, borderRight: "1px solid var(--glass-line)" }}>
          {launchThumb ? (
            <>
              <img src={launchThumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(0deg, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.1) 55%, transparent 100%)" }} />
            </>
          ) : (
            <div style={{ width: "100%", height: "100%", background: "var(--surface-2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <GamepadIcon size={30} color="var(--g08)" />
            </div>
          )}
          <div style={{ position: "absolute", bottom: 10, left: 12, right: 12 }}>
            {launchGame ? (
              <>
                <div style={{ fontSize: 12, fontWeight: 800, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{launchGame.name}</div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>{t("by")} {launchGame.creator}</div>
              </>
            ) : (
              <div style={{ fontSize: 10, color: "var(--g25)", fontWeight: 700 }}>{t("no_game_selected")}</div>
            )}
          </div>
        </div>

        {/* Controls */}
        <div style={{ flex: 1, padding: "14px 18px", display: "flex", flexDirection: "column", gap: 9, overflow: "hidden", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#FFFFFF", boxShadow: "0 0 8px rgba(255,255,255,0.5)", flexShrink: 0 }} />
            <span style={{ fontSize: 9.5, fontWeight: 900, color: "var(--t1)", letterSpacing: "0.09em" }}>{t("launch_console")}</span>
          </div>
          <div style={{ width: "100%", minWidth: 0 }}>
            <div style={{ display: "flex", gap: 5, alignItems: "center", marginBottom: 4 }}>
              <select value={launchPlaceId} onChange={e => {
                const val = e.target.value;
                setLaunchPlaceId(val);
                localStorage.setItem("reiya_last_place_id", val);
                setLaunchError("");
                const game = accountGameOptions.find(g => g.placeId === val);
                setAccessCode(game?.privateServer || "");
              }} className="field glass-input" style={{ flex: 1, height: 32, fontSize: 11, cursor: "pointer" }}>
              <option value="">{t("no_game_custom_target")}</option>
              {selAccount !== null && getAccGameHistory(selAccount).length > 0 && (
                <optgroup label={t("account_history_group")}>
                  {getAccGameHistory(selAccount).map(g => <option key={g.placeId} value={g.placeId} title={g.name}>{g.name}</option>)}
                </optgroup>
              )}
              {recentGames.filter(g => selAccount === null || !getAccGameHistory(selAccount).some(h => h.placeId === g.placeId)).length > 0 && (
                <optgroup label={t("all_recent_games_group")}>
                  {recentGames.filter(g => selAccount === null || !getAccGameHistory(selAccount).some(h => h.placeId === g.placeId)).map(g => <option key={g.placeId} value={g.placeId} title={g.name}>{g.name}</option>)}
                </optgroup>
              )}
            </select>
              {/* Clear game selection */}
              {launchPlaceId && (
                <button onClick={() => { setLaunchPlaceId(""); setAccessCode(""); localStorage.removeItem("reiya_last_place_id"); }}
                  title="Clear game selection"
                  style={{ flexShrink: 0, height: 32, width: 32, borderRadius: 7, border: "1px solid var(--g06)", background: "var(--g03)", color: "var(--t3)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>
                  ×
                </button>
              )}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, flexShrink: 0 }}>
            <div>
              <div style={{ fontSize: 8.5, color: "var(--t3)", fontWeight: 800, letterSpacing: "0.06em", marginBottom: 3 }}>{t("place_id")}</div>
              <div style={{ display: "flex", gap: 4 }}>
              <input value={launchPlaceId} onChange={e => { setLaunchPlaceId(e.target.value); localStorage.setItem("reiya_last_place_id", e.target.value); setLaunchError(""); }} placeholder="7882829745"
                className="field glass-input" style={{ flex: 1, height: 28, fontSize: 10.5, padding: "0 9px" }} />
              <button onClick={handlePastePlaceId} title="Paste from clipboard"
                style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 6, border: "1px solid var(--g06)", background: "var(--g03)", color: "var(--t3)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11 }}>
                📋
              </button>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 8.5, color: "var(--t3)", fontWeight: 800, letterSpacing: "0.06em", marginBottom: 3 }}>{t("job_id")}</div>
              <input value={jobId} onChange={e => setJobId(e.target.value)} placeholder="server UUID..."
                className="field glass-input" style={{ height: 28, fontSize: 10.5, padding: "0 9px" }} />
            </div>
            <div>
              <div style={{ fontSize: 8.5, color: "var(--t3)", fontWeight: 800, letterSpacing: "0.06em", marginBottom: 3 }}>{t("access_code")}</div>
              <input value={accessCode} onChange={e => handleAccessCodeChange(e.target.value)} placeholder={t("private_server")}
                className="field glass-input" style={{ height: 28, fontSize: 10.5, padding: "0 9px" }} />
            </div>
          </div>
          {/* Feature 8: Quick Repeat row */}
          {launchHistory.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0, flexWrap: "wrap" }}>
              <span style={{ fontSize: 8.5, color: "var(--t3)", fontWeight: 800, letterSpacing: "0.05em", flexShrink: 0 }}>REPEAT:</span>
              {launchHistory.map((h, i) => {
                const accExists = accounts.find(a => a.user_id === h.userId);
                return (
                  <button key={i} onClick={() => {
                    if (accExists) {
                      setSelAccount(h.userId);
                      localStorage.setItem("reiya_last_account", String(h.userId));
                    }
                    if (h.placeId) {
                      setLaunchPlaceId(h.placeId);
                      localStorage.setItem("reiya_last_place_id", h.placeId);
                    }
                    setTimeout(() => document.dispatchEvent(new CustomEvent("reiya-launch-shortcut")), 50);
                  }}
                  title={`@${h.username} · ${h.gameName || h.placeId}`}
                  style={{ padding: "2px 8px", borderRadius: 99, border: "1px solid var(--g08)", background: "var(--g03)", color: "var(--t2)", fontSize: 9, fontWeight: 700, cursor: "pointer", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    @{h.username} · {h.gameName || h.placeId || "App"}
                  </button>
                );
              })}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: "auto", flexShrink: 0, minWidth: 0 }}>
            {selAccount !== null && (() => {
              const acc = accounts.find(a => a.user_id === selAccount);
              if (!acc) return null;
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 3, flexShrink: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 7, background: "var(--g03)", border: "1px solid var(--g06)", maxWidth: 185, overflow: "hidden" }}>
                    {acc.avatar_url
                      ? <img src={acc.avatar_url} alt="" style={{ width: 20, height: 20, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                      : <div style={{ width: 20, height: 20, borderRadius: "50%", background: "var(--surface-3)", fontSize: 8, fontWeight: 700, color: "var(--t2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{acc.username.slice(0, 2).toUpperCase()}</div>
                    }
                    <span style={{ fontSize: 10.5, fontWeight: 750, color: "var(--t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{acc.display_name || acc.username}</span>
                    {selectedAccountIsActive && <AlertTriangleIcon size={10} color="var(--red)" />}
                    {/* Feature 4: Quick re-validate button */}
                    <button
                      onClick={e => { e.stopPropagation(); setReValidating(true); handleCheckCookie(acc.user_id).finally(() => setReValidating(false)); }}
                      title="Re-validate cookie"
                      disabled={reValidating}
                      style={{ flexShrink: 0, padding: "1px 5px", borderRadius: 4, border: "1px solid var(--g08)", background: "transparent", color: reValidating ? "var(--t3)" : "var(--t2)", fontSize: 9, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 2 }}>
                      {reValidating ? <LoaderIcon size={8} style={{ animation: "spin 1s linear infinite" }} /> : <ShieldCheckIcon size={8} />}
                    </button>
                  </div>
                  {/* Feature 7: Account notes */}
                  {acc.notes && (
                    <div style={{ display: "flex", alignItems: "center", gap: 4, maxWidth: 185, marginTop: 1 }}>
                      <span style={{ fontSize: 8, color: "var(--t3)", fontWeight: 800, letterSpacing: "0.05em", flexShrink: 0 }}>NOTE</span>
                      <div style={{ fontSize: 10, color: "var(--t2)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", background: "var(--g04)", borderRadius: 4, padding: "1px 6px", border: "1px solid var(--g07)" }}>
                        {acc.notes}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
            {launchError && <div style={{ fontSize: 10, color: "var(--red)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{launchError}</div>}
            <div style={{ display: "flex", gap: 7, marginLeft: "auto", alignItems: "center", flexShrink: 0 }}>
              <button onClick={handleLaunchApp} disabled={launching || selAccount === null || accounts.length === 0}
                className="btn btn-ghost glow-btn"
                style={{ padding: "7px 12px", borderRadius: 7, fontSize: 10.5, fontWeight: 800, display: "flex", alignItems: "center", gap: 5, opacity: selAccount === null || accounts.length === 0 ? 0.4 : 1, cursor: selAccount === null ? "not-allowed" : "pointer" }}>
                <MonitorIcon size={11} /> {t("app")}
              </button>
              <button onClick={handleLaunch} disabled={launching || selAccount === null || accounts.length === 0}
                className="btn glow-btn"
                style={{ padding: "7px 18px", borderRadius: 7, fontSize: 11.5, fontWeight: 900, letterSpacing: "0.05em", background: launching || selAccount === null ? "var(--g04)" : "linear-gradient(135deg, #FFFFFF 0%, #E0E0E0 100%)", color: launching || selAccount === null ? "var(--t3)" : "#07080a", border: launching || selAccount === null ? "1px solid var(--g06)" : "none", cursor: launching || selAccount === null ? "not-allowed" : "pointer", opacity: selAccount === null || accounts.length === 0 ? 0.4 : 1, boxShadow: launching || selAccount === null ? "none" : "0 4px 18px var(--g18)", display: "flex", alignItems: "center", gap: 6 }}
                onMouseEnter={e => { if (!launching && selAccount !== null) e.currentTarget.style.filter = "brightness(1.06)"; }}
                onMouseLeave={e => { if (!launching && selAccount !== null) e.currentTarget.style.filter = "none"; }}>
                {launching
                  ? <><LoaderIcon size={11} style={{ animation: "spin 1s linear infinite" }} /> {t("launching_suffix")}</>
                  : <><PlayIcon size={11} color="#07080a" /> {t("launch")}</>}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Scrollable: Recently Played + Session Chart */}
      <div className="scroll" style={{ flex: 1, padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Feature 9: Pinned Games section */}
      {pinnedGames.length > 0 && recentGames.filter(g => pinnedGames.includes(g.placeId)).length > 0 && (
        <div>
          <div className="section-header" style={{ marginBottom: 10 }}>
            <span className="section-title">
              <span className="section-dot" style={{ background: "#FBBF24", boxShadow: "0 0 6px rgba(251,191,36,0.4)" }} />
              Pinned Games
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 8 }}>
            {recentGames.filter(g => pinnedGames.includes(g.placeId)).slice(0, 6).map(g => {
              const isSelected = launchPlaceId === g.placeId;
              const hasPrivateServer = !!g.privateServer;
              return (
                <GameCard key={g.placeId} g={g} isSelected={isSelected} hasPrivateServer={hasPrivateServer}
                  thumb={thumbs[g.placeId]}
                  isPinned={true}
                  onTogglePin={() => togglePinGame(g.placeId)}
                  onSelect={() => handleSelectRecentGame(g.placeId)}
                  onContextMenu={(e) => handleGameContextMenu(e, g)}
                  onDelete={() => setDeleteConfirmModal({ placeId: g.placeId, name: g.name })}
                  onQuickLaunch={() => {
                    handleSelectRecentGame(g.placeId);
                    setTimeout(() => document.dispatchEvent(new CustomEvent("reiya-launch-shortcut")), 80);
                  }}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Recently Played */}
      {recentGames.length > 0 && (
        <div>
          <div className="section-header" style={{ marginBottom: 10 }}>
            <span className="section-title">
              <span className="section-dot" style={{ background: "#FCD34D", boxShadow: "0 0 6px rgba(252,211,77,0.35)" }} />
              {t("recently_played")}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <input
                value={gameSearch}
                onChange={e => setGameSearch(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    const match = gameSearch.match(/\d{6,}/);
                    if (match) {
                      const id = match[0];
                      setLaunchPlaceId(id);
                      localStorage.setItem("reiya_last_place_id", id);
                      setGameSearch("");
                      showToast(`Game set to Place ID: ${id}`, "success");
                    }
                    e.stopPropagation();
                  }
                }}
                placeholder="Place ID or URL…"
                className="field glass-input"
                style={{ width: 130, height: 22, fontSize: 9.5, padding: "0 7px" }}
              />
              <span style={{ fontSize: 10.5, color: "var(--t3)", fontWeight: 600 }}>{t("right_click_to_set_server")}</span>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 8 }}>
            {recentGames.slice(0, 12).map(g => {
              const isSelected = launchPlaceId === g.placeId;
              const hasPrivateServer = !!g.privateServer;
              return (
                <GameCard key={g.placeId} g={g} isSelected={isSelected} hasPrivateServer={hasPrivateServer}
                  thumb={thumbs[g.placeId]}
                  isPinned={pinnedGames.includes(g.placeId)}
                  onTogglePin={() => togglePinGame(g.placeId)}
                  onSelect={() => handleSelectRecentGame(g.placeId)}
                  onContextMenu={(e) => handleGameContextMenu(e, g)}
                  onDelete={() => setDeleteConfirmModal({ placeId: g.placeId, name: g.name })}
                  onQuickLaunch={() => {
                    handleSelectRecentGame(g.placeId);
                    setTimeout(() => document.dispatchEvent(new CustomEvent("reiya-launch-shortcut")), 80);
                  }}
                />
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
            {t("session_activity")}
          </span>
          <span style={{ fontSize: 10.5, color: "var(--t2)", fontWeight: 600 }}>{weekStats.sessCount} {t("sessions_plural")} · {weekStats.timeStr}</span>
        </div>
        <div style={{ height: 100 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={graphData} margin={{ top: 4, right: 4, left: -26, bottom: 0 }}>
              <defs>
                <linearGradient id="aG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-line)" stopOpacity={0.12} />
                  <stop offset="100%" stopColor="var(--chart-line)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--g03)" vertical={false} />
              <XAxis dataKey="day" tick={{ fill: "var(--t3)", fontSize: 9.5, fontWeight: 600 }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fill: "var(--t3)", fontSize: 9.5, fontWeight: 600 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: "var(--modal-bg)", border: "1px solid var(--modal-border)", borderRadius: 10, fontSize: 11 }}
                labelStyle={{ color: "var(--t2)", fontWeight: 700 }} itemStyle={{ color: "var(--t1)", fontWeight: 800 }}
                formatter={(v) => [`${v ?? 0} ${t("sessions_plural")}`, t("sessions_plural")]} />
              <Area type="monotone" dataKey="sessions" stroke="var(--chart-line)" strokeWidth={1.8}
                fill="url(#aG)" dot={{ fill: "var(--chart-line)", r: 3, strokeWidth: 0 }}
                activeDot={{ fill: "var(--chart-line)", r: 5, strokeWidth: 0 }} />
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
              {t("top_games")}
            </span>
            <span style={{ fontSize: 10, color: "var(--t3)", fontWeight: 600 }}>{t("by_total_playtime_lbl")}</span>
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
                    <div style={{ width: 28, height: 28, borderRadius: 6, background: "var(--g04)", flexShrink: 0 }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "60%" }}>{g.name}</span>
                      <span style={{ fontSize: 10, fontWeight: 800, color: "var(--t2)", flexShrink: 0 }}>{timeStr}</span>
                    </div>
                    <div style={{ height: 4, borderRadius: 99, background: "var(--g05)", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pct}%`, borderRadius: 99, background: i === 0 ? "linear-gradient(90deg, #818cf8, #a78bfa)" : "var(--g18)", transition: "width 0.6s ease" }} />
                    </div>
                    <span style={{ fontSize: 9, color: "var(--t3)", marginTop: 2, display: "block" }}>{g.sessions} {g.sessions === 1 ? t("session") : t("sessions_plural")}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      </div>{/* end center scroll */}
    </div>{/* end center column */}

    {/* RIGHT: History + Events */}
    <div style={{ width: 252, borderLeft: "1px solid var(--glass-line)", display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--panel-bg)", flexShrink: 0 }}>

      {/* Recent history — independently scrollable */}
      {recentActivity.length > 0 && (
        <div style={{ flexShrink: 0, borderBottom: "1px solid var(--glass-line-2)", padding: "12px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <div style={{ width: 3, height: 10, background: "linear-gradient(180deg, #C4B5FD 0%, rgba(196,181,253,0.15) 100%)", borderRadius: 2, flexShrink: 0 }} />
            <span style={{ fontSize: 9, fontWeight: 900, color: "var(--t3)", letterSpacing: "0.08em" }}>{t("recent_history")}</span>
          </div>
          <div className="scroll" style={{ display: "flex", flexDirection: "column", gap: 1, maxHeight: 200, overflowY: "auto" }}>
            {recentActivity.map((r, i) => <ActivityRow key={i} record={r} />)}
          </div>
        </div>
      )}

      {/* Event log — independently scrollable, fills remaining space */}
      {events.length > 0 && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", padding: "12px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexShrink: 0 }}>
            <span className="section-dot" style={{ width: 5, height: 5, background: "#818CF8", boxShadow: "0 0 5px rgba(129,140,248,0.4)" }} />
            <span style={{ fontSize: 9, fontWeight: 900, color: "var(--t3)", letterSpacing: "0.08em" }}>{t("event_log")}</span>
            <span style={{ fontSize: 8.5, color: "var(--t3)", opacity: 0.5 }}>— {events.length}</span>
          </div>
          <div className="scroll" style={{ flex: 1, display: "flex", flexDirection: "column", gap: 1, overflowY: "auto" }}>
            {events.slice(0, 80).map((ev, i) => <EventRow key={i} event={ev} />)}
          </div>
        </div>
      )}

    </div>{/* end right panel */}
    </div>{/* end 3-col body */}

      {/* ── Play Stats Modal ── */}
      {showPlayStats && (
        <HomeModal title={t("play_stats")} onClose={() => setShowPlayStats(false)} wide>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Stat Summary Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              <div style={{ background: "var(--g02)", border: "1px solid var(--g05)", borderRadius: 12, padding: "12px 16px" }}>
                <div style={{ fontSize: 9.5, color: "var(--t3)", fontWeight: 800, letterSpacing: "0.06em" }}>{t("total_playtime")}</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: "var(--t1)", marginTop: 4 }}>{playStatsData.totalPlayTime}</div>
              </div>
              <div style={{ background: "var(--g02)", border: "1px solid var(--g05)", borderRadius: 12, padding: "12px 16px" }}>
                <div style={{ fontSize: 9.5, color: "var(--t3)", fontWeight: 800, letterSpacing: "0.06em" }}>{t("total_sessions")}</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: "var(--t1)", marginTop: 4 }}>{playStatsData.totalSessions}</div>
              </div>
              <div style={{ background: "var(--g02)", border: "1px solid var(--g05)", borderRadius: 12, padding: "12px 16px" }}>
                <div style={{ fontSize: 9.5, color: "var(--t3)", fontWeight: 800, letterSpacing: "0.06em" }}>{t("top_account")}</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: "var(--t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 4 }} title={playStatsData.topAccount}>
                  {playStatsData.topAccount}
                </div>
              </div>
            </div>

            {/* Rankings Lists Container */}
            <div className="scroll" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, maxHeight: "50vh", overflowY: "auto", paddingRight: 4 }}>
              
              {/* By Account */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 850, color: "var(--t2)", letterSpacing: "0.05em", paddingBottom: 8, borderBottom: "1px solid var(--glass-line)", marginBottom: 12 }}>{t("by_account")}</div>
                {playStatsData.byAccount.length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--t3)", textAlign: "center", padding: 20 }}>{t("no_records_found")}</div>
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
                              background: x.rank === 1 ? "#FFFFFF" : x.rank === 2 ? "rgba(255,255,255,0.6)" : x.rank === 3 ? "var(--g30)" : "var(--g06)",
                              color: x.rank <= 3 ? "#000" : "var(--t2)"
                            }}>
                              {x.rank}
                            </span>
                            <span style={{ fontWeight: 750, color: "var(--t1)" }}>{x.name}</span>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <span style={{ fontWeight: 800, color: "var(--t1)" }}>{x.timeText}</span>
                            <span style={{ fontSize: 9.5, color: "var(--t3)", marginLeft: 6 }}>({x.sessionsLabel})</span>
                          </div>
                        </div>
                        {/* Progress Bar */}
                        <div style={{ height: 5, width: "100%", background: "var(--g03)", borderRadius: 99, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${x.pct}%`, background: "#FFFFFF", borderRadius: 99, opacity: x.rank === 1 ? 1 : 0.4 }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* By Game */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 850, color: "var(--t2)", letterSpacing: "0.05em", paddingBottom: 8, borderBottom: "1px solid var(--glass-line)", marginBottom: 12 }}>{t("by_game")}</div>
                {playStatsData.byGame.length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--t3)", textAlign: "center", padding: 20 }}>{t("no_records_found")}</div>
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
                              background: x.rank === 1 ? "#FFFFFF" : x.rank === 2 ? "rgba(255,255,255,0.6)" : x.rank === 3 ? "var(--g30)" : "var(--g06)",
                              color: x.rank <= 3 ? "#000" : "var(--t2)"
                            }}>
                              {x.rank}
                            </span>
                            <span style={{ fontWeight: 750, color: "var(--t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120 }} title={x.name}>
                              {x.name}
                            </span>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <span style={{ fontWeight: 800, color: "var(--t1)" }}>{x.timeText}</span>
                            <span style={{ fontSize: 9.5, color: "var(--t3)", marginLeft: 6 }}>({x.sessionsLabel})</span>
                          </div>
                        </div>
                        {/* Progress Bar */}
                        <div style={{ height: 5, width: "100%", background: "var(--g03)", borderRadius: 99, overflow: "hidden" }}>
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
        <HomeModal title={t("private_server_setup_title")} onClose={() => setPrivateServerModal(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 12, color: "var(--t2)", lineHeight: 1.4 }}>
              {t("configure_private_server_for")} <strong>"{privateServerModal.name}"</strong>:
            </div>
            <div>
              <FieldLabel>{t("private_server_link_or_access_code")}</FieldLabel>
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
              {t("private_server_format_desc")}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <button onClick={() => setPrivateServerModal(null)} className="btn btn-ghost" style={{ flex: 1 }}>
                Cancel
              </button>
              <button onClick={handleSavePrivateServer} className="btn"
                style={{ flex: 2, background: "#FFFFFF", color: "#000", fontWeight: 800 }}>
                {t("save_settings")}
              </button>
            </div>
          </div>
        </HomeModal>
      )}

      {/* Custom Delete Confirmation Modal */}
      {deleteConfirmModal && (
        <HomeModal title={t("remove_game")} onClose={() => setDeleteConfirmModal(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ fontSize: 12, color: "var(--t2)", lineHeight: 1.5 }}>
              {t("remove_game_confirm")}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setDeleteConfirmModal(null)} className="btn btn-ghost" style={{ flex: 1 }}>
                Cancel
              </button>
              <button onClick={handleConfirmDeleteGame} className="btn"
                style={{ flex: 1, background: "rgba(248, 113, 113, 0.1)", color: "var(--red)", border: "1px solid rgba(248, 113, 113, 0.25)", fontWeight: 800 }}>
                {t("remove_game")}
              </button>
            </div>
          </div>
        </HomeModal>
      )}

      {/* Group Modal */}
      {groupModal && (
        <HomeModal title={t("set_account_group_title")} onClose={() => setGroupModal(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 12, color: "var(--t2)", lineHeight: 1.4 }}>
              {t("assign_group_desc")}
            </div>
            <div>
              <FieldLabel>{t("group_name_label")}</FieldLabel>
              <input type="text" className="field glass-input" value={groupInput}
                onChange={e => setGroupInput(e.target.value)}
                onKeyDown={async e => { if (e.key === "Enter") { await invoke("set_account_group", { userId: groupModal.account.user_id, group: groupInput }); await refreshAccounts(); setGroupModal(null); } }}
                placeholder={t("group_placeholder")}
                style={{ width: "100%", height: 36, fontSize: 12, outline: "none" }} autoFocus />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {["Main", "Alts", "Trading", "Farming"].map(preset => (
                <button key={preset} onClick={() => setGroupInput(preset)} style={{ padding: "4px 12px", borderRadius: 7, border: "1px solid var(--g08)", background: groupInput === preset ? "var(--g10)" : "transparent", color: groupInput === preset ? "var(--t1)" : "var(--t3)", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>{preset}</button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              <button onClick={() => setGroupModal(null)} className="btn btn-ghost" style={{ flex: 1 }}>Cancel</button>
              <button onClick={async () => {
                await invoke("set_account_group", { userId: groupModal.account.user_id, group: groupInput });
                await refreshAccounts();
                setGroupModal(null);
              }} className="btn" style={{ flex: 2, background: "#FFFFFF", color: "#000", fontWeight: 800 }}>
                {t("save_group_btn")}
              </button>
            </div>
          </div>
        </HomeModal>
      )}

      {/* Account Context Menu */}
      {accountMenu && (() => {
        const MENU_W = 224;
        const PAD = 8;
        const spaceBelow = window.innerHeight - accountMenu.y - PAD;
        const spaceAbove = accountMenu.y - PAD;
        // Flip upward only when more space above than below and below is tight
        const flipUp = spaceAbove > spaceBelow && spaceBelow < 420;
        // maxHeight = actual available space in chosen direction, capped at 88vh
        const maxH = Math.min(
          Math.floor(window.innerHeight * 0.88),
          flipUp ? spaceAbove : spaceBelow
        );
        const topVal = flipUp
          ? Math.max(PAD, accountMenu.y - maxH)
          : accountMenu.y;
        return (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: "fixed",
            top: topVal,
            left: Math.min(accountMenu.x, window.innerWidth - MENU_W - PAD),
            zIndex: 9999,
            background: "var(--modal-bg)",
            backdropFilter: "blur(12px)",
            border: "1px solid var(--modal-border)",
            borderRadius: 12,
            padding: 4,
            minWidth: 210,
            boxShadow: "0 12px 36px rgba(0, 0, 0, 0.4)",
            maxHeight: maxH,
            overflowY: "auto"
          }}
        >
          <DropdownItem
            icon={<IconSvg><polygon points="5 3 19 12 5 21 5 3" /></IconSvg>}
            label={t("launch_game_menu")}
            sub={launchPlaceId ? `${t("join_place_menu")} ${launchPlaceId}` : t("start_game_menu")}
            onClick={async () => {
              const acc = accountMenu.account;
              setAccountMenu(null);
              if (acc.cookie_status !== "Valid") {
                showToast("Cookie is not valid. Validate the cookie first.", "error");
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
            label={t("edit_account_menu")}
            sub={t("edit_account_sub")}
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
            label={t("account_utilities_menu")}
            sub={t("account_utilities_sub")}
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
            label={t("remove_account_menu")}
            sub={t("remove_account_sub")}
            onClick={async () => {
              const acc = accountMenu.account;
              setAccountMenu(null);
              if (confirm(`${t("remove_account_confirm")}${acc.username}?`)) {
                try {
                  await invoke("remove_account", { userId: acc.user_id });
                  setAccounts(prev => prev.filter(a => a.user_id !== acc.user_id));
                  if (selAccount === acc.user_id) {
                    setSelAccount(null);
                    localStorage.removeItem("reiya_last_account");
                  }
                } catch (err) {
                  showToast("Failed to remove account: " + err, "error");
                }
              }
            }}
          />
          <div style={{ height: 1, background: "var(--g08)", margin: "2px 6px" }} />
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
            label={accountMenu.account.is_favorite ? t("unfavorite_account_menu") : t("favorite_account_menu")}
            sub={t("toggle_quick_pinning_sub")}
            onClick={async () => {
              const acc = accountMenu.account;
              setAccountMenu(null);
              try {
                const updated = await invoke<Account>("toggle_favorite", { userId: acc.user_id });
                setAccounts(prev => prev.map(a => a.user_id === acc.user_id ? updated : a));
              } catch (err) {
                showToast("Failed to toggle favorite: " + err, "error");
              }
            }}
          />
          <DropdownItem
            icon={
              <IconSvg>
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill={accountMenu.account.safe_launch_enabled ? "var(--g15)" : "none"} />
              </IconSvg>
            }
            label={t("toggle_safe_launch_menu")}
            sub={`${t("currently_prefix")}: ${accountMenu.account.safe_launch_enabled ? t("enabled") : t("disabled")}`}
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
                showToast("Failed to toggle safe launch: " + err, "error");
              }
            }}
          />
          <DropdownItem
            icon={
              <IconSvg>
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
              </IconSvg>
            }
            label={t("toggle_auto_rejoin_menu")}
            sub={`${t("currently_prefix")}: ${accountMenu.account.auto_rejoin_enabled ? t("enabled") : t("disabled")}`}
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
                showToast("Failed to toggle auto rejoin: " + err, "error");
              }
            }}
          />
          <DropdownItem
            icon={
              <IconSvg>
                <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />
              </IconSvg>
            }
            label={t("set_as_default_game_menu")}
            sub={launchPlaceId ? t("set_default_sub") : t("clear_default_sub")}
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
                showToast(`Default place ID for @${acc.username} updated to ${launchPlaceId || "none"}.`, "success");
              } catch (err) {
                showToast("Failed to update default place ID: " + err, "error");
              }
            }}
          />
          <DropdownItem
            icon={<IconSvg><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></IconSvg>}
            label={t("edit_tags_menu")}
            sub={t("focus_tags_sub")}
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
            label={t("edit_notes_menu")}
            sub={t("focus_notes_sub")}
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
            label={t("set_group_menu")}
            sub={accountMenu.account.group ? `${t("currently_group_prefix")}: ${accountMenu.account.group}` : t("no_group_assigned")}
            onClick={() => {
              const acc = accountMenu.account;
              setGroupModal({ account: acc });
              setGroupInput(acc.group || "");
              setAccountMenu(null);
            }}
          />
          <DropdownItem
            icon={<IconSvg><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" /></IconSvg>}
            label={t("export_config_menu")}
            sub={t("copy_config_sub")}
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
                showToast(t("config_copied"), "success");
              } catch (err) {
                showToast("Export failed: " + err, "error");
              }
            }}
          />
          <DropdownItem
            icon={<IconSvg><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></IconSvg>}
            label={t("import_config_menu")}
            sub={t("load_config_sub")}
            onClick={async () => {
              const acc = accountMenu.account;
              setAccountMenu(null);
              try {
                const clipText = await readText();
                if (!clipText) {
                  showToast(t("clipboard_empty"), "error");
                  return;
                }
                const parsed = JSON.parse(clipText);
                if (typeof parsed !== "object" || parsed === null) {
                  showToast(t("invalid_json_format"), "error");
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
                showToast(t("config_imported"), "success");
              } catch (err) {
                showToast("Import failed: " + err, "error");
              }
            }}
          />
          <DropdownItem
            icon={<IconSvg><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" /></IconSvg>}
            label={t("re_login_menu")}
            sub={t("re_auth_cookie_sub")}
            onClick={async () => {
              const acc = accountMenu.account;
              setAccountMenu(null);
              await handleCheckCookie(acc.user_id);
            }}
          />
          <div style={{ height: 1, background: "var(--g08)", margin: "2px 6px" }} />
          <DropdownItem
            icon={<IconSvg><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" /></IconSvg>}
            label={t("copy_cookie_menu")}
            sub={t("security_warning_sub")}
            onClick={async () => {
              const acc = accountMenu.account;
              setAccountMenu(null);
              if (confirm(t("copy_cookie_warning"))) {
                try {
                  const cookie = await invoke<string>("get_account_cookie", { userId: acc.user_id });
                  await navigator.clipboard.writeText(cookie);
                  showToast(t("cookie_copied"), "success");
                } catch (err) {
                  showToast("Failed to decrypt/copy cookie: " + err, "error");
                }
              }
            }}
          />
          <DropdownItem
            icon={<IconSvg><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" /></IconSvg>}
            label={t("copy_username_menu")}
            sub={t("copy_username_sub")}
            onClick={async () => {
              const acc = accountMenu.account;
              setAccountMenu(null);
              await navigator.clipboard.writeText(acc.username);
            }}
          />
          <DropdownItem
            icon={<IconSvg><line x1="4" y1="9" x2="20" y2="9" /><line x1="4" y1="15" x2="20" y2="15" /><line x1="10" y1="3" x2="8" y2="21" /><line x1="16" y1="3" x2="14" y2="21" /></IconSvg>}
            label={t("copy_user_id_menu")}
            sub={t("copy_user_id_sub")}
            onClick={async () => {
              const acc = accountMenu.account;
              setAccountMenu(null);
              await navigator.clipboard.writeText(String(acc.user_id));
            }}
          />
          {accountMenu.account.password && (
            <DropdownItem
              icon={<IconSvg><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></IconSvg>}
              label={t("copy_password_menu")}
              sub={t("copy_password_sub")}
              onClick={async () => {
                const acc = accountMenu.account;
                setAccountMenu(null);
                await navigator.clipboard.writeText(acc.password!);
              }}
            />
          )}
          <DropdownItem
            icon={<IconSvg><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v2z" /><line x1="12" y1="5" x2="12" y2="19" /></IconSvg>}
            label={t("get_auth_ticket_menu")}
            sub={t("generate_ticket_sub")}
            onClick={async () => {
              const acc = accountMenu.account;
              setAccountMenu(null);
              try {
                const ticket = await invoke<string>("get_auth_ticket_command", { userId: acc.user_id });
                await navigator.clipboard.writeText(ticket);
                showToast(t("auth_ticket_copied"), "success");
              } catch (err) {
                showToast("Failed to get authentication ticket: " + err, "error");
              }
            }}
          />
          <DropdownItem
            icon={<IconSvg><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></IconSvg>}
            label={t("copy_rbx_link_menu")}
            sub={t("construct_uri_sub")}
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
                showToast(t("rbx_link_copied"), "success");
              } catch (err) {
                showToast("Failed to generate launch link: " + err, "error");
              }
            }}
          />
          <DropdownItem
            icon={<IconSvg><circle cx="12" cy="12" r="3" /><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /></IconSvg>}
            label={t("dump_details_menu")}
            sub={t("display_raw_json_sub")}
            onClick={() => {
              setDumpAccount(accountMenu.account);
              setAccountMenu(null);
            }}
          />
        </div>
        );
      })()}

      {/* Edit Account Modal */}
      {editAccountModal && (
        <HomeModal title={t("edit_account_settings_title")} onClose={() => { if (!editLoading) { setEditAccountModal(null); setEditError(""); } }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 11, color: "var(--t3)", marginTop: -4 }}>
              {t("edit_details_for")} @{editAccountModal.username}
            </div>

            {/* Display Name */}
            <div>
              <FieldLabel>{t("display_name_label")}</FieldLabel>
              <input className="field glass-input" value={editDisplayName} onChange={e => setEditDisplayName(e.target.value)}
                placeholder={t("leave_empty_username_desc")} style={{ width: "100%", height: 36, fontSize: 12, outline: "none" }} disabled={editLoading} />
            </div>

            {/* Notes */}
            <div>
              <FieldLabel>{t("description_notes_label")}</FieldLabel>
              <textarea className="field glass-input" rows={3} value={editNotes} onChange={e => setEditNotes(e.target.value)}
                placeholder={t("notes_placeholder")} style={{ width: "100%", fontSize: 12, outline: "none", resize: "vertical" }} disabled={editLoading} />
            </div>

            {/* Tags */}
            <div>
              <FieldLabel>{t("tags_label")}</FieldLabel>
              <input className="field glass-input" value={editTags} onChange={e => setEditTags(e.target.value)}
                placeholder={t("tags_placeholder")} style={{ width: "100%", height: 36, fontSize: 12, outline: "none" }} disabled={editLoading} />
            </div>

            {/* Default Place ID */}
            <div>
              <FieldLabel>{t("default_place_id_label")}</FieldLabel>
              <input className="field glass-input" value={editDefaultPlaceId} onChange={e => setEditDefaultPlaceId(e.target.value)}
                placeholder={t("roblox_game_place_id_desc")} style={{ width: "100%", height: 36, fontSize: 12, outline: "none" }} disabled={editLoading} />
            </div>

            {/* Cooldown */}
            <div>
              <FieldLabel>{t("launch_cooldown_label")}</FieldLabel>
              <input type="number" className="field glass-input" value={editCooldown} onChange={e => setEditCooldown(Number(e.target.value))}
                style={{ width: "100%", height: 36, fontSize: 12, outline: "none" }} disabled={editLoading} />
            </div>

            {/* Cookie */}
            <div>
              <FieldLabel>{t("cookie_label")}</FieldLabel>
              <textarea className="field glass-input" rows={2} value={editCookie} onChange={e => setEditCookie(e.target.value)}
                placeholder={t("cookie_placeholder")} style={{ width: "100%", fontSize: 11, fontFamily: "monospace", outline: "none", resize: "vertical" }} disabled={editLoading} />
            </div>

            {/* Checkboxes */}
            <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
              <Toggle label={t("favorite")} value={editIsFavorite} onChange={setEditIsFavorite} />
              <Toggle label={t("safe_launch")} value={editSafeLaunch} onChange={setEditSafeLaunch} />
              <Toggle label={t("auto_rejoin")} value={editAutoRejoin} onChange={setEditAutoRejoin} />
            </div>

            {editError && <ErrorMsg msg={editError} />}

            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <button onClick={() => { setEditAccountModal(null); setEditError(""); }} disabled={editLoading} className="btn btn-ghost" style={{ flex: 1 }}>
                Cancel
              </button>
              <button onClick={handleSaveEditAccount} disabled={editLoading} className="btn"
                style={{ flex: 2, background: "#FFFFFF", color: "#000", fontWeight: 800 }}>
                {editLoading ? t("saving_changes") : t("save_changes_btn")}
              </button>
            </div>
          </div>
        </HomeModal>
      )}

      {/* Account Utilities Modal */}
      {utilAccount && (
        <HomeModal title={t("account_utilities_menu")} onClose={() => { if (!utilLoading) { setUtilAccount(null); setUtilStatus(""); } }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <p style={{ fontSize: 11, color: "var(--t3)", margin: 0 }}>
              {t("manage_settings_for")} @{utilAccount.username} (ID: {utilAccount.user_id})
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Set Display Name */}
              <div style={{ borderBottom: "1px solid var(--g06)", paddingBottom: 16 }}>
                <FieldLabel>{t("display_name_label")}</FieldLabel>
                <div style={{ display: "flex", gap: 8 }}>
                  <input className="field glass-input" value={utilNewDisplayName} onChange={e => setUtilNewDisplayName(e.target.value)}
                    placeholder={t("new_display_name_placeholder")} style={{ height: 34, fontSize: 12, flex: 1, outline: "none" }}
                    disabled={utilLoading} />
                  <button onClick={handleSetDisplayName} disabled={utilLoading || !utilNewDisplayName.trim()} className="btn"
                    style={{ padding: "0 14px", height: 34, fontSize: 11.5, background: "#FFFFFF", color: "#000", fontWeight: 800, borderRadius: 8, border: "none", opacity: !utilNewDisplayName.trim() ? 0.5 : 1 }}>
                    {t("set_name")}
                  </button>
                </div>
              </div>

              {/* Password */}
              <div style={{ borderBottom: "1px solid var(--g06)", paddingBottom: 16 }}>
                <FieldLabel>{t("change_password_label")}</FieldLabel>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <input type="password" className="field glass-input" value={utilCurrentPassword} onChange={e => setUtilCurrentPassword(e.target.value)}
                    placeholder={t("current_password_placeholder")} style={{ height: 34, fontSize: 12, flex: 1, outline: "none" }}
                    disabled={utilLoading} />
                  <input type="password" className="field glass-input" value={utilNewPassword} onChange={e => setUtilNewPassword(e.target.value)}
                    placeholder={t("new_password_placeholder")} style={{ height: 34, fontSize: 12, flex: 1, outline: "none" }}
                    disabled={utilLoading} />
                </div>
                <button onClick={handleChangePassword} disabled={utilLoading || !utilCurrentPassword || !utilNewPassword} className="btn"
                  style={{ padding: "0 14px", height: 34, fontSize: 11.5, background: "#FFFFFF", color: "#000", fontWeight: 800, borderRadius: 8, border: "none", opacity: (!utilCurrentPassword || !utilNewPassword) ? 0.5 : 1 }}>
                  {t("change_password_btn")}
                </button>
              </div>

              {/* Sessions */}
              <div style={{ borderBottom: "1px solid var(--g06)", paddingBottom: 16 }}>
                <FieldLabel>{t("sessions_label")}</FieldLabel>
                <button onClick={handleSignOutAll} disabled={utilLoading} className="btn"
                  style={{ padding: "0 14px", height: 34, fontSize: 11.5, background: "rgba(248,113,113,0.1)", color: "var(--red)", fontWeight: 800, borderRadius: 8, border: "1px solid rgba(248,113,113,0.25)" }}>
                  {t("sign_out_other_sessions_btn")}
                </button>
              </div>

              {/* Friend / Block */}
              <div>
                <FieldLabel>{t("friend_block_label")}</FieldLabel>
                <div style={{ display: "flex", gap: 8 }}>
                  <input className="field glass-input" value={utilTargetUser} onChange={e => setUtilTargetUser(e.target.value)}
                    placeholder={t("target_username_placeholder")} style={{ height: 34, fontSize: 12, flex: 1, outline: "none" }}
                    disabled={utilLoading} />
                  <button onClick={handleSendFriendRequest} disabled={utilLoading || !utilTargetUser.trim()} className="btn"
                    style={{ padding: "0 14px", height: 34, fontSize: 11.5, background: "#FFFFFF", color: "#000", fontWeight: 800, borderRadius: 8, border: "none", opacity: !utilTargetUser.trim() ? 0.5 : 1 }}>
                    {t("add_friend_btn")}
                  </button>
                  <button onClick={handleBlockUser} disabled={utilLoading || !utilTargetUser.trim()} className="btn"
                    style={{ padding: "0 14px", height: 34, fontSize: 11.5, background: "rgba(248,113,113,0.1)", color: "var(--red)", fontWeight: 800, borderRadius: 8, border: "1px solid rgba(248,113,113,0.25)", opacity: !utilTargetUser.trim() ? 0.5 : 1 }}>
                    {t("block_btn")}
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
        <HomeModal title={t("account_details_dump_title")} onClose={() => setDumpAccount(null)} wide>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 11, color: "var(--t3)", marginTop: -4 }}>
              {t("raw_data_properties_for")} @{dumpAccount.username}
            </div>
            <textarea
              className="field glass-input"
              rows={12}
              readOnly
              value={JSON.stringify(dumpAccount, null, 2)}
              style={{ width: "100%", fontFamily: "monospace", fontSize: 11, resize: "vertical", background: "var(--g02)", color: "var(--t2)", padding: 12, outline: "none" }}
            />
            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              <button onClick={() => setDumpAccount(null)} className="btn btn-ghost" style={{ flex: 1 }}>
                {t("close_btn")}
              </button>
              <button onClick={async () => {
                try {
                  await navigator.clipboard.writeText(JSON.stringify(dumpAccount, null, 2));
                  showToast(t("copied"), "success");
                } catch (err) {
                  showToast("Failed to copy details: " + err, "error");
                }
              }} className="btn"
                style={{ flex: 1, background: "#FFFFFF", color: "#000", fontWeight: 800 }}>
                {t("copy_to_clipboard_btn")}
              </button>
            </div>
          </div>
        </HomeModal>
      )}

      {/* Feature 10: Session Detail Popover */}
      {sessionDetail && (
        <HomeModal title="Session Details" onClose={() => setSessionDetail(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "center" }}>
            <div style={{ position: "relative" }}>
              {sessionDetail.avatar_url
                ? <img src={sessionDetail.avatar_url} alt="" style={{ width: 64, height: 64, borderRadius: "50%", objectFit: "cover" }} />
                : <div style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--surface-3)", display: "flex", alignItems: "center", justifyContent: "center" }}><GamepadIcon size={24} color="var(--t2)" /></div>
              }
              <span style={{ position: "absolute", bottom: 2, right: 2, width: 12, height: 12, borderRadius: "50%", background: "var(--green)", border: "2px solid var(--modal-bg)", animation: "pulse-glow 2s ease-in-out infinite" }} />
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 900, color: "var(--t1)" }}>{sessionDetail.username ?? "Unknown"}</div>
              <div style={{ fontSize: 11, color: "var(--t3)", marginTop: 3 }}>{sessionDetail.game_name ?? `PID ${sessionDetail.pid}`}</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, width: "100%" }}>
              <div style={{ background: "var(--g03)", borderRadius: 10, padding: "10px 14px" }}>
                <div style={{ fontSize: 9, color: "var(--t3)", fontWeight: 800, letterSpacing: "0.06em" }}>PID</div>
                <div style={{ fontSize: 15, fontWeight: 900, color: "var(--t1)", marginTop: 2 }}>{sessionDetail.pid}</div>
              </div>
              <div style={{ background: "var(--g03)", borderRadius: 10, padding: "10px 14px" }}>
                <div style={{ fontSize: 9, color: "var(--t3)", fontWeight: 800, letterSpacing: "0.06em" }}>ELAPSED</div>
                <div style={{ fontSize: 15, fontWeight: 900, color: "var(--green)", marginTop: 2 }}>
                  <SessionElapsed startTime={sessionDetail.start_time} />
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, width: "100%", marginTop: 6 }}>
              <button onClick={() => { navigator.clipboard.writeText(String(sessionDetail.pid)); showToast("PID copied!", "success"); }}
                className="btn btn-ghost" style={{ flex: 1 }}>
                Copy PID
              </button>
              <button onClick={() => setSessionDetail(null)} className="btn"
                style={{ flex: 1, background: "#FFFFFF", color: "#000", fontWeight: 800 }}>
                Close
              </button>
            </div>
          </div>
        </HomeModal>
      )}

      {/* Save Password prompt after manual login */}
      {savePasswordPrompt && (
        <HomeModal title="Save Password?" onClose={() => setSavePasswordPrompt(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontSize: 11.5, color: "var(--t2)", lineHeight: 1.5 }}>
              <span style={{ fontWeight: 800, color: "var(--t1)" }}>@{savePasswordPrompt.username}</span> was added successfully.
              <br />
              Enter the password you used so it can be copied later from the account menu.
            </div>
            <input
              type="password"
              placeholder="Password (optional)"
              value={savePasswordInput}
              onChange={e => setSavePasswordInput(e.target.value)}
              onKeyDown={async e => {
                if (e.key === "Enter" && savePasswordInput.trim()) {
                  await invoke("save_account_password", { userId: savePasswordPrompt.userId, password: savePasswordInput.trim() }).catch(() => {});
                  setAccounts(prev => prev.map(a => a.user_id === savePasswordPrompt.userId ? { ...a, password: savePasswordInput.trim() } : a));
                  setSavePasswordPrompt(null);
                  showToast("Password saved.", "success");
                }
                if (e.key === "Escape") setSavePasswordPrompt(null);
              }}
              autoFocus
              className="field glass-input"
              style={{ height: 34, fontSize: 12, padding: "0 11px" }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={async () => {
                  if (savePasswordInput.trim()) {
                    await invoke("save_account_password", { userId: savePasswordPrompt.userId, password: savePasswordInput.trim() }).catch(() => {});
                    setAccounts(prev => prev.map(a => a.user_id === savePasswordPrompt.userId ? { ...a, password: savePasswordInput.trim() } : a));
                    showToast("Password saved.", "success");
                  }
                  setSavePasswordPrompt(null);
                }}
                className="btn" style={{ flex: 1, background: "#FFFFFF", color: "#000", fontWeight: 800, fontSize: 11 }}>
                Save
              </button>
              <button onClick={() => setSavePasswordPrompt(null)}
                className="btn btn-ghost" style={{ flex: 1, fontSize: 11 }}>
                Skip
              </button>
            </div>
          </div>
        </HomeModal>
      )}

      {/* Feature 1: Toast Container */}
      <ToastContainer toasts={toasts} />
    </div>
  );
}

/* â•â• Sub-components â•â• */

/* ── GameCard: recent game card with hover quick-launch ── */
function GameCard({ g, isSelected, hasPrivateServer, thumb, onSelect, onContextMenu, onDelete, onQuickLaunch, isPinned, onTogglePin }: {
  g: RecentGame; isSelected: boolean; hasPrivateServer: boolean; thumb?: string;
  onSelect: () => void; onContextMenu: (e: React.MouseEvent) => void;
  onDelete: () => void; onQuickLaunch: () => void;
  isPinned?: boolean; onTogglePin?: () => void;
}) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      title={`${g.name}${hasPrivateServer ? "\n🔒 Private Server" : ""}\nDouble-click to quick launch`}
      onDoubleClick={onQuickLaunch}
      style={{ position: "relative", height: 70, borderRadius: 9, overflow: "hidden", cursor: "pointer", border: `1.5px solid ${isSelected ? "#FFFFFF" : hov ? "rgba(255,255,255,0.14)" : "var(--g05)"}`, boxShadow: isSelected ? "0 4px 14px var(--g10)" : "none", transition: "all .15s", transform: isSelected ? "translateY(-2px)" : "none" }}
    >
      {g.iconUrl || thumb ? (
        <img src={g.iconUrl || thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <div style={{ width: "100%", height: "100%", background: "var(--surface-3)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <GamepadIcon size={18} color="var(--g20)" />
        </div>
      )}
      {/* Delete button — zIndex:10 so it stays above hover overlay */}
      <div onClick={(e) => { e.stopPropagation(); onDelete(); }}
        style={{ position: "absolute", top: 4, left: 4, width: 16, height: 16, borderRadius: "50%", background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--g10)", zIndex: 10 }}>
        <XIcon size={8} color="var(--red)" />
      </div>
      {hasPrivateServer && (
        <div style={{ position: "absolute", top: 4, right: 4, width: 16, height: 16, borderRadius: "50%", background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--g12)", zIndex: 10 }}>
          <LockIcon size={8} color="#FFFFFF" />
        </div>
      )}
      {/* Pin button — zIndex:10 so it stays above hover overlay (zIndex:3) */}
      {onTogglePin && (
        <div onClick={e => { e.stopPropagation(); onTogglePin(); }}
          title={isPinned ? "Unpin" : "Pin game"}
          style={{ position: "absolute", top: hasPrivateServer ? 24 : 4, right: 4, width: 16, height: 16, borderRadius: "50%", background: isPinned ? "rgba(251,191,36,0.9)" : "rgba(0,0,0,0.55)", display: hov || isPinned ? "flex" : "none", alignItems: "center", justifyContent: "center", border: `1px solid ${isPinned ? "rgba(251,191,36,0.6)" : "var(--g12)"}`, zIndex: 10, cursor: "pointer" }}>
          <span style={{ fontSize: 8, lineHeight: 1 }}>📌</span>
        </div>
      )}
      {/* Quick-launch overlay on hover */}
      {hov && (
        <div onClick={e => { e.stopPropagation(); onQuickLaunch(); }}
          style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3, transition: "opacity .12s" }}>
          <div style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(255,255,255,0.92)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <PlayIcon size={11} color="#07080a" />
          </div>
        </div>
      )}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "linear-gradient(transparent, rgba(0,0,0,.9))", padding: "12px 5px 4px" }}>
        <div style={{ fontSize: 8.5, fontWeight: 800, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</div>
      </div>
    </div>
  );
}

function CompactAccountRow({ account, isActive, isSelected, checking, health, onCheck, onSelect, onDoubleClick, onContextMenu, onToggleFav }: {
  account: Account; isActive: boolean; isSelected: boolean;
  checking: boolean; health: "checking" | "valid" | "invalid" | "unknown";
  onCheck: () => void; onSelect: () => void; onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onToggleFav: () => void;
}) {
  const [hov, setHov] = useState(false);
  const { t } = useLanguage();
  const isValid   = account.cookie_status === "Valid";
  const isExpired = account.cookie_status === "Expired";

  const healthColor = health === "valid" ? "var(--green)" : health === "invalid" ? "var(--red)" : health === "checking" ? "#FBBF24" : "var(--t3)";
  const healthTitle = health === "valid" ? t("cookie_valid_tooltip") : health === "invalid" ? t("cookie_invalid_tooltip") : health === "checking" ? t("checking_tooltip") : t("not_yet_checked_tooltip");

  return (
    <div
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      onClick={onSelect} onDoubleClick={onDoubleClick} onContextMenu={onContextMenu}
      title={`@${account.username}${account.notes ? "\n" + account.notes : ""}\nDouble-click to quick launch`}
      style={{
        display: "flex", alignItems: "center", gap: 9, padding: "7px 14px",
        cursor: "pointer",
        background: isSelected ? "var(--g05)" : hov ? "var(--g02)" : "transparent",
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
            <span style={{ fontSize: 7.5, fontWeight: 800, padding: "1px 5px", borderRadius: 4, background: "var(--g04)", color: "var(--t3)", flexShrink: 0 }}>{account.group}</span>
          )}
        </div>
      </div>
      <button onClick={e => { e.stopPropagation(); onCheck(); }} disabled={checking}
        style={{ flexShrink: 0, padding: "2px 6px", borderRadius: 4, fontSize: 9, fontWeight: 700,
          border: `1px solid ${isValid ? "rgba(52,211,153,.25)" : isExpired ? "rgba(248,113,113,.25)" : "var(--g06)"}`,
          background: isValid ? "var(--green-dim)" : isExpired ? "var(--red-dim)" : "var(--g03)",
          color: isValid ? "var(--green)" : isExpired ? "var(--red)" : "var(--t3)",
          cursor: checking ? "not-allowed" : "pointer" }}>
        {checking ? "…" : isValid ? "✓" : isExpired ? "!" : "?"}
      </button>
      {/* Feature 3: Star/favorite toggle on hover */}
      {(hov || account.is_favorite) && (
        <button onClick={e => { e.stopPropagation(); onToggleFav(); }}
          title={account.is_favorite ? "Unfavorite" : "Favorite"}
          style={{ flexShrink: 0, padding: "2px 4px", borderRadius: 4, border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", color: account.is_favorite ? "#FBBF24" : "var(--t3)", transition: "color .12s" }}
          onMouseEnter={e => e.currentTarget.style.color = "#FBBF24"}
          onMouseLeave={e => e.currentTarget.style.color = account.is_favorite ? "#FBBF24" : "var(--t3)"}>
          <StarIcon size={11} color={account.is_favorite ? "#FBBF24" : "currentColor"} />
        </button>
      )}
    </div>
  );
}

function HeaderStatPill({ icon, label, value, sub, valueColor }: { icon: React.ReactNode; label: string; value: string; sub: string; valueColor?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderRadius: 8, background: "var(--g03)", border: "1px solid var(--g05)", flexShrink: 0 }}>
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

function LiveSessionRow({ session, onKill, onShowDetail }: { session: Session; onKill: () => void; onShowDetail: () => void }) {
  const { t } = useLanguage();
  const [hov, setHov] = useState(false);
  const [elapsed, setElapsed] = useState("");

  useEffect(() => {
    if (!session.start_time) return;
    const start = new Date(session.start_time).getTime();
    const tick = () => {
      const s = Math.floor((Date.now() - start) / 1000);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      setElapsed(h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec}s` : `${sec}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [session.start_time]);

  return (
    <div onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)} onClick={onShowDetail}
      style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, background: hov ? "var(--surface-2)" : "var(--surface-3)", border: "1px solid var(--border)", transition: "background .1s", cursor: "pointer" }}>
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
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {session.username ?? "Unknown"}
        </div>
        <div style={{ fontSize: 9, color: "var(--t3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {session.game_name ?? `PID ${session.pid}`}
        </div>
      </div>
      {elapsed && <span style={{ fontSize: 9, color: "var(--green)", fontWeight: 700, flexShrink: 0 }}>{elapsed}</span>}
      <button onClick={e => { e.stopPropagation(); onKill(); }} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(248,113,113,.3)", background: "var(--red-dim)", color: "var(--red)", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
        {t("kill")}
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
  const { t } = useLanguage();
  const color = EVENT_COLORS[event.kind] ?? "var(--t3)";
  const icon  = EVENT_ICONS[event.kind]  ?? <span style={{ fontSize: 10 }}>•</span>;
  const rel   = timeAgo(new Date(event.timestamp), t);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 6px", borderBottom: "1px solid var(--glass-line-2)" }}>
      <span style={{ color, display: "flex", alignItems: "center", justifyContent: "center", width: 14, flexShrink: 0 }}>{icon}</span>
      {event.avatar_url ? (
        <img src={event.avatar_url} alt="" style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
      ) : (
        <div style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--g03)", flexShrink: 0 }} />
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
  const { t } = useLanguage();
  const dur = record.duration_minutes < 60
    ? `${record.duration_minutes}m`
    : `${Math.floor(record.duration_minutes / 60)}h ${record.duration_minutes % 60}m`;
  const ts = timeAgo(new Date(record.start_time), t);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 6px", borderBottom: "1px solid var(--glass-line-2)" }}>
      {record.avatar_url ? (
        <img src={record.avatar_url} alt="" style={{ width: 26, height: 26, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
      ) : (
        <div style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--g03)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: "var(--t2)", flexShrink: 0 }}>
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
        background: value ? "#FFFFFF" : "var(--g05)",
        border: `1.5px solid ${value ? "#FFFFFF" : "var(--g15)"}`,
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
        background: hov ? "var(--g04)" : "transparent",
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

function timeAgo(date: Date, t: (key: string) => string): string {
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 60)   return t("time_ago_seconds").replace("{s}", String(sec));
  if (sec < 3600) return t("time_ago_minutes").replace("{m}", String(Math.floor(sec / 60)));
  if (sec < 86400) return t("time_ago_hours").replace("{h}", String(Math.floor(sec / 3600)));
  return t("time_ago_days").replace("{d}", String(Math.floor(sec / 86400)));
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
          background: "var(--modal-bg)",
          border: "1px solid var(--modal-border)",
          borderRadius: 20,
          padding: 24,
          width: wide ? 560 : 420,
          maxWidth: "100%",
          boxShadow: "0 24px 60px rgba(0, 0, 0, 0.5)",
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
              e.currentTarget.style.background = "var(--g05)";
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

/* ── Feature 1: Toast notification container ── */
function ToastContainer({ toasts }: { toasts: Toast[] }) {
  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 99999, display: "flex", flexDirection: "column", gap: 8, pointerEvents: "none" }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          padding: "9px 16px",
          borderRadius: 10,
          fontSize: 11.5,
          fontWeight: 700,
          color: t.type === "success" ? "#065f46" : t.type === "error" ? "#7f1d1d" : "var(--t1)",
          background: t.type === "success" ? "rgba(52,211,153,0.92)" : t.type === "error" ? "rgba(248,113,113,0.92)" : "rgba(255,255,255,0.92)",
          border: `1px solid ${t.type === "success" ? "rgba(52,211,153,0.4)" : t.type === "error" ? "rgba(248,113,113,0.4)" : "rgba(0,0,0,0.12)"}`,
          boxShadow: "0 4px 18px rgba(0,0,0,0.3)",
          backdropFilter: "blur(8px)",
          maxWidth: 320,
          animation: "fadeInSlideUp 0.2s ease",
        }}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

/* ── Feature 10: SessionElapsed helper ── */
function SessionElapsed({ startTime }: { startTime: string | null }) {
  const [elapsed, setElapsed] = useState("");
  useEffect(() => {
    if (!startTime) return;
    const start = new Date(startTime).getTime();
    const tick = () => {
      const s = Math.floor((Date.now() - start) / 1000);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      setElapsed(h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec}s` : `${sec}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startTime]);
  return <>{elapsed}</>;
}
