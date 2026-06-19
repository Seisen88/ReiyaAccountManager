import { useLanguage } from "../context/LanguageContext";
import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useNavigate, useLocation } from "react-router-dom";
import {
  SettingsIcon, SearchIcon, LockIcon, GamepadIcon, StarIcon, XIcon,
  TrashIcon, LoaderIcon, RefreshIcon, ServerIcon, ClockIcon, ActivityIcon,
  ChevronRightIcon,
} from "../components/Icons";

/* â”€â”€ Types â”€â”€ */
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

interface RobloxGameResult {
  name: string;
  place_id: number;
  universe_id: number;
  creator_name: string;
  icon_url: string;
}

interface RobloxServerEntry {
  job_id: string;
  playing: string;
  active_players: number;
  max_players: number;
  ping: string;
  fps: string;
}

interface FavoriteGame {
  placeId: string;
  name: string;
  creator: string;
  iconUrl: string;
  privateServer?: string;
}

/* â”€â”€ Tab definitions â”€â”€ */
const TABS = [
  { id: "servers",   label: "servers",   Icon: ServerIcon   },
  { id: "games",     label: "games",     Icon: GamepadIcon  },
  { id: "history",   label: "history",   Icon: ClockIcon    },
  { id: "favorites", label: "favorites_tab", Icon: StarIcon     },
] as const;
type TabId = typeof TABS[number]["id"];

/* â”€â”€ Ping color helper â”€â”€ */
function pingColor(ping: string): string {
  const n = parseInt(ping) || 999;
  if (n < 80)  return "var(--green)";
  if (n < 150) return "var(--amber)";
  return "var(--red)";
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
export default function Utilities() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();

  const [activeTab, setActiveTab] = useState<TabId>("servers");

  const [sessionHistory, setSessionHistory] = useState<SessionRecord[]>([]);
  const [favorites, setFavorites] = useState<FavoriteGame[]>([]);
  const [recentGames, setRecentGames] = useState<FavoriteGame[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});

  const [multiInstanceActive, setMultiInstanceActive] = useState(true);

  const [serverQuery, setServerQuery] = useState("");
  const [loadingServers, setLoadingServers] = useState(false);
  const [resolvedServerGame, setResolvedServerGame] = useState<RobloxGameResult | null>(null);
  const [servers, setServers] = useState<RobloxServerEntry[]>([]);
  const [serverError, setServerError] = useState("");

  const [gameQuery, setGameQuery] = useState("");
  const [loadingGames, setLoadingGames] = useState(false);
  const [games, setGames] = useState<RobloxGameResult[]>([]);
  const [gameError, setGameError] = useState("");

  const [selectedItem, setSelectedItem] = useState<{
    type: "server" | "game" | "history" | "favorite";
    placeId: string;
    jobId?: string;
    name?: string;
  } | null>(null);

  const [privateServerModal, setPrivateServerModal] = useState<{ placeId: string; name: string; isFavorite: boolean; currentValue: string } | null>(null);
  const [privateServerInput, setPrivateServerInput] = useState("");
  const [deleteConfirmModal, setDeleteConfirmModal] = useState<{ placeId: string; name: string } | null>(null);

  useEffect(() => {
    async function load() {
      const [hist, multiActive, recents] = await Promise.all([
        invoke<SessionRecord[]>("get_session_history").catch(() => []),
        invoke<boolean>("get_multi_instance").catch(() => true),
        invoke<FavoriteGame[]>("get_recent_games").catch(() => []),
      ]);
      setSessionHistory(hist);
      setMultiInstanceActive(multiActive);
      setRecentGames(recents);

      if (location.state && typeof location.state === "object") {
        const state = location.state as { placeId?: string; jobId?: string };
        if (state.placeId) setServerQuery(state.placeId);
      }
    }
    load();

    let unlisten: (() => void) | null = null;
    const setupListener = async () => {
      unlisten = await listen("session-status-changed", () => {
        invoke<SessionRecord[]>("get_session_history").then(setSessionHistory).catch(() => {});
        invoke<FavoriteGame[]>("get_recent_games").then(setRecentGames).catch(() => {});
      });
    };
    setupListener();

    const saved = localStorage.getItem("reiya_favorite_games");
    if (saved) {
      try { setFavorites(JSON.parse(saved)); } catch { setFavorites([]); }
    } else {
      invoke<FavoriteGame[]>("get_legacy_favorites")
        .then(legacy => {
          if (legacy?.length > 0) {
            setFavorites(legacy);
            localStorage.setItem("reiya_favorite_games", JSON.stringify(legacy));
          }
        }).catch(() => {});
    }

    return () => { if (unlisten) unlisten(); };
  }, [location.state]);

  useEffect(() => {
    const ids = new Set<string>();
    for (const r of sessionHistory) { if (r.place_id) ids.add(r.place_id); }
    for (const f of favorites) { if (f.placeId) ids.add(f.placeId); }
    for (const rg of recentGames) {
      if (rg.placeId && (!rg.iconUrl || rg.iconUrl.includes("game_cover_placeholder.png"))) ids.add(rg.placeId);
    }
    if (ids.size > 0) {
      invoke<Record<string, string>>("fetch_place_thumbnails", { placeIds: Array.from(ids) })
        .then(map => setThumbnails(prev => ({ ...prev, ...map }))).catch(() => {});
    }
  }, [sessionHistory, favorites, recentGames]);

  const handleToggleMultiInstance = async () => {
    const nextState = !multiInstanceActive;
    try {
      await invoke("set_multi_instance", { active: nextState });
      setMultiInstanceActive(nextState);
    } catch (e) { alert(`Failed to set multi-instance status: ${String(e)}`); }
  };

  const saveFavorites = (list: FavoriteGame[]) => {
    setFavorites(list);
    localStorage.setItem("reiya_favorite_games", JSON.stringify(list));
    invoke("save_favorites", { favorites: list }).catch(() => {});
  };

  const handleToggleFavorite = (g: any) => {
    const placeId = g.placeId || String(g.place_id || "");
    const name    = g.name || g.game_name || "";
    const creator = g.creator || g.creator_name || "Roblox";
    const iconUrl = g.iconUrl || g.icon_url || "";
    if (!placeId) return;
    const isFav = favorites.some(f => f.placeId === placeId);
    if (isFav) saveFavorites(favorites.filter(f => f.placeId !== placeId));
    else saveFavorites([...favorites, { placeId, name, creator, iconUrl }]);
  };

  const handleChooseAndGoHome = async () => {
    if (!selectedItem) return;
    const { placeId, jobId } = selectedItem;
    if (placeId) await invoke("add_recent_game", { placeId }).catch(() => {});
    navigate("/", { state: { placeId, jobId: jobId || "" } });
  };

  const handleGameContextMenu = (e: React.MouseEvent, g: FavoriteGame, isFavorite: boolean) => {
    e.preventDefault();
    setPrivateServerInput(g.privateServer || "");
    setPrivateServerModal({ placeId: g.placeId, name: g.name, isFavorite, currentValue: g.privateServer || "" });
  };

  const handleSavePrivateServer = async () => {
    if (!privateServerModal) return;
    const { placeId, isFavorite } = privateServerModal;
    const trimmed = privateServerInput.trim();
    const value = trimmed === "" ? null : trimmed;
    try {
      await invoke("set_private_server", { placeId, privateServer: value });
      if (isFavorite) {
        saveFavorites(favorites.map(f => f.placeId === placeId ? { ...f, privateServer: value || undefined } : f));
      } else {
        if (favorites.some(f => f.placeId === placeId)) {
          saveFavorites(favorites.map(f => f.placeId === placeId ? { ...f, privateServer: value || undefined } : f));
        }
      }
      const recents = await invoke<FavoriteGame[]>("get_recent_games").catch(() => []);
      setRecentGames(recents);
      setPrivateServerModal(null);
    } catch (err) { alert("Failed to save private server: " + err); }
  };

  const handleConfirmDeleteGame = async () => {
    if (!deleteConfirmModal) return;
    const { placeId } = deleteConfirmModal;
    try {
      await invoke("remove_recent_game", { placeId });
      const recents = await invoke<FavoriteGame[]>("get_recent_games").catch(() => []);
      setRecentGames(recents);
      if (selectedItem?.type === "game" && selectedItem?.placeId === placeId) setSelectedItem(null);
      setDeleteConfirmModal(null);
    } catch (err) { alert("Failed to remove game: " + err); }
  };

  const handleSearchGames = async () => {
    if (!gameQuery.trim()) return;
    setLoadingGames(true); setGameError(""); setGames([]); setSelectedItem(null);
    try {
      const results = await invoke<RobloxGameResult[]>("search_roblox_games", { keyword: gameQuery });
      setGames(results);
      if (results.length === 0) setGameError(t("no_accounts_match"));
    } catch (e) { setGameError(String(e)); }
    finally { setLoadingGames(false); }
  };

  const handleSearchServers = async () => {
    if (!serverQuery.trim()) return;
    setLoadingServers(true); setServerError(""); setServers([]); setResolvedServerGame(null); setSelectedItem(null);
    const isNumber = /^\d+$/.test(serverQuery.trim());
    let targetPlaceId = 0;
    try {
      if (isNumber) {
        targetPlaceId = Number(serverQuery.trim());
        const details = await invoke<RobloxGameResult>("fetch_place_details", { placeId: targetPlaceId }).catch(() => null);
        if (details) { setResolvedServerGame(details); targetPlaceId = details.place_id; setServerQuery(String(details.place_id)); }
        else { setResolvedServerGame({ name: `Place ${targetPlaceId}`, place_id: targetPlaceId, universe_id: 0, creator_name: "Unknown", icon_url: "" }); }
      } else {
        const searchResults = await invoke<RobloxGameResult[]>("search_roblox_games", { keyword: serverQuery });
        if (searchResults.length === 0) { setServerError("No game matching that name was found."); setLoadingServers(false); return; }
        const topGame = searchResults[0];
        setResolvedServerGame(topGame); targetPlaceId = topGame.place_id;
      }
      const activeServers = await invoke<RobloxServerEntry[]>("fetch_active_servers", { placeId: targetPlaceId });
      setServers(activeServers);
      if (activeServers.length === 0) setServerError(`No active public servers found for Place ID ${targetPlaceId}.`);
    } catch (e) { setServerError(String(e)); }
    finally { setLoadingServers(false); }
  };

  const quickSearchServers = (placeId: string) => {
    setActiveTab("servers"); setServerQuery(placeId); setSelectedItem(null);
    setLoadingServers(true); setServerError(""); setServers([]); setResolvedServerGame(null);
    Promise.all([
      invoke<RobloxGameResult>("fetch_place_details", { placeId: Number(placeId) }).catch(() => null),
      invoke<RobloxServerEntry[]>("fetch_active_servers", { placeId: Number(placeId) })
    ]).then(([details, activeServers]) => {
      const finalPlaceId = details ? details.place_id : Number(placeId);
      if (details) { setResolvedServerGame(details); setServerQuery(String(details.place_id)); }
      else { setResolvedServerGame({ name: `Place ${placeId}`, place_id: Number(placeId), universe_id: 0, creator_name: "Unknown", icon_url: "" }); }
      setServers(activeServers);
      if (activeServers.length === 0) setServerError(`No active public servers found for Place ID ${finalPlaceId}.`);
    }).catch(e => setServerError(String(e))).finally(() => setLoadingServers(false));
  };

  const historyGames = useMemo(() => {
    const seen = new Set<string>();
    const list: { place_id: string; game_name: string; lastPlayed: string; username: string }[] = [];
    for (const r of sessionHistory) {
      if (r.place_id && !seen.has(r.place_id)) {
        seen.add(r.place_id);
        list.push({ place_id: r.place_id, game_name: r.game_name, lastPlayed: r.start_time, username: r.username });
      }
    }
    return list;
  }, [sessionHistory]);

  const selectionStatusText = useMemo(() => {
    if (!selectedItem) return t("no_item_selected");
    if (selectedItem.type === "server") return `Server · ${selectedItem.jobId?.slice(0, 20)}...`;
    return `${selectedItem.name} · PID ${selectedItem.placeId}`;
  }, [selectedItem, t]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#07080a", overflow: "hidden" }}>

      {/* â”€â”€ HEADER â”€â”€ */}
      <div style={{
        padding: "18px 24px",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        background: "rgba(255,255,255,0.01)",
        backdropFilter: "blur(12px)",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        flexShrink: 0,
      }}>
        <div>
          <h1 style={{ fontSize: 14, fontWeight: 900, color: "var(--t1)", letterSpacing: "0.06em", margin: 0 }}>
            {t("game_browser_title")}
          </h1>
          <p style={{ fontSize: 10, fontWeight: 700, color: "var(--t3)", letterSpacing: "0.1em", marginTop: 3 }}>
            SEARCH GAMES Â· BROWSE SERVERS Â· LAUNCH CUSTOM PLACES
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Multi-Instance badge */}
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "5px 12px", borderRadius: 10,
            background: "rgba(255,255,255,0.02)",
            border: `1px solid ${multiInstanceActive ? "rgba(52,211,153,0.2)" : "rgba(248,113,113,0.2)"}`,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: "50%",
              background: multiInstanceActive ? "var(--green)" : "var(--red)",
              boxShadow: multiInstanceActive ? "0 0 5px var(--green)" : "0 0 5px var(--red)",
            }} />
            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--t2)" }}>
              {t("multi_instance_label")}: {multiInstanceActive ? t("active") : t("disabled")}
            </span>
          </div>

          <button
            onClick={handleToggleMultiInstance}
            style={{
              padding: "6px 13px", borderRadius: 9, fontSize: 11, fontWeight: 800,
              background: multiInstanceActive ? "rgba(248,113,113,0.08)" : "rgba(52,211,153,0.08)",
              color: multiInstanceActive ? "var(--red)" : "var(--green)",
              border: `1px solid ${multiInstanceActive ? "rgba(248,113,113,0.2)" : "rgba(52,211,153,0.2)"}`,
              cursor: "pointer", transition: "all .15s",
            }}
            onMouseEnter={e => e.currentTarget.style.filter = "brightness(1.15)"}
            onMouseLeave={e => e.currentTarget.style.filter = "none"}
          >
            {multiInstanceActive ? t("disable_btn") : t("enable_btn")}
          </button>

          <button
            onClick={() => navigate("/settings")}
            style={{
              background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)",
              borderRadius: 9, cursor: "pointer", color: "var(--t3)",
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 32, height: 32, transition: "all .15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.color = "var(--t1)"; e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "var(--t3)"; e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
          >
            <SettingsIcon size={14} />
          </button>
        </div>
      </div>

      {/* â”€â”€ MAIN CONTENT â”€â”€ */}
      <div className="scroll" style={{
        flex: 1, padding: "18px 22px",
        display: "flex", flexDirection: "column", gap: 14,
        overflow: "hidden", minHeight: 0,
        background: "radial-gradient(circle at top right, rgba(232,232,232,0.02) 0%, transparent 60%)",
      }}>

        {/* â”€â”€ Tab Bar â”€â”€ */}
        <div className="premium-tab-track" style={{ alignSelf: "flex-start" }}>
          {TABS.map(({ id, label, Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => { setActiveTab(id); setSelectedItem(null); }}
                className={`premium-tab ${active ? "active" : ""}`}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 16px" }}
              >
                <Icon size={12} color={active ? "var(--amber)" : "var(--t3)"} />
                <span style={{ fontSize: 11, fontWeight: 700 }}>{t(label).toUpperCase()}</span>
              </button>
            );
          })}
        </div>

        {/* â”€â”€ Tab Content â”€â”€ */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, gap: 12 }}>

          {/* SERVERS TAB */}
          {activeTab === "servers" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%", minHeight: 0 }}>
              {/* Search */}
              <div style={{
                display: "flex", gap: 8, alignItems: "center",
                background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)",
                borderRadius: 12, padding: "5px 8px 5px 14px",
              }}>
                <SearchIcon size={13} color="var(--t3)" />
                <input
                  value={serverQuery}
                  onChange={e => setServerQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleSearchServers(); }}
                  disabled={loadingServers}
                  placeholder={t("search_place_placeholder")}
                  style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--t1)", fontSize: 12, padding: "6px 4px" }}
                />
                <button
                  onClick={handleSearchServers}
                  disabled={loadingServers}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)",
                    borderRadius: 8, color: "var(--t1)", fontSize: 11, fontWeight: 700,
                    padding: "6px 14px", cursor: "pointer", transition: "all .15s",
                  }}
                >
                  {loadingServers ? <LoaderIcon size={12} style={{ animation: "spin 1s linear infinite" }} /> : <SearchIcon size={12} />}
                  {loadingServers ? t("scanning") : t("scan")}
                </button>
                <button
                  onClick={handleSearchServers}
                  disabled={loadingServers}
                  style={{
                    background: "none", border: "none", color: "var(--t2)",
                    cursor: "pointer", padding: "0 6px", display: "flex", alignItems: "center",
                  }}
                >
                  <RefreshIcon size={13} style={{ animation: loadingServers ? "spin 1s linear infinite" : "none" }} />
                </button>
              </div>

              {/* Resolved details */}
              {resolvedServerGame && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 8,
                  fontSize: 10.5, color: "var(--t2)", fontWeight: 600,
                }}>
                  <ActivityIcon size={12} color="var(--amber)" />
                  <span><span style={{ color: "var(--amber)", fontWeight: 800 }}>{servers.length}</span> {t("resolved_server_active_suffix")} {" "}
                    <span style={{ color: "var(--amber)", fontFamily: "monospace" }}>{resolvedServerGame.place_id}</span>
                    {resolvedServerGame.name !== `Place ${resolvedServerGame.place_id}` && ` (${resolvedServerGame.name})`}
                  </span>
                </div>
              )}

              {/* Server table */}
              <div className="scroll" style={{
                flex: 1, overflowY: "auto",
                background: "rgba(255,255,255,0.01)",
                border: "1px solid rgba(255,255,255,0.05)", borderRadius: 14,
              }}>
                {loadingServers ? (
                  <div style={{ padding: 50, textAlign: "center", color: "var(--t2)", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
                    <LoaderIcon size={14} style={{ animation: "spin 1s linear infinite" }} />
                    <span style={{ fontSize: 12 }}>{t("loading_active_servers")}</span>
                  </div>
                ) : serverError ? (
                  <div style={{ padding: 30, textAlign: "center", color: "var(--red)", fontSize: 12 }}>{serverError}</div>
                ) : servers.length === 0 ? (
                  <div style={{ padding: 40, textAlign: "center", color: "var(--t3)", fontSize: 12 }}>
                    {t("no_active_servers_loaded")}
                  </div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", textAlign: "left" }}>
                        {[t("job_id_guid_header"), t("players_header"), t("ping_header"), t("fps_header")].map((h, i) => (
                          <th key={h} style={{
                            padding: "10px 16px", color: "var(--t3)", fontWeight: 800, fontSize: 9.5,
                            letterSpacing: "0.1em",
                            textAlign: i > 0 ? "right" : "left",
                            width: i > 0 ? 90 : undefined,
                          }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {servers.map(srv => {
                        const isSelected = selectedItem?.type === "server" && selectedItem?.jobId === srv.job_id;
                        const pc = pingColor(srv.ping);
                        return (
                          <tr
                            key={srv.job_id}
                            onClick={() => setSelectedItem({ type: "server", placeId: String(resolvedServerGame?.place_id || ""), jobId: srv.job_id, name: resolvedServerGame?.name })}
                            style={{
                              borderBottom: "1px solid rgba(255,255,255,0.03)",
                              background: isSelected ? "rgba(232,232,232,0.05)" : "transparent",
                              cursor: "pointer", transition: "background .08s",
                            }}
                            onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "rgba(255,255,255,0.015)"; }}
                            onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
                          >
                            <td style={{ padding: "11px 16px", fontFamily: "monospace", fontSize: 10.5, color: isSelected ? "var(--amber)" : "var(--t2)", fontWeight: isSelected ? 700 : 400 }}>
                              {srv.job_id}
                            </td>
                            <td style={{ padding: "11px 16px", textAlign: "right", fontWeight: 700, color: "var(--t1)" }}>
                              {srv.playing}
                            </td>
                            <td style={{ padding: "11px 16px", textAlign: "right", fontWeight: 700, color: pc }}>
                              {srv.ping}ms
                            </td>
                            <td style={{ padding: "11px 16px", textAlign: "right", color: "var(--t2)" }}>
                              {srv.fps}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* GAMES TAB */}
          {activeTab === "games" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%", minHeight: 0 }}>
              {/* Search */}
              <div style={{
                display: "flex", gap: 8, alignItems: "center",
                background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)",
                borderRadius: 12, padding: "5px 8px 5px 14px",
              }}>
                <SearchIcon size={13} color="var(--t3)" />
                <input
                  value={gameQuery}
                  onChange={e => setGameQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleSearchGames(); }}
                  disabled={loadingGames}
                  placeholder={t("search_games_placeholder")}
                  style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--t1)", fontSize: 12, padding: "6px 4px" }}
                />
                <button
                  onClick={handleSearchGames}
                  disabled={loadingGames}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)",
                    borderRadius: 8, color: "var(--t1)", fontSize: 11, fontWeight: 700,
                    padding: "6px 14px", cursor: "pointer",
                  }}
                >
                  {loadingGames ? <LoaderIcon size={12} style={{ animation: "spin 1s linear infinite" }} /> : <SearchIcon size={12} />}
                  {loadingGames ? "Searching..." : "Search"}
                </button>
              </div>

              <div className="scroll" style={{ flex: 1, overflowY: "auto" }}>
                {loadingGames ? (
                  <div style={{ padding: 50, textAlign: "center", color: "var(--t2)", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
                    <LoaderIcon size={14} style={{ animation: "spin 1s linear infinite" }} />
                    <span style={{ fontSize: 12 }}>{t("scanning")}</span>
                  </div>
                ) : gameError ? (
                  <div style={{ padding: 30, textAlign: "center", color: "var(--red)", fontSize: 12 }}>{gameError}</div>
                ) : (games.length === 0 && !gameQuery.trim() && recentGames.length > 0) ? (
                  <div>
                    <SectionLabel label="RECENTLY PLAYED" count={recentGames.length} />
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10, padding: "8px 0" }}>
                      {recentGames.map(g => {
                        const isSelected = selectedItem?.type === "game" && selectedItem?.placeId === g.placeId;
                        const isFav = favorites.some(f => f.placeId === g.placeId);
                        const hasPrivateServer = !!g.privateServer;
                        const thumb = (g.iconUrl && !g.iconUrl.includes("game_cover_placeholder.png")) ? g.iconUrl : thumbnails[g.placeId];
                        return (
                          <GameCard
                            key={g.placeId}
                            isSelected={isSelected}
                            isFav={isFav}
                            hasPrivateServer={hasPrivateServer}
                            thumb={thumb}
                            name={g.name}
                            creator={g.creator}
                            placeId={g.placeId}
                            onSelect={() => setSelectedItem({ type: "game", placeId: g.placeId, name: g.name })}
                            onContextMenu={e => handleGameContextMenu(e, g, false)}
                            onSearchServers={() => quickSearchServers(g.placeId)}
                            onToggleFav={() => handleToggleFavorite(g)}
                            onDelete={() => setDeleteConfirmModal({ placeId: g.placeId, name: g.name })}
                          />
                        );
                      })}
                    </div>
                  </div>
                ) : games.length === 0 ? (
                  <div style={{ padding: 40, textAlign: "center", color: "var(--t3)", fontSize: 12 }}>
                    {t("type_keyword_to_search")}
                  </div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10, padding: "4px 0" }}>
                    {games.map(g => {
                      const isSelected = selectedItem?.type === "game" && selectedItem?.placeId === String(g.place_id);
                      const isFav = favorites.some(f => f.placeId === String(g.place_id));
                      return (
                        <GameCard
                          key={g.place_id}
                          isSelected={isSelected}
                          isFav={isFav}
                          hasPrivateServer={false}
                          thumb={g.icon_url}
                          name={g.name}
                          creator={g.creator_name}
                          placeId={String(g.place_id)}
                          onSelect={() => setSelectedItem({ type: "game", placeId: String(g.place_id), name: g.name })}
                          onContextMenu={() => {}}
                          onSearchServers={() => quickSearchServers(String(g.place_id))}
                          onToggleFav={() => handleToggleFavorite(g)}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* HISTORY TAB */}
          {activeTab === "history" && (
            <div className="scroll" style={{ flex: 1, overflowY: "auto" }}>
              {historyGames.length === 0 ? (
                <div style={{ padding: 40, textAlign: "center", color: "var(--t3)", fontSize: 12 }}>{t("no_recent_games")}</div>
              ) : (
                <>
                  <SectionLabel label={t("recent_history").toUpperCase()} count={historyGames.length} />
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10, padding: "8px 0" }}>
                    {historyGames.map(g => {
                      const isSelected = selectedItem?.type === "history" && selectedItem?.placeId === g.place_id;
                      const isFav = favorites.some(f => f.placeId === g.place_id);
                      return (
                        <GameCard
                          key={g.place_id}
                          isSelected={isSelected}
                          isFav={isFav}
                          hasPrivateServer={false}
                          thumb={thumbnails[g.place_id]}
                          name={g.game_name}
                          creator={`@${g.username}`}
                          placeId={g.place_id}
                          subLabel={new Date(g.lastPlayed).toLocaleDateString()}
                          onSelect={() => setSelectedItem({ type: "history", placeId: g.place_id, name: g.game_name })}
                          onContextMenu={() => {}}
                          onSearchServers={() => quickSearchServers(g.place_id)}
                          onToggleFav={() => handleToggleFavorite({ placeId: g.place_id, name: g.game_name, creator: "Roblox", iconUrl: "" })}
                        />
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* FAVORITES TAB */}
          {activeTab === "favorites" && (
            <div className="scroll" style={{ flex: 1, overflowY: "auto" }}>
              {favorites.length === 0 ? (
                <div style={{ padding: 40, textAlign: "center", color: "var(--t3)", fontSize: 12 }}>
                  {t("no_favorites_desc")}
                </div>
              ) : (
                <>
                  <SectionLabel label={t("starred_favorites_title")} count={favorites.length} />
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10, padding: "8px 0" }}>
                    {favorites.map(g => {
                      const isSelected = selectedItem?.type === "favorite" && selectedItem?.placeId === g.placeId;
                      const hasPrivateServer = !!g.privateServer;
                      return (
                        <GameCard
                          key={g.placeId}
                          isSelected={isSelected}
                          isFav
                          hasPrivateServer={hasPrivateServer}
                          thumb={g.iconUrl || thumbnails[g.placeId]}
                          name={g.name}
                          creator={g.creator}
                          placeId={g.placeId}
                          onSelect={() => setSelectedItem({ type: "favorite", placeId: g.placeId, name: g.name })}
                          onContextMenu={e => handleGameContextMenu(e, g, true)}
                          onSearchServers={() => quickSearchServers(g.placeId)}
                          onRemoveFav={() => { saveFavorites(favorites.filter(f => f.placeId !== g.placeId)); if (isSelected) setSelectedItem(null); }}
                        />
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

        </div>
      </div>

      {/* â”€â”€ FOOTER â”€â”€ */}
      <div style={{
        padding: "12px 22px",
        borderTop: "1px solid rgba(255,255,255,0.04)",
        background: "rgba(255,255,255,0.005)",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
            background: selectedItem ? "var(--amber)" : "var(--t3)",
            boxShadow: selectedItem ? "0 0 5px var(--amber)" : "none",
          }} />
          <div>
            <div style={{ fontSize: 9, color: "var(--t3)", fontWeight: 800, letterSpacing: "0.1em" }}>SELECTION</div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: selectedItem ? "var(--t1)" : "var(--t3)", marginTop: 2 }}>
              {selectionStatusText}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={() => navigate("/")}
            style={{
              padding: "9px 20px", borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.06)",
              background: "rgba(255,255,255,0.02)", color: "var(--t2)",
              fontSize: 11.5, fontWeight: 700, cursor: "pointer", transition: "all .15s",
            }}
            onMouseEnter={e => e.currentTarget.style.color = "var(--t1)"}
            onMouseLeave={e => e.currentTarget.style.color = "var(--t2)"}
          >
            {t("cancel")}
          </button>
          <button
            onClick={handleChooseAndGoHome}
            disabled={!selectedItem}
            style={{
              display: "flex", alignItems: "center", gap: 7,
              padding: "9px 20px", borderRadius: 10, border: "none",
              background: selectedItem
                ? "rgba(232,232,232,0.92)"
                : "rgba(255,255,255,0.04)",
              color: selectedItem ? "#0a0a0a" : "var(--t3)",
              fontSize: 11.5, fontWeight: 800,
              cursor: selectedItem ? "pointer" : "not-allowed",
              opacity: selectedItem ? 1 : 0.5,
              boxShadow: selectedItem ? "0 4px 14px rgba(232,232,232,0.25)" : "none",
              transition: "all .12s",
            }}
            onMouseEnter={e => { if (selectedItem) e.currentTarget.style.filter = "brightness(1.08)"; }}
            onMouseLeave={e => { if (selectedItem) e.currentTarget.style.filter = "none"; }}
          >
            <ChevronRightIcon size={13} color={selectedItem ? "#0a0a0a" : "var(--t3)"} />
            {t("use_selected_btn")}
          </button>
        </div>
      </div>

      {/* â”€â”€ PRIVATE SERVER MODAL â”€â”€ */}
      {privateServerModal && (
        <Modal onClose={() => setPrivateServerModal(null)}>
          <div style={{ fontSize: 14, fontWeight: 900, color: "var(--t1)", marginBottom: 6 }}>{t("private_server_setup_title")}</div>
          <div style={{ fontSize: 11, color: "var(--t2)", marginBottom: 16, lineHeight: 1.5 }}>
            {t("configure_private_server_for")} <span style={{ color: "var(--amber)", fontWeight: 700 }}>"{privateServerModal.name}"</span>
          </div>
          <label style={{ fontSize: 9.5, color: "var(--t3)", fontWeight: 800, letterSpacing: "0.1em", display: "block", marginBottom: 8 }}>
            {t("private_server_link_or_access_code")}
          </label>
          <input
            type="text"
            className="field glass-input"
            value={privateServerInput}
            onChange={e => setPrivateServerInput(e.target.value)}
            placeholder="https://www.roblox.com/share?code=...&type=Server"
            style={{ width: "100%", padding: "9px 12px", marginBottom: 8 }}
          />
          <div style={{ fontSize: 9.5, color: "var(--t3)", lineHeight: 1.5, marginBottom: 20 }}>
            {t("private_server_clear_desc")}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <ModalBtn label={t("cancel")} onClick={() => setPrivateServerModal(null)} />
            <ModalBtn label={t("save_settings")} onClick={handleSavePrivateServer} primary />
          </div>
        </Modal>
      )}

      {/* â”€â”€ DELETE CONFIRM MODAL â”€â”€ */}
      {deleteConfirmModal && (
        <Modal onClose={() => setDeleteConfirmModal(null)}>
          <div style={{ fontSize: 14, fontWeight: 900, color: "var(--red)", marginBottom: 10 }}>{t("remove_game")}</div>
          <div style={{ fontSize: 12, color: "var(--t1)", lineHeight: 1.6, marginBottom: 22 }}>
            {t("remove_game_confirm_desc")}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <ModalBtn label={t("cancel")} onClick={() => setDeleteConfirmModal(null)} />
            <ModalBtn label={t("remove_game").split(" ")[0]} onClick={handleConfirmDeleteGame} danger />
          </div>
        </Modal>
      )}
    </div>
  );
}

/* â”€â”€ Game Card â”€â”€ */
function GameCard({
  isSelected, isFav, hasPrivateServer, thumb, name, creator, placeId, subLabel,
  onSelect, onContextMenu, onSearchServers, onToggleFav, onDelete, onRemoveFav,
}: {
  isSelected: boolean; isFav: boolean; hasPrivateServer: boolean;
  thumb?: string; name: string; creator: string; placeId: string; subLabel?: string;
  onSelect: () => void; onContextMenu: (e: React.MouseEvent) => void;
  onSearchServers: () => void; onToggleFav?: () => void; onDelete?: () => void; onRemoveFav?: () => void;
}) {
  const { t } = useLanguage();
  return (
    <div
      onClick={onSelect}
      onContextMenu={onContextMenu}
      style={{
        display: "flex", gap: 12, padding: "12px 14px",
        background: isSelected ? "rgba(232,232,232,0.04)" : "rgba(255,255,255,0.02)",
        border: `1px solid ${isSelected ? "rgba(232,232,232,0.4)" : "rgba(255,255,255,0.05)"}`,
        borderRadius: 14, alignItems: "center", cursor: "pointer",
        transition: "all .12s", boxShadow: isSelected ? "0 0 14px rgba(232,232,232,0.06)" : "none",
      }}
      onMouseEnter={e => { if (!isSelected) { e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.background = "rgba(255,255,255,0.03)"; } }}
      onMouseLeave={e => { if (!isSelected) { e.currentTarget.style.borderColor = "rgba(255,255,255,0.05)"; e.currentTarget.style.background = "rgba(255,255,255,0.02)"; } }}
    >
      {/* Thumbnail */}
      {thumb ? (
        <img src={thumb} alt="" style={{ width: 46, height: 46, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
      ) : (
        <div style={{
          width: 46, height: 46, borderRadius: 10, flexShrink: 0,
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <GamepadIcon size={18} color="var(--t3)" />
        </div>
      )}

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12, fontWeight: 800, color: "var(--t1)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          display: "flex", alignItems: "center", gap: 5, marginBottom: 3,
        }}>
          {name}
          {hasPrivateServer && <LockIcon size={10} color="var(--amber)" />}
        </div>
        <div style={{ fontSize: 10, color: "var(--t2)" }}>{creator}</div>
        <div style={{ fontSize: 9.5, color: "var(--amber)", marginTop: 2, fontFamily: "monospace", fontWeight: 700 }}>
          {subLabel ? `${subLabel} Â· PID ${placeId}` : `PID ${placeId}`}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
        <IconBtn title={t("browse_servers_tooltip")} onClick={e => { e.stopPropagation(); onSearchServers(); }} hoverColor="var(--amber)">
          <SearchIcon size={12} />
        </IconBtn>
        {onToggleFav && (
          <IconBtn title={isFav ? t("unfavorite") : t("favorite")} onClick={e => { e.stopPropagation(); onToggleFav(); }} hoverColor="var(--amber)">
            <StarIcon size={12} fill={isFav ? "var(--amber)" : "none"} color={isFav ? "var(--amber)" : "var(--t3)"} />
          </IconBtn>
        )}
        {onDelete && (
          <IconBtn title={t("remove_game").split(" ")[0]} onClick={e => { e.stopPropagation(); onDelete(); }} hoverColor="var(--red)">
            <TrashIcon size={12} />
          </IconBtn>
        )}
        {onRemoveFav && (
          <IconBtn title={t("remove_favorite_tooltip")} onClick={e => { e.stopPropagation(); onRemoveFav(); }} hoverColor="var(--red)">
            <XIcon size={12} />
          </IconBtn>
        )}
      </div>
    </div>
  );
}

/* â”€â”€ Icon Button â”€â”€ */
function IconBtn({ children, title, onClick, hoverColor }: {
  children: React.ReactNode; title: string; onClick: (e: React.MouseEvent) => void; hoverColor?: string;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        background: "none", border: "none", cursor: "pointer",
        color: "var(--t3)", padding: 5, borderRadius: 6,
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "all .12s",
      }}
      onMouseEnter={e => { e.currentTarget.style.color = hoverColor ?? "var(--t1)"; e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
      onMouseLeave={e => { e.currentTarget.style.color = "var(--t3)"; e.currentTarget.style.background = "none"; }}
    >
      {children}
    </button>
  );
}

/* â”€â”€ Section Label â”€â”€ */
function SectionLabel({ label, count }: { label: string; count: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
      <span style={{ fontSize: 9.5, fontWeight: 800, color: "var(--t3)", letterSpacing: "0.12em" }}>{label}</span>
      <span style={{
        fontSize: 9, fontWeight: 800, color: "var(--amber)",
        background: "rgba(232,232,232,0.08)", border: "1px solid rgba(232,232,232,0.15)",
        padding: "1px 7px", borderRadius: 99,
      }}>{count}</span>
    </div>
  );
}

/* â”€â”€ Modal wrapper â”€â”€ */
function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(10px)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "linear-gradient(135deg, rgba(19,20,27,0.98) 0%, rgba(13,14,20,0.99) 100%)",
        border: "1px solid rgba(255,255,255,0.08)", borderRadius: 18,
        padding: 26, width: 440, maxWidth: "92vw",
        boxShadow: "0 24px 60px rgba(0,0,0,0.7)",
      }}>
        {children}
      </div>
    </div>
  );
}

function ModalBtn({ label, onClick, primary, danger }: { label: string; onClick: () => void; primary?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, padding: "10px 0", borderRadius: 10, fontSize: 12, fontWeight: 800,
        cursor: "pointer", transition: "all .12s",
        border: primary ? "none" : danger ? "1px solid rgba(248,113,113,0.3)" : "1px solid rgba(255,255,255,0.07)",
        background: primary
          ? "rgba(232,232,232,0.92)"
          : danger ? "rgba(248,113,113,0.1)" : "rgba(255,255,255,0.03)",
        color: primary ? "#0a0a0a" : danger ? "var(--red)" : "var(--t2)",
        boxShadow: primary ? "0 4px 14px rgba(232,232,232,0.25)" : "none",
      }}
      onMouseEnter={e => { e.currentTarget.style.filter = "brightness(1.1)"; }}
      onMouseLeave={e => { e.currentTarget.style.filter = "none"; }}
    >
      {label}
    </button>
  );
}

