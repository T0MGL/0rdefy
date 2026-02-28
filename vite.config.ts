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
    chunkSizeWarningLimit: 10000,
    // Use ES2015 for maximum compatibility
    target: 'es2015',
    // Use esbuild minifier (safer than terser for TDZ edge cases)
    minify: 'esbuild',
    rollupOptions: {
      output: {
        // Ensure consistent file names
        assetFileNames: 'assets/[name]-[hash][extname]',
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        format: 'es',
      }
    }
  },

  plugins: [react()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    // Deduplicate React to prevent multiple instances
    dedupe: ['react', 'react-dom', 'react/jsx-runtime'],
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
    esbuildOptions: {
      target: 'es2015',
      // Ensure proper module format
      format: 'esm',
    },
  },

  // Critical: Ensure all modules are treated as ES modules
  esbuild: {
    target: 'es2015',
    // Keep function and class names for better debugging
    keepNames: true,
  },
});
