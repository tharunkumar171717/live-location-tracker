import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Port 3000 matches the OAuth redirect URL (http://localhost:3000/auth/callback).
export default defineConfig({
  plugins: [react()],
  server: { port: 3000, strictPort: true },
  preview: { port: 3000, strictPort: true },
});
