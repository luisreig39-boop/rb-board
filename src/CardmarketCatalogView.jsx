import { useEffect, useMemo, useState } from "react";
import "./cardmarket-catalog.css";

function formatCurrency(value) {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function priceValue(product, mode) {
  if (mode === "normal") return Number.isFinite(Number(product.normalPriceFrom)) ? Number(product.normalPriceFrom) : null;
  if (mode === "foil") return Number.isFinite(Number(product.foilPriceFrom)) ? Number(product.foilPriceFrom) : null;
  return Number.isFinite(Number(product.priceFrom)) ? Number(product.priceFrom) : null;
}

function CardmarketImage({ product }) {
  const [failed, setFailed] = useState(false);
  const src = product.imageUrl || product.imageCandidates?.[0] || "";

  if (!src || failed) {
    return (
      <div className="cmImageFallback">
        <span>{product.name}</span>
      </div>
    );
  }

  return (
    <img
      className="cmImage"
      src={src}
      alt={product.name}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function CardmarketCatalogView() {
  const [data, setData] = useState(null);
  const [query, setQuery] = useState("");
  const [expansion, setExpansion] = useState("all");
  const [priceMode, setPriceMode] = useState("all");
  const [priceStatus, setPriceStatus] = useState("all");
  const [sortBy, setSortBy] = useState("name");

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/cardmarket-products.json?v=${Date.now()}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => setData(json))
      .catch(() => setData({ meta: {}, products: [] }));
  }, []);

  const products = data?.products || [];

  const expansions = useMemo(() => {
    const map = new Map();
    for (const product of products) {
      const key = product.expansionCode || String(product.idExpansion || "");
      if (!key) continue;
      map.set(key, product.expansionLabel || key);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [products]);

  const visible = useMemo(() => {
    const q = normalizeText(query);

    const filtered = products.filter((product) => {
      if (q) {
        const blob = normalizeText([
          product.name,
          product.expansionCode,
          product.expansionLabel,
          product.idProduct,
          product.idMetacard
        ].join(" "));
        if (!blob.includes(q)) return false;
      }

      if (expansion !== "all" && product.expansionCode !== expansion) return false;

      const value = priceValue(product, priceMode);
      if (priceStatus === "priced" && value === null) return false;
      if (priceStatus === "unpriced" && value !== null) return false;

      return true;
    });

    return filtered.sort((a, b) => {
      if (sortBy === "priceAsc") return (priceValue(a, priceMode) ?? 999999) - (priceValue(b, priceMode) ?? 999999);
      if (sortBy === "priceDesc") return (priceValue(b, priceMode) ?? -1) - (priceValue(a, priceMode) ?? -1);
      if (sortBy === "expansion") return String(a.expansionLabel || "").localeCompare(String(b.expansionLabel || "")) || a.name.localeCompare(b.name);
      if (sortBy === "product") return Number(a.idProduct || 0) - Number(b.idProduct || 0);
      return a.name.localeCompare(b.name);
    });
  }, [products, query, expansion, priceMode, priceStatus, sortBy]);

  const stats = useMemo(() => {
    const priced = products.filter((product) => product.priceFrom !== null && product.priceFrom !== undefined).length;
    const normal = products.filter((product) => product.normalPriceFrom !== null && product.normalPriceFrom !== undefined).length;
    const foil = products.filter((product) => product.foilPriceFrom !== null && product.foilPriceFrom !== undefined).length;

    return { priced, normal, foil };
  }, [products]);

  if (!data) {
    return (
      <main className="cmCatalogPage">
        <section className="panel">
          <h1>Cardmarket</h1>
          <p className="muted">Cargando base de datos de precios...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="cmCatalogPage">
      <section className="cmHero panel">
        <div>
          <p className="cmEyebrow">Base Cardmarket</p>
          <h1>Cartas, fotos y precios</h1>
          <p className="muted">
            Datos importados desde productos y price guide de Cardmarket. No aplican filtros de vendedor España, idioma inglés o Near Mint.
          </p>
        </div>
        <div className="cmKpis">
          <div><strong>{products.length}</strong><span>productos</span></div>
          <div><strong>{data.meta?.uniqueNames || "—"}</strong><span>nombres únicos</span></div>
          <div><strong>{stats.priced}</strong><span>con precio</span></div>
          <div><strong>{stats.foil}</strong><span>foil detectadas</span></div>
        </div>
      </section>

      <section className="cmControls panel">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar carta, producto, expansión..."
        />

        <select value={expansion} onChange={(event) => setExpansion(event.target.value)}>
          <option value="all">Todas las expansiones</option>
          {expansions.map(([code, label]) => (
            <option key={code} value={code}>{label} ({code})</option>
          ))}
        </select>

        <select value={priceMode} onChange={(event) => setPriceMode(event.target.value)}>
          <option value="all">Precio mostrado: mejor disponible</option>
          <option value="normal">Precio normal</option>
          <option value="foil">Precio foil</option>
        </select>

        <select value={priceStatus} onChange={(event) => setPriceStatus(event.target.value)}>
          <option value="all">Todas</option>
          <option value="priced">Con precio</option>
          <option value="unpriced">Sin precio</option>
        </select>

        <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
          <option value="name">Orden: nombre</option>
          <option value="priceAsc">Precio bajo</option>
          <option value="priceDesc">Precio alto</option>
          <option value="expansion">Expansión</option>
          <option value="product">ID producto</option>
        </select>
      </section>

      <div className="cmResultsBar">
        <strong>{visible.length}</strong>
        <span>resultados</span>
        {data.meta?.pricesCreatedAt && <span className="muted">Precios: {data.meta.pricesCreatedAt}</span>}
      </div>

      <section className="cmGrid">
        {visible.map((product) => {
          const shownPrice = priceValue(product, priceMode);
          return (
            <article className="cmCard" key={product.idProduct}>
              <a href={product.cardmarketUrl} target="_blank" rel="noreferrer" className="cmImageLink">
                <CardmarketImage product={product} />
              </a>

              <div className="cmCardBody">
                <div className="cmTopline">
                  <span>{product.expansionCode || "—"}</span>
                  <span>#{product.idProduct}</span>
                </div>

                <h2>{product.name}</h2>

                <div className="cmPriceMain">
                  <span>Desde</span>
                  <strong>{formatCurrency(shownPrice)}</strong>
                </div>

                <div className="cmPriceGrid">
                  <div>
                    <span>Normal</span>
                    <strong>{formatCurrency(product.normalPriceFrom)}</strong>
                  </div>
                  <div>
                    <span>Foil</span>
                    <strong>{formatCurrency(product.foilPriceFrom)}</strong>
                  </div>
                  <div>
                    <span>Tendencia</span>
                    <strong>{formatCurrency(product.prices?.normal?.trend)}</strong>
                  </div>
                  <div>
                    <span>Tend. foil</span>
                    <strong>{formatCurrency(product.prices?.foil?.trend)}</strong>
                  </div>
                </div>

                <a href={product.cardmarketUrl} target="_blank" rel="noreferrer" className="cmLink">
                  Ver en Cardmarket
                </a>
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
