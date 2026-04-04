import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Affichage quota : les crédits DB = minutes de vidéo source. */
export function creditsToHours(credits: number): string {
  const h = Math.floor(credits / 60)
  const m = credits % 60
  if (h === 0) return `${m} min`
  if (m === 0) return `${h}h`
  return `${h}h${String(m).padStart(2, "0")}`
}
