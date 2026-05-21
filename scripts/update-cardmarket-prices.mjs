import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const TARGET_FILE = path.resolve("public/data/cardmarket-targets.json");
const OUT_FILE = path.resolve("public/data/cardmarket-prices.json");

const MAX_CARDS_PER_RUN = Number(process.env.MAX_CARDS_PER_RUN || 80);
const DELAY_MS = Number(process.env.CARDMARKET_DELAY_MS || 4500);
const REFRESH_HOURS = Number(process.env.CARDMARKET_REFRESH_HOURS || 24);

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
    .replace(/&euro;/g, "€")
    .replace(/&#8364;/g, "€")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
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
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function buildKey(target) {
  if (target.key) return target.key;
  const set = normalizeId(target.setId || target.setSlug || "no-set");
  const code = normalizeId(target.publicCode || target.riftboundId || "");
  const name = normalizeId(target.name || "sin-nombre");
  return `${set}:${code || name}:${name}`;
}

function buildBaseUrl(target) {
  if (target.url) return String(target.url).split("?")[0];

  const setSlug = target.setSlug || target.expansion || target.setLabel;
  const nameSlug = target.cardSlug || slugifyCardmarketName(target.name);
  if (!setSlug || !nameSlug) return "";

  return `https://www.cardmarket.com/es/Riftbound/Products/Singles/${encodeURIComponent(setSlug)}/${encodeURIComponent(nameSlug)}`;
}

function buildUrls(target) {
  const base = buildBaseUrl(target);
  if (!base) return [];

  // Importante: la URL del target viene sin filtros. Probamos primero EXACTAMENTE el filtro que has validado en navegador:
  // vendedor España + idioma inglés + condición mínima Near Mint.
  const paramsList = [
    new URLSearchParams({ sellerCountry: "10", language: "1", minCondition: "2" }),
    new URLSearchParams({ sellerCountry: "10", language: "1", minCondition: "2", isFoil: "false", isSigned: "false", isAltered: "false" }),
    new URLSearchParams({ sellerCountry: "10", idLanguage: "1", minCondition: "2" }),
  ];

  return [
    ...paramsList.map((params) => `${base}?${params.toString()}`),
    base,
  ];
}

function splitOfferSegments(html) {
  const chunks = [];

  // Cardmarket suele renderizar cada oferta como una fila/div con article-row o clases parecidas.
  const rowPatterns = [
    /<[^>]*class=["'][^"']*article-row[^"']*["'][\s\S]*?(?=<[^>]*class=["'][^"']*article-row|<\/body>|$)/gi,
    /<[^>]*class=["'][^"']*articleRow[^"']*["'][\s\S]*?(?=<[^>]*class=["'][^"']*articleRow|<\/body>|$)/gi,
    /<tr[\s\S]*?<\/tr>/gi,
  ];

  for (const pattern of rowPatterns) {
    let match;
    while ((match = pattern.exec(html))) {
      const chunk = match[0];
      if (chunk && /€|&euro;|&#8364;/.test(chunk)) chunks.push(chunk);
    }
    if (chunks.length) return chunks;
  }

  return [];
}

function extractEuroPrices(segment) {
  const decoded = htmlDecode(segment);
  const prices = [];
  const patterns = [
    /(\d{1,4}(?:\.\d{3})*,\d{2})\s*€/g,
    /€\s*(\d{1,4}(?:\.\d{3})*,\d{2})/g,
    /(\d{1,4}(?:\.\d{3})*,\d{2})\s*EUR/gi,
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

function rowLooksLikeValidOffer(segment) {
  const decoded = htmlDecode(segment).toLowerCase();
  const raw = String(segment).toLowerCase();

  // Como la URL ya va filtrada, esto es solo una capa extra. En la tabla se ven NM + banderas ES/GB.
  const hasNm = /\bnm\b|near mint/.test(decoded) || /\bnm\b/.test(raw);
  const hasSpanishSeller = /españa|spain|flag[-_ ]?es|\/es\.svg/.test(decoded) || /flag[-_ ]?es|\/es\.svg/.test(raw);
  const hasEnglishCard = /inglés|ingles|english|flag[-_ ]?gb|\/gb\.svg|\/en\.svg/.test(decoded) || /flag[-_ ]?gb|\/gb\.svg|\/en\.svg/.test(raw);

  const bad = /\bfoil\b|signed|altered|firmad|alterad/.test(decoded);

  return {
    strict: hasNm && hasSpanishSeller && hasEnglishCard && !bad,
    loose: hasNm && !bad,
    any: !bad,
  };
}

function parseOfferRows(html) {
  const rows = splitOfferSegments(html);
  const strict = [];
  const loose = [];
  const any = [];

  for (const row of rows) {
    const prices = extractEuroPrices(row);
    if (!prices.length) continue;

    const flags = rowLooksLikeValidOffer(row);
    if (flags.strict) strict.push(...prices);
    else if (flags.loose) loose.push(...prices);
    else if (flags.any) any.push(...prices);
  }

  if (strict.length) return { price: Math.min(...strict), confidence: "strict-offer-row" };
  if (loose.length) return { price: Math.min(...loose), confidence: "loose-offer-row" };
  if (any.length) return { price: Math.min(...any), confidence: "offer-row-fallback" };
  return null;
}

function parseSummaryFromFilteredPage(html) {
  // Fallback: si no podemos detectar filas, extraemos el campo "De" del panel de información.
  // En Cardmarket suele representar el precio mínimo visible para el producto/filtros.
  const plain = htmlDecode(html);
  const lower = plain.toLowerCase();

  const patterns = [
    /\bde\s+(\d{1,4}(?:\.\d{3})*,\d{2})\s*€/i,
    /\bfrom\s+(\d{1,4}(?:\.\d{3})*,\d{2})\s*€/i,
  ];

  for (const pattern of patterns) {
    const match = plain.match(pattern);
    if (match?.[1]) {
      const value = Number(match[1].replace(/\./g, "").replace(",", "."));
      if (Number.isFinite(value) && value > 0 && value < 10000) {
        return { price: value, confidence: "summary-from-price" };
      }
    }
  }

  // Último fallback: solo si la página no parece vacía ni bloqueada, cogemos el menor precio de toda la página.
  // Es menos preciso porque puede capturar tendencia/medias, pero evita quedarse en cero cuando Cardmarket cambia clases.
  if (!/no hay artículos|sin artículos|no articles|captcha|robot|access denied|too many requests|cloudflare|unusual traffic/i.test(lower)) {
    const allPrices = extractEuroPrices(html);
    if (allPrices.length) return { price: Math.min(...allPrices), confidence: "page-lowest-fallback" };
  }

  return null;
}

function parseLowestPrice(html) {
  const plain = htmlDecode(html).toLowerCase();
  if (/captcha|robot|access denied|too many requests|cloudflare|unusual traffic/.test(plain)) {
    return { blocked: true, reason: "blocked-or-captcha" };
  }

  return parseOfferRows(html) || parseSummaryFromFilteredPage(html);
}

async function fetchPriceForTarget(target) {
  const urls = buildUrls(target);
  let lastStatus = null;

  for (const url of urls) {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
        "Referer": "https://www.cardmarket.com/es/Riftbound",
      },
      redirect: "follow",
    });

    lastStatus = res.status;

    if (res.status === 404) continue;
    if (res.status === 429) return { blocked: true, status: 429, url };
    if (!res.ok) continue;

    const html = await res.text();
    const parsed = parseLowestPrice(html);

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
        foil: false,
        confidence: parsed.confidence,
        updatedAt: new Date().toISOString(),
      };
    }
  }

  return { notFound: true, status: lastStatus, url: urls[0] || "" };
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
  // Los "not-found" anteriores se reintentan siempre para poder corregirlos con este parser nuevo.
  if (current.priceFrom == null && current.confidence === "not-found") return true;
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
      return hoursSince(b.current?.updatedAt) - hoursSince(a.current?.updatedAt);
    })
    .slice(0, MAX_CARDS_PER_RUN);

  console.log(`Targets disponibles: ${targets.length}`);
  console.log(`A actualizar en esta ejecución: ${queue.length}/${MAX_CARDS_PER_RUN}`);

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
        console.log(`[${i + 1}/${queue.length}] OK ${target.setId || ""} ${target.name}: ${result.priceFrom}€ (${result.confidence})`);
      } else if (result?.blocked) {
        prices[key] = {
          priceFrom: null,
          currency: "EUR",
          url: result.url || fallbackUrl,
          source: "Cardmarket",
          sellerCountry: "ES",
          cardLanguage: "EN",
          condition: "NM",
          foil: false,
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
          foil: false,
          confidence: "not-found",
          updatedAt: new Date().toISOString(),
          key,
          cardName: target.name,
          setId: target.setId || "",
          setSlug: target.setSlug || "",
          publicCode: target.publicCode || "",
        };
        missing += 1;
        console.log(`[${i + 1}/${queue.length}] Sin precio ${target.setId || ""} ${target.name}. URL: ${result?.url || fallbackUrl}`);
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
      filters: "España + carta en inglés + Near Mint + no foil/no signed/no altered",
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
