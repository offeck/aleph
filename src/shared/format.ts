export function formatTime(seconds: number): string {
  if (!seconds || seconds < 60) return seconds ? `${Math.round(seconds)}s` : "0m";
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

export function formatTokens(n: number): string {
  if (!n) return "~0";
  if (n >= 1000) return `~${(n / 1000).toFixed(1)}K`;
  return `~${n}`;
}
