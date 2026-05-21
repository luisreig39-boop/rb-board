import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const RIFTCODEX_API = "https://api.riftcodex.com/cards";

const RIFTCODEX_HEADERS = {
  "Accept": "application/json,text/plain,*/*",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
  "Origin": "https://luisreig39-boop.github.io",
  "Referer": "https://luisreig39-boop.github.io/rb-board/"
};

const CARDMARKET_BASE = "https://www.cardmarket.com/es/Riftbound/Products/Singles";
const OUT_FILE = path.resolve("public/data/cardmarket-prices.json");

const MAX_CARDS_PER_RUN = Number(process.env.MAX_CARDS_PER_RUN || 80);
const DELAY_MS = Number(process.env.CARDMARKET_DELAY_MS || 1800);
const REFRESH_HOURS = Number(process.env.CARDMARKET_REFRESH_HOURS || 24);

const SET_SLUGS = {
  UNL: "Unleashed",
  SFD: "Spiritforged",
  OGN: "Origins",
  OGS: "Proving-Grounds",
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

function titleCase(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value == null || value === "") return [];
  return [value];
}

function buildPriceKey({ setId, publicCode, riftboundId, name }) {
  const code = normalizeId(publicCode || riftboundId || "");
  const safeSet = normalizeId(setId || "no-set");
  const safeName = normalizeId(name || "sin-nombre");
  return `${safeSet}:${code || safeName}:${safeName}`;
}

function normalizeCard(raw) {
  const setObject = typeof raw.set === "object" && raw.set !== null ? raw.set : {};
  const metadata = raw.metadata || {};
  const classification = raw.classification || {};
  const setId = titleCase(setObject.set_id || raw.set_id || raw.set || raw.setCode).toUpperCase();
  const setLabel = setObject.label || setObject.name || raw.setName || raw.set_label || setId;
  const riftboundId = raw.riftbound_id || raw.riftboundId || raw.publicCode || raw.public_code || raw.code || "";
  const publicCode = raw.public_code || raw.publicCode || riftboundId || raw.collectorNumber || raw.collector_number || raw.id;
  const name = raw.name || "";
  return {
    id: raw.id || normalizeId(`${setId}-${publicCode}-${name}`),
    name,
    setId,
    setLabel,
    riftboundId: String(riftboundId || ""),
    publicCode: String(publicCode || ""),
    rarity: titleCase(classification.rarity || raw.rarity || ""),
    type: titleCase(classification.type || raw.type || ""),
    supertype: titleCase(classification.supertype || raw.supertype || ""),
    domains: asArray(classification.domain || raw.domains || raw.domain).map(titleCase),
    metadata: {
      alternateArt: Boolean(metadata.alternate_art ?? raw.alternate_art),
      overnumbered: Boolean(metadata.overnumbered ?? raw.overnumbered),
      signature: Boolean(metadata.signature ?? raw.signature),
      cleanName: metadata.clean_name || raw.clean_name || "",
    },
  };
}

function isSimpleNormalCard(card) {
  const blob = `${card.name} ${card.rarity} ${card.type} ${card.supertype}`.toLowerCase();
  if (!card.name || !card.setId || !SET_SLUGS[card.setId]) return false;
  if (card.metadata.alternateArt || card.metadata.overnumbered || card.metadata.signature) return false;
  if (/showcase|promo|alternate|signature|overnumbered|foil|v\.\s*\d|version/.test(blob)) return false;
  return true;
}

function cardmarketNameSlugs(card) {
  const names = [card.name, card.metadata.cleanName].filter(Boolean);
  const slugs = new Set();

  for (const name of names) {
    const clean = String(name)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/&/g, "and")
      .replace(/[’']/g, "")
      .replace(/[.,:;!?()\[\]{}]/g, "")
      .replace(/\s*\/\s*/g, "-")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
    if (clean) slugs.add(clean);

    const conservative = String(name)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[’']/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    if (conservative) slugs.add(conservative);
  }

  return [...slugs];
}

function buildCardmarketUrls(card) {
  const setSlug = SET_SLUGS[card.setId];
  const params = new URLSearchParams({
    idLanguage: "1",
    language: "1",
    sellerCountry: "10",
    minCondition: "NM",
    isFoil: "false",
    isSigned: "false",
    isAltered: "false",
  });

  return cardmarketNameSlugs(card).map((slug) => `${CARDMARKET_BASE}/${setSlug}/${encodeURIComponent(slug)}?${params.toString()}`);
}

async function fetchAllCards() {
  const cards = [];
  for (let page = 1; page < 250; page += 1) {
    const url = `${RIFTCODEX_API}?size=100&page=${page}&sort=set_id&dir=1`;
    let res = await fetch(url, { headers: RIFTCODEX_HEADERS });

    if (res.status === 403) {
  const fallbackUrl = `${RIFTCODEX_API}?size=100&page=${page}`;
  console.warn(`Riftcodex respondió 403 con sort. Probando fallback: ${fallbackUrl}`);
  res = await fetch(fallbackUrl, { headers: RIFTCODEX_HEADERS });
    }

    if (!res.ok) {
  const body = await res.text().catch(() => "");
  throw new Error(`Riftcodex respondió ${res.status}. ${body.slice(0, 300)}`);
    }
    
    const data = await res.json();
    const items = Array.isArray(data) ? data : data.items || data.data || data.results || [];
    cards.push(...items.map(normalizeCard));
    if (!items.length || items.length < 100) break;
  }
  return cards.filter(isSimpleNormalCard);
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

function splitOfferSegments(html) {
  const chunks = [];
  const patterns = [
    /<[^>]+class=["'][^"']*(?:article-row|articleRow|article-item|articleItem|table-body-row|productRow)[^"']*["'][\s\S]*?(?=<[^>]+class=["'][^"']*(?:article-row|articleRow|article-item|articleItem|table-body-row|productRow)|<\/body>|$)/gi,
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

  const countryOk = /españa|spain|sellercountry.?10|country.?10|flag[-_ ]?es|\/es\.svg|country-icon-es|location.*es/.test(decoded) || /flag[-_ ]?es|\/es\.svg|sellercountry.?10|country.?10/.test(raw);
  const englishOk = /english|inglés|ingles|idlanguage.?1|language.?1|flag[-_ ]?gb|\/gb\.svg|\/en\.svg/.test(decoded) || /flag[-_ ]?gb|\/gb\.svg|idlanguage.?1|language.?1/.test(raw);
  const nmOk = /near mint|\bnm\b|mincondition.?nm/.test(decoded) || /mincondition.?nm/.test(raw);
  const badFlags = /signed|altered|foil/.test(decoded) && !/not signed|not altered|non foil|no foil/.test(decoded);

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
  if (fallback.length) return { price: Math.min(...fallback), confidence: "filtered-page" };
  return null;
}

async function fetchPriceForCard(card) {
  const urls = buildCardmarketUrls(card);
  for (const url of urls) {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; rb-board-price-checker/1.0; +https://github.com/luisreig39-boop/rb-board)",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
      },
      redirect: "follow",
    });

    if (res.status === 404) continue;
    if (res.status === 429) throw new Error("Cardmarket ha limitado temporalmente las peticiones (429). Baja MAX_CARDS_PER_RUN o sube CARDMARKET_DELAY_MS.");
    if (!res.ok) continue;

    const html = await res.text();
    const parsed = parseLowestPrice(html);
    if (parsed) {
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
  return null;
}

async function loadExisting() {
  try {
    return JSON.parse(await readFile(OUT_FILE, "utf8"));
  } catch {
    return { meta: {}, prices: {} };
  }
}

function hoursSince(iso) {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 36e5;
}

async function main() {
  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  const existing = await loadExisting();
  const prices = existing.prices || {};
  const cards = await fetchAllCards();

  const queue = cards
    .map((card) => ({ card, key: buildPriceKey(card), current: prices[buildPriceKey(card)] }))
    .filter(({ current }) => hoursSince(current?.updatedAt) >= REFRESH_HOURS)
    .sort((a, b) => {
      const ah = hoursSince(a.current?.updatedAt);
      const bh = hoursSince(b.current?.updatedAt);
      if (!a.current && b.current) return -1;
      if (a.current && !b.current) return 1;
      return bh - ah;
    })
    .slice(0, MAX_CARDS_PER_RUN);

  console.log(`Cartas normales detectadas: ${cards.length}`);
  console.log(`A actualizar en esta ejecución: ${queue.length}/${MAX_CARDS_PER_RUN}`);

  let ok = 0;
  let missing = 0;
  let failed = 0;

  for (let i = 0; i < queue.length; i += 1) {
    const { card, key } = queue[i];
    try {
      const result = await fetchPriceForCard(card);
      const fallbackUrl = buildCardmarketUrls(card)[0]?.split("?")[0] || "";
      if (result) {
        prices[key] = { ...result, cardName: card.name, setId: card.setId, publicCode: card.publicCode };
        ok += 1;
        console.log(`[${i + 1}/${queue.length}] OK ${card.setId} ${card.name}: ${result.priceFrom}€ (${result.confidence})`);
      } else {
        prices[key] = {
          priceFrom: null,
          currency: "EUR",
          url: fallbackUrl,
          source: "Cardmarket",
          sellerCountry: "ES",
          cardLanguage: "EN",
          condition: "NM",
          foil: false,
          confidence: "not-found",
          updatedAt: new Date().toISOString(),
          cardName: card.name,
          setId: card.setId,
          publicCode: card.publicCode,
        };
        missing += 1;
        console.log(`[${i + 1}/${queue.length}] Sin precio ${card.setId} ${card.name}`);
      }
    } catch (error) {
      failed += 1;
      console.warn(`[${i + 1}/${queue.length}] ERROR ${card.setId} ${card.name}: ${error.message}`);
      if (/429/.test(error.message)) break;
    }
    if (i < queue.length - 1) await sleep(DELAY_MS + Math.floor(Math.random() * 600));
  }

  const output = {
    meta: {
      updatedAt: new Date().toISOString(),
      source: "Cardmarket",
      filters: "España + carta en inglés + Near Mint + no foil/no signed/no altered",
      maxCardsPerRun: MAX_CARDS_PER_RUN,
      refreshHours: REFRESH_HOURS,
      totalNormalCards: cards.length,
      pricesWithValue: Object.values(prices).filter((p) => Number.isFinite(Number(p.priceFrom))).length,
      lastRun: { ok, missing, failed, queued: queue.length },
      warning: "Sin API oficial, esto depende del HTML público de Cardmarket. Si Cardmarket cambia la página o bloquea peticiones, puede dejar de actualizar.",
    },
    prices,
  };

  await writeFile(OUT_FILE, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Guardado ${OUT_FILE}. OK=${ok}, sin precio=${missing}, errores=${failed}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
