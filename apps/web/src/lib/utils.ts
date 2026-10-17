import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return "just now";
  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "minute"],
    [3600, "hour"],
    [86400, "day"],
    [604800, "week"]
  ];
  const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (let i = units.length - 1; i >= 0; i--) {
    const [size, unit] = units[i]!;
    if (seconds >= size) return fmt.format(-Math.floor(seconds / size), unit);
  }
  return fmt.format(-Math.floor(seconds / 60), "minute");
}

export const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;
