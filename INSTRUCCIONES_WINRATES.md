# Parche Winrates para rb-board

Este ZIP añade una pestaña nueva de análisis competitivo basada en el Excel `Riftbound_Unleashed_Aggregate.xlsx`.

## Archivos incluidos

- `public/data/winrates-unleashed.json`
- `src/WinratesView.jsx`
- `src/winrates.css`

## Qué falta tocar manualmente

Hay que editar `src/App.jsx` para que la app muestre la pestaña nueva.

### 1. Importar el componente

Arriba del todo, después de:

```js
import { useCallback, useEffect, useMemo, useState } from "react";
```

añade:

```js
import { WinratesView } from "./WinratesView.jsx";
```

### 2. Añadir botón al menú

Busca dentro de `Header` este bloque:

```jsx
<nav className="topNav">
  <button className={view === "collection" ? "active" : ""} onClick={() => setView("collection")}>Colección</button>
  <button className={view === "decks" ? "active" : ""} onClick={() => setView("decks")}>Mazos</button>
  <button className={view === "stats" ? "active" : ""} onClick={() => setView("stats")}>Stats</button>
</nav>
```

Sustitúyelo por:

```jsx
<nav className="topNav">
  <button className={view === "collection" ? "active" : ""} onClick={() => setView("collection")}>Colección</button>
  <button className={view === "decks" ? "active" : ""} onClick={() => setView("decks")}>Mazos</button>
  <button className={view === "stats" ? "active" : ""} onClick={() => setView("stats")}>Stats</button>
  <button className={view === "winrates" ? "active" : ""} onClick={() => setView("winrates")}>Winrates</button>
</nav>
```

### 3. Renderizar la pantalla nueva

Cerca del final de `App.jsx`, busca:

```jsx
{cards.length > 0 && view === "collection" && <CollectionView cards={cards} collection={collection} setCollection={setCollection} prices={prices} priceMeta={priceMeta} />}
{cards.length > 0 && view === "decks" && <DecksView cards={cards} collection={collection} decks={decks} setDecks={setDecks} prices={prices} />}
{cards.length > 0 && view === "stats" && <StatsView cards={cards} collection={collection} decks={decks} prices={prices} />}
```

Y déjalo así:

```jsx
{view === "winrates" && <WinratesView />}
{cards.length > 0 && view === "collection" && <CollectionView cards={cards} collection={collection} setCollection={setCollection} prices={prices} priceMeta={priceMeta} />}
{cards.length > 0 && view === "decks" && <DecksView cards={cards} collection={collection} decks={decks} setDecks={setDecks} prices={prices} />}
{cards.length > 0 && view === "stats" && <StatsView cards={cards} collection={collection} decks={decks} prices={prices} />}
```

### Opcional, pero recomendable

Para que no salga la pantalla de "No hay cartas cargadas" cuando estés en Winrates, cambia estas dos líneas:

```jsx
{!cards.length && syncing && <EmptyState title="Cargando cartas" text={`Descargadas ${progress.loaded}/${progress.total || "?"}. La primera carga puede tardar un poco.`} />}
{!cards.length && !syncing && <EmptyState title="No hay cartas cargadas" text="Pulsa Actualizar cartas para descargar la base de datos." action={<button className="primary" onClick={syncCards}>Actualizar cartas</button>} />}
```

por estas:

```jsx
{view !== "winrates" && !cards.length && syncing && <EmptyState title="Cargando cartas" text={`Descargadas ${progress.loaded}/${progress.total || "?"}. La primera carga puede tardar un poco.`} />}
{view !== "winrates" && !cards.length && !syncing && <EmptyState title="No hay cartas cargadas" text="Pulsa Actualizar cartas para descargar la base de datos." action={<button className="primary" onClick={syncCards}>Actualizar cartas</button>} />}
```

## Cómo subirlo a GitHub

1. Descomprime este ZIP.
2. Entra en tu repo `rb-board`.
3. Pulsa `Add file > Upload files`.
4. Arrastra estas carpetas:
   - `public`
   - `src`
5. Haz `Commit changes`.
6. Edita `src/App.jsx` con los cambios de arriba.
7. Haz otro `Commit changes`.
8. GitHub Pages se desplegará solo.

## Qué incluye la pantalla nueva

- Ranking de leyendas.
- Comparador de una leyenda contra otra.
- Matriz completa de winrates.
- Mejores y peores matchups.
- Listado de torneos incluidos.
