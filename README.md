# Riftbound Collection Board Pro

App estática en React/Vite para GitHub Pages.

## Qué hace

- Descarga cartas desde Riftcodex.
- Usa imágenes de Piltover Archive cuando puede derivar el código de carta.
- Fallback automático a la imagen que venga en la API.
- Guarda colección y mazos en el navegador con `localStorage`.
- Permite filtrar por set, dominio, tipo, supertipo, rareza, etiquetas, coste/energía y estado de colección.
- Permite crear mazos desde tu colección, validar cantidades, exportar/importar mazos y ver qué cartas te faltan.

## Instalación local

```bash
npm install
npm run dev
```

## Publicar en GitHub Pages

1. Crea un repositorio en GitHub.
2. Sube todos estos archivos.
3. En GitHub: Settings > Pages > Source > GitHub Actions.
4. Haz push a `main`.
5. GitHub publicará la web automáticamente.

## Notas

No usa claves privadas ni llamadas a Claude desde frontend. Eso es importante porque una web pública no debe exponer API keys.
