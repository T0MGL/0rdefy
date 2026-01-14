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
          // Split vendors into logical chunks to prevent race conditions
          if (id.includes('node_modules')) {
            // React ecosystem (most critical - loaded first)
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router')) {
              return 'vendor-react';
            }

            // TanStack Query (used in most pages)
            if (id.includes('@tanstack/react-query')) {
              return 'vendor-query';
            }

            // UI Libraries (shadcn/ui, radix-ui)
            if (id.includes('@radix-ui') || id.includes('class-variance-authority') || id.includes('clsx')) {
              return 'vendor-ui';
            }

            // Charts and visualization
            if (id.includes('recharts') || id.includes('d3-') || id.includes('victory')) {
              return 'vendor-charts';
            }

            // Forms and validation
            if (id.includes('react-hook-form') || id.includes('zod') || id.includes('@hookform')) {
              return 'vendor-forms';
            }

            // Animation libraries
            if (id.includes('framer-motion')) {
              return 'vendor-animation';
            }

            // Date utilities
            if (id.includes('date-fns')) {
              return 'vendor-date';
            }

            // HTTP and API
            if (id.includes('axios')) {
              return 'vendor-http';
            }

            // Everything else
            return 'vendor-misc';
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
