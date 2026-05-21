# Riftbound Collection Board Pro

App estática en React/Vite para GitHub Pages.

## Qué hace

- Descarga cartas desde Riftcodex.
- Usa imágenes de Piltover Archive cuando puede derivar el código de carta.
- Guarda colección y mazos en el navegador con `localStorage`.
- Permite filtrar por set, dominio, tipo, supertipo, rareza, etiquetas, coste/energía, estado de colección y precio.
- Permite crear mazos desde tu colección.
- Lee precios desde `public/data/cardmarket-prices.json`.
- Incluye un workflow diario que intenta actualizar precios de Cardmarket.

## Precios Cardmarket

El workflow `Update Cardmarket prices` intenta obtener precios para cartas normales, ignorando variantes, alternate arts, showcase, promos, signed y overnumbered.

Criterio usado:

- vendedor de España
- carta en inglés
- condición Near Mint
- no foil
- no firmada
- no alterada
- muestra `desde X €`

Importante: sin API oficial de Cardmarket, esto depende del HTML público de Cardmarket. Puede fallar si Cardmarket cambia su página, bloquea peticiones o modifica filtros/estructura.

## Workflows

- `.github/workflows/deploy.yml`: publica la app en GitHub Pages.
- `.github/workflows/update-cardmarket-prices.yml`: actualiza precios cada día y hace commit de `public/data/cardmarket-prices.json` si hay cambios.

## Desarrollo local

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```
