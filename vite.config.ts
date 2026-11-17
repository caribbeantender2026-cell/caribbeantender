import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { publicSettingsProblem } from './src/lib/publicSettings.ts';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const problem = publicSettingsProblem(env.VITE_SUPABASE_URL ?? '', env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '');
  if (problem && (command === 'build' || env.VITE_SUPABASE_PUBLISHABLE_KEY)) throw new Error(problem);
  return { plugins: [react(), tailwindcss()] };
});
