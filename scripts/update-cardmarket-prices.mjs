import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const TARGET_FILE = path.resolve("public/data/cardmarket-targets.json");
const OUT_FILE = path.resolve("public/data/cardmarket-prices.json");

const MAX_CARDS_PER_RUN = Number(process.env.MAX_CARDS_PER_RUN || 80);
const DELAY_MS = Number(process.env.CARDMARKET_DELAY_MS || 4500);
const REFRESH_HOURS = Number(process.env.CARDMARKET_REFRESH_HOURS || 24);

// Modo actual: precio FOIL.
// Motivo: en Riftbound hay rarezas que en Cardmarket aparecen siempre como foil.
// La app sigue leyendo priceFrom, así que no hay que tocar la interfaz para que muestre "desde X €".
const PRICE_MODE = String(process.env.CARDMARKET_PRICE_MODE || "foil").toLowerCase(); // foil | nonfoil | any
const MIN_CONDITION = String(process.env.CARDMARKET_MIN_CONDITION || "2"); // 2 = Near Mint en Cardmarket web
const SELLER_COUNTRY = String(process.env.CARDMARKET_SELLER_COUNTRY || "10"); // 10 = España
const LANGUAGE = String(process.env.CARDMARKET_LANGUAGE || "1"); // 1 = Inglés

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function stripTags(value) {
  return String(value || "").replace(/<[^>]+>/g, " ");
}

function htmlDecode(text) {
  return String(text || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&euro;/g, "€")
    .replace(/\s+/g, " ")
    .trim();
}

function textFromHtml(html) {
  return htmlDecode(stripTags(html));
}

function slugifyCardmarketName(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[’']/g, "")
    .replace(/[.,:;!?()[\]{}]/g, "")
    .replace(/\s*\/\s*/g, "-")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function buildKey(target) {
  if (target.key) return target.key;
  const set = normalizeId(target.setId || target.setSlug || "no-set");
  const code = normalizeId(target.publicCode || target.riftboundId || "");
  const name = normalizeId(target.name || "sin-nombre");
  return `${set}:${code || name}:${name}`;
}

function canonicalBaseUrl(target) {
  if (target.url) return String(target.url).split("?")[0];

  const setSlug = target.setSlug || target.expansion || target.setLabel;
  const nameSlug = target.cardSlug || slugifyCardmarketName(target.name);
  if (!setSlug || !nameSlug) return "";

  return `https://www.cardmarket.com/es/Riftbound/Products/Singles/${encodeURIComponent(setSlug)}/${encodeURIComponent(nameSlug)}`;
}

function withParams(base, paramsObj) {
  const params = new URLSearchParams(paramsObj);
  return `${base}?${params.toString()}`;
}

function buildUrls(target) {
  const base = canonicalBaseUrl(target);
  if (!base) return [];

  const foilParam =
    PRICE_MODE === "foil" ? "Y" :
    PRICE_MODE === "nonfoil" ? "N" :
    "";

  const common = {
    sellerCountry: SELLER_COUNTRY,
    language: LANGUAGE,
    minCondition: MIN_CONDITION,
  };

  const urls = [];

  if (foilParam) {
    urls.push(withParams(base, { ...common, isFoil: foilParam }));
  }

  // Fallbacks. Se dejan al final por si Cardmarket ignora alguno de los filtros.
  urls.push(withParams(base, common));
  urls.push(base);

  return [...new Set(urls)];
}

function extractEuroPrices(raw) {
  const decoded = htmlDecode(raw);
  const prices = [];
  const patterns = [
    /(\d{1,4}(?:\.\d{3})*,\d{2})\s*€/g,
    /€\s*(\d{1,4}(?:\.\d{3})*,\d{2})/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(decoded))) {
      const value = Number(match[1].replace(/\./g, "").replace(",", "."));
      if (Number.isFinite(value) && value > 0 && value < 10000) prices.push(value);
    }
  }

  return prices;
}

function splitArticleRows(html) {
  const starts = [];
  const startPattern = /<div[^>]+id=["']articleRow\d+["'][^>]*class=["'][^"']*article-row[^"']*["'][^>]*>/gi;
  let match;
  while ((match = startPattern.exec(html))) {
    starts.push(match.index);
  }

  if (!starts.length) return [];

  const rows = [];
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i];
    const end = starts[i + 1] || html.indexOf("</section>", start);
    rows.push(html.slice(start, end > start ? end : html.length));
  }
  return rows;
}

function rowSignals(row) {
  const raw = String(row || "");
  const plain = textFromHtml(raw).toLowerCase();

  const countryOk =
    /ubicaci[oó]n del art[ií]culo:\s*españa/i.test(raw) ||
    /aria-label=["'][^"']*españa/i.test(raw) ||
    /data-bs-original-title=["'][^"']*españa/i.test(raw) ||
    /\bespaña\b|\bspain\b/i.test(plain);

  const englishOk =
    /aria-label=["']ingl[eé]s["']/i.test(raw) ||
    /data-original-title=["']ingl[eé]s["']/i.test(raw) ||
    /data-bs-original-title=["']ingl[eé]s["']/i.test(raw) ||
    /\bingl[eé]s\b|\benglish\b/i.test(plain);

  const nmOk =
    /condition-nm/i.test(raw) ||
    /data-bs-original-title=["']near mint["']/i.test(raw) ||
    /aria-label=["']near mint["']/i.test(raw) ||
    /(?:^|\s)nm(?:\s|$)/i.test(plain) ||
    /\bnear mint\b/i.test(plain);

  const foilOk =
    /aria-label=["']foil["']/i.test(raw) ||
    /data-original-title=["']foil["']/i.test(raw) ||
    /data-bs-original-title=["']foil["']/i.test(raw) ||
    /st_SpecialIcon/i.test(raw) ||
    /\bfoil\b/i.test(plain);

  return { countryOk, englishOk, nmOk, foilOk };
}

function rowMatchesMode(signals) {
  if (PRICE_MODE === "foil") return signals.foilOk;
  if (PRICE_MODE === "nonfoil") return !signals.foilOk;
  return true;
}

function parseSummaryFromPrice(html) {
  // Cardmarket muestra el precio resumen como:
  // <dt>De</dt><dd>10,00 €</dd>
  const patterns = [
    /<dt[^>]*>\s*De\s*<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/i,
    /<dt[^>]*>\s*From\s*<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) continue;
    const prices = extractEuroPrices(match[1]);
    if (prices.length) {
      return Math.min(...prices);
    }
  }

  return null;
}

function parseLowestPrice(html) {
  const plain = textFromHtml(html).toLowerCase();

  if (/captcha|robot|access denied|too many requests|cloudflare|unusual traffic/.test(plain)) {
    return { blocked: true, reason: "blocked-or-captcha" };
  }

  const rows = splitArticleRows(html);
  const strictPrices = [];
  const rowPrices = [];

  let rowsWithEuro = 0;
  let rowsSpain = 0;
  let rowsEnglish = 0;
  let rowsNm = 0;
  let rowsFoil = 0;
  let rowsMode = 0;
  let rowsStrict = 0;

  for (const row of rows) {
    const prices = extractEuroPrices(row);
    if (prices.length) rowsWithEuro += 1;

    const signals = rowSignals(row);
    if (signals.countryOk) rowsSpain += 1;
    if (signals.englishOk) rowsEnglish += 1;
    if (signals.nmOk) rowsNm += 1;
    if (signals.foilOk) rowsFoil += 1;
    if (rowMatchesMode(signals)) rowsMode += 1;

    if (prices.length) {
      rowPrices.push(...prices);
    }

    if (prices.length && signals.countryOk && signals.englishOk && signals.nmOk && rowMatchesMode(signals)) {
      strictPrices.push(Math.min(...prices));
      rowsStrict += 1;
    }
  }

  if (strictPrices.length) {
    return {
      price: Math.min(...strictPrices),
      confidence: `strict-row-es-en-nm-${PRICE_MODE}`,
      debug: { rows: rows.length, rowsWithEuro, rowsSpain, rowsEnglish, rowsNm, rowsFoil, rowsMode, rowsStrict },
    };
  }

  // Si la URL ya está filtrada por Cardmarket, "De" suele reflejar los filtros aplicados.
  // Esto es especialmente útil cuando el HTML cambia o las filas tienen atributos difíciles de leer.
  const summaryFrom = parseSummaryFromPrice(html);
  if (Number.isFinite(summaryFrom)) {
    return {
      price: summaryFrom,
      confidence: `summary-de-filtered-${PRICE_MODE}`,
      debug: { rows: rows.length, rowsWithEuro, rowsSpain, rowsEnglish, rowsNm, rowsFoil, rowsMode, rowsStrict, summaryFrom },
    };
  }

  if (rowPrices.length) {
    return {
      price: Math.min(...rowPrices),
      confidence: `row-price-fallback-${PRICE_MODE}`,
      debug: { rows: rows.length, rowsWithEuro, rowsSpain, rowsEnglish, rowsNm, rowsFoil, rowsMode, rowsStrict },
    };
  }

  return {
    price: null,
    debug: { rows: rows.length, rowsWithEuro, rowsSpain, rowsEnglish, rowsNm, rowsFoil, rowsMode, rowsStrict, summaryFrom },
  };
}

async function fetchPriceForTarget(target) {
  const urls = buildUrls(target);
  let lastStatus = null;
  let lastDebug = null;

  for (const url of urls) {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
      },
      redirect: "follow",
    });

    lastStatus = res.status;

    if (res.status === 404) continue;
    if (res.status === 429) {
      return { blocked: true, status: 429, url };
    }
    if (!res.ok) continue;

    const html = await res.text();
    const parsed = parseLowestPrice(html);
    lastDebug = parsed?.debug || null;

    if (parsed?.blocked) return { blocked: true, status: res.status, url, reason: parsed.reason, debug: parsed.debug };

    if (parsed?.price != null) {
      return {
        priceFrom: Number(parsed.price.toFixed(2)),
        priceMode: PRICE_MODE,
        currency: "EUR",
        url,
        baseUrl: url.split("?")[0],
        source: "Cardmarket",
        sellerCountry: "ES",
        cardLanguage: "EN",
        condition: MIN_CONDITION === "2" ? "NM" : MIN_CONDITION,
        foil: PRICE_MODE === "foil" ? true : PRICE_MODE === "nonfoil" ? false : null,
        confidence: parsed.confidence,
        debug: parsed.debug,
        updatedAt: new Date().toISOString(),
      };
    }
  }

  return { notFound: true, status: lastStatus, url: urls[0] || "", debug: lastDebug };
}

async function loadJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

function hoursSince(iso) {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 36e5;
}

function shouldRefresh(current) {
  if (!current) return true;
  if (!Number.isFinite(Number(current.priceFrom))) return true; // reintenta sin precio
  if (current.priceMode !== PRICE_MODE) return true; // cambiamos de nonfoil a foil, etc.
  return hoursSince(current.updatedAt) >= REFRESH_HOURS;
}

async function main() {
  await mkdir(path.dirname(OUT_FILE), { recursive: true });

  const targetData = await loadJson(TARGET_FILE, null);
  const targets = Array.isArray(targetData) ? targetData : targetData?.targets || [];

  if (!targets.length) {
    throw new Error(`No hay objetivos en ${TARGET_FILE}. Genera cardmarket-targets.json desde la app y súbelo a public/data/.`);
  }

  const existing = await loadJson(OUT_FILE, { meta: {}, prices: {} });
  const prices = existing.prices || {};

  const queue = targets
    .map((target) => ({ target, key: buildKey(target), current: prices[buildKey(target)] }))
    .filter(({ current }) => shouldRefresh(current))
    .sort((a, b) => {
      if (!a.current && b.current) return -1;
      if (a.current && !b.current) return 1;
      const av = Number.isFinite(Number(a.current?.priceFrom)) ? 1 : 0;
      const bv = Number.isFinite(Number(b.current?.priceFrom)) ? 1 : 0;
      if (av !== bv) return av - bv;
      return hoursSince(b.current?.updatedAt) - hoursSince(a.current?.updatedAt);
    })
    .slice(0, MAX_CARDS_PER_RUN);

  console.log(`Targets disponibles: ${targets.length}`);
  console.log(`A actualizar en esta ejecución: ${queue.length}/${MAX_CARDS_PER_RUN}`);
  console.log(`Modo precio: ${PRICE_MODE.toUpperCase()} · España · Inglés · Near Mint · isFoil=${PRICE_MODE === "foil" ? "Y" : PRICE_MODE === "nonfoil" ? "N" : "ANY"}`);

  let ok = 0;
  let missing = 0;
  let blocked = 0;
  let failed = 0;

  for (let i = 0; i < queue.length; i += 1) {
    const { target, key } = queue[i];

    try {
      const result = await fetchPriceForTarget(target);
      const fallbackUrl = buildUrls(target)[0] || "";

      if (result?.priceFrom != null) {
        prices[key] = {
          ...result,
          key,
          cardName: target.name,
          setId: target.setId || "",
          setSlug: target.setSlug || "",
          publicCode: target.publicCode || "",
        };
        ok += 1;
        console.log(`[${i + 1}/${queue.length}] OK ${PRICE_MODE.toUpperCase()} ${target.setId || ""} ${target.name}: ${result.priceFrom}€ (${result.confidence})`);
      } else if (result?.blocked) {
        prices[key] = {
          priceFrom: null,
          priceMode: PRICE_MODE,
          currency: "EUR",
          url: result.url || fallbackUrl,
          baseUrl: (result.url || fallbackUrl).split("?")[0],
          source: "Cardmarket",
          sellerCountry: "ES",
          cardLanguage: "EN",
          condition: "NM",
          foil: PRICE_MODE === "foil",
          confidence: result.status === 429 ? "rate-limited" : "blocked-or-captcha",
          debug: result.debug || null,
          updatedAt: new Date().toISOString(),
          key,
          cardName: target.name,
          setId: target.setId || "",
          setSlug: target.setSlug || "",
          publicCode: target.publicCode || "",
        };
        blocked += 1;
        console.warn(`[${i + 1}/${queue.length}] BLOQUEADO ${target.setId || ""} ${target.name}. Status=${result.status || "?"}`);
        break;
      } else {
        prices[key] = {
          priceFrom: null,
          priceMode: PRICE_MODE,
          currency: "EUR",
          url: result?.url || fallbackUrl,
          baseUrl: (result?.url || fallbackUrl).split("?")[0],
          source: "Cardmarket",
          sellerCountry: "ES",
          cardLanguage: "EN",
          condition: "NM",
          foil: PRICE_MODE === "foil",
          confidence: "not-found",
          debug: result?.debug || null,
          updatedAt: new Date().toISOString(),
          key,
          cardName: target.name,
          setId: target.setId || "",
          setSlug: target.setSlug || "",
          publicCode: target.publicCode || "",
        };
        missing += 1;
        const d = result?.debug;
        const debugLine = d ? ` rows=${d.rows} euros=${d.rowsWithEuro} es=${d.rowsSpain} en=${d.rowsEnglish} nm=${d.rowsNm} foil=${d.rowsFoil} mode=${d.rowsMode} strict=${d.rowsStrict} summary=${d.summaryFrom ?? "-"}` : "";
        console.log(`[${i + 1}/${queue.length}] Sin precio ${PRICE_MODE.toUpperCase()} ${target.setId || ""} ${target.name}.${debugLine} URL: ${result?.url || fallbackUrl}`);
      }
    } catch (error) {
      failed += 1;
      console.warn(`[${i + 1}/${queue.length}] ERROR ${target.setId || ""} ${target.name}: ${error.message}`);
    }

    if (i < queue.length - 1) {
      await sleep(DELAY_MS + Math.floor(Math.random() * 1000));
    }
  }

  const output = {
    meta: {
      updatedAt: new Date().toISOString(),
      source: "Cardmarket",
      priceMode: PRICE_MODE,
      filters: `España + carta en inglés + Near Mint + ${PRICE_MODE === "foil" ? "foil" : PRICE_MODE === "nonfoil" ? "no foil" : "cualquier foil"}`,
      maxCardsPerRun: MAX_CARDS_PER_RUN,
      refreshHours: REFRESH_HOURS,
      totalTargets: targets.length,
      pricesWithValue: Object.values(prices).filter((p) => Number.isFinite(Number(p.priceFrom))).length,
      lastRun: { ok, missing, blocked, failed, queued: queue.length },
      warning:
        "Sin API oficial, esto depende del HTML público de Cardmarket. Si Cardmarket cambia la página o bloquea peticiones, puede dejar de actualizar.",
    },
    prices,
  };

  await writeFile(OUT_FILE, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Guardado ${OUT_FILE}. OK=${ok}, sin precio=${missing}, bloqueadas=${blocked}, errores=${failed}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
