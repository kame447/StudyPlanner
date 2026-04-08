import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  plugins: [
    react(),
    basicSsl({
      name: 'study-planner-local',
      domains: ['localhost', '127.0.0.1', 'DESKTOP-VS76QED', 'DESKTOP-VS76QED.local'],
    }),
  ],
  server: {
    host: true,
    https: true,
  },
  preview: {
    host: true,
    https: true,
  },
});
