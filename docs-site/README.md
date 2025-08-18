This folder contains a Docusaurus site scaffold that points at the repository `docs/` folder.

Important: This site uses a React-based hero landing page at `src/pages/index.js`.
The previous `docs/index.md` has been removed so the React page is the primary site root.

Quick start

1. cd docs-site
2. npm install
3. npm run start

Build for production

1. npm run build
2. npm run serve

Deploy to GitHub Pages (repository settings must match `organizationName` and `projectName` in `docusaurus.config.js`)

1. npm run deploy

Styling and theming notes

- The site uses a custom stylesheet at `src/css/custom.css` implementing a dark, high-end theme.
- The font stack prefers Windows 11's `Segoe UI Variable` when available. If you want a consistent cross-platform font, replace the stack or bundle a licensed webfont.
- The footer has been hidden via CSS. If you'd prefer to remove it in config, edit `docusaurus.config.js` and clear the `themeConfig.footer` entry.

Troubleshooting

- Duplicate root route warning: Ensure there's no `docs/index.md` if you keep `src/pages/index.js`.
- If you see CSS minifier warnings, try running a local build (`npm run build`) and inspect `build/assets/css/styles.*.css` for stray properties; I can help clean the CSS if needed.

If you'd like, I can open a PR with these changes and clean up any remaining warnings (CSS minifier or package updates).
