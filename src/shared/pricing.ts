import type { Platform } from "./platform";

export interface PlanPricing {
  price: number;
  label: string;
}

// Plan ids are platform-specific strings (detected or user-overridden),
// hence the string index per platform.
export const PRICING: Record<Platform, Record<string, PlanPricing>> = {
  claude: {
    free: { price: 0, label: "Free" },
    pro: { price: 20, label: "Pro" },
    max5x: { price: 100, label: "Max 5x" },
    max20x: { price: 200, label: "Max 20x" },
  },
  chatgpt: {
    free: { price: 0, label: "Free" },
    plus: { price: 20, label: "Plus" },
    pro5x: { price: 100, label: "Pro 5x" },
    pro20x: { price: 200, label: "Pro 20x" },
  },
  gemini: {
    free: { price: 0, label: "Free" },
    ai_pro: { price: 19.99, label: "AI Pro" },
    ai_ultra: { price: 249.99, label: "AI Ultra" },
  },
};
