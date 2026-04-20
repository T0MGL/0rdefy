import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

/**
 * Strips modulepreload hints for heavy non-critical chunks from the built HTML.
 * vendor-ui (framer-motion) and vendor-pdf are only needed after authentication,
 * so preloading them on every page load wastes bandwidth.
 */
function stripNonCriticalPreloads(): Plugin {
  return {
    name: 'strip-non-critical-preloads',
    transformIndexHtml(html) {
      return html
        .replace(/<link rel="modulepreload"[^>]*vendor-ui[^>]*>\n?/g, '')
        .replace(/<link rel="modulepreload"[^>]*vendor-pdf[^>]*>\n?/g, '');
    },
  };
}

export default defineConfig({
  // Base URL for assets - use absolute paths to work in embedded mode
  base: "/",

  server: {
    host: "::",
    port: 8080,
  },

  build: {
    // Generate absolute asset URLs for embedded apps
    sourcemap: false, // Never expose source code in production
    chunkSizeWarningLimit: 1000, // 1MB — flag large chunks for review
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
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          // Use segment-aware matching to avoid false positives like react-smooth → vendor-react
          const seg = (pkg: string) => id.includes(`/node_modules/${pkg}/`) || id.includes(`/node_modules/${pkg}@`);
          if (seg('react') || seg('react-dom') || seg('react-router-dom') || seg('react-router') || seg('scheduler')) {
            return 'vendor-react';
          }
          if (seg('framer-motion') || seg('cmdk') || seg('sonner')) {
            return 'vendor-ui';
          }
          if (seg('jspdf') || seg('jspdf-autotable') || seg('qrcode') || seg('exceljs')) {
            return 'vendor-pdf';
          }
          if (id.includes('@shopify/app-bridge')) {
            return 'vendor-shopify';
          }
        },
      }
    }
  },

  plugins: [react(), stripNonCriticalPreloads()],

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
