import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const TARGET_FILE = path.resolve("public/data/cardmarket-targets.json");
const OUT_FILE = path.resolve("public/data/cardmarket-prices.json");

const MAX_CARDS_PER_RUN = Number(process.env.MAX_CARDS_PER_RUN || 40);
const DELAY_MS = Number(process.env.CARDMARKET_DELAY_MS || 4500);
const REFRESH_HOURS = Number(process.env.CARDMARKET_REFRESH_HOURS || 24);

// v1 rápida: precio FOIL, porque en Riftbound algunas rarezas son siempre foil.
// Para NM usamos minCondition=2. minCondition=3 en Cardmarket equivale a "Excellent" o mejor.
const PRICE_VARIANT = "foil";
const CARDMARKET_FILTERS = {
  sellerCountry: "10", // España
  language: "1",      // Inglés
  minCondition: "2",  // Near Mint o mejor
  isFoil: "Y",        // Foil
};

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

function htmlDecode(text) {
  return String(text || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&euro;/g, "€")
    .replace(/&aacute;/g, "á")
    .replace(/&eacute;/g, "é")
    .replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó")
    .replace(/&uacute;/g, "ú")
    .replace(/&ntilde;/g, "ñ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function baseUrlForTarget(target) {
  if (target.url) return target.url.split("?")[0];

  const setSlug = target.setSlug || target.expansion || target.setLabel;
  const nameSlug = target.cardSlug || slugifyCardmarketName(target.name);
  if (!setSlug || !nameSlug) return "";

  return `https://www.cardmarket.com/es/Riftbound/Products/Singles/${encodeURIComponent(setSlug)}/${encodeURIComponent(nameSlug)}`;
}

function buildUrls(target) {
  const base = baseUrlForTarget(target);
  if (!base) return [];

  const preferred = new URLSearchParams(CARDMARKET_FILTERS);

  // Fallbacks por si Cardmarket ignora algún alias de parámetro.
  const fallbacks = [
    new URLSearchParams({ sellerCountry: "10", language: "1", minCondition: "2", isFoil: "Y" }),
    new URLSearchParams({ sellerCountry: "10", idLanguage: "1", minCondition: "2", isFoil: "Y" }),
    new URLSearchParams({ sellerCountry: "10", language: "1", minCondition: "2", isFoil: "true" }),
  ];

  return [`${base}?${preferred.toString()}`, ...fallbacks.map((params) => `${base}?${params.toString()}`), base];
}

function splitArticleRows(html) {
  const rows = [];
  const pattern = /<div\s+id=["']articleRow[^"']*["'][\s\S]*?(?=<div\s+id=["']articleRow|<\/section>|<div\s+class=["']pagination|$)/gi;
  let match;
  while ((match = pattern.exec(html))) {
    if (match[0]?.includes("€")) rows.push(match[0]);
  }

  if (rows.length) return rows;

  // Fallback por si cambia el id pero mantiene clase.
  const pattern2 = /<div[^>]+class=["'][^"']*article-row[^"']*["'][\s\S]*?(?=<div[^>]+class=["'][^"']*article-row|<\/section>|$)/gi;
  while ((match = pattern2.exec(html))) {
    if (match[0]?.includes("€")) rows.push(match[0]);
  }

  return rows;
}

function extractEuroPrices(segment) {
  const decoded = htmlDecode(segment);
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

function rowFlags(row) {
  const decoded = htmlDecode(row).toLowerCase();
  const raw = String(row || "").toLowerCase();

  const isSpain =
    /ubicación del artículo:\s*españa|ubicacion del articulo:\s*espana|location of the item:\s*spain|spain|españa/.test(decoded) ||
    /aria-label=["'][^"']*españa|data-bs-original-title=["'][^"']*españa|background-position:\s*-176px\s+-70px/.test(raw);

  const isEnglish =
    /inglés|ingles|english/.test(decoded) ||
    /aria-label=["'][^"']*inglés|aria-label=["'][^"']*ingles|aria-label=["'][^"']*english|data-original-title=["']inglés|data-bs-original-title=["']inglés/.test(raw);

  const isNM =
    /near mint|\bnm\b/.test(decoded) ||
    /condition-nm|data-bs-original-title=["']near mint|data-original-title=["']near mint/.test(raw);

  const isFoil =
    /\bfoil\b/.test(decoded) ||
    /aria-label=["']foil|data-bs-original-title=["']foil|data-original-title=["']foil|st_specialicon|specialicon/.test(raw);

  const isAltered = /altered|alterada|alterado/.test(decoded);
  const isSigned = /signed|firmada|firmado/.test(decoded);

  return { isSpain, isEnglish, isNM, isFoil, isAltered, isSigned };
}

function rowIsValidForWantedFoil(row) {
  const flags = rowFlags(row);
  return flags.isSpain && flags.isEnglish && flags.isNM && flags.isFoil && !flags.isAltered && !flags.isSigned;
}

function diagnosticsForHtml(html) {
  const rows = splitArticleRows(html);
  const prices = rows.flatMap(extractEuroPrices);
  const flags = rows.map(rowFlags);
  return {
    rows: rows.length,
    euros: prices.length,
    spainRows: flags.filter((f) => f.isSpain).length,
    englishRows: flags.filter((f) => f.isEnglish).length,
    nmRows: flags.filter((f) => f.isNM).length,
    foilRows: flags.filter((f) => f.isFoil).length,
    validFoilRows: rows.filter(rowIsValidForWantedFoil).length,
  };
}

function parseLowestFoilPrice(html) {
  const plain = htmlDecode(html).toLowerCase();
  if (/captcha|robot|access denied|too many requests|cloudflare|unusual traffic/.test(plain)) {
    return { blocked: true, reason: "blocked-or-captcha" };
  }

  const rows = splitArticleRows(html);
  const strictPrices = [];

  for (const row of rows) {
    if (!rowIsValidForWantedFoil(row)) continue;
    strictPrices.push(...extractEuroPrices(row));
  }

  if (strictPrices.length) {
    return {
      price: Math.min(...strictPrices),
      confidence: "strict-row-es-en-nm-foil",
      debug: diagnosticsForHtml(html),
    };
  }

  return { notFound: true, debug: diagnosticsForHtml(html) };
}

async function fetchPriceForTarget(target) {
  const urls = buildUrls(target);
  let lastStatus = null;
  let lastDebug = null;

  for (const url of urls) {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
      },
      redirect: "follow",
    });

    lastStatus = res.status;

    if (res.status === 404) continue;
    if (res.status === 429) return { blocked: true, status: 429, url };
    if (!res.ok) continue;

    const html = await res.text();
    const parsed = parseLowestFoilPrice(html);
    lastDebug = parsed?.debug || lastDebug;

    if (parsed?.blocked) return { blocked: true, status: res.status, url, reason: parsed.reason };

    if (parsed?.price) {
      return {
        priceFrom: Number(parsed.price.toFixed(2)),
        currency: "EUR",
        url: url.split("?")[0],
        source: "Cardmarket",
        sellerCountry: "ES",
        cardLanguage: "EN",
        condition: "NM",
        foil: true,
        variant: PRICE_VARIANT,
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

  // Reintenta siempre los not-found/bloqueados/filtrados para que un cambio de parser se aplique sin esperar 24h.
  if (!Number.isFinite(Number(current.priceFrom))) return true;

  // Si el precio anterior no era foil, refrescamos.
  if (current.foil !== true || current.variant !== PRICE_VARIANT) return true;

  return hoursSince(current.updatedAt) >= REFRESH_HOURS;
}

function debugToString(debug) {
  if (!debug) return "";
  return `rows=${debug.rows} euros=${debug.euros} es=${debug.spainRows} en=${debug.englishRows} nm=${debug.nmRows} foil=${debug.foilRows} validFoil=${debug.validFoilRows}`;
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
  console.log(`Modo precio: FOIL · España · Inglés · Near Mint · isFoil=Y`);

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
        console.log(`[${i + 1}/${queue.length}] OK FOIL ${target.setId || ""} ${target.name}: ${result.priceFrom}€ (${result.confidence}) ${debugToString(result.debug)}`);
      } else if (result?.blocked) {
        prices[key] = {
          priceFrom: null,
          currency: "EUR",
          url: result.url || fallbackUrl,
          source: "Cardmarket",
          sellerCountry: "ES",
          cardLanguage: "EN",
          condition: "NM",
          foil: true,
          variant: PRICE_VARIANT,
          confidence: result.status === 429 ? "rate-limited" : "blocked-or-captcha",
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
          currency: "EUR",
          url: result?.url || fallbackUrl,
          source: "Cardmarket",
          sellerCountry: "ES",
          cardLanguage: "EN",
          condition: "NM",
          foil: true,
          variant: PRICE_VARIANT,
          confidence: "not-found-foil",
          debug: result?.debug || null,
          updatedAt: new Date().toISOString(),
          key,
          cardName: target.name,
          setId: target.setId || "",
          setSlug: target.setSlug || "",
          publicCode: target.publicCode || "",
        };
        missing += 1;
        console.log(`[${i + 1}/${queue.length}] Sin precio FOIL ${target.setId || ""} ${target.name}. URL: ${result?.url || fallbackUrl} ${debugToString(result?.debug)}`);
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
      filters: "España + carta en inglés + Near Mint + foil",
      variant: PRICE_VARIANT,
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
