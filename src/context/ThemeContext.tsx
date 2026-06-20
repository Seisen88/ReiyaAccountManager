import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export interface ThemeVars {
  "--bg": string;
  "--surface": string;
  "--surface-2": string;
  "--surface-3": string;
  "--accent": string;
  "--accent-text": string;
  "--t1": string;
  "--t2": string;
  "--t3": string;
  "--green": string;
  "--amber": string;
  "--red": string;
  "--border": string;
}

export interface Theme {
  id: string;
  name: string;
  description: string;
  category: "dark" | "light";
  previewBg: string;
  previewAccent: string;
  vars: ThemeVars;
}

export const THEMES: Theme[] = [
  {
    id: "reiya-dark",
    name: "Reiya Dark",
    category: "dark",
    description: "The classic look",
    previewBg: "#07080a",
    previewAccent: "#E8E8E8",
    vars: {
      "--bg": "#07080a",
      "--surface": "#0e0f13",
      "--surface-2": "#141519",
      "--surface-3": "#1a1b22",
      "--accent": "#E8E8E8",
      "--accent-text": "#0a0a0a",
      "--t1": "#F0F1F6",
      "--t2": "#8B8FA8",
      "--t3": "#4B4E64",
      "--green": "#34D399",
      "--amber": "#FBBF24",
      "--red": "#F87171",
      "--border": "rgba(255,255,255,0.06)",
    },
  },
  {
    id: "midnight",
    name: "Midnight",
    category: "dark",
    description: "Deep indigo glow",
    previewBg: "#07080d",
    previewAccent: "#818CF8",
    vars: {
      "--bg": "#07080d",
      "--surface": "#0c0d16",
      "--surface-2": "#10121e",
      "--surface-3": "#151726",
      "--accent": "#818CF8",
      "--accent-text": "#ffffff",
      "--t1": "#E8EAF6",
      "--t2": "#7B83C0",
      "--t3": "#474D8A",
      "--green": "#34D399",
      "--amber": "#FBBF24",
      "--red": "#F87171",
      "--border": "rgba(129,140,248,0.08)",
    },
  },
  {
    id: "purple",
    name: "Purple",
    category: "dark",
    description: "Rich violet dark",
    previewBg: "#09060f",
    previewAccent: "#A78BFA",
    vars: {
      "--bg": "#09060f",
      "--surface": "#120b1e",
      "--surface-2": "#19102a",
      "--surface-3": "#201536",
      "--accent": "#A78BFA",
      "--accent-text": "#ffffff",
      "--t1": "#EDE9FF",
      "--t2": "#9585C0",
      "--t3": "#5B4D8A",
      "--green": "#34D399",
      "--amber": "#FBBF24",
      "--red": "#F87171",
      "--border": "rgba(167,139,250,0.08)",
    },
  },
  {
    id: "forest",
    name: "Forest",
    category: "dark",
    description: "Dark emerald tones",
    previewBg: "#060c08",
    previewAccent: "#34D399",
    vars: {
      "--bg": "#060c08",
      "--surface": "#0a1310",
      "--surface-2": "#0f1b16",
      "--surface-3": "#14231c",
      "--accent": "#34D399",
      "--accent-text": "#041a0a",
      "--t1": "#E8F5EE",
      "--t2": "#6FA385",
      "--t3": "#3D6B52",
      "--green": "#34D399",
      "--amber": "#FBBF24",
      "--red": "#F87171",
      "--border": "rgba(52,211,153,0.08)",
    },
  },
  {
    id: "ocean",
    name: "Ocean",
    category: "dark",
    description: "Cyan deep-sea vibes",
    previewBg: "#04090c",
    previewAccent: "#38BDF8",
    vars: {
      "--bg": "#04090c",
      "--surface": "#080f14",
      "--surface-2": "#0d171e",
      "--surface-3": "#121f28",
      "--accent": "#38BDF8",
      "--accent-text": "#040c10",
      "--t1": "#E8F6FD",
      "--t2": "#6BA0BA",
      "--t3": "#3D6A82",
      "--green": "#34D399",
      "--amber": "#FBBF24",
      "--red": "#F87171",
      "--border": "rgba(56,189,248,0.08)",
    },
  },
  {
    id: "crimson",
    name: "Crimson",
    category: "dark",
    description: "Dark red intensity",
    previewBg: "#0a0507",
    previewAccent: "#F87171",
    vars: {
      "--bg": "#0a0507",
      "--surface": "#130809",
      "--surface-2": "#1c0d10",
      "--surface-3": "#231217",
      "--accent": "#F87171",
      "--accent-text": "#ffffff",
      "--t1": "#FBE8EB",
      "--t2": "#B57480",
      "--t3": "#7A4050",
      "--green": "#34D399",
      "--amber": "#FBBF24",
      "--red": "#F87171",
      "--border": "rgba(248,113,113,0.08)",
    },
  },
  {
    id: "sunset",
    name: "Sunset",
    category: "dark",
    description: "Warm amber warmth",
    previewBg: "#0d0800",
    previewAccent: "#FB923C",
    vars: {
      "--bg": "#0d0800",
      "--surface": "#160e00",
      "--surface-2": "#1e1500",
      "--surface-3": "#261c00",
      "--accent": "#FB923C",
      "--accent-text": "#140800",
      "--t1": "#FFF3E8",
      "--t2": "#BF8E67",
      "--t3": "#7A5832",
      "--green": "#34D399",
      "--amber": "#FBBF24",
      "--red": "#F87171",
      "--border": "rgba(251,146,60,0.08)",
    },
  },
  {
    id: "sakura",
    name: "Sakura",
    category: "dark",
    description: "Soft pink blossom",
    previewBg: "#0e070e",
    previewAccent: "#F472B6",
    vars: {
      "--bg": "#0e070e",
      "--surface": "#180b18",
      "--surface-2": "#221022",
      "--surface-3": "#2c152c",
      "--accent": "#F472B6",
      "--accent-text": "#ffffff",
      "--t1": "#FDE8F5",
      "--t2": "#B87AA6",
      "--t3": "#784268",
      "--green": "#34D399",
      "--amber": "#FBBF24",
      "--red": "#F87171",
      "--border": "rgba(244,114,182,0.08)",
    },
  },
  {
    id: "cyberpunk",
    name: "Cyberpunk",
    category: "dark",
    description: "Neon yellow on void",
    previewBg: "#060608",
    previewAccent: "#FAFF00",
    vars: {
      "--bg": "#060608",
      "--surface": "#0c0c10",
      "--surface-2": "#111116",
      "--surface-3": "#16161d",
      "--accent": "#FAFF00",
      "--accent-text": "#060608",
      "--t1": "#F8FFCC",
      "--t2": "#9EA840",
      "--t3": "#585A20",
      "--green": "#39FF14",
      "--amber": "#FF6B35",
      "--red": "#FF2D55",
      "--border": "rgba(250,255,0,0.07)",
    },
  },
  {
    id: "void",
    name: "Void",
    category: "dark",
    description: "Pure black, zero distraction",
    previewBg: "#000000",
    previewAccent: "#FFFFFF",
    vars: {
      "--bg": "#000000",
      "--surface": "#080808",
      "--surface-2": "#101010",
      "--surface-3": "#181818",
      "--accent": "#FFFFFF",
      "--accent-text": "#000000",
      "--t1": "#FFFFFF",
      "--t2": "#707070",
      "--t3": "#383838",
      "--green": "#34D399",
      "--amber": "#FBBF24",
      "--red": "#F87171",
      "--border": "rgba(255,255,255,0.05)",
    },
  },
  {
    id: "arctic",
    name: "Arctic",
    category: "dark",
    description: "Icy blue-white frost",
    previewBg: "#030a10",
    previewAccent: "#BAE6FD",
    vars: {
      "--bg": "#030a10",
      "--surface": "#060f18",
      "--surface-2": "#0b1722",
      "--surface-3": "#10202e",
      "--accent": "#BAE6FD",
      "--accent-text": "#020a12",
      "--t1": "#E8F4FD",
      "--t2": "#7AAAC8",
      "--t3": "#3D6A82",
      "--green": "#34D399",
      "--amber": "#FBBF24",
      "--red": "#F87171",
      "--border": "rgba(186,230,253,0.07)",
    },
  },
  {
    id: "ember",
    name: "Ember",
    category: "dark",
    description: "Deep orange-red heat",
    previewBg: "#0c0500",
    previewAccent: "#FF6B35",
    vars: {
      "--bg": "#0c0500",
      "--surface": "#180900",
      "--surface-2": "#210d00",
      "--surface-3": "#2c1200",
      "--accent": "#FF6B35",
      "--accent-text": "#0c0500",
      "--t1": "#FFE8D6",
      "--t2": "#C07050",
      "--t3": "#7A3D20",
      "--green": "#34D399",
      "--amber": "#FBBF24",
      "--red": "#FF4444",
      "--border": "rgba(255,107,53,0.08)",
    },
  },
  {
    id: "jade",
    name: "Jade",
    category: "dark",
    description: "Rich dark jade stone",
    previewBg: "#040c08",
    previewAccent: "#6EE7B7",
    vars: {
      "--bg": "#040c08",
      "--surface": "#071410",
      "--surface-2": "#0c1e18",
      "--surface-3": "#112820",
      "--accent": "#6EE7B7",
      "--accent-text": "#020c06",
      "--t1": "#D1FAE5",
      "--t2": "#5BA889",
      "--t3": "#2E6B52",
      "--green": "#6EE7B7",
      "--amber": "#FBBF24",
      "--red": "#F87171",
      "--border": "rgba(110,231,183,0.07)",
    },
  },
  {
    id: "rose-gold",
    name: "Rose Gold",
    category: "dark",
    description: "Warm metallic luxury",
    previewBg: "#0d0608",
    previewAccent: "#F4A261",
    vars: {
      "--bg": "#0d0608",
      "--surface": "#180a0e",
      "--surface-2": "#220e14",
      "--surface-3": "#2c121a",
      "--accent": "#F4A261",
      "--accent-text": "#0d0608",
      "--t1": "#FFF0E8",
      "--t2": "#C48A6A",
      "--t3": "#7A4A38",
      "--green": "#34D399",
      "--amber": "#FBBF24",
      "--red": "#F87171",
      "--border": "rgba(244,162,97,0.08)",
    },
  },
  {
    id: "slate",
    name: "Slate",
    category: "dark",
    description: "Cool steel-grey calm",
    previewBg: "#060810",
    previewAccent: "#94A3B8",
    vars: {
      "--bg": "#060810",
      "--surface": "#0b0e18",
      "--surface-2": "#111420",
      "--surface-3": "#171b28",
      "--accent": "#94A3B8",
      "--accent-text": "#060810",
      "--t1": "#E2E8F0",
      "--t2": "#64748B",
      "--t3": "#334155",
      "--green": "#34D399",
      "--amber": "#FBBF24",
      "--red": "#F87171",
      "--border": "rgba(148,163,184,0.07)",
    },
  },
  {
    id: "nebula",
    name: "Nebula",
    category: "dark",
    description: "Deep space cosmic haze",
    previewBg: "#04020d",
    previewAccent: "#C084FC",
    vars: {
      "--bg": "#04020d",
      "--surface": "#08051a",
      "--surface-2": "#0e0a24",
      "--surface-3": "#140f2e",
      "--accent": "#C084FC",
      "--accent-text": "#ffffff",
      "--t1": "#F3E8FF",
      "--t2": "#9068C0",
      "--t3": "#563880",
      "--green": "#34D399",
      "--amber": "#FBBF24",
      "--red": "#FB7185",
      "--border": "rgba(192,132,252,0.07)",
    },
  },
  {
    id: "gold",
    name: "Gold",
    category: "dark",
    description: "Royal dark gold",
    previewBg: "#080600",
    previewAccent: "#FBBF24",
    vars: {
      "--bg": "#080600",
      "--surface": "#110e00",
      "--surface-2": "#1a1500",
      "--surface-3": "#221c00",
      "--accent": "#FBBF24",
      "--accent-text": "#080600",
      "--t1": "#FFFBEB",
      "--t2": "#B8920A",
      "--t3": "#705800",
      "--green": "#34D399",
      "--amber": "#FBBF24",
      "--red": "#F87171",
      "--border": "rgba(251,191,36,0.07)",
    },
  },
  {
    id: "blood-moon",
    name: "Blood Moon",
    category: "dark",
    description: "Dark crimson with amber",
    previewBg: "#0a0200",
    previewAccent: "#EF4444",
    vars: {
      "--bg": "#0a0200",
      "--surface": "#160400",
      "--surface-2": "#200600",
      "--surface-3": "#2c0800",
      "--accent": "#EF4444",
      "--accent-text": "#ffffff",
      "--t1": "#FEE2E2",
      "--t2": "#B05050",
      "--t3": "#6B2525",
      "--green": "#34D399",
      "--amber": "#FBBF24",
      "--red": "#EF4444",
      "--border": "rgba(239,68,68,0.08)",
    },
  },
  {
    id: "mint",
    name: "Mint",
    category: "dark",
    description: "Fresh cool spearmint",
    previewBg: "#020d08",
    previewAccent: "#6EDFC0",
    vars: {
      "--bg": "#020d08",
      "--surface": "#05160e",
      "--surface-2": "#091f16",
      "--surface-3": "#0e2a1e",
      "--accent": "#6EDFC0",
      "--accent-text": "#020d08",
      "--t1": "#E0FFF6",
      "--t2": "#50A888",
      "--t3": "#266650",
      "--green": "#6EDFC0",
      "--amber": "#FBBF24",
      "--red": "#F87171",
      "--border": "rgba(110,223,192,0.07)",
    },
  },
  {
    id: "electric",
    name: "Electric",
    category: "dark",
    description: "High-voltage neon blue",
    previewBg: "#020610",
    previewAccent: "#3B82F6",
    vars: {
      "--bg": "#020610",
      "--surface": "#050b1a",
      "--surface-2": "#091022",
      "--surface-3": "#0e162c",
      "--accent": "#3B82F6",
      "--accent-text": "#ffffff",
      "--t1": "#EFF6FF",
      "--t2": "#6090D0",
      "--t3": "#334E8A",
      "--green": "#34D399",
      "--amber": "#FBBF24",
      "--red": "#F87171",
      "--border": "rgba(59,130,246,0.08)",
    },
  },
  {
    id: "copper",
    name: "Copper",
    category: "dark",
    description: "Warm metallic brown",
    previewBg: "#0a0602",
    previewAccent: "#D97706",
    vars: {
      "--bg": "#0a0602",
      "--surface": "#150e04",
      "--surface-2": "#1e1508",
      "--surface-3": "#281c0c",
      "--accent": "#D97706",
      "--accent-text": "#0a0602",
      "--t1": "#FEF3C7",
      "--t2": "#A06020",
      "--t3": "#643A0A",
      "--green": "#34D399",
      "--amber": "#D97706",
      "--red": "#F87171",
      "--border": "rgba(217,119,6,0.08)",
    },
  },
  {
    id: "lavender",
    name: "Lavender",
    category: "dark",
    description: "Soft lilac dreamscape",
    previewBg: "#07050f",
    previewAccent: "#DDD6FE",
    vars: {
      "--bg": "#07050f",
      "--surface": "#0e0b1c",
      "--surface-2": "#151028",
      "--surface-3": "#1c1534",
      "--accent": "#DDD6FE",
      "--accent-text": "#07050f",
      "--t1": "#F5F3FF",
      "--t2": "#9D8EC0",
      "--t3": "#5E5280",
      "--green": "#34D399",
      "--amber": "#FBBF24",
      "--red": "#F87171",
      "--border": "rgba(221,214,254,0.07)",
    },
  },
  {
    id: "toxic",
    name: "Toxic",
    category: "dark",
    description: "Radioactive lime green",
    previewBg: "#030800",
    previewAccent: "#A3E635",
    vars: {
      "--bg": "#030800",
      "--surface": "#071000",
      "--surface-2": "#0c1800",
      "--surface-3": "#112000",
      "--accent": "#A3E635",
      "--accent-text": "#030800",
      "--t1": "#ECFCCB",
      "--t2": "#6EA020",
      "--t3": "#3C6008",
      "--green": "#A3E635",
      "--amber": "#FBBF24",
      "--red": "#F87171",
      "--border": "rgba(163,230,53,0.07)",
    },
  },

  // ── Light themes ─────────────────────────────────────────────────────────
  {
    id: "snow",
    name: "Snow",
    category: "light",
    description: "Clean white minimal",
    previewBg: "#f8f9fc",
    previewAccent: "#111827",
    vars: {
      "--bg": "#f8f9fc",
      "--surface": "#ffffff",
      "--surface-2": "#f0f2f7",
      "--surface-3": "#e8eaf2",
      "--accent": "#111827",
      "--accent-text": "#ffffff",
      "--t1": "#0d1117",
      "--t2": "#4B5563",
      "--t3": "#9CA3AF",
      "--green": "#059669",
      "--amber": "#D97706",
      "--red": "#DC2626",
      "--border": "rgba(0,0,0,0.08)",
    },
  },
  {
    id: "cream",
    name: "Cream",
    category: "light",
    description: "Warm parchment paper",
    previewBg: "#faf8f3",
    previewAccent: "#78350F",
    vars: {
      "--bg": "#faf8f3",
      "--surface": "#ffffff",
      "--surface-2": "#f2ede3",
      "--surface-3": "#e8e0d0",
      "--accent": "#78350F",
      "--accent-text": "#ffffff",
      "--t1": "#1c1410",
      "--t2": "#6B5844",
      "--t3": "#A89278",
      "--green": "#15803D",
      "--amber": "#B45309",
      "--red": "#B91C1C",
      "--border": "rgba(0,0,0,0.07)",
    },
  },
  {
    id: "sky-light",
    name: "Sky",
    category: "light",
    description: "Airy pale blue day",
    previewBg: "#f0f7ff",
    previewAccent: "#1D4ED8",
    vars: {
      "--bg": "#f0f7ff",
      "--surface": "#ffffff",
      "--surface-2": "#e4f0fc",
      "--surface-3": "#d6e8f8",
      "--accent": "#1D4ED8",
      "--accent-text": "#ffffff",
      "--t1": "#0c1a3a",
      "--t2": "#3B6088",
      "--t3": "#7AAAC8",
      "--green": "#047857",
      "--amber": "#B45309",
      "--red": "#B91C1C",
      "--border": "rgba(0,0,0,0.07)",
    },
  },
  {
    id: "blossom",
    name: "Blossom",
    category: "light",
    description: "Soft rose petal light",
    previewBg: "#fff5f8",
    previewAccent: "#9D174D",
    vars: {
      "--bg": "#fff5f8",
      "--surface": "#ffffff",
      "--surface-2": "#fce8f0",
      "--surface-3": "#f8d8e8",
      "--accent": "#9D174D",
      "--accent-text": "#ffffff",
      "--t1": "#1a0810",
      "--t2": "#854060",
      "--t3": "#C090A8",
      "--green": "#047857",
      "--amber": "#B45309",
      "--red": "#B91C1C",
      "--border": "rgba(0,0,0,0.07)",
    },
  },
  {
    id: "sage-light",
    name: "Sage",
    category: "light",
    description: "Calm natural green",
    previewBg: "#f3f8f4",
    previewAccent: "#14532D",
    vars: {
      "--bg": "#f3f8f4",
      "--surface": "#ffffff",
      "--surface-2": "#e6f2e8",
      "--surface-3": "#d8eadc",
      "--accent": "#14532D",
      "--accent-text": "#ffffff",
      "--t1": "#0c1f10",
      "--t2": "#3D6B4E",
      "--t3": "#80A890",
      "--green": "#15803D",
      "--amber": "#B45309",
      "--red": "#B91C1C",
      "--border": "rgba(0,0,0,0.07)",
    },
  },
  {
    id: "paper",
    name: "Paper",
    category: "light",
    description: "Classic ink on white",
    previewBg: "#fefefe",
    previewAccent: "#2563EB",
    vars: {
      "--bg": "#fefefe",
      "--surface": "#f7f7f8",
      "--surface-2": "#eeeff2",
      "--surface-3": "#e5e6eb",
      "--accent": "#2563EB",
      "--accent-text": "#ffffff",
      "--t1": "#111111",
      "--t2": "#555555",
      "--t3": "#999999",
      "--green": "#16A34A",
      "--amber": "#CA8A04",
      "--red": "#DC2626",
      "--border": "rgba(0,0,0,0.08)",
    },
  },
  {
    id: "dusk",
    name: "Dusk",
    category: "light",
    description: "Soft violet twilight",
    previewBg: "#f8f7ff",
    previewAccent: "#5B21B6",
    vars: {
      "--bg": "#f8f7ff",
      "--surface": "#ffffff",
      "--surface-2": "#ede8fc",
      "--surface-3": "#e0d8f8",
      "--accent": "#5B21B6",
      "--accent-text": "#ffffff",
      "--t1": "#1e1040",
      "--t2": "#6050A0",
      "--t3": "#9080C8",
      "--green": "#047857",
      "--amber": "#B45309",
      "--red": "#B91C1C",
      "--border": "rgba(0,0,0,0.07)",
    },
  },
  {
    id: "peach",
    name: "Peach",
    category: "light",
    description: "Warm peachy glow",
    previewBg: "#fff8f3",
    previewAccent: "#C2410C",
    vars: {
      "--bg": "#fff8f3",
      "--surface": "#ffffff",
      "--surface-2": "#fdeee4",
      "--surface-3": "#fae0d0",
      "--accent": "#C2410C",
      "--accent-text": "#ffffff",
      "--t1": "#1c0e08",
      "--t2": "#7A4030",
      "--t3": "#C09080",
      "--green": "#15803D",
      "--amber": "#B45309",
      "--red": "#B91C1C",
      "--border": "rgba(0,0,0,0.07)",
    },
  },
];

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  for (const [key, val] of Object.entries(theme.vars)) {
    root.style.setProperty(key, val);
  }

  const light = theme.category === "light";
  root.setAttribute("data-theme", theme.category);

  root.style.setProperty("--accent-dim",   theme.vars["--accent"] + "18");
  root.style.setProperty("--green-dim",    light ? "rgba(5,150,105,0.12)"  : "rgba(52,211,153,0.10)");
  root.style.setProperty("--red-dim",      light ? "rgba(220,38,38,0.10)"  : "rgba(248,113,113,0.10)");
  root.style.setProperty("--border-mid",   theme.vars["--border"]);
  root.style.setProperty("--accent-2",     light ? theme.vars["--t2"]      : "#A0A0A0");

  // Adaptive glass helpers — rgba(255,255,255,X) in dark, rgba(0,0,0,X) in light
  const g = (a: number) => light ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
  root.style.setProperty("--g01",  g(0.01));
  root.style.setProperty("--g02",  g(0.02));   // alias: --glass-subtle
  root.style.setProperty("--g03",  g(0.03));
  root.style.setProperty("--g04",  g(0.04));   // alias: --glass-line-2
  root.style.setProperty("--g05",  g(0.05));   // alias: --glass-line
  root.style.setProperty("--g06",  g(0.06));
  root.style.setProperty("--g07",  g(0.07));
  root.style.setProperty("--g08",  g(0.08));   // alias: --glass-line-strong
  root.style.setProperty("--g09",  g(0.09));
  root.style.setProperty("--g10",  g(0.10));
  root.style.setProperty("--g12",  g(0.12));
  root.style.setProperty("--g15",  g(0.15));
  root.style.setProperty("--g18",  g(0.18));
  root.style.setProperty("--g20",  g(0.20));
  root.style.setProperty("--g25",  g(0.25));
  root.style.setProperty("--g30",  g(0.30));
  root.style.setProperty("--g35",  g(0.35));
  // Keep existing aliases pointing at the same values
  root.style.setProperty("--glass-subtle",      g(0.02));
  root.style.setProperty("--glass-line-2",      g(0.04));
  root.style.setProperty("--glass-line",        g(0.05));
  root.style.setProperty("--glass-line-strong", g(0.08));

  root.style.setProperty("--panel-bg",       light ? theme.vars["--surface"]   : "rgba(8,9,12,0.5)");
  root.style.setProperty("--input-bg",       light ? "#ffffff"                 : "var(--surface-2)");
  root.style.setProperty("--input-bg-solid", light ? "#ffffff"                 : "#0e0f13");
  root.style.setProperty("--input-border",   light ? "rgba(0,0,0,0.12)"        : "rgba(255,255,255,0.07)");
  root.style.setProperty("--input-focus",    light ? "rgba(0,0,0,0.25)"        : "rgba(232,232,232,0.25)");
  root.style.setProperty("--modal-bg",       light ? "#ffffff"                 : "rgba(10,11,16,0.97)");
  root.style.setProperty("--modal-border",   light ? "rgba(0,0,0,0.10)"        : "rgba(255,255,255,0.08)");
  root.style.setProperty("--chart-line",     theme.vars["--accent"]);
  root.style.setProperty("--logo-filter",    light ? "brightness(0)"           : "none");
}

interface ThemeContextValue {
  activeTheme: Theme;
  setTheme: (t: Theme) => void;
  themes: Theme[];
}

const ThemeContext = createContext<ThemeContextValue>({
  activeTheme: THEMES[0],
  setTheme: () => {},
  themes: THEMES,
});

export function useTheme() { return useContext(ThemeContext); }

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [activeTheme, setActiveThemeState] = useState<Theme>(THEMES[0]);

  const setTheme = (t: Theme) => {
    setActiveThemeState(t);
    applyTheme(t);
  };

  useEffect(() => { applyTheme(activeTheme); }, []);

  return (
    <ThemeContext.Provider value={{ activeTheme, setTheme, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  );
}

// Kept for backward-compat with Settings.tsx import
export const ACCENT_PRESETS = THEMES.map(t => ({ name: t.name, value: t.vars["--accent"] }));
export function applyAccent(color: string) {
  document.documentElement.style.setProperty("--accent", color);
}
