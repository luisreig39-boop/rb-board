# Parche Cardmarket FOIL + Debug

Este parche reemplaza el script de precios y el workflow.

Cambios:
- Modo FOIL por defecto: sellerCountry=10, language=1, minCondition=2, isFoil=Y.
- El parser ya no descarta filas con Foil cuando el modo es FOIL.
- Extrae precios de `span.color-primary...fw-bold` y del bloque resumen `<dt>De</dt><dd>...`.
- Guarda HTML de depuración de las cartas consultadas en `public/data/cardmarket-debug/`.
- Reintenta precios `not-found` sin esperar 24 horas.

Después de subirlo:
1. Ejecuta Actions > Update Cardmarket prices > Run workflow.
2. Si sigue sin precio, abre `public/data/cardmarket-debug/` y revisa el HTML recibido por GitHub Actions.
