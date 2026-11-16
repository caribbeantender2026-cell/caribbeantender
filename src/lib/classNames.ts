/** Joins class names, letting later Tailwind classes win over earlier ones (shadcn/ui's "cn" helper). */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function classNames(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
