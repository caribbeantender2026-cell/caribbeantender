/** Validate browser-visible Supabase settings before the build embeds them. */
export function publicSettingsProblem(url: string, key: string): string | null {
  if (!url || !key) return 'Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY before building.';
  try {
    if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error();
  } catch {
    return 'VITE_SUPABASE_URL must be an HTTP or HTTPS URL.';
  }
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return null;
  try {
    const parts = key.split('.');
    const claims = JSON.parse(atob((parts[1] ?? '').replace(/-/g, '+').replace(/_/g, '/'))) as { role?: unknown };
    if (parts.length === 3 && claims.role === 'anon') return null;
  } catch { /* Unknown credentials must never be bundled. */ }
  return 'VITE_SUPABASE_PUBLISHABLE_KEY must be a publishable key or legacy anon JWT.';
}
