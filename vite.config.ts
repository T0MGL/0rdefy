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
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        // Ensure consistent file names
        assetFileNames: 'assets/[name]-[hash][extname]',
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        // Minimal chunking to prevent dependency race conditions
        // Keep React and all UI components together in vendor bundle
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            // Separate only heavy, standalone libraries
            if (id.includes('recharts') || id.includes('/d3-')) {
              return 'charts';
            }

            if (id.includes('jspdf') || id.includes('html2canvas') || id.includes('xlsx') || id.includes('exceljs')) {
              return 'document-gen';
            }

            // Keep React, Radix UI, and all other dependencies together
            // to ensure proper initialization order
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

  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom'],
  },
});
