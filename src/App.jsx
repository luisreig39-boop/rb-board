import { useCallback, useEffect, useMemo, useState } from "react";

const API_BASE = "https://api.riftcodex.com";
const PAGE_SIZE = 100;

const STORAGE = {
  cards: "rb-board-pro:cards:v1",
  collection: "rb-board-pro:collection:v1",
  decks: "rb-board-pro:decks:v1",
  settings: "rb-board-pro:settings:v1",
};

const DOMAIN_COLORS = {
  Fury: "#ff623d",
  Calm: "#60a5fa",
  Mind: "#2dd4bf",
  Body: "#84cc16",
  Chaos: "#d946ef",
  Order: "#f6d24a",
  Colorless: "#a8a8a8",
};

const ZONES = {
  legend: { label: "Legend", limit: 1, short: "LEG" },
  champion: { label: "Champion", limit: 1, short: "CH" },
  battlefields: { label: "Battlefields", limit: 3, short: "BF" },
  runes: { label: "Runes", limit: 12, short: "RUN" },
  main: { label: "Main Deck", limit: 40, short: "MAIN" },
  sideboard: { label: "Sideboard", limit: 8, short: "SIDE" },
};

const EMPTY_FILTERS = {
  query: "",
  sets: [],
  domains: [],
  types: [],
  supertypes: [],
  rarities: [],
  tags: "",
  ownership: "all",
  minEnergy: "",
  maxEnergy: "",
  onlyMeta: "all",
  zone: "all",
};

function safeJsonParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function loadLocal(key, fallback) {
  return safeJsonParse(localStorage.getItem(key), fallback);
}

function saveLocal(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value == null || value === "") return [];
  return [value];
}

function titleCase(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function normalizeCard(raw) {
  const setObject = typeof raw.set === "object" && raw.set !== null ? raw.set : {};
  const attributes = raw.attributes || {};
  const classification = raw.classification || {};
  const textObject = typeof raw.text === "object" && raw.text !== null ? raw.text : {};
  const media = raw.media || {};
  const metadata = raw.metadata || {};

  const setId = titleCase(setObject.set_id || raw.set_id || raw.set || raw.setCode).toUpperCase();
  const setLabel = setObject.label || setObject.name || raw.setName || raw.set_label || setId || "Sin set";
  const riftboundId = raw.riftbound_id || raw.riftboundId || raw.publicCode || raw.public_code || raw.code || "";
  const publicCode = raw.public_code || raw.publicCode || riftboundId || raw.collectorNumber || raw.collector_number || raw.id;
  const id = raw.id || normalizeId(`${setId}-${publicCode}-${raw.name}`);
  const domains = asArray(classification.domain || raw.domains || raw.domain).map(titleCase);
  const tags = asArray(raw.tags).map(titleCase);
  const type = titleCase(classification.type || raw.type || raw.cardType || "Unknown");
  const supertype = titleCase(classification.supertype || raw.supertype || "");
  const rarity = titleCase(classification.rarity || raw.rarity || "Unknown");

  const card = {
    id,
    name: raw.name || "Carta sin nombre",
    riftboundId: String(riftboundId || ""),
    publicCode: String(publicCode || ""),
    collectorNumber: Number(raw.collector_number ?? raw.collectorNumber ?? 0) || 0,
    setId,
    setLabel,
    domains,
    type,
    supertype,
    rarity,
    energy: numberOrNull(attributes.energy ?? raw.energy),
    might: numberOrNull(attributes.might ?? raw.might),
    power: numberOrNull(attributes.power ?? raw.power),
    text: String(textObject.plain || raw.text_plain || raw.rulesText || (typeof raw.text === "string" ? raw.text : "")),
    flavour: String(textObject.flavour || textObject.flavor || raw.flavour || raw.flavor || ""),
    artist: String(media.artist || raw.artist || ""),
    accessibilityText: String(media.accessibility_text || ""),
    mediaImageUrl: media.image_url || media.imageUrl || raw.image_url || raw.imageUrl || "",
    orientation: String(raw.orientation || "portrait").toLowerCase(),
    tags,
    metadata: {
      alternateArt: Boolean(metadata.alternate_art ?? raw.alternate_art),
      overnumbered: Boolean(metadata.overnumbered ?? raw.overnumbered),
      signature: Boolean(metadata.signature ?? raw.signature),
      updatedOn: metadata.updated_on || raw.updated_on || "",
      cleanName: metadata.clean_name || raw.clean_name || "",
    },
    raw,
  };

  card.imageCandidates = buildImageCandidates(card);
  card.deckZone = inferDeckZone(card);
  card.searchBlob = [
    card.name,
    card.riftboundId,
    card.publicCode,
    card.setId,
    card.setLabel,
    card.domains.join(" "),
    card.type,
    card.supertype,
    card.rarity,
    card.tags.join(" "),
    card.text,
  ]
    .join(" ")
    .toLowerCase();

  return card;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getPiltoverBaseCode(card) {
  const raw = String(card.riftboundId || card.publicCode || "").toUpperCase().replace("/", "-");
  const match = raw.match(/[A-Z0-9]+-\d{1,3}/);
  if (!match) return "";
  const [set, number] = match[0].split("-");
  return `${set}-${String(Number(number)).padStart(3, "0")}`;
}

function buildImageCandidates(card) {
  const baseCode = getPiltoverBaseCode(card);
  const candidates = [];

  // Piltover Archive primero. Si no existe, el componente hace fallback automático.
  if (baseCode) {
    if (card.metadata?.signature) candidates.push(`https://cdn.piltoverarchive.com/cards/${baseCode}s.webp`);
    if (card.metadata?.alternateArt || card.metadata?.overnumbered) candidates.push(`https://cdn.piltoverarchive.com/cards/${baseCode}a.webp`);
    candidates.push(`https://cdn.piltoverarchive.com/cards/${baseCode}.webp`);
  }

  if (card.mediaImageUrl) candidates.push(card.mediaImageUrl);
  return unique(candidates);
}

function inferDeckZone(card) {
  const combined = `${card.type} ${card.supertype}`.toLowerCase();
  if (combined.includes("legend")) return "legend";
  if (combined.includes("champion")) return "champion";
  if (combined.includes("battlefield")) return "battlefields";
  if (combined.includes("rune")) return "runes";
  return "main";
}

async function fetchCardsFromRiftcodex(onProgress) {
  let page = 1;
  let total = Infinity;
  const all = [];

  while (all.length < total && page < 250) {
    const url = `${API_BASE}/cards?size=${PAGE_SIZE}&page=${page}&sort=set_id&dir=1`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Riftcodex respondió ${res.status}`);
    const data = await res.json();
    const items = Array.isArray(data) ? data : data.items || data.data || data.results || [];
    total = Number(data.total || data.count || data.meta?.total || items.length || all.length);
    all.push(...items);
    onProgress?.({ loaded: all.length, total: Number.isFinite(total) ? total : all.length, page });
    if (!items.length || items.length < PAGE_SIZE) break;
    page += 1;
  }

  const normalized = all.map(normalizeCard);
  return normalized.sort(sortCardsDefault);
}

function sortCardsDefault(a, b) {
  return (
    String(a.setId).localeCompare(String(b.setId)) ||
    (a.collectorNumber || 0) - (b.collectorNumber || 0) ||
    a.name.localeCompare(b.name)
  );
}

function formatNumber(value) {
  return new Intl.NumberFormat("es-ES").format(value || 0);
}

function toggleListValue(list, value) {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

function matchesMultiFilter(cardValue, selected) {
  if (!selected.length) return true;
  const values = asArray(cardValue);
  return values.some((v) => selected.includes(v));
}

function applyFilters(cards, filters, collection) {
  const q = filters.query.trim().toLowerCase();
  const tagQ = filters.tags.trim().toLowerCase();
  const minEnergy = filters.minEnergy === "" ? null : Number(filters.minEnergy);
  const maxEnergy = filters.maxEnergy === "" ? null : Number(filters.maxEnergy);

  return cards.filter((card) => {
    if (q && !card.searchBlob.includes(q)) return false;
    if (tagQ && !card.tags.join(" ").toLowerCase().includes(tagQ)) return false;
    if (!matchesMultiFilter(card.setId, filters.sets)) return false;
    if (!matchesMultiFilter(card.domains, filters.domains)) return false;
    if (!matchesMultiFilter(card.type, filters.types)) return false;
    if (!matchesMultiFilter(card.supertype, filters.supertypes)) return false;
    if (!matchesMultiFilter(card.rarity, filters.rarities)) return false;
    if (filters.zone !== "all" && card.deckZone !== filters.zone) return false;

    const ownedQty = collection[card.id] || 0;
    if (filters.ownership === "owned" && ownedQty <= 0) return false;
    if (filters.ownership === "missing" && ownedQty > 0) return false;

    if (minEnergy !== null && (card.energy === null || card.energy < minEnergy)) return false;
    if (maxEnergy !== null && (card.energy === null || card.energy > maxEnergy)) return false;

    if (filters.onlyMeta === "alternate" && !card.metadata.alternateArt) return false;
    if (filters.onlyMeta === "overnumbered" && !card.metadata.overnumbered) return false;
    if (filters.onlyMeta === "signature" && !card.metadata.signature) return false;

    return true;
  });
}

function sortCards(cards, sortBy) {
  const list = [...cards];
  if (sortBy === "name") return list.sort((a, b) => a.name.localeCompare(b.name));
  if (sortBy === "rarity") return list.sort((a, b) => a.rarity.localeCompare(b.rarity) || sortCardsDefault(a, b));
  if (sortBy === "energy") return list.sort((a, b) => (a.energy ?? 99) - (b.energy ?? 99) || a.name.localeCompare(b.name));
  if (sortBy === "power") return list.sort((a, b) => (b.power ?? -1) - (a.power ?? -1) || a.name.localeCompare(b.name));
  return list.sort(sortCardsDefault);
}

function createEmptyDeck() {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID?.() || String(Date.now()),
    name: "Nuevo mazo",
    createdAt: now,
    updatedAt: now,
    cards: {},
    sideboard: {},
    notes: "",
  };
}

function getCardQtyInDeck(deck, cardId) {
  return (deck.cards?.[cardId] || 0) + (deck.sideboard?.[cardId] || 0);
}

function zoneCounts(deck, cardsById) {
  const counts = { legend: 0, champion: 0, battlefields: 0, runes: 0, main: 0, sideboard: 0 };
  for (const [cardId, qty] of Object.entries(deck.cards || {})) {
    const card = cardsById.get(cardId);
    if (!card) continue;
    counts[card.deckZone] = (counts[card.deckZone] || 0) + qty;
  }
  counts.sideboard = Object.values(deck.sideboard || {}).reduce((sum, qty) => sum + qty, 0);
  return counts;
}

function getCopyLimit(card, targetZone = null) {
  const zone = targetZone || card.deckZone;
  if (zone === "legend" || zone === "champion") return 1;
  if (zone === "runes") return 12;
  return 3;
}

function cleanDeckCards(deck) {
  const cleanMap = (map) =>
    Object.fromEntries(Object.entries(map || {}).filter(([, qty]) => Number(qty) > 0).map(([id, qty]) => [id, Number(qty)]));
  return { ...deck, cards: cleanMap(deck.cards), sideboard: cleanMap(deck.sideboard), updatedAt: new Date().toISOString() };
}

function deckLines(deck, cardsById) {
  const lines = [];
  for (const zoneKey of ["legend", "champion", "battlefields", "runes", "main"]) {
    const zoneCards = Object.entries(deck.cards || {})
      .map(([id, qty]) => ({ card: cardsById.get(id), qty }))
      .filter((x) => x.card && x.card.deckZone === zoneKey)
      .sort((a, b) => sortCardsDefault(a.card, b.card));
    if (!zoneCards.length) continue;
    if (lines.length) lines.push("");
    lines.push(`# ${ZONES[zoneKey].label}`);
    zoneCards.forEach(({ card, qty }) => lines.push(`${qty} ${card.name}`));
  }
  const side = Object.entries(deck.sideboard || {})
    .map(([id, qty]) => ({ card: cardsById.get(id), qty }))
    .filter((x) => x.card)
    .sort((a, b) => sortCardsDefault(a.card, b.card));
  if (side.length) {
    if (lines.length) lines.push("");
    lines.push(`# ${ZONES.sideboard.label}`);
    side.forEach(({ card, qty }) => lines.push(`${qty} ${card.name}`));
  }
  return lines.join("\n");
}

function importDeckText(text, cards) {
  const byName = new Map(cards.map((c) => [c.name.toLowerCase(), c]));
  const byCode = new Map(cards.flatMap((c) => [[c.publicCode.toLowerCase(), c], [c.riftboundId.toLowerCase(), c]]));
  const deck = createEmptyDeck();
  deck.name = "Mazo importado";
  let target = "cards";

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      if (line.toLowerCase().includes("side")) target = "sideboard";
      else target = "cards";
      continue;
    }
    const match = line.match(/^(\d+)\s+(.+)$/);
    if (!match) continue;
    const qty = Math.max(1, Number(match[1]));
    const token = match[2].trim().toLowerCase();
    const card = byName.get(token) || byCode.get(token);
    if (!card) continue;
    deck[target][card.id] = (deck[target][card.id] || 0) + qty;
  }

  return cleanDeckCards(deck);
}

function Pill({ children, color }) {
  return <span className="pill" style={{ "--pill": color || "#c8b891" }}>{children}</span>;
}

function ImageWithFallback({ card, className = "", alt }) {
  const candidates = card?.imageCandidates || [];
  const [index, setIndex] = useState(0);

  useEffect(() => setIndex(0), [card?.id]);

  if (!candidates.length || index >= candidates.length) {
    return (
      <div className={`imageFallback ${className}`}>
        <span>{card?.name || "Sin imagen"}</span>
      </div>
    );
  }

  return (
    <img
      className={className}
      src={candidates[index]}
      alt={alt || card.name}
      loading="lazy"
      onError={() => setIndex((x) => x + 1)}
    />
  );
}

function Header({ view, setView, cards, syncCards, syncing, progress, lastUpdated, clearCards }) {
  return (
    <header className="appHeader">
      <div>
        <div className="brandLine">
          <span className="brandMark">✦</span>
          <span className="brandTitle">Riftbound Board</span>
          <span className="brandBadge">Collection · Decks</span>
        </div>
        <p className="muted small">
          {cards.length ? `${formatNumber(cards.length)} cartas cargadas` : "Sin cartas cargadas"}
          {lastUpdated ? ` · actualizado ${new Date(lastUpdated).toLocaleString("es-ES")}` : ""}
        </p>
      </div>
      <nav className="topNav">
        <button className={view === "collection" ? "active" : ""} onClick={() => setView("collection")}>Colección</button>
        <button className={view === "decks" ? "active" : ""} onClick={() => setView("decks")}>Mazos</button>
        <button className={view === "stats" ? "active" : ""} onClick={() => setView("stats")}>Stats</button>
      </nav>
      <div className="headerActions">
        {syncing && <span className="syncText">{progress.loaded}/{progress.total || "?"}</span>}
        <button className="ghost" onClick={syncCards} disabled={syncing}>{syncing ? "Sincronizando..." : "Actualizar cartas"}</button>
        <button className="ghost danger" onClick={clearCards}>Limpiar caché</button>
      </div>
    </header>
  );
}

function FilterPanel({ cards, filters, setFilters, sortBy, setSortBy }) {
  const options = useMemo(() => ({
    sets: unique(cards.map((c) => c.setId)).sort(),
    domains: unique(cards.flatMap((c) => c.domains)).sort(),
    types: unique(cards.map((c) => c.type)).sort(),
    supertypes: unique(cards.map((c) => c.supertype)).sort(),
    rarities: unique(cards.map((c) => c.rarity)).sort(),
  }), [cards]);

  const toggle = (key, value) => setFilters((f) => ({ ...f, [key]: toggleListValue(f[key], value) }));

  return (
    <section className="panel filtersPanel">
      <div className="filterTop">
        <input
          className="searchInput"
          value={filters.query}
          onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
          placeholder="Buscar por nombre, código, texto, set, dominio..."
        />
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
          <option value="number">Orden: set + número</option>
          <option value="name">Orden: nombre</option>
          <option value="rarity">Orden: rareza</option>
          <option value="energy">Orden: energía</option>
          <option value="power">Orden: poder</option>
        </select>
        <button className="ghost" onClick={() => setFilters(EMPTY_FILTERS)}>Reset</button>
      </div>

      <FilterGroup title="Set" values={options.sets} selected={filters.sets} onToggle={(v) => toggle("sets", v)} />
      <FilterGroup title="Dominio" values={options.domains} selected={filters.domains} onToggle={(v) => toggle("domains", v)} colorMap={DOMAIN_COLORS} />
      <FilterGroup title="Tipo" values={options.types} selected={filters.types} onToggle={(v) => toggle("types", v)} />
      <FilterGroup title="Supertipo" values={options.supertypes} selected={filters.supertypes} onToggle={(v) => toggle("supertypes", v)} />
      <FilterGroup title="Rareza" values={options.rarities} selected={filters.rarities} onToggle={(v) => toggle("rarities", v)} />

      <div className="advancedFilters">
        <label>
          Colección
          <select value={filters.ownership} onChange={(e) => setFilters((f) => ({ ...f, ownership: e.target.value }))}>
            <option value="all">Todas</option>
            <option value="owned">Tengo</option>
            <option value="missing">Me faltan</option>
          </select>
        </label>
        <label>
          Zona de mazo
          <select value={filters.zone} onChange={(e) => setFilters((f) => ({ ...f, zone: e.target.value }))}>
            <option value="all">Todas</option>
            {Object.entries(ZONES).filter(([k]) => k !== "sideboard").map(([key, z]) => <option key={key} value={key}>{z.label}</option>)}
          </select>
        </label>
        <label>
          Energía min.
          <input type="number" value={filters.minEnergy} min="0" onChange={(e) => setFilters((f) => ({ ...f, minEnergy: e.target.value }))} />
        </label>
        <label>
          Energía max.
          <input type="number" value={filters.maxEnergy} min="0" onChange={(e) => setFilters((f) => ({ ...f, maxEnergy: e.target.value }))} />
        </label>
        <label>
          Tags
          <input value={filters.tags} placeholder="Noxus, Yordle..." onChange={(e) => setFilters((f) => ({ ...f, tags: e.target.value }))} />
        </label>
        <label>
          Especiales
          <select value={filters.onlyMeta} onChange={(e) => setFilters((f) => ({ ...f, onlyMeta: e.target.value }))}>
            <option value="all">Todas</option>
            <option value="alternate">Alternate Art</option>
            <option value="overnumbered">Overnumbered</option>
            <option value="signature">Signature</option>
          </select>
        </label>
      </div>
    </section>
  );
}

function FilterGroup({ title, values, selected, onToggle, colorMap = {} }) {
  if (!values.length) return null;
  return (
    <div className="filterGroup">
      <span className="filterTitle">{title}</span>
      <div className="chips">
        {values.map((value) => (
          <button
            key={value}
            className={`chip ${selected.includes(value) ? "selected" : ""}`}
            style={{ "--chip": colorMap[value] || "#c8b891" }}
            onClick={() => onToggle(value)}
          >
            {value}
          </button>
        ))}
      </div>
    </div>
  );
}

function CollectionView({ cards, collection, setCollection }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sortBy, setSortBy] = useState("number");
  const [selected, setSelected] = useState(null);

  const visible = useMemo(() => sortCards(applyFilters(cards, filters, collection), sortBy), [cards, filters, collection, sortBy]);
  const stats = useMemo(() => getCollectionStats(cards, collection), [cards, collection]);

  const updateQty = useCallback((cardId, qty) => {
    setCollection((prev) => {
      const next = { ...prev };
      const cleanQty = Math.max(0, Math.min(99, Number(qty) || 0));
      if (cleanQty <= 0) delete next[cardId];
      else next[cardId] = cleanQty;
      return next;
    });
  }, [setCollection]);

  const exportCollection = () => downloadJson("riftbound-collection.json", collection);
  const importCollection = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const data = safeJsonParse(text, null);
    if (data && typeof data === "object") setCollection(data);
    event.target.value = "";
  };

  return (
    <main className="pageGrid">
      <aside className="sidebar">
        <section className="panel statsPanel">
          <div className="bigStat">{stats.ownedUnique}<span>/{stats.total}</span></div>
          <div className="progress"><span style={{ width: `${stats.percent}%` }} /></div>
          <p className="muted small">{stats.percent}% de colección · {stats.ownedQty} cartas totales registradas</p>
          <div className="miniActions">
            <button className="ghost" onClick={exportCollection}>Exportar colección</button>
            <label className="ghost fileButton">Importar<input type="file" accept="application/json" onChange={importCollection} /></label>
          </div>
        </section>
        <FilterPanel cards={cards} filters={filters} setFilters={setFilters} sortBy={sortBy} setSortBy={setSortBy} />
      </aside>

      <section className="contentArea">
        <div className="resultsBar">
          <strong>{formatNumber(visible.length)}</strong> cartas encontradas
          <span className="muted">Pulsa + para añadir a tu colección.</span>
        </div>
        <div className="cardGrid">
          {visible.map((card) => (
            <CardTile
              key={card.id}
              card={card}
              qty={collection[card.id] || 0}
              onQty={updateQty}
              onOpen={setSelected}
            />
          ))}
        </div>
        {!visible.length && <EmptyState title="No hay cartas con esos filtros" text="Prueba a quitar algún filtro o pulsa Reset." />}
      </section>

      {selected && <CardModal card={selected} qty={collection[selected.id] || 0} onQty={updateQty} onClose={() => setSelected(null)} />}
    </main>
  );
}

function getCollectionStats(cards, collection) {
  const total = cards.length;
  const ownedUnique = cards.filter((c) => (collection[c.id] || 0) > 0).length;
  const ownedQty = Object.values(collection).reduce((sum, n) => sum + Number(n || 0), 0);
  return { total, ownedUnique, ownedQty, percent: total ? Math.round((ownedUnique / total) * 100) : 0 };
}

function CardTile({ card, qty, onQty, onOpen }) {
  const domainColor = DOMAIN_COLORS[card.domains[0]] || "#c8b891";
  return (
    <article className={`cardTile ${qty > 0 ? "owned" : "missing"}`} style={{ "--domain": domainColor }}>
      <button className="cardImageButton" onClick={() => onOpen(card)} title={`Abrir ${card.name}`}>
        <ImageWithFallback card={card} className="cardImage" />
        <span className="cardQty">×{qty}</span>
      </button>
      <div className="cardInfo">
        <button className="cardName" onClick={() => onOpen(card)}>{card.name}</button>
        <span className="cardMeta">{card.publicCode || card.riftboundId} · {card.type}{card.supertype ? ` · ${card.supertype}` : ""}</span>
        <div className="qtyControls">
          <button onClick={() => onQty(card.id, qty - 1)}>−</button>
          <input value={qty} onChange={(e) => onQty(card.id, e.target.value)} inputMode="numeric" />
          <button onClick={() => onQty(card.id, qty + 1)}>+</button>
        </div>
      </div>
    </article>
  );
}

function CardModal({ card, qty, onQty, onClose }) {
  const domainColor = DOMAIN_COLORS[card.domains[0]] || "#c8b891";
  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modal cardModal" onClick={(e) => e.stopPropagation()} style={{ "--domain": domainColor }}>
        <button className="modalClose" onClick={onClose}>×</button>
        <div className="modalImageWrap">
          <ImageWithFallback card={card} className="modalImage" />
        </div>
        <div className="modalBody">
          <p className="eyebrow">{card.setLabel} · {card.publicCode || card.riftboundId}</p>
          <h2>{card.name}</h2>
          <div className="pillRow">
            {card.domains.map((d) => <Pill key={d} color={DOMAIN_COLORS[d]}>{d}</Pill>)}
            <Pill>{card.type}</Pill>
            {card.supertype && <Pill>{card.supertype}</Pill>}
            <Pill>{card.rarity}</Pill>
          </div>
          <div className="statStrip">
            <Stat label="Energía" value={card.energy ?? "—"} />
            <Stat label="Poder" value={card.power ?? "—"} />
            <Stat label="Might" value={card.might ?? "—"} />
            <Stat label="Zona" value={ZONES[card.deckZone]?.short || "—"} />
          </div>
          {card.text && <p className="rulesText">{card.text}</p>}
          {card.flavour && <p className="flavourText">“{card.flavour}”</p>}
          {card.tags.length > 0 && <p className="muted small">Tags: {card.tags.join(", ")}</p>}
          {card.artist && <p className="muted small">Artista: {card.artist}</p>}
          <div className="modalActions">
            <button onClick={() => onQty(card.id, qty - 1)}>−</button>
            <strong>{qty}</strong>
            <button onClick={() => onQty(card.id, qty + 1)}>+</button>
            <span className="muted">en tu colección</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function DecksView({ cards, collection, decks, setDecks }) {
  const cardsById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const [activeId, setActiveId] = useState(decks[0]?.id || "");
  const [builderFilters, setBuilderFilters] = useState({ ...EMPTY_FILTERS, ownership: "owned" });
  const [sortBy, setSortBy] = useState("number");
  const [importText, setImportText] = useState("");

  useEffect(() => {
    if (!activeId && decks[0]) setActiveId(decks[0].id);
    if (activeId && !decks.find((d) => d.id === activeId)) setActiveId(decks[0]?.id || "");
  }, [decks, activeId]);

  const activeDeck = decks.find((d) => d.id === activeId) || null;
  const builderCards = useMemo(() => sortCards(applyFilters(cards, builderFilters, collection), sortBy), [cards, builderFilters, collection, sortBy]);

  const updateDeck = (deck) => setDecks((prev) => prev.map((d) => (d.id === deck.id ? cleanDeckCards(deck) : d)));

  const createDeck = () => {
    const deck = createEmptyDeck();
    setDecks((prev) => [deck, ...prev]);
    setActiveId(deck.id);
  };

  const deleteDeck = (deckId) => {
    if (!confirm("¿Eliminar este mazo?")) return;
    setDecks((prev) => prev.filter((d) => d.id !== deckId));
  };

  const duplicateDeck = (deck) => {
    const copy = { ...deck, id: crypto.randomUUID?.() || String(Date.now()), name: `${deck.name} copia`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    setDecks((prev) => [copy, ...prev]);
    setActiveId(copy.id);
  };

  const addCard = (card, target = null) => {
    if (!activeDeck) return;
    const zone = target || card.deckZone;
    const deck = structuredClone(activeDeck);
    const mapKey = zone === "sideboard" ? "sideboard" : "cards";
    const counts = zoneCounts(deck, cardsById);
    const currentZoneCount = zone === "sideboard" ? counts.sideboard : counts[card.deckZone];
    const zoneLimit = zone === "sideboard" ? ZONES.sideboard.limit : ZONES[card.deckZone].limit;
    const usedTotal = getCardQtyInDeck(deck, card.id);
    const ownedQty = collection[card.id] || 0;
    const copyLimit = getCopyLimit(card, zone);

    if (currentZoneCount >= zoneLimit) return;
    if ((deck[mapKey][card.id] || 0) >= copyLimit) return;
    if (builderFilters.ownership === "owned" && usedTotal >= ownedQty) return;
    deck[mapKey][card.id] = (deck[mapKey][card.id] || 0) + 1;
    updateDeck(deck);
  };

  const removeCard = (cardId, mapKey = "cards") => {
    if (!activeDeck) return;
    const deck = structuredClone(activeDeck);
    deck[mapKey][cardId] = Math.max(0, (deck[mapKey][cardId] || 0) - 1);
    if (deck[mapKey][cardId] <= 0) delete deck[mapKey][cardId];
    updateDeck(deck);
  };

  const setDeckName = (name) => activeDeck && updateDeck({ ...activeDeck, name });
  const setDeckNotes = (notes) => activeDeck && updateDeck({ ...activeDeck, notes });

  const handleImport = () => {
    if (!importText.trim()) return;
    const imported = importDeckText(importText, cards);
    setDecks((prev) => [imported, ...prev]);
    setActiveId(imported.id);
    setImportText("");
  };

  return (
    <main className="decksLayout">
      <aside className="deckSidebar panel">
        <button className="primary full" onClick={createDeck}>+ Nuevo mazo</button>
        <div className="deckList">
          {decks.map((deck) => {
            const counts = zoneCounts(deck, cardsById);
            const total = counts.legend + counts.champion + counts.battlefields + counts.runes + counts.main;
            return (
              <button key={deck.id} className={`deckListItem ${deck.id === activeId ? "active" : ""}`} onClick={() => setActiveId(deck.id)}>
                <strong>{deck.name}</strong>
                <span>{total}/57 + side {counts.sideboard}/8</span>
              </button>
            );
          })}
        </div>
        <div className="importBox">
          <h3>Importar decklist</h3>
          <textarea value={importText} onChange={(e) => setImportText(e.target.value)} placeholder={"1 Viktor, Leader\n3 Seal of Unity\n12 Order Rune"} />
          <button className="ghost full" onClick={handleImport}>Importar como nuevo mazo</button>
        </div>
      </aside>

      {!activeDeck ? (
        <EmptyState title="Todavía no tienes mazos" text="Crea tu primer mazo y empieza a añadir cartas desde tu colección." action={<button className="primary" onClick={createDeck}>Crear mazo</button>} />
      ) : (
        <>
          <section className="deckEditor panel">
            <div className="deckHeader">
              <input className="deckNameInput" value={activeDeck.name} onChange={(e) => setDeckName(e.target.value)} />
              <div className="deckActions">
                <button className="ghost" onClick={() => duplicateDeck(activeDeck)}>Duplicar</button>
                <button className="ghost" onClick={() => navigator.clipboard?.writeText(deckLines(activeDeck, cardsById))}>Copiar lista</button>
                <button className="ghost" onClick={() => downloadText(`${activeDeck.name}.txt`, deckLines(activeDeck, cardsById))}>Exportar TXT</button>
                <button className="ghost danger" onClick={() => deleteDeck(activeDeck.id)}>Eliminar</button>
              </div>
            </div>
            <DeckValidation deck={activeDeck} collection={collection} cardsById={cardsById} />
            <DeckZones deck={activeDeck} cardsById={cardsById} collection={collection} onRemove={removeCard} />
            <label className="notesLabel">Notas del mazo<textarea value={activeDeck.notes || ""} onChange={(e) => setDeckNotes(e.target.value)} placeholder="Plan de juego, matchups, cambios pendientes..." /></label>
          </section>

          <aside className="builderPanel panel">
            <h2>Añadir cartas</h2>
            <FilterPanel cards={cards} filters={builderFilters} setFilters={setBuilderFilters} sortBy={sortBy} setSortBy={setSortBy} />
            <div className="builderGrid">
              {builderCards.map((card) => {
                const used = getCardQtyInDeck(activeDeck, card.id);
                const owned = collection[card.id] || 0;
                return (
                  <div key={card.id} className="builderCard" title="Añadir al mazo">
                    <button className="builderCardMain" onClick={() => addCard(card)}>
                      <ImageWithFallback card={card} className="builderImage" />
                      <span>{card.name}</span>
                      <small>{used}/{owned || "∞"} · {ZONES[card.deckZone]?.short}</small>
                    </button>
                    <div className="builderCardActions">
                      <button onClick={() => addCard(card)}>+ zona</button>
                      <button onClick={() => addCard(card, "sideboard")}>+ side</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>
        </>
      )}
    </main>
  );
}

function DeckValidation({ deck, collection, cardsById }) {
  const counts = zoneCounts(deck, cardsById);
  const issues = [];
  for (const [zone, info] of Object.entries(ZONES)) {
    const count = counts[zone] || 0;
    if (zone === "sideboard") {
      if (count > info.limit) issues.push(`Sideboard sobrepasa ${info.limit}`);
    } else if (count !== info.limit) {
      issues.push(`${info.label}: ${count}/${info.limit}`);
    }
  }

  for (const [id, qty] of [...Object.entries(deck.cards || {}), ...Object.entries(deck.sideboard || {})]) {
    const card = cardsById.get(id);
    if (!card) continue;
    const owned = collection[id] || 0;
    const used = getCardQtyInDeck(deck, id);
    if (used > owned) issues.push(`Faltan ${used - owned} × ${card.name}`);
  }

  return (
    <div className={`validation ${issues.length ? "warn" : "ok"}`}>
      {issues.length ? <><strong>Revisión:</strong> {issues.slice(0, 6).join(" · ")}{issues.length > 6 ? "..." : ""}</> : "Mazo completo con tu colección actual."}
    </div>
  );
}

function DeckZones({ deck, cardsById, collection, onRemove }) {
  const counts = zoneCounts(deck, cardsById);
  return (
    <div className="deckZones">
      {Object.entries(ZONES).map(([zoneKey, zone]) => {
        const mapKey = zoneKey === "sideboard" ? "sideboard" : "cards";
        const entries = Object.entries(deck[mapKey] || {})
          .map(([id, qty]) => ({ card: cardsById.get(id), qty }))
          .filter(({ card }) => card && (zoneKey === "sideboard" || card.deckZone === zoneKey))
          .sort((a, b) => sortCardsDefault(a.card, b.card));
        return (
          <section key={zoneKey} className="deckZone">
            <h3>{zone.label} <span>{counts[zoneKey] || 0}/{zone.limit}</span></h3>
            {entries.length ? entries.map(({ card, qty }) => (
              <div key={card.id} className={(collection[card.id] || 0) < getCardQtyInDeck(deck, card.id) ? "deckRow missingOwned" : "deckRow"}>
                <span className="deckQty">{qty}×</span>
                <span className="deckCardName">{card.name}</span>
                <span className="deckCode">{card.publicCode || card.riftboundId}</span>
                <button onClick={() => onRemove(card.id, mapKey)}>−</button>
              </div>
            )) : <p className="muted small">Sin cartas todavía.</p>}
          </section>
        );
      })}
    </div>
  );
}

function StatsView({ cards, collection, decks }) {
  const statsBySet = useMemo(() => {
    const map = new Map();
    cards.forEach((card) => {
      const key = card.setId || "?";
      if (!map.has(key)) map.set(key, { label: card.setLabel, total: 0, owned: 0, qty: 0 });
      const item = map.get(key);
      item.total += 1;
      if ((collection[card.id] || 0) > 0) item.owned += 1;
      item.qty += collection[card.id] || 0;
    });
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [cards, collection]);

  const statsByRarity = useMemo(() => {
    const map = new Map();
    cards.forEach((card) => {
      const key = card.rarity || "Unknown";
      if (!map.has(key)) map.set(key, { total: 0, owned: 0 });
      const item = map.get(key);
      item.total += 1;
      if ((collection[card.id] || 0) > 0) item.owned += 1;
    });
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [cards, collection]);

  return (
    <main className="statsPage">
      <section className="panel">
        <h2>Progreso por set</h2>
        <div className="tableLike">
          {statsBySet.map(([setId, data]) => {
            const pct = data.total ? Math.round((data.owned / data.total) * 100) : 0;
            return (
              <div key={setId} className="tableRow">
                <strong>{setId}</strong>
                <span>{data.label}</span>
                <span>{data.owned}/{data.total}</span>
                <div className="progress"><span style={{ width: `${pct}%` }} /></div>
                <span>{pct}%</span>
              </div>
            );
          })}
        </div>
      </section>
      <section className="panel">
        <h2>Progreso por rareza</h2>
        <div className="tableLike compact">
          {statsByRarity.map(([rarity, data]) => {
            const pct = data.total ? Math.round((data.owned / data.total) * 100) : 0;
            return <div key={rarity} className="tableRow"><strong>{rarity}</strong><span>{data.owned}/{data.total}</span><div className="progress"><span style={{ width: `${pct}%` }} /></div><span>{pct}%</span></div>;
          })}
        </div>
      </section>
      <section className="panel">
        <h2>Mazos guardados</h2>
        <p className="bigStat">{decks.length}</p>
        <p className="muted">Los datos se guardan en este navegador. Exporta tu colección o mazos si vas a cambiar de ordenador.</p>
      </section>
    </main>
  );
}

function EmptyState({ title, text, action }) {
  return <div className="emptyState"><h2>{title}</h2><p>{text}</p>{action}</div>;
}

function downloadJson(filename, data) {
  downloadText(filename, JSON.stringify(data, null, 2));
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [cards, setCards] = useState(() => loadLocal(STORAGE.cards, []));
  const [collection, setCollection] = useState(() => loadLocal(STORAGE.collection, {}));
  const [decks, setDecks] = useState(() => loadLocal(STORAGE.decks, []));
  const [settings, setSettings] = useState(() => loadLocal(STORAGE.settings, { lastUpdated: "" }));
  const [view, setView] = useState("collection");
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState({ loaded: 0, total: 0, page: 0 });
  const [error, setError] = useState("");

  useEffect(() => saveLocal(STORAGE.collection, collection), [collection]);
  useEffect(() => saveLocal(STORAGE.decks, decks), [decks]);
  useEffect(() => saveLocal(STORAGE.settings, settings), [settings]);
  useEffect(() => {
    if (!cards.length) syncCards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncCards = useCallback(async () => {
    setSyncing(true);
    setError("");
    try {
      const fresh = await fetchCardsFromRiftcodex(setProgress);
      setCards(fresh);
      saveLocal(STORAGE.cards, fresh);
      setSettings((s) => ({ ...s, lastUpdated: new Date().toISOString() }));
    } catch (err) {
      setError(err.message || "No se han podido cargar las cartas.");
    } finally {
      setSyncing(false);
    }
  }, []);

  const clearCards = () => {
    if (!confirm("¿Limpiar la caché de cartas? No se borran colección ni mazos.")) return;
    localStorage.removeItem(STORAGE.cards);
    setCards([]);
  };

  return (
    <div className="appShell">
      <Header
        view={view}
        setView={setView}
        cards={cards}
        syncCards={syncCards}
        syncing={syncing}
        progress={progress}
        lastUpdated={settings.lastUpdated}
        clearCards={clearCards}
      />
      {error && <div className="errorBanner"><strong>Error:</strong> {error}. Si Riftcodex está caído, prueba más tarde o conserva la caché local.</div>}
      {!cards.length && syncing && <EmptyState title="Cargando cartas" text={`Descargadas ${progress.loaded}/${progress.total || "?"}. La primera carga puede tardar un poco.`} />}
      {!cards.length && !syncing && <EmptyState title="No hay cartas cargadas" text="Pulsa Actualizar cartas para descargar la base de datos." action={<button className="primary" onClick={syncCards}>Actualizar cartas</button>} />}
      {cards.length > 0 && view === "collection" && <CollectionView cards={cards} collection={collection} setCollection={setCollection} />}
      {cards.length > 0 && view === "decks" && <DecksView cards={cards} collection={collection} decks={decks} setDecks={setDecks} />}
      {cards.length > 0 && view === "stats" && <StatsView cards={cards} collection={collection} decks={decks} />}
    </div>
  );
}
