export interface Theme {
  bg: string;
  bgSecondary: string;
  bgTertiary: string;
  text: string;
  textMuted: string;
  accent: string;
  border: string;
  codeBg: string;
  codeBorder: string;
  inputBg: string;
}

// Indexed by theme name; looked up dynamically with names coming from
// settings, hence the string index signature ("none" maps to null).
export const THEMES: Record<string, Theme | null> = {
  none: null,
  warmDark: {
    bg: "#1c1917", bgSecondary: "#292524", bgTertiary: "#1a1614",
    text: "#e7e5e4", textMuted: "#a8a29e", accent: "#fb923c",
    border: "#44403c", codeBg: "#211e1b", codeBorder: "#3a3632", inputBg: "#252220",
  },
  coolDark: {
    bg: "#0f172a", bgSecondary: "#1e293b", bgTertiary: "#0c1322",
    text: "#e2e8f0", textMuted: "#94a3b8", accent: "#38bdf8",
    border: "#334155", codeBg: "#0d1424", codeBorder: "#2d3a4d", inputBg: "#1a2438",
  },
  paperLight: {
    bg: "#faf8f5", bgSecondary: "#f0ebe3", bgTertiary: "#e8e2d8",
    text: "#2c2418", textMuted: "#78716c", accent: "#c2410c",
    border: "#d4cfc8", codeBg: "#f3ede4", codeBorder: "#d4cfc8", inputBg: "#ffffff",
  },
  highContrast: {
    bg: "#000000", bgSecondary: "#0a0a0a", bgTertiary: "#000000",
    text: "#ffffff", textMuted: "#d4d4d4", accent: "#fde047",
    border: "#525252", codeBg: "#0a0a0a", codeBorder: "#525252", inputBg: "#0a0a0a",
  },
  midnight: {
    bg: "#13111c", bgSecondary: "#1e1b2e", bgTertiary: "#0f0d17",
    text: "#e4e0ee", textMuted: "#9b95b0", accent: "#a78bfa",
    border: "#312d45", codeBg: "#181523", codeBorder: "#2b2740", inputBg: "#1b1829",
  },
  nord: {
    bg: "#2e3440", bgSecondary: "#3b4252", bgTertiary: "#282e3a",
    text: "#eceff4", textMuted: "#d8dee9", accent: "#88c0d0",
    border: "#4c566a", codeBg: "#2e3440", codeBorder: "#434c5e", inputBg: "#3b4252",
  },
  dracula: {
    bg: "#282a36", bgSecondary: "#343746", bgTertiary: "#21222c",
    text: "#f8f8f2", textMuted: "#bfbfbf", accent: "#bd93f9",
    border: "#44475a", codeBg: "#282a36", codeBorder: "#44475a", inputBg: "#343746",
  },
  solarized: {
    bg: "#002b36", bgSecondary: "#073642", bgTertiary: "#00252f",
    text: "#eee8d5", textMuted: "#93a1a1", accent: "#2aa198",
    border: "#2f4f56", codeBg: "#073642", codeBorder: "#2f4f56", inputBg: "#073642",
  },
  rosePine: {
    bg: "#191724", bgSecondary: "#1f1d2e", bgTertiary: "#15131f",
    text: "#e0def4", textMuted: "#908caa", accent: "#ebbcba",
    border: "#2a2740", codeBg: "#1f1d2e", codeBorder: "#2a2740", inputBg: "#1f1d2e",
  },
  catppuccin: {
    bg: "#1e1e2e", bgSecondary: "#28283d", bgTertiary: "#181825",
    text: "#cdd6f4", textMuted: "#a6adc8", accent: "#cba6f7",
    border: "#363654", codeBg: "#1e1e2e", codeBorder: "#363654", inputBg: "#28283d",
  },
  gruvbox: {
    bg: "#282828", bgSecondary: "#3c3836", bgTertiary: "#1d2021",
    text: "#ebdbb2", textMuted: "#a89984", accent: "#fe8019",
    border: "#504945", codeBg: "#1d2021", codeBorder: "#504945", inputBg: "#32302f",
  },
  oneDark: {
    bg: "#282c34", bgSecondary: "#2c313a", bgTertiary: "#21252b",
    text: "#abb2bf", textMuted: "#7f848e", accent: "#61afef",
    border: "#3e4451", codeBg: "#21252b", codeBorder: "#3e4451", inputBg: "#2c313a",
  },
  tokyoNight: {
    bg: "#1a1b26", bgSecondary: "#24283b", bgTertiary: "#16161e",
    text: "#c0caf5", textMuted: "#565f89", accent: "#7aa2f7",
    border: "#3b4261", codeBg: "#16161e", codeBorder: "#3b4261", inputBg: "#24283b",
  },
  githubDark: {
    bg: "#0d1117", bgSecondary: "#161b22", bgTertiary: "#010409",
    text: "#c9d1d9", textMuted: "#8b949e", accent: "#58a6ff",
    border: "#30363d", codeBg: "#161b22", codeBorder: "#30363d", inputBg: "#161b22",
  },
};

export const THEME_NAMES = {
  none: "Default",
  warmDark: "Warm Dark",
  coolDark: "Cool Dark",
  paperLight: "Paper Light",
  highContrast: "High Contrast",
  midnight: "Midnight",
  nord: "Nord",
  dracula: "Dracula",
  solarized: "Solarized",
  rosePine: "Ros\u00e9 Pine",
  catppuccin: "Catppuccin",
  gruvbox: "Gruvbox",
  oneDark: "One Dark",
  tokyoNight: "Tokyo Night",
  githubDark: "GitHub Dark",
};
