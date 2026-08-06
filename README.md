# Slutstation — Vite migration

This repo has been migrated to use Vite + npm as a simple static site build.

Commands:

```powershell
npm install
npm run dev     # start dev server
npm run build   # produce production build in /dist
npm run preview # preview the production build
```

Notes:
- JavaScript and CSS moved to `src/` and are imported from `index.html` via a module entry `src/main.js`.
- Keep the `assets/` folder as-is.
