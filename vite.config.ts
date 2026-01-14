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
    // Enable module preload with polyfill for better chunk loading
    modulePreload: {
      polyfill: true,
    },
    rollupOptions: {
      output: {
        // Ensure consistent file names
        assetFileNames: 'assets/[name]-[hash][extname]',
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        // Optimized chunking strategy to prevent dependency race conditions
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            // Core React bundle - keep React and React-DOM together
            if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) {
              return 'react-core';
            }

            // React ecosystem libraries
            if (id.includes('react-router') || id.includes('@tanstack/react-query')) {
              return 'react-libs';
            }

            // UI framework - Radix UI components (depend on React)
            if (id.includes('@radix-ui/')) {
              return 'ui-framework';
            }

            // Charts and visualization
            if (id.includes('recharts') || id.includes('/d3-')) {
              return 'charts';
            }

            // Large dependencies
            if (id.includes('framer-motion')) {
              return 'animation';
            }

            if (id.includes('jspdf') || id.includes('html2canvas') || id.includes('xlsx') || id.includes('exceljs')) {
              return 'document-gen';
            }

            // Other vendor code
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
