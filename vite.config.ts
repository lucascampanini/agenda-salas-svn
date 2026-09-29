import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // publicado em https://lucascampanini.github.io/agenda-salas-svn/
  base: '/agenda-salas-svn/',
  plugins: [react()],
})
