export const CHATGPT_CODEX_CREDITS_KEY = "chatgpt:codex.credits";
export const CHATGPT_CODEX_WORKSPACE_THREADS_KEY = "chatgpt:codex.workspace.threads";
export const CHATGPT_CODEX_WORKSPACE_TURNS_KEY = "chatgpt:codex.workspace.turns";
export const CHATGPT_CODEX_WORKSPACE_CREDITS_KEY = "chatgpt:codex.workspace.credits";
export const GEMINI_CREDITS_KEY = "gemini:credits";
export const GEMINI_ANTIGRAVITY_CREDITS_KEY = "gemini:antigravity.credits";

export function chatgptModelMetricKey(id: string | number): string {
  return "chatgpt:model:" + id;
}

export function chatgptLimitMetricKey(id: string | number): string {
  return "chatgpt:limit:" + id;
}

export function geminiFeatureMetricKey(id: string | number): string {
  return "gemini:feature:" + id;
}

export function geminiAntigravityModelMetricKey(id: string | number): string {
  return "gemini:antigravity.model:" + id;
}

export const CHATGPT_CODEX_WORKSPACE_KEYS = [
  CHATGPT_CODEX_WORKSPACE_TURNS_KEY,
  CHATGPT_CODEX_WORKSPACE_THREADS_KEY,
  CHATGPT_CODEX_WORKSPACE_CREDITS_KEY,
];
