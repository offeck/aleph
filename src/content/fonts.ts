// ── Google Fonts map ───────────────────────────────────────────────────
const GOOGLE_FONTS: Record<string, string> = {
  "Rubik": "Rubik:wght@400;500;700",
  "Heebo": "Heebo:wght@400;500;700",
  "Assistant": "Assistant:wght@400;600;700",
  "Noto Sans Hebrew": "Noto+Sans+Hebrew:wght@400;500;700",
  "Noto Sans Arabic": "Noto+Sans+Arabic:wght@400;500;700",
  "Cairo": "Cairo:wght@400;500;700",
  "Vazirmatn": "Vazirmatn:wght@400;500;700",
  "Noto Nastaliq Urdu": "Noto+Nastaliq+Urdu:wght@400;500;700",
  "Open Sans": "Open+Sans:wght@400;600;700",
  "Inter": "Inter:wght@400;500;700",
  "IBM Plex Sans": "IBM+Plex+Sans:wght@400;500;700",
  "Fira Code": "Fira+Code:wght@400;500;700",
  "JetBrains Mono": "JetBrains+Mono:wght@400;500;700",
  "Source Code Pro": "Source+Code+Pro:wght@400;500;700",
  "IBM Plex Mono": "IBM+Plex+Mono:wght@400;500;700",
};

export function loadFont(fontName: string) {
  if (!fontName || !GOOGLE_FONTS[fontName]) return;
  const id = "aleph-font-" + fontName.replace(/\s+/g, "-").toLowerCase();
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=" + GOOGLE_FONTS[fontName] + "&display=swap";
  document.head.appendChild(link);
}
