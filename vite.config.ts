import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  /**
   * GitHub Pages serves from /<repo>/, but applying that base in dev breaks
   * the HMR WebSocket: the client tries to connect through the base path while
   * the socket lives at the root, so every edit silently serves a stale module.
   * Only the production build needs the prefix.
   *
   * Shared designs live in the hash fragment, so no server rewrite rules are
   * needed either way.
   */
  base: command === 'build' ? '/butcher-block-designer/' : '/',
  plugins: [react()],
}));
