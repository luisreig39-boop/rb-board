import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const TARGET_FILE = path.resolve("public/data/cardmarket-targets.json");
const OUT_FILE = path.resolve("public/data/cardmarket-prices.json");

const MAX_CARDS_PER_RUN = Number(process.env.MAX_CARDS_PER_RUN || 40);
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

function buildUrls(target) {
  if (Array.isArray(target.urls) && target.urls.length) return target.urls;
  if (target.url) return [target.url];

  const setSlug = target.setSlug || target.expansion || target.setLabel;
  const nameSlug = target.cardSlug || slugifyCardmarketName(target.name);
  if (!setSlug || !nameSlug) return [];

  const base = `https://www.cardmarket.com/es/Riftbound/Products/Singles/${encodeURIComponent(setSlug)}/${encodeURIComponent(nameSlug)}`;

  // Cardmarket web filters are not documented as a stable public API. These params are best-effort.
  const paramsList = [
    new URLSearchParams({
      language: "1",
      idLanguage: "1",
      sellerCountry: "10",
      minCondition: "2",
      isFoil: "false",
      isSigned: "false",
      isAltered: "false",
    }),
    new URLSearchParams({
      language: "1",
      sellerCountry: "10",
      minCondition: "2",
    }),
    new URLSearchParams({
      idLanguage: "1",
      sellerCountry: "10",
      minCondition: "NM",
    }),
  ];

  return [base, ...paramsList.map((params) => `${base}?${params.toString()}`)];
}

function splitOfferSegments(html) {
  const chunks = [];
  const patterns = [
    /<[^>]+class=["'][^"']*(?:article-row|articleRow|article-item|articleItem|table-body-row|productRow|row no-gutters)[^"']*["'][\s\S]*?(?=<[^>]+class=["'][^"']*(?:article-row|articleRow|article-item|articleItem|table-body-row|productRow|row no-gutters)|<\/body>|$)/gi,
    /<tr[\s\S]*?<\/tr>/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html))) {
      if (match[0] && match[0].includes("€")) chunks.push(match[0]);
    }
    if (chunks.length) return chunks;
  }

  return [html];
}

function segmentLooksValid(segment) {
  const decoded = htmlDecode(segment).toLowerCase();
  const raw = String(segment).toLowerCase();

  const countryOk =
    /españa|spain|seller country.*spain|from spain|flag[-_ ]?es|\/es\.svg|country-icon-es|sellerCountry=10/i.test(decoded) ||
    /flag[-_ ]?es|\/es\.svg|sellercountry.?10|country.?10/i.test(raw);

  const englishOk =
    /english|inglés|ingles|flag[-_ ]?gb|\/gb\.svg|\/en\.svg|language.?1|idlanguage.?1/i.test(decoded) ||
    /flag[-_ ]?gb|\/gb\.svg|idlanguage.?1|language.?1/i.test(raw);

  const nmOk =
    /near mint|\bnm\b|mincondition.?nm|mincondition.?2/i.test(decoded) ||
    /mincondition.?nm|mincondition.?2/i.test(raw);

  const badFlags = /(signed|altered|foil)/i.test(decoded) && !/(not signed|not altered|non foil|no foil|non-foil)/i.test(decoded);

  return { countryOk, englishOk, nmOk, badFlags };
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

function parseLowestPrice(html) {
  // Signals that Cardmarket returned a generic block / empty page instead of listings.
  const plain = htmlDecode(html).toLowerCase();
  if (/captcha|robot|access denied|too many requests|cloudflare|unusual traffic/.test(plain)) {
    return { blocked: true, reason: "blocked-or-captcha" };
  }

  const segments = splitOfferSegments(html);
  const strict = [];
  const loose = [];
  const fallback = [];

  for (const segment of segments) {
    const prices = extractEuroPrices(segment);
    if (!prices.length) continue;

    const flags = segmentLooksValid(segment);
    if (flags.badFlags) continue;

    if (flags.countryOk && flags.englishOk && flags.nmOk) strict.push(...prices);
    else if ((flags.countryOk && flags.englishOk) || (flags.englishOk && flags.nmOk) || (flags.countryOk && flags.nmOk)) loose.push(...prices);
    else fallback.push(...prices);
  }

  if (strict.length) return { price: Math.min(...strict), confidence: "strict-row" };
  if (loose.length) return { price: Math.min(...loose), confidence: "loose-row" };
  if (fallback.length) return { price: Math.min(...fallback), confidence: "page-price-fallback" };
  return null;
}

async function fetchPriceForTarget(target) {
  const urls = buildUrls(target);
  let lastStatus = null;

  for (const url of urls) {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; rb-board-price-checker/1.0; +https://github.com/luisreig39-boop/rb-board)",
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

async function main() {
  await mkdir(path.dirname(OUT_FILE), { recursive: true });

  const targetData = await loadJson(TARGET_FILE, null);
  const targets = Array.isArray(targetData) ? targetData : targetData?.targets || [];

  if (!targets.length) {
    throw new Error(
      `No hay objetivos en ${TARGET_FILE}. Genera cardmarket-targets.json desde la app y súbelo a public/data/.`
    );
  }

  const existing = await loadJson(OUT_FILE, { meta: {}, prices: {} });
  const prices = existing.prices || {};

  const queue = targets
    .map((target) => ({ target, key: buildKey(target), current: prices[buildKey(target)] }))
    .filter(({ current }) => hoursSince(current?.updatedAt) >= REFRESH_HOURS)
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
        // Stop early if Cardmarket is blocking. Keep JSON valid and exit successfully.
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
        console.log(`[${i + 1}/${queue.length}] Sin precio ${target.setId || ""} ${target.name}`);
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
