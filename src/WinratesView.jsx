import { useEffect, useMemo, useState } from "react";
import "./winrates.css";

const WINRATE_DATA_URL = `${import.meta.env.BASE_URL}data/winrates-unleashed.json`;

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return `${Number(value).toFixed(Number(value) % 1 === 0 ? 0 : 1)}%`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("es-ES").format(Number(value || 0));
}

function matchupTone(winrate) {
  const value = Number(winrate);
  if (!Number.isFinite(value)) return "unknown";
  if (value >= 60) return "great";
  if (value >= 55) return "good";
  if (value >= 50) return "slight";
  if (value >= 45) return "closeBad";
  return "bad";
}

function matchupText(winrate, champion, rival) {
  const value = Number(winrate);
  if (!Number.isFinite(value)) return "No hay datos suficientes para este emparejamiento.";
  if (value >= 60) return `${champion} tiene un emparejamiento muy favorable contra ${rival}.`;
  if (value >= 55) return `${champion} tiene ventaja clara contra ${rival}.`;
  if (value >= 50) return `${champion} va ligeramente por delante contra ${rival}.`;
  if (value >= 45) return `${champion} está algo por detrás, pero el matchup sigue siendo jugable.`;
  return `${champion} tiene un emparejamiento desfavorable contra ${rival}.`;
}

function confidenceLabel(games, minGames) {
  const n = Number(games || 0);
  if (!n) return "sin muestra";
  if (n < minGames) return "muestra baja";
  if (n >= 40) return "muestra alta";
  return "muestra media";
}

function getMatchup(data, champion, rival) {
  if (!data || !champion || !rival || champion === rival) return null;
  return data.matrix?.[champion]?.[rival] || null;
}

function tierClass(tier) {
  return `tier tier-${String(tier || "x").toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}

function WinrateCell({ champion, rival, matchup, minGames, onSelect }) {
  if (champion === rival) return <td className="wrCell diagonal">—</td>;

  const wr = matchup?.winrate;
  const games = Number(matchup?.games || 0);
  const hasData = Number.isFinite(Number(wr));
  const lowSample = hasData && games > 0 && games < minGames;

  return (
    <td
      className={`wrCell ${hasData ? matchupTone(wr) : "unknown"} ${lowSample ? "lowSample" : ""}`}
      onClick={() => hasData && onSelect(champion, rival)}
      title={hasData ? `${champion} vs ${rival}: ${formatPercent(wr)} · ${games} partidas` : "Sin datos"}
    >
      {hasData ? (
        <>
          <strong>{formatPercent(wr)}</strong>
          <span>{games ? `${games} partidas` : "sin muestra"}</span>
        </>
      ) : (
        <span>—</span>
      )}
    </td>
  );
}

export function WinratesView() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [championA, setChampionA] = useState("");
  const [championB, setChampionB] = useState("");
  const [minGames, setMinGames] = useState(10);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState("rank");

  useEffect(() => {
    fetch(`${WINRATE_DATA_URL}?v=${Date.now()}`, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`No se pudo cargar winrates: ${res.status}`);
        return res.json();
      })
      .then((json) => {
        setData(json);
        const names = json.champions?.map((c) => c.name) || [];
        setChampionA(names.includes("Rengar") ? "Rengar" : names[0] || "");
        setChampionB(names.includes("Vex") ? "Vex" : names[1] || names[0] || "");
      })
      .catch((err) => setError(err.message || "No se pudieron cargar los winrates."));
  }, []);

  const champions = data?.champions || [];
  const championNames = champions.map((c) => c.name);

  const filteredChampions = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = champions.filter((champion) => {
      if (!q) return true;
      return `${champion.name} ${champion.tier} ${champion.confidence}`.toLowerCase().includes(q);
    });

    if (sortBy === "winrate") list = [...list].sort((a, b) => Number(b.winrate || 0) - Number(a.winrate || 0));
    else if (sortBy === "matches") list = [...list].sort((a, b) => Number(b.matches || 0) - Number(a.matches || 0));
    else if (sortBy === "name") list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    else list = [...list].sort((a, b) => Number(a.rank || 999) - Number(b.rank || 999));

    return list;
  }, [champions, query, sortBy]);

  const matchup = getMatchup(data, championA, championB);
  const reverse = getMatchup(data, championB, championA);
  const bestWorst = data?.bestWorst || [];
  const tournaments = data?.tournaments || [];

  if (error) {
    return (
      <main className="wrPage">
        <section className="wrPanel">
          <h2>Winrates</h2>
          <p className="wrError">{error}</p>
        </section>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="wrPage">
        <section className="wrPanel">
          <h2>Winrates</h2>
          <p className="wrMuted">Cargando datos competitivos...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="wrPage">
      <section className="wrHero">
        <div>
          <p className="wrEyebrow">Riftdecks · máxima relevancia</p>
          <h1>Winrate Matrix</h1>
          <p>
            Matriz de enfrentamientos por leyenda. Fila = leyenda que juegas; columna = rival.
            Datos del metagame <strong>{data.meta?.name || "Unleashed"}</strong>.
          </p>
        </div>
        <div className="wrHeroStats">
          <div><strong>{formatNumber(data.meta?.totalChampions || champions.length)}</strong><span>leyendas</span></div>
          <div><strong>{formatNumber(data.meta?.totalTournaments || tournaments.length)}</strong><span>torneos</span></div>
          <div><strong>{data.meta?.relevance || 3}★</strong><span>relevancia</span></div>
        </div>
      </section>

      <section className="wrPanel wrControls">
        <div className="wrControl">
          <label>Quiero ver</label>
          <select value={championA} onChange={(e) => setChampionA(e.target.value)}>
            {championNames.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
        <div className="wrControl">
          <label>contra</label>
          <select value={championB} onChange={(e) => setChampionB(e.target.value)}>
            {championNames.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
        <div className="wrControl">
          <label>Muestra mínima</label>
          <input type="number" min="0" value={minGames} onChange={(e) => setMinGames(Number(e.target.value || 0))} />
        </div>
      </section>

      <section className="wrMatchupGrid">
        <article className={`wrPanel wrMatchupCard ${matchupTone(matchup?.winrate)}`}>
          <span className="wrCardLabel">{championA} vs {championB}</span>
          <strong>{formatPercent(matchup?.winrate)}</strong>
          <p>{formatNumber(matchup?.games || 0)} partidas · {confidenceLabel(matchup?.games, minGames)}</p>
          <small>{matchupText(matchup?.winrate, championA, championB)}</small>
        </article>
        <article className={`wrPanel wrMatchupCard ${matchupTone(reverse?.winrate)}`}>
          <span className="wrCardLabel">{championB} vs {championA}</span>
          <strong>{formatPercent(reverse?.winrate)}</strong>
          <p>{formatNumber(reverse?.games || 0)} partidas · {confidenceLabel(reverse?.games, minGames)}</p>
          <small>{matchupText(reverse?.winrate, championB, championA)}</small>
        </article>
      </section>

      <section className="wrPanel">
        <div className="wrSectionHeader">
          <div>
            <h2>Ranking de leyendas</h2>
            <p className="wrMuted">Winrate general, partidas, torneos y confianza de muestra.</p>
          </div>
          <div className="wrToolbar">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filtrar leyenda..." />
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="rank">Orden: ranking</option>
              <option value="winrate">Orden: winrate</option>
              <option value="matches">Orden: partidas</option>
              <option value="name">Orden: alfabético</option>
            </select>
          </div>
        </div>
        <div className="wrRankingGrid">
          {filteredChampions.map((champion) => (
            <button
              key={champion.name}
              className="wrChampionCard"
              onClick={() => setChampionA(champion.name)}
              title={`Usar ${champion.name} como leyenda principal`}
            >
              <span className="wrRank">#{champion.rank}</span>
              <strong>{champion.name}</strong>
              <span className={tierClass(champion.tier)}>{champion.tier}</span>
              <span>{formatPercent(champion.winrate)}</span>
              <small>{formatNumber(champion.matches)} partidas · {champion.confidence}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="wrPanel">
        <div className="wrSectionHeader">
          <div>
            <h2>Matriz completa</h2>
            <p className="wrMuted">Pulsa una celda para cargar ese enfrentamiento en el comparador.</p>
          </div>
          <div className="wrLegend">
            <span className="bad">{"<45%"}</span>
            <span className="closeBad">45-49%</span>
            <span className="slight">50-54%</span>
            <span className="good">55-59%</span>
            <span className="great">60%+</span>
          </div>
        </div>
        <div className="wrMatrixWrap">
          <table className="wrMatrix">
            <thead>
              <tr>
                <th className="stickyCorner">vs</th>
                {champions.map((opponent) => (
                  <th key={opponent.name} title={opponent.name}>{opponent.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {champions.map((champion) => (
                <tr key={champion.name}>
                  <th>{champion.name}</th>
                  {champions.map((opponent) => (
                    <WinrateCell
                      key={`${champion.name}-${opponent.name}`}
                      champion={champion.name}
                      rival={opponent.name}
                      matchup={getMatchup(data, champion.name, opponent.name)}
                      minGames={minGames}
                      onSelect={(a, b) => {
                        setChampionA(a);
                        setChampionB(b);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="wrPanel">
        <h2>Mejores y peores matchups</h2>
        <div className="wrTableWrap">
          <table className="wrSimpleTable">
            <thead>
              <tr>
                <th>Leyenda</th>
                <th>Tier</th>
                <th>Mejor matchup</th>
                <th>WR</th>
                <th>Partidas</th>
                <th>Peor matchup</th>
                <th>WR</th>
                <th>Partidas</th>
              </tr>
            </thead>
            <tbody>
              {bestWorst.map((row) => (
                <tr key={row.champion}>
                  <td>{row.champion}</td>
                  <td><span className={tierClass(row.tier)}>{row.tier}</span></td>
                  <td>{row.bestMatchup}</td>
                  <td className={matchupTone(row.bestWinrate)}>{formatPercent(row.bestWinrate)}</td>
                  <td>{formatNumber(row.bestGames)}</td>
                  <td>{row.worstMatchup}</td>
                  <td className={matchupTone(row.worstWinrate)}>{formatPercent(row.worstWinrate)}</td>
                  <td>{formatNumber(row.worstGames)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="wrPanel">
        <details>
          <summary>Torneos incluidos ({tournaments.length})</summary>
          <div className="wrTournamentList">
            {tournaments.map((tournament) => (
              <a key={tournament.url || tournament.name} href={tournament.url} target="_blank" rel="noreferrer">
                <strong>{tournament.name}</strong>
                <span>{formatNumber(tournament.champions)} campeones</span>
              </a>
            ))}
          </div>
        </details>
      </section>
    </main>
  );
}
