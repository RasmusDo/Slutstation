import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Minimal Vite config, defaults are fine for this static site.
// account.html is a second entry point, so Rollup is told about both pages;
// without this, `vite build` would only emit index.html.
export default defineConfig({
  root: '.',
  build: {
    // Needed for top-level await, which account.js and tickets.js use to load
    // the Supabase SDK inside a try/catch (see the comment there for why that
    // matters). Supported since Chrome 89, Safari 15 and Firefox 89 (all 2021),
    // which is everything this audience is browsing on.
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        account: resolve(__dirname, 'account.html'),
        tickets: resolve(__dirname, 'tickets.html'),
        staff: resolve(__dirname, 'staff.html'),
        admin: resolve(__dirname, 'admin.html'),
        work: resolve(__dirname, 'work.html'),
      },
    },
  },
  plugins: [
    {
      // The source HTML is full of explanatory comments, and they were being
      // shipped verbatim: minified JS and CSS lose their comments in the
      // build, but HTML does not, so anyone opening devtools got the whole
      // internal commentary. This strips comments from the emitted pages
      // while the source keeps its documentation. Conditional comments
      // (<!--[if ...]-->) would be preserved if any ever existed here.
      name: 'strip-html-comments',
      transformIndexHtml: {
        order: 'post',
        handler: (html) => html.replace(/<!--(?!\[if)[\s\S]*?-->/g, ''),
      },
    },
  ],
});
