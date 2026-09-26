import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

// https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Keep Rust errors visible in the terminal during `tauri dev`
  clearScreen: false,
  server: {
    port: 3000,
    strictPort: true,
  },
});
