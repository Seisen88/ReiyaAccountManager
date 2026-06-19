import { useState, useEffect, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { CATALOG } from "../data/catalog";
import { useLanguage } from "../context/LanguageContext";
import {
  StarIcon, CheckIcon, SearchIcon, CopyIcon, TerminalIcon, ActivityIcon,
} from "../components/Icons";

/* ── Types ── */
interface Game {
  placeId: string;
  name: string;
  category: string;
  description: string;
  status: "Supported" | "Discontinued";
  scriptUrl: string;
  isFavorite: boolean;
}

const EXECUTOR_SCRIPT = `loadstring(game:HttpGet("https://api.junkie-development.de/api/v1/luascripts/public/8ac2e97282ac0718aeeb3bb3856a2821d71dc9e57553690ab508ebdb0d1569da/download"))()`;

const CAT_COLOR: Record<string, string> = {
  Anime:     "#E879F9",
  RPG:       "#60A5FA",
  Shooter:   "#F87171",
  Simulator: "#34D399",
  Strategy:  "#E8E8E8",
  Tycoon:    "#FB923C",
};

const CATEGORIES = ["All", "Anime", "RPG", "Shooter", "Simulator", "Strategy", "Tycoon"];
type StatusFilter = "All" | "Supported" | "Discontinued";

/* ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── */
export default function Hub() {
  const { t } = useLanguage();
  const [games, setGames] = useState<Game[]>(() =>
    CATALOG.map(g => ({ ...g, isFavorite: false as boolean }))
  );
  const [thumbnails,    setThumbnails]    = useState<Record<string, string>>({});
  const [thumbsLoading, setThumbsLoading] = useState(true);

  const [search,       setSearch]       = useState("");
  const [category,     setCategory]     = useState("All");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [favOnly,      setFavOnly]      = useState(false);
  const [execCopied,   setExecCopied]   = useState(false);

  useEffect(() => {
    const placeIds = CATALOG.map(g => g.placeId);
    invoke<Record<string, string>>("fetch_thumbnails", { placeIds })
      .then(map => setThumbnails(map))
      .catch(() => {})
      .finally(() => setThumbsLoading(false));
  }, []);

  const visible = useMemo(() => games.filter(g => {
    const q = search.toLowerCase();
    return (
      (!q || g.name.toLowerCase().includes(q) || g.description.toLowerCase().includes(q)) &&
      (category === "All" || g.category === category) &&
      (statusFilter === "All" || g.status === statusFilter) &&
      (!favOnly || g.isFavorite)
    );
  }), [games, search, category, statusFilter, favOnly]);

  const toggleFav = useCallback((placeId: string) =>
    setGames(prev => prev.map(g => g.placeId === placeId ? { ...g, isFavorite: !g.isFavorite } : g)),
  []);

  const copyExecutor = async () => {
    try { await writeText(EXECUTOR_SCRIPT); } catch { navigator.clipboard?.writeText(EXECUTOR_SCRIPT); }
    setExecCopied(true);
    setTimeout(() => setExecCopied(false), 2000);
  };

  const supported = CATALOG.filter(g => g.status === "Supported").length;
  const favCount  = games.filter(g => g.isFavorite).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#07080a" }}>

      {/* ── Header ── */}
      <div style={{
        padding: "18px 24px 14px",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        background: "rgba(255,255,255,0.01)",
        backdropFilter: "blur(12px)",
        flexShrink: 0,
      }}>

        {/* Title row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{
                width: 28, height: 28, borderRadius: 8,
                background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.25)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <ActivityIcon size={13} color="var(--green)" />
              </div>
              <h1 style={{ fontSize: 14, fontWeight: 900, letterSpacing: "0.06em", color: "var(--t1)", margin: 0 }}>
                SEISEN HUB
              </h1>
            </div>
            <span style={{
              fontSize: 8.5, fontWeight: 800, color: "var(--green)",
              background: "rgba(52,211,153,0.1)", padding: "2px 8px",
              borderRadius: 99, letterSpacing: "0.1em",
              border: "1px solid rgba(52,211,153,0.2)",
            }}>{t("live").toUpperCase()}</span>
          </div>

          {/* Stat pills */}
          <div style={{ display: "flex", gap: 10 }}>
            <StatPill value={String(CATALOG.length)} label={t("all")} />
            <StatPill value={String(supported)} label={t("supported")} color="var(--green)" />
            <StatPill value={String(favCount)} label={t("favorites_tab")} color="var(--amber)" />
          </div>
        </div>

        {/* Executor bar */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.05)",
          borderRadius: 12, padding: "10px 14px", marginBottom: 14,
        }}>
          <div style={{
            width: 26, height: 26, borderRadius: 7, flexShrink: 0,
            background: "rgba(232,232,232,0.12)", border: "1px solid rgba(232,232,232,0.25)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <TerminalIcon size={12} color="var(--amber)" />
          </div>
          <span style={{
            fontSize: 9, fontWeight: 800, letterSpacing: "0.1em",
            color: "var(--amber)", flexShrink: 0,
          }}>{t("executor").toUpperCase()}</span>
          <code style={{
            flex: 1, fontSize: 10, color: "var(--t3)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            fontFamily: "'Cascadia Code', 'Fira Code', monospace",
          }}>{EXECUTOR_SCRIPT}</code>
          <button
            onClick={copyExecutor}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "6px 14px", borderRadius: 8, border: "none", flexShrink: 0,
              background: execCopied ? "rgba(52,211,153,0.12)" : "rgba(255,255,255,0.04)",
              color: execCopied ? "var(--green)" : "var(--t1)",
              fontSize: 11, fontWeight: 700, cursor: "pointer",
              transition: "all .15s",
            }}
            onMouseEnter={e => { if (!execCopied) e.currentTarget.style.background = "rgba(255,255,255,0.07)"; }}
            onMouseLeave={e => { if (!execCopied) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
          >
            {execCopied
              ? <><CheckIcon size={11} color="var(--green)" /><span>{t("copied")}</span></>
              : <><CopyIcon size={11} color="var(--t2)" /><span>{t("copy")}</span></>
            }
          </button>
        </div>

        {/* Search + status filter row */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <SearchIcon size={13} color="var(--t3)" style={{
              position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", pointerEvents: "none",
            }} />
            <input
              style={{
                width: "100%", paddingLeft: 32, paddingRight: 12,
                padding: "8px 12px 8px 32px",
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.05)",
                borderRadius: 10, color: "var(--t1)", fontSize: 12, outline: "none",
                transition: "border-color .15s",
              }}
              placeholder={t("search_games")}
              value={search}
              onChange={e => setSearch(e.target.value)}
              onFocus={e => e.currentTarget.style.borderColor = "rgba(232,232,232,0.4)"}
              onBlur={e => e.currentTarget.style.borderColor = "rgba(255,255,255,0.05)"}
            />
          </div>

          {/* Favorites toggle */}
          <button
            onClick={() => setFavOnly(f => !f)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 14px", borderRadius: 10, fontSize: 11, fontWeight: 700,
              border: favOnly ? "1px solid rgba(232,232,232,0.4)" : "1px solid rgba(255,255,255,0.05)",
              background: favOnly ? "rgba(232,232,232,0.08)" : "rgba(255,255,255,0.02)",
              color: favOnly ? "var(--amber)" : "var(--t3)",
              cursor: "pointer", transition: "all .15s",
            }}
          >
            <StarIcon size={11} fill={favOnly ? "var(--amber)" : "none"} color={favOnly ? "var(--amber)" : "var(--t3)"} />
            {t("favorites_tab")}
          </button>

          {/* Status segmented control */}
          <div style={{
            display: "flex",
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.05)",
            borderRadius: 10, padding: 3,
          }}>
            {(["All", "Supported", "Discontinued"] as StatusFilter[]).map(s => {
              const active = statusFilter === s;
              const color = s === "Supported" ? "var(--green)" : s === "Discontinued" ? "var(--red)" : "var(--t1)";
              return (
                <button key={s} onClick={() => setStatusFilter(s)} style={{
                  padding: "5px 12px", borderRadius: 8,
                  background: active ? "rgba(255,255,255,0.06)" : "transparent",
                  color: active ? color : "var(--t3)",
                  border: "none", fontSize: 11, fontWeight: active ? 700 : 500,
                  cursor: "pointer", transition: "all .1s", whiteSpace: "nowrap",
                }}>
                  {s === "Supported" ? t("supported") : s === "Discontinued" ? t("discontinued") : t("all")}
                </button>
              );
            })}
          </div>
        </div>

        {/* Category pills */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {CATEGORIES.map(cat => {
            const active = category === cat;
            const color  = CAT_COLOR[cat];
            return (
              <button key={cat} onClick={() => setCategory(cat)} style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "5px 13px", borderRadius: 99,
                border: active && color ? `1px solid ${color}60` : "1px solid rgba(255,255,255,0.05)",
                background: active ? (color ? color + "18" : "rgba(255,255,255,0.06)") : "rgba(255,255,255,0.02)",
                color: active ? (color ?? "var(--t1)") : "var(--t3)",
                fontSize: 11, fontWeight: active ? 700 : 500, cursor: "pointer",
                transition: "all .12s",
              }}>
                {color && (
                  <span style={{
                    width: 5, height: 5, borderRadius: "50%",
                    background: active ? color : "var(--t3)",
                    flexShrink: 0,
                  }} />
                )}
                {cat === "All" ? t("all") : cat}
              </button>
            );
          })}
          <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--t3)", fontWeight: 600 }}>
            {visible.length} {t("games").toLowerCase()}
          </span>
        </div>
      </div>

      {/* ── Game grid ── */}
      <div style={{
        flex: 1, overflowY: "auto",
        padding: "14px 18px 20px",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(172px, 1fr))",
        gap: 12,
        alignContent: "start",
        background: "radial-gradient(circle at top right, rgba(52,211,153,0.02) 0%, transparent 60%)",
      }}>
        {visible.length === 0 ? (
          <div style={{
            gridColumn: "1 / -1", marginTop: 60,
            textAlign: "center", padding: "40px 20px",
            color: "var(--t3)", fontSize: 12.5,
            border: "1px dashed rgba(255,255,255,0.06)", borderRadius: 16,
          }}>
            {t("no_games_match_filters")}
          </div>
        ) : visible.map(game => (
          <GameCard
            key={game.placeId}
            game={game}
            thumbnail={thumbnails[game.placeId]}
            thumbLoading={thumbsLoading}
            onToggleFav={() => toggleFav(game.placeId)}
          />
        ))}
      </div>
    </div>
  );
}

/* â”€â”€ Game card â”€â”€ */
function GameCard({ game, thumbnail, thumbLoading, onToggleFav }: {
  game: Game;
  thumbnail?: string;
  thumbLoading: boolean;
  onToggleFav: () => void;
}) {
  const { t } = useLanguage();
  const [hovered, setHovered] = useState(false);
  const [copied,  setCopied]  = useState(false);
  const catColor = CAT_COLOR[game.category] ?? "#888";
  const isActive = game.status === "Supported";

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const cmd = `loadstring(game:HttpGet("${game.scriptUrl}"))()`;
    try { await writeText(cmd); } catch { navigator.clipboard?.writeText(cmd); }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        aspectRatio: "1 / 1",
        borderRadius: 14,
        overflow: "hidden",
        background: "rgba(255,255,255,0.02)",
        border: `1px solid ${hovered ? catColor + "66" : "rgba(255,255,255,0.05)"}`,
        boxShadow: hovered
          ? `0 0 0 1px ${catColor}22, 0 16px 40px rgba(0,0,0,.55)`
          : "0 2px 8px rgba(0,0,0,.25)",
        transform: hovered ? "translateY(-3px) scale(1.015)" : "none",
        transition: "all .22s cubic-bezier(0.4, 0, 0.2, 1)",
        cursor: "default",
      }}
    >
      {/* Thumbnail */}
      {thumbnail ? (
        <img
          src={thumbnail}
          alt={game.name}
          style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", display: "block" }}
        />
      ) : thumbLoading ? (
        <div className="skeleton" style={{ width: "100%", aspectRatio: "1 / 1" }} />
      ) : (
        <div style={{ width: "100%", aspectRatio: "1 / 1", background: "var(--surface-3)" }} />
      )}

      {/* Category badge */}
      <span style={{
        position: "absolute", bottom: 8, left: 8,
        fontSize: 9, fontWeight: 800, letterSpacing: "0.05em",
        padding: "3px 8px", borderRadius: 6,
        background: catColor + "CC", color: "#fff",
        backdropFilter: "blur(4px)",
        transition: "opacity .15s",
        opacity: hovered ? 0 : 1,
        pointerEvents: "none",
      }}>
        {game.category.toUpperCase()}
      </span>

      {/* Favorite button */}
      <button
        onClick={e => { e.stopPropagation(); onToggleFav(); }}
        style={{
          position: "absolute", top: 8, right: 8,
          width: 28, height: 28, borderRadius: 8, zIndex: 20,
          background: game.isFavorite ? "rgba(232,232,232,.3)" : "rgba(0,0,0,.55)",
          border: `1px solid ${game.isFavorite ? "rgba(232,232,232,.6)" : "rgba(255,255,255,.15)"}`,
          color: game.isFavorite ? "var(--amber)" : "rgba(255,255,255,.5)",
          cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          backdropFilter: "blur(6px)",
          transition: "all .12s",
        }}
      >
        <StarIcon size={14} fill={game.isFavorite ? "var(--amber)" : "none"} color={game.isFavorite ? "var(--amber)" : "rgba(255,255,255,.5)"} />
      </button>

      {/* Hover overlay */}
      <div style={{
        position: "absolute", inset: 0,
        background: `linear-gradient(to top,
          rgba(0,0,0,.97) 0%,
          rgba(0,0,0,.82) 50%,
          rgba(0,0,0,.3) 80%,
          transparent 100%)`,
        display: "flex", flexDirection: "column", justifyContent: "flex-end",
        padding: "12px",
        transform: hovered ? "translateY(0)" : "translateY(100%)",
        transition: "transform .28s cubic-bezier(0.4, 0, 0.2, 1)",
        zIndex: 10,
      }}>
        <span style={{
          alignSelf: "flex-start",
          fontSize: 9, fontWeight: 800, letterSpacing: "0.05em",
          padding: "2px 8px", borderRadius: 5, marginBottom: 6,
          background: catColor + "28", color: catColor,
          border: `1px solid ${catColor}44`,
        }}>
          {game.category.toUpperCase()}
        </span>

        <div style={{ fontSize: 13, fontWeight: 800, color: "#fff", lineHeight: 1.25, marginBottom: 5 }}>
          {game.name}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 8 }}>
          <span style={{
            width: 5, height: 5, borderRadius: "50%", flexShrink: 0,
            background: isActive ? "var(--green)" : "var(--red)",
            boxShadow: isActive ? "0 0 5px var(--green)" : "none",
          }} />
          <span style={{ fontSize: 10, fontWeight: 600, color: isActive ? "var(--green)" : "var(--red)" }}>
            {isActive ? t("supported") : t("discontinued")}
          </span>
        </div>

        <p style={{
          fontSize: 10.5, color: "rgba(255,255,255,.5)", lineHeight: 1.45,
          margin: "0 0 10px",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}>
          {game.description}
        </p>

        <button onClick={handleCopy} style={{
          width: "100%", padding: "8px 0", borderRadius: 9,
          border: `1px solid ${copied ? "rgba(52,211,153,.5)" : "rgba(255,255,255,.18)"}`,
          background: copied ? "rgba(52,211,153,.15)" : "rgba(255,255,255,.08)",
          backdropFilter: "blur(10px)",
          color: copied ? "var(--green)" : "#fff",
          fontSize: 11, fontWeight: 700, cursor: "pointer",
          transition: "all .15s",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
        }}>
          {copied ? (
            <><CheckIcon size={12} color="var(--green)" /><span>{t("copied")}</span></>
          ) : (
            <><CopyIcon size={11} color="rgba(255,255,255,0.7)" /><span>{t("copy_script")}</span></>
          )}
        </button>
      </div>
    </div>
  );
}

/* â”€â”€ Stat Pill â”€â”€ */
function StatPill({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <div style={{
      padding: "6px 16px", borderRadius: 10,
      background: "rgba(255,255,255,0.02)",
      border: "1px solid rgba(255,255,255,0.05)",
      textAlign: "center",
    }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: color ?? "var(--t1)", lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 9, color: "var(--t3)", marginTop: 3, letterSpacing: "0.06em", fontWeight: 700 }}>
        {label.toUpperCase()}
      </div>
    </div>
  );
}

