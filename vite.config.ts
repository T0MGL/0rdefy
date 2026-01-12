import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  // Base URL for assets - use absolute paths to work in embedded mode
  base: "/",

  server: {
    host: "::",
    port: 8080,
  },

  build: {
    // Generate absolute asset URLs for embedded apps
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1000,
    // Disable module preload to prevent unused preload warnings
    modulePreload: true,
    rollupOptions: {
      output: {
        // Ensure consistent file names
        assetFileNames: 'assets/[name]-[hash][extname]',
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            return 'vendor';
          }
        },
      }
    }
  },

  plugins: [react()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
