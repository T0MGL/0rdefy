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
    // Target modern browsers to avoid circular dependency issues
    target: 'esnext',
    // Use esbuild for faster minification
    minify: 'esbuild',
    rollupOptions: {
      output: {
        // Ensure consistent file names
        assetFileNames: 'assets/[name]-[hash][extname]',
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        // Manual chunking to control initialization order
        manualChunks: (id) => {
          // Keep ALL dependencies in vendor to prevent circular refs
          if (id.includes('node_modules')) {
            return 'vendor';
          }
        },
        // CRITICAL: Use 'iife' format for better browser compatibility
        // and to avoid ES module initialization issues
        format: 'es',
        // Ensure proper hoisting
        hoistTransitiveImports: false,
      }
    }
  },

  plugins: [react()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    // Deduplicate React to prevent multiple instances
    dedupe: ['react', 'react-dom'],
  },

  optimizeDeps: {
    // Force pre-bundling of ALL React dependencies
    include: [
      'react',
      'react/jsx-runtime',
      'react-dom',
      'react-dom/client',
      'react-router-dom',
    ],
    // Force exclusion of problematic packages
    exclude: [],
    esbuildOptions: {
      target: 'esnext',
      // Preserve names for better debugging
      keepNames: true,
    },
  },
});
