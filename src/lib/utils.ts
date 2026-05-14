import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Standard shadcn helper: merge Tailwind class lists with later classes winning. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
