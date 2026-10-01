import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

export const inter = loadInter("normal", { weights: ["400", "500", "600", "700", "800"], subsets: ["latin"] }).fontFamily;
export const mono = loadMono("normal", { weights: ["400", "500", "700"], subsets: ["latin"] }).fontFamily;

export const C = {
  bg: "#07070B",
  surface: "#0F0F17",
  raised: "#161622",
  border: "#25253A",
  text: "#F4F4F8",
  muted: "#A1A1B5",
  dim: "#6C6C84",
  red: "#FF3D5A",
  orange: "#FF8A00",
  violet: "#B14DFF",
  mint: "#22D3A5",
  warn: "#FFB020",
  info: "#4DA3FF",
};

export const CHAOS = `linear-gradient(90deg, ${C.red} 0%, ${C.orange} 50%, ${C.violet} 100%)`;
export const FPS = 30;
