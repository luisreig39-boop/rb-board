import { useEffect, useMemo, useState } from "react";
import "./legend-stats.css";

const CATEGORY_LABELS = {
  core: "Core",
  flex: "Flex",
  fringe: "Fringe",
  gem: "Gem",
  trap: "Trap",
};

const CATEGORY_HELP = {
  core: "Cartas que forman el esqueleto del mazo.",
  flex: "Opciones jugables según versión, meta o preferencias.",
  fringe: "Cartas situacionales o con poca presencia.",
  gem: "Cartas poco jugadas que rinden por encima de la media.",
  trap: "Cartas que se juegan, pero suelen rendir peor.",
};

const CATEGORY_ORDER = ["core", "flex", "gem", "trap", "fringe"];

function normalizeId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function formatPercent(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("es-ES", { maximumFractionDigits: digits })}%`;
}

function formatScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`;
}

function formatNumber(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("es-ES", { maximumFractionDigits: digits });
}

function cleanLegendName(name, slug) {
  const text = String(name || "")
    .replace(/Card Analysis.*$/i, "")
    .replace(/Performance Stats.*$/i, "")
    .trim();

  if (text) return text;

  return String(slug || "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function categoryClass(category) {
  return `legendCategory legendCategory--${category || "unknown"}`;
}

function pickBoard(legend) {
  const boards = Object.keys(legend?.boards || {});
  if (boards.includes("main")) return "main";
  return boards[0] || "";
}

function getBoardCards(legend, boardKey) {
  const board = legend?.boards?.[boardKey];
  if (!board) return [];
  return Array.isArray(board) ? board : board.cards || [];
}

function getBoardMeta(legend, boardKey) {
  const board = legend?.boards?.[boardKey];
  if (!board) return {};
  return Array.isArray(board) ? { cards: board } : board;
}

function sortCards(cards, sortBy) {
  const list = [...cards];

  const byNumber = (getter, dir = "desc") => {
    list.sort((a, b) => {
      const av = Number(getter(a));
      const bv = Number(getter(b));
      const safeA = Number.isFinite(av) ? av : dir === "desc" ? -Infinity : Infinity;
      const safeB = Number.isFinite(bv) ? bv : dir === "desc" ? -Infinity : Infinity;
      return dir === "desc" ? safeB - safeA : safeA - safeB;
    });
    return list;
  };

  if (sortBy === "presence") return byNumber((c) => c.presence ?? c.inclusionRate, "desc");
  if (sortBy === "score") return byNumber((c) => c.performanceScore ?? c.score, "desc");
  if (sortBy === "topCutRate") return byNumber((c) => c.topCutRate, "desc");
  if (sortBy === "avgCopies") return byNumber((c) => c.avgCopies, "desc");
  if (sortBy === "category") {
    return list.sort((a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a.category);
      const bi = CATEGORY_ORDER.indexOf(b.category);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || (b.presence || 0) - (a.presence || 0);
    });
  }
  return list.sort((a, b) => String(a.cardName).localeCompare(String(b.cardName)));
}

function parseDeckText(text) {
  const names = new Set();

  String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      if (line.startsWith("#") || line.startsWith("//")) return;

      let clean = line
        .replace(/^\d+\s+x?\s*/i, "")
        .replace(/\s+x\s*\d+$/i, "")
        .replace(/\([^)]*\)$/g, "")
        .trim();

      if (!clean) return;
      names.add(normalizeId(clean));
    });

  return names;
}

function useLegendStats() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;

    fetch(`${import.meta.env.BASE_URL}data/legend-card-stats.json?v=${Date.now()}`, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`No se ha podido cargar legend-card-stats.json (${res.status})`);
        return res.json();
      })
      .then((json) => {
        if (!alive) return;
        setData(json);
        setStatus("ready");
      })
      .catch((err) => {
        if (!alive) return;
        setError(err.message || "No se ha podido cargar el JSON de estadísticas.");
        setStatus("error");
      });

    return () => {
      alive = false;
    };
  }, []);

  return { data, status, error };
}

function StatCard({ label, value, detail }) {
  return (
    <div className="legendStatCard">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

function CategoryPill({ category, count, active, onClick }) {
  return (
    <button className={`${categoryClass(category)} ${active ? "isActive" : ""}`} onClick={onClick} type="button" title={CATEGORY_HELP[category] || ""}>
      <span>{CATEGORY_LABELS[category] || category || "Sin categoría"}</span>
      {count !== undefined ? <b>{count}</b> : null}
    </button>
  );
}

function CardStatTile({ card, compact = false }) {
  const category = card.category || "unknown";

  return (
    <article className={`legendCardStat ${compact ? "legendCardStat--compact" : ""}`}>
      <div className="legendCardImageWrap">
        {card.imageUrl ? (
          <img src={card.imageUrl} alt={card.cardName} loading="lazy" />
        ) : (
          <div className="legendCardImageFallback">{card.cardName}</div>
        )}
        <span className={categoryClass(category)}>{CATEGORY_LABELS[category] || category}</span>
        {card.avgCopies != null ? <span className="legendCopies">×{formatNumber(card.avgCopies)}</span> : null}
      </div>

      <div className="legendCardInfo">
        <div>
          <h4>{card.cardName}</h4>
          <p>{card.setId || "—"} {card.publicCode ? `· ${card.publicCode}` : ""}</p>
        </div>

        <div className="legendMetricGrid">
          <span><b>{formatPercent(card.inclusionRate ?? card.presence)}</b><small>presencia</small></span>
          <span><b>{formatScore(card.performanceScore ?? card.score)}</b><small>score</small></span>
          <span><b>{formatPercent(card.topCutRate)}</b><small>top-cut</small></span>
          <span><b>{formatNumber(card.avgCopies)}</b><small>copias</small></span>
        </div>
      </div>
    </article>
  );
}

function BuilderHelper({ cards }) {
  const [deckText, setDeckText] = useState("");
  const deckNames = useMemo(() => parseDeckText(deckText), [deckText]);

  const analysis = useMemo(() => {
    const byCategory = (category) => cards.filter((card) => card.category === category);
    const owns = (card) => deckNames.has(normalizeId(card.cardName));

    const included = cards.filter(owns);
    const missingCore = byCategory("core").filter((card) => !owns(card)).sort((a, b) => (b.presence || 0) - (a.presence || 0));
    const gemCandidates = byCategory("gem").filter((card) => !owns(card)).sort((a, b) => (b.performanceScore || b.score || 0) - (a.performanceScore || a.score || 0));
    const flexCandidates = byCategory("flex").filter((card) => !owns(card)).sort((a, b) => (b.presence || 0) - (a.presence || 0));
    const trapsIncluded = byCategory("trap").filter(owns);

    return {
      included,
      missingCore,
      gemCandidates,
      flexCandidates,
      trapsIncluded,
      recognized: included.length,
    };
  }, [cards, deckNames]);

  return (
    <section className="legendBuilderHelper">
      <div className="legendBuilderHeader">
        <div>
          <h3>Asistente de decklist</h3>
          <p>Pega una lista de cartas y te diré qué core te falta, qué gems podrías valorar y qué traps estás jugando.</p>
        </div>
        <div className="legendBuilderCount">
          <strong>{analysis.recognized}</strong>
          <span>cartas reconocidas</span>
        </div>
      </div>

      <textarea
        value={deckText}
        onChange={(e) => setDeckText(e.target.value)}
        placeholder={"Ejemplo:\n3 Soaring Scout\n2 Mirror Image\n1 Atakhan"}
      />

      {deckText.trim() ? (
        <div className="legendSuggestions">
          <div className="legendSuggestionBlock">
            <h4>Core que faltan</h4>
            {analysis.missingCore.length ? analysis.missingCore.slice(0, 8).map((card) => <CardStatTile key={card.cardKey} card={card} compact />) : <p className="legendMuted">Tienes todas las core detectadas para esta leyenda.</p>}
          </div>

          <div className="legendSuggestionBlock">
            <h4>Gems a considerar</h4>
            {analysis.gemCandidates.length ? analysis.gemCandidates.slice(0, 8).map((card) => <CardStatTile key={card.cardKey} card={card} compact />) : <p className="legendMuted">No hay gems pendientes en este board.</p>}
          </div>

          <div className="legendSuggestionBlock">
            <h4>Flex populares</h4>
            {analysis.flexCandidates.length ? analysis.flexCandidates.slice(0, 8).map((card) => <CardStatTile key={card.cardKey} card={card} compact />) : <p className="legendMuted">No hay flex pendientes destacadas.</p>}
          </div>

          <div className="legendSuggestionBlock">
            <h4>Traps incluidas</h4>
            {analysis.trapsIncluded.length ? analysis.trapsIncluded.map((card) => <CardStatTile key={card.cardKey} card={card} compact />) : <p className="legendMuted">No estás jugando cartas marcadas como trap en esta muestra.</p>}
          </div>
        </div>
      ) : (
        <p className="legendMuted">Cuando pegues una decklist, el asistente comparará tu lista con las estadísticas de la leyenda seleccionada.</p>
      )}
    </section>
  );
}

export function LegendStatsView() {
  const { data, status, error } = useLegendStats();
  const [selectedLegendSlug, setSelectedLegendSlug] = useState("");
  const [selectedBoard, setSelectedBoard] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [sortBy, setSortBy] = useState("presence");
  const [minPresence, setMinPresence] = useState("");

  const legends = useMemo(() => {
    const entries = Object.entries(data?.legends || {}).map(([slug, legend]) => ({
      ...legend,
      slug,
      displayName: cleanLegendName(legend.name, slug),
    }));

    return entries.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [data]);

  useEffect(() => {
    if (!legends.length) return;
    if (!selectedLegendSlug || !legends.some((legend) => legend.slug === selectedLegendSlug)) {
      const first = legends[0];
      setSelectedLegendSlug(first.slug);
      setSelectedBoard(pickBoard(first));
    }
  }, [legends, selectedLegendSlug]);

  const selectedLegend = legends.find((legend) => legend.slug === selectedLegendSlug);
  const boardKeys = Object.keys(selectedLegend?.boards || {});

  useEffect(() => {
    if (!selectedLegend) return;
    if (!selectedBoard || !boardKeys.includes(selectedBoard)) {
      setSelectedBoard(pickBoard(selectedLegend));
    }
  }, [selectedLegend, selectedBoard, boardKeys.join("|")]);

  const boardMeta = getBoardMeta(selectedLegend, selectedBoard);
  const boardCards = getBoardCards(selectedLegend, selectedBoard);

  const categoryCounts = useMemo(() => {
    const counts = { all: boardCards.length };
    boardCards.forEach((card) => {
      const key = card.category || "unknown";
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }, [boardCards]);

  const filteredCards = useMemo(() => {
    const q = normalizeId(query);
    const min = minPresence === "" ? null : Number(minPresence);

    const filtered = boardCards.filter((card) => {
      if (category !== "all" && card.category !== category) return false;
      if (q && !`${normalizeId(card.cardName)} ${normalizeId(card.setId)} ${normalizeId(card.publicCode)}`.includes(q)) return false;
      if (min !== null && Number(card.presence ?? card.inclusionRate ?? 0) < min) return false;
      return true;
    });

    return sortCards(filtered, sortBy);
  }, [boardCards, query, category, sortBy, minPresence]);

  const summary = useMemo(() => {
    const core = boardCards.filter((card) => card.category === "core");
    const gems = boardCards.filter((card) => card.category === "gem");
    const traps = boardCards.filter((card) => card.category === "trap");

    const avgScore = boardCards.length
      ? boardCards.reduce((sum, card) => sum + Number(card.performanceScore ?? card.score ?? 0), 0) / boardCards.length
      : 0;

    return {
      total: boardCards.length,
      core: core.length,
      gems: gems.length,
      traps: traps.length,
      avgScore,
      topCore: [...core].sort((a, b) => (b.presence || 0) - (a.presence || 0)).slice(0, 3),
      topGems: [...gems].sort((a, b) => (b.performanceScore || b.score || 0) - (a.performanceScore || a.score || 0)).slice(0, 3),
    };
  }, [boardCards]);

  if (status === "loading") {
    return (
      <main className="legendStatsPage">
        <section className="legendStatsPanel">
          <h2>Cargando estadísticas de leyendas...</h2>
          <p className="legendMuted">Leyendo public/data/legend-card-stats.json</p>
        </section>
      </main>
    );
  }

  if (status === "error") {
    return (
      <main className="legendStatsPage">
        <section className="legendStatsPanel legendStatsError">
          <h2>No se han podido cargar las estadísticas</h2>
          <p>{error}</p>
          <p className="legendMuted">Comprueba que el archivo exista en public/data/legend-card-stats.json.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="legendStatsPage">
      <section className="legendHero">
        <div>
          <p className="legendEyebrow">Riftdecks Card Stats</p>
          <h1>Estadísticas por leyenda</h1>
          <p>
            Consulta qué cartas son core, flex, gems, traps o fringe para cada leyenda. Después podrás usar estos datos para el builder asistido.
          </p>
        </div>

        <div className="legendHeroStats">
          <StatCard label="Leyendas" value={data?.meta?.totalLegends ?? legends.length} />
          <StatCard label="Boards" value={data?.meta?.totalBoards ?? "—"} />
          <StatCard label="Cartas analizadas" value={data?.meta?.totalCards ?? "—"} />
          <StatCard label="Actualizado" value={data?.meta?.updatedAt ? new Date(data.meta.updatedAt).toLocaleDateString("es-ES") : "—"} />
        </div>
      </section>

      <section className="legendControls legendStatsPanel">
        <label>
          Leyenda
          <select value={selectedLegendSlug} onChange={(e) => {
            const slug = e.target.value;
            const legend = legends.find((item) => item.slug === slug);
            setSelectedLegendSlug(slug);
            setSelectedBoard(pickBoard(legend));
          }}>
            {legends.map((legend) => (
              <option key={legend.slug} value={legend.slug}>{legend.displayName}</option>
            ))}
          </select>
        </label>

        <label>
          Board
          <select value={selectedBoard} onChange={(e) => setSelectedBoard(e.target.value)}>
            {boardKeys.map((board) => (
              <option key={board} value={board}>{board}</option>
            ))}
          </select>
        </label>

        <label>
          Orden
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="presence">Mayor presencia</option>
            <option value="score">Mejor performance</option>
            <option value="topCutRate">Mayor top-cut rate</option>
            <option value="avgCopies">Más copias medias</option>
            <option value="category">Categoría</option>
            <option value="name">Nombre</option>
          </select>
        </label>

        <label>
          Presencia mínima
          <input type="number" min="0" max="100" step="0.1" value={minPresence} onChange={(e) => setMinPresence(e.target.value)} placeholder="0" />
        </label>

        <label className="legendSearch">
          Buscar carta
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Soaring Scout, OGN..." />
        </label>
      </section>

      <section className="legendSummaryGrid">
        <StatCard label="Cartas del board" value={summary.total} detail={boardMeta?.updatedAt ? `Board actualizado ${new Date(boardMeta.updatedAt).toLocaleDateString("es-ES")}` : ""} />
        <StatCard label="Core" value={summary.core} detail="núcleo del mazo" />
        <StatCard label="Gems" value={summary.gems} detail="baja presencia, buen rendimiento" />
        <StatCard label="Traps" value={summary.traps} detail="cartas a revisar" />
        <StatCard label="Score medio" value={formatScore(summary.avgScore)} detail="1.00x = media" />
      </section>

      <section className="legendCategoryBar legendStatsPanel">
        <CategoryPill category="all" count={categoryCounts.all} active={category === "all"} onClick={() => setCategory("all")} />
        {CATEGORY_ORDER.map((cat) => (
          <CategoryPill key={cat} category={cat} count={categoryCounts[cat] || 0} active={category === cat} onClick={() => setCategory(cat)} />
        ))}
      </section>

      <section className="legendInsights">
        <div className="legendStatsPanel">
          <h3>Core prioritarias</h3>
          {summary.topCore.length ? summary.topCore.map((card) => <CardStatTile key={card.cardKey} card={card} compact />) : <p className="legendMuted">Sin core detectadas.</p>}
        </div>

        <div className="legendStatsPanel">
          <h3>Gems destacadas</h3>
          {summary.topGems.length ? summary.topGems.map((card) => <CardStatTile key={card.cardKey} card={card} compact />) : <p className="legendMuted">Sin gems detectadas.</p>}
        </div>
      </section>

      <BuilderHelper cards={boardCards} />

      <section className="legendStatsPanel">
        <div className="legendTableHeader">
          <div>
            <h3>Cartas del board</h3>
            <p>{filteredCards.length} de {boardCards.length} cartas visibles.</p>
          </div>
          <button type="button" className="legendGhostButton" onClick={() => {
            setQuery("");
            setCategory("all");
            setMinPresence("");
            setSortBy("presence");
          }}>
            Limpiar filtros
          </button>
        </div>

        <div className="legendCardGrid">
          {filteredCards.map((card) => (
            <CardStatTile key={`${selectedLegendSlug}-${selectedBoard}-${card.cardKey}-${card.publicCode}`} card={card} />
          ))}
        </div>

        {!filteredCards.length ? <p className="legendMuted">No hay cartas que coincidan con los filtros.</p> : null}
      </section>
    </main>
  );
}
