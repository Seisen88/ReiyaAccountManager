import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export const ACCENT_PRESETS = [
  { name: "White",  value: "#E8E8E8" },
  { name: "Purple", value: "#A78BFA" },
  { name: "Blue",   value: "#60A5FA" },
  { name: "Teal",   value: "#34D399" },
  { name: "Amber",  value: "#FBBF24" },
  { name: "Red",    value: "#F87171" },
  { name: "Pink",   value: "#F472B6" },
  { name: "Orange", value: "#FB923C" },
];

export function applyAccent(color: string) {
  if (!color || !/^#[0-9A-Fa-f]{6}$/.test(color)) return;
  document.documentElement.style.setProperty("--accent", color);
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  document.documentElement.style.setProperty("--accent-text", lum > 0.55 ? "#0a0a0a" : "#f0f1f6");
}

interface ThemeContextValue {
  accentColor: string;
  setAccentColor: (c: string) => void;
  accentPresets: typeof ACCENT_PRESETS;
}

const ThemeContext = createContext<ThemeContextValue>({
  accentColor: "#E8E8E8",
  setAccentColor: () => {},
  accentPresets: ACCENT_PRESETS,
});

export function useTheme() { return useContext(ThemeContext); }

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [accentColor, setAccentColorState] = useState("#E8E8E8");

  const setAccentColor = (c: string) => {
    setAccentColorState(c);
    applyAccent(c);
  };

  useEffect(() => { applyAccent(accentColor); }, []);

  return (
    <ThemeContext.Provider value={{ accentColor, setAccentColor, accentPresets: ACCENT_PRESETS }}>
      {children}
    </ThemeContext.Provider>
  );
}
