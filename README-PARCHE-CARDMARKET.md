# Parche Cardmarket sin Riftcodex en GitHub Actions

Este parche elimina la dependencia de Riftcodex dentro del workflow de precios.

Archivos incluidos:
- scripts/update-cardmarket-prices.mjs
- .github/workflows/update-cardmarket-prices.yml
- tools/export-cardmarket-targets-from-browser-console.js
- public/data/cardmarket-targets.example.json

Uso:
1. Sube `scripts/update-cardmarket-prices.mjs` y `.github/workflows/update-cardmarket-prices.yml` sustituyendo los actuales.
2. Abre tu web, abre consola del navegador y pega el contenido de `tools/export-cardmarket-targets-from-browser-console.js`.
3. Se descargará `cardmarket-targets.json`.
4. Sube ese archivo a `public/data/cardmarket-targets.json`.
5. Ejecuta el workflow `Update Cardmarket prices`.
