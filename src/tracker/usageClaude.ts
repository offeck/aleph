import { send } from "./send";

// ── Claude real usage polling ────────────────────────────
// Fetches /api/organizations/{orgId}/usage with session cookie (no API key).
// Returns real utilization percentages and reset times.
export function pollClaudeUsage() {
  try {
    const cookies = document.cookie.split(";").reduce((a, c) => {
      const [k, ...v] = c.trim().split("=");
      a[k] = v.join("=");
      return a;
    }, {});
    const orgId = cookies["lastActiveOrg"];
    if (!orgId) return;
    fetch("/api/organizations/" + orgId + "/usage", { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data) return;
        send({
          type: "insights-usage",
          platform: "claude",
          usage: {
            source: "provider",
            fiveHour: data.five_hour ? { utilization: data.five_hour.utilization, resetsAt: data.five_hour.resets_at } : null,
            sevenDay: data.seven_day ? { utilization: data.seven_day.utilization, resetsAt: data.seven_day.resets_at } : null,
            sonnet: data.seven_day_sonnet ? { utilization: data.seven_day_sonnet.utilization } : null,
            extraUsage: data.extra_usage || null,
          },
        });
      })
      .catch(() => {});
  } catch (e) {}
}
