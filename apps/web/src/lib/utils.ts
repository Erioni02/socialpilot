import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatDistanceToNowStrict, format } from "date-fns";
import { toast } from "sonner";
import { ApiError } from "./api";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function ago(d?: string | Date | null) {
  if (!d) return "—";
  return formatDistanceToNowStrict(new Date(d), { addSuffix: true });
}

export function fmtDate(d?: string | Date | null, f = "MMM d, yyyy HH:mm") {
  if (!d) return "—";
  return format(new Date(d), f);
}

export function fmtNum(n?: number | null, digits = 0) {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits, notation: Math.abs(n) >= 100_000 ? "compact" : "standard" }).format(n);
}

export function fmtUsd(n?: number | null) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: n < 1 ? 3 : 2 }).format(n);
}

export function fmtBytes(n?: number | null) {
  if (!n) return "—";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

/** Shows an API error as a toast; setup-required errors include a hint. */
export function toastError(e: unknown, fallback = "Something went wrong") {
  if (e instanceof ApiError) {
    const hint = e.code === "setup_required" ? " — setup needed" : "";
    toast.error(e.message + hint);
  } else toast.error((e as Error)?.message ?? fallback);
}

export const PLATFORM_LABEL: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", x: "X", ga4: "Google Analytics", plausible: "Plausible", github: "GitHub", vercel: "Vercel" };

export function titleCase(s: string) {
  return s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function copy(text: string) {
  void navigator.clipboard.writeText(text).then(() => toast.success("Copied"));
}
