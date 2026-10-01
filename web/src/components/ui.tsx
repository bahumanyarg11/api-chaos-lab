import { clsx } from "clsx";
import { Check, Copy, Loader2 } from "lucide-react";
import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { motion } from "motion/react";
import { SEV_COLOR, type Severity } from "../lib/api";

export function Logo({ size = 28, withText = true }: { size?: number; withText?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
        <defs>
          <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#FF3D5A" />
            <stop offset=".5" stopColor="#FF8A00" />
            <stop offset="1" stopColor="#B14DFF" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="14" fill="#161622" stroke="#25253a" />
        <path d="M14 40 L24 22 L32 34 L40 16 L50 40" fill="none" stroke="url(#lg)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="40" cy="16" r="4" fill="#FF8A00" />
      </svg>
      {withText && (
        <span className="font-semibold tracking-tight text-fg">
          API <span className="chaos-text">Chaos</span> Lab
        </span>
      )}
    </span>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "outline" | "danger" | "mint"; size?: "sm" | "md" | "lg"; loading?: boolean; icon?: ReactNode };
export function Button({ variant = "primary", size = "md", loading, icon, className, children, disabled, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap",
        size === "sm" && "px-3 py-1.5 text-xs",
        size === "md" && "px-4 py-2 text-sm",
        size === "lg" && "px-6 py-3 text-base",
        variant === "primary" && "chaos-bg text-white shadow-[0_8px_30px_rgba(255,61,90,0.25)] hover:brightness-110",
        variant === "ghost" && "text-muted hover:text-fg hover:bg-white/5",
        variant === "outline" && "border border-line bg-raised/60 text-fg hover:border-white/20 hover:bg-raised",
        variant === "danger" && "bg-chaos-red/15 text-chaos-red border border-chaos-red/30 hover:bg-chaos-red/25",
        variant === "mint" && "bg-mint/15 text-mint border border-mint/30 hover:bg-mint/25",
        className,
      )}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={clsx("glass rounded-2xl", className)}>
      {children}
    </div>
  );
}

export function Badge({ children, color = "#a1a1b5", className }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium font-mono", className)} style={{ color, background: `${color}1f`, border: `1px solid ${color}40` }}>
      {children}
    </span>
  );
}

export function SeverityPill({ s }: { s: Severity }) {
  return <Badge color={SEV_COLOR[s]}>{s.toUpperCase()}</Badge>;
}

export const METHOD_COLOR: Record<string, string> = { GET: "#22d3a5", POST: "#4da3ff", PUT: "#ffb020", PATCH: "#b14dff", DELETE: "#ff3d5a", OUTCOME: "#a1a1b5" };
export function Method({ m }: { m: string }) {
  return (
    <span className="inline-block min-w-[3.4rem] font-mono text-[11px] font-semibold" style={{ color: METHOD_COLOR[m] ?? "#a1a1b5" }}>
      {m}
    </span>
  );
}

export function StatusCode({ s }: { s: number }) {
  const c = s === 0 ? "#a1a1b5" : s < 300 ? "#22d3a5" : s < 400 ? "#4da3ff" : s < 500 ? "#ffb020" : "#ff3d5a";
  return (
    <span className="font-mono text-xs font-semibold" style={{ color: c }}>
      {s || "—"}
    </span>
  );
}

export function CodeBlock({ code, lang, className }: { code: string; lang?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={clsx("group relative rounded-xl border border-line bg-[#0a0a12]", className)}>
      {lang && <div className="border-b border-line px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-dim">{lang}</div>}
      <button
        className="absolute right-2 top-2 rounded-md border border-line bg-raised p-1.5 text-muted opacity-0 transition group-hover:opacity-100 hover:text-fg cursor-pointer"
        onClick={() => {
          navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        aria-label="Copy"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-mint" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      <pre className="scrollbar-thin overflow-x-auto p-4 text-[12.5px] leading-relaxed text-[#d7d7e6]">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function CopyField({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={clsx("flex items-center gap-2 rounded-xl border border-line bg-[#0a0a12] pl-3 pr-1 py-1", className)}>
      <code className="flex-1 truncate font-mono text-xs text-[#d7d7e6]">{value}</code>
      <button
        className="rounded-lg p-1.5 text-muted hover:bg-white/5 hover:text-fg cursor-pointer"
        onClick={() => {
          navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
      >
        {copied ? <Check className="h-4 w-4 text-mint" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button onClick={() => onChange(!on)} className="inline-flex items-center gap-2 cursor-pointer select-none" aria-pressed={on}>
      <span className={clsx("relative h-6 w-11 rounded-full transition-colors", on ? "chaos-bg" : "bg-line")}>
        <motion.span layout className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow" style={{ left: on ? 22 : 2 }} transition={{ type: "spring", stiffness: 500, damping: 30 }} />
      </span>
      {label && <span className="text-sm text-muted">{label}</span>}
    </button>
  );
}

export function ScoreDial({ score, grade, size = 140, label }: { score: number | null; grade: string; size?: number; label?: string }) {
  const sw = size < 100 ? 6 : 9;
  const r = size / 2 - sw - 1;
  const c = 2 * Math.PI * r;
  const pct = score == null ? 0 : score / 100;
  const color = score == null ? "#6b6b82" : score >= 85 ? "#22d3a5" : score >= 65 ? "#ffb020" : score >= 50 ? "#ff8a00" : "#ff3d5a";
  return (
    <div className="relative inline-flex flex-col items-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#25253a" strokeWidth={sw} fill="none" />
        <motion.circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={sw} fill="none" strokeLinecap="round" strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - pct) }} transition={{ duration: 1.1, ease: "easeOut" }} style={{ filter: `drop-shadow(0 0 8px ${color}66)` }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ height: size }}>
        <div className="font-extrabold leading-none tracking-tight" style={{ color, fontSize: Math.round(size * 0.27) }}>
          {grade}
        </div>
        <div className="mt-0.5 font-mono text-muted" style={{ fontSize: Math.max(9, Math.round(size * 0.085)) }}>{score == null ? "no data" : `${score}/100`}</div>
      </div>
      {label && <div className="mt-2 text-xs font-medium text-muted">{label}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx("h-4 w-4 animate-spin", className)} />;
}

export function Stat({ label, value, sub, color }: { label: string; value: ReactNode; sub?: ReactNode; color?: string }) {
  return (
    <div className="rounded-xl border border-line bg-raised/50 px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-dim">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums" style={{ color }}>
        {value}
      </div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line px-6 py-14 text-center">
      {icon && <div className="mb-3 text-dim">{icon}</div>}
      <div className="font-semibold">{title}</div>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}
