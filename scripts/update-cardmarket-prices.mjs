import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const TARGET_FILE = path.resolve("public/data/cardmarket-targets.json");
const OUT_FILE = path.resolve("public/data/cardmarket-prices.json");
const DEBUG_DIR = path.resolve("public/data/cardmarket-debug");

const MAX_CARDS_PER_RUN = Number(process.env.MAX_CARDS_PER_RUN || 40);
const DELAY_MS = Number(process.env.CARDMARKET_DELAY_MS || 4500);
const REFRESH_HOURS = Number(process.env.CARDMARKET_REFRESH_HOURS || 24);
const RETRY_MISSING_HOURS = Number(process.env.CARDMARKET_RETRY_MISSING_HOURS || 0);
const PRICE_MODE = String(process.env.CARDMARKET_PRICE_MODE || "foil").toLowerCase(); // foil | normal | any
const MIN_CONDITION = String(process.env.CARDMARKET_MIN_CONDITION || "2"); // 2 = NM, 3 = EX
const DEBUG = String(process.env.CARDMARKET_DEBUG || "0") === "1";

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
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(text) {
  return htmlDecode(text).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function toNumber(priceText) {
  const n = Number(String(priceText || "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 && n < 100000 ? n : null;
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
  if (target.url) return String(target.url).split("?")[0];
  const setSlug = target.setSlug || target.expansion || target.setLabel;
  const nameSlug = target.cardSlug || slugifyCardmarketName(target.name);
  if (!setSlug || !nameSlug) return "";
  return `https://www.cardmarket.com/es/Riftbound/Products/Singles/${encodeURIComponent(setSlug)}/${encodeURIComponent(nameSlug)}`;
}

function buildUrls(target) {
  const base = baseUrlForTarget(target);
  if (!base) return [];

  const common = {
    sellerCountry: "10",
    language: "1",
    minCondition: MIN_CONDITION,
  };

  const urls = [];

  if (PRICE_MODE === "foil") {
    urls.push(`${base}?${new URLSearchParams({ ...common, isFoil: "Y" }).toString()}`);
  } else if (PRICE_MODE === "normal") {
    urls.push(`${base}?${new URLSearchParams({ ...common, isFoil: "N" }).toString()}`);
  } else {
    urls.push(`${base}?${new URLSearchParams(common).toString()}`);
  }

  // Fallbacks por si Cardmarket ignora algún parámetro o cambia nombres.
  urls.push(`${base}?${new URLSearchParams(common).toString()}`);
  urls.push(base);

  return [...new Set(urls)];
}

function extractArticleRows(html) {
  const rows = [];
  const pattern = /<div\s+id=["']articleRow[^"']*["'][\s\S]*?(?=<div\s+id=["']articleRow|<\/section>|<\/div>\s*<\/div>\s*<\/section>|$)/gi;
  let match;
  while ((match = pattern.exec(html))) rows.push(match[0]);
  return rows;
}

function extractAllEuroPrices(html) {
  const decoded = stripTags(html);
  const prices = [];
  const pattern = /(\d{1,5}(?:\.\d{3})*,\d{2})\s*€/g;
  let match;
  while ((match = pattern.exec(decoded))) {
    const n = toNumber(match[1]);
    if (n != null) prices.push(n);
  }
  return prices;
}

function extractOfferPriceFromRow(row) {
  const prices = [];
  // En Cardmarket suele estar en span.color-primary...fw-bold
  const spanPattern = /<span[^>]*class=["'][^"']*color-primary[^"']*fw-bold[^"']*["'][^>]*>\s*(\d{1,5}(?:\.\d{3})*,\d{2})\s*€\s*<\/span>/gi;
  let match;
  while ((match = spanPattern.exec(row))) {
    const n = toNumber(match[1]);
    if (n != null) prices.push(n);
  }
  if (prices.length) return Math.min(...prices);

  const all = extractAllEuroPrices(row);
  return all.length ? Math.min(...all) : null;
}

function rowFlags(row) {
  const raw = htmlDecode(row).toLowerCase();
  const text = stripTags(row).toLowerCase();

  const countryEs = /ubicaci[oó]n del art[ií]culo:\s*espa/.test(raw) || /españa|spain/.test(text);
  const english = /aria-label=["']ingl[eé]s["']/.test(raw) || /data-original-title=["']ingl[eé]s["']/.test(raw) || /data-bs-original-title=["']ingl[eé]s["']/.test(raw) || /\bingl[eé]s\b|\benglish\b/.test(text);
  const nmOrBetter = /condition-(mt|nm)/.test(raw) || /near mint|\bnm\b|\bmint\b/.test(text);
  const exOrBetter = nmOrBetter || /condition-ex/.test(raw) || /excellent|\bex\b/.test(text);
  const conditionOk = MIN_CONDITION === "3" ? exOrBetter : nmOrBetter;

  const foil = /aria-label=["']foil["']/.test(raw) || /data-original-title=["']foil["']/.test(raw) || /data-bs-original-title=["']foil["']/.test(raw) || /st_specialicon|specialicon/.test(raw) || /\bfoil\b/.test(text);
  const signed = /aria-label=["']signed["']/.test(raw) || /\bsigned\b|firmad/.test(text);
  const altered = /aria-label=["']altered["']/.test(raw) || /\baltered\b|alterad/.test(text);

  let foilOk = true;
  if (PRICE_MODE === "foil") foilOk = foil;
  if (PRICE_MODE === "normal") foilOk = !foil;

  return { countryEs, english, conditionOk, foil, foilOk, signed, altered };
}

function extractSummaryFromPrice(html) {
  // Caso español: <dt>De</dt><dd>10,00 €</dd>
  const patterns = [
    /<dt[^>]*>\s*De\s*<\/dt>\s*<dd[^>]*>[\s\S]*?(\d{1,5}(?:\.\d{3})*,\d{2})\s*€/i,
    /<dt[^>]*>\s*From\s*<\/dt>\s*<dd[^>]*>[\s\S]*?(\d{1,5}(?:\.\d{3})*,\d{2})\s*€/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    const n = match ? toNumber(match[1]) : null;
    if (n != null) return n;
  }

  // Fallback textual: "De 10,00 € Tendencia..."
  const text = stripTags(html);
  const match = text.match(/(?:^|\s)(?:De|From)\s+(\d{1,5}(?:\.\d{3})*,\d{2})\s*€/i);
  const n = match ? toNumber(match[1]) : null;
  return n;
}

function parseLowestPrice(html) {
  const plain = stripTags(html).toLowerCase();
  if (/captcha|robot|access denied|too many requests|cloudflare|unusual traffic/.test(plain)) {
    return { blocked: true, reason: "blocked-or-captcha" };
  }

  const rows = extractArticleRows(html);
  const allRows = [];
  const validRows = [];

  for (const row of rows) {
    const price = extractOfferPriceFromRow(row);
    const flags = rowFlags(row);
    if (price == null) continue;
    allRows.push({ price, flags });

    if (flags.countryEs && flags.english && flags.conditionOk && flags.foilOk && !flags.signed && !flags.altered) {
      validRows.push(price);
    }
  }

  if (validRows.length) {
    return {
      price: Math.min(...validRows),
      confidence: PRICE_MODE === "foil" ? "strict-row-es-en-condition-foil" : PRICE_MODE === "normal" ? "strict-row-es-en-condition-nonfoil" : "strict-row-es-en-condition",
      debug: buildDebug(rows, allRows),
    };
  }

  const summaryPrice = extractSummaryFromPrice(html);
  if (summaryPrice != null) {
    return {
      price: summaryPrice,
      confidence: `summary-de-${PRICE_MODE}`,
      debug: buildDebug(rows, allRows),
    };
  }

  return { debug: buildDebug(rows, allRows) };
}

function buildDebug(rows, allRows) {
  return {
    rows: rows.length,
    pricedRows: allRows.length,
    esRows: allRows.filter((r) => r.flags.countryEs).length,
    enRows: allRows.filter((r) => r.flags.english).length,
    conditionRows: allRows.filter((r) => r.flags.conditionOk).length,
    foilRows: allRows.filter((r) => r.flags.foil).length,
    foilOkRows: allRows.filter((r) => r.flags.foilOk).length,
    pricesSeen: [...new Set(allRows.map((r) => r.price))].slice(0, 10),
  };
}

async function maybeSaveDebugHtml(target, url, html, parsed) {
  if (!DEBUG) return;
  await mkdir(DEBUG_DIR, { recursive: true });
  const name = `${normalizeId(target.setId || target.setSlug || "set")}-${normalizeId(target.name || "card")}`.slice(0, 120);
  await writeFile(path.join(DEBUG_DIR, `${name}.html`), html, "utf8");
  await writeFile(path.join(DEBUG_DIR, `${name}.json`), JSON.stringify({ target, url, parsed }, null, 2), "utf8");
}

async function fetchPriceForTarget(target) {
  const urls = buildUrls(target);
  let lastStatus = null;
  let bestDebug = null;
  let firstHtmlSaved = false;

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

   const html = await res.text();

    if (DEBUG && !firstHtmlSaved) {
      await maybeSaveDebugHtml(target, url, html, {
        status: res.status,
        ok: res.ok,
        headers: Object.fromEntries(res.headers.entries()),
      });
      firstHtmlSaved = true;
    }
    
    if (res.status === 404) continue;
    if (res.status === 429) return { blocked: true, status: 429, url };
    if (!res.ok) continue;
    
    const parsed = parseLowestPrice(html);
    bestDebug = parsed?.debug || bestDebug;

    if (DEBUG && !firstHtmlSaved) {
      await maybeSaveDebugHtml(target, url, html, parsed);
      firstHtmlSaved = true;
    }

    if (parsed?.blocked) return { blocked: true, status: res.status, url, reason: parsed.reason, debug: parsed.debug };

    if (parsed?.price) {
      return {
        priceFrom: Number(parsed.price.toFixed(2)),
        currency: "EUR",
        url: url.split("?")[0],
        source: "Cardmarket",
        sellerCountry: "ES",
        cardLanguage: "EN",
        condition: MIN_CONDITION === "3" ? "EX+" : "NM+",
        foil: PRICE_MODE === "foil" ? true : PRICE_MODE === "normal" ? false : null,
        priceMode: PRICE_MODE,
        confidence: parsed.confidence,
        debug: parsed.debug,
        updatedAt: new Date().toISOString(),
      };
    }
  }

  return { notFound: true, status: lastStatus, url: urls[0] || "", debug: bestDebug };
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
  if (!Number.isFinite(Number(current.priceFrom))) return hoursSince(current.updatedAt) >= RETRY_MISSING_HOURS;
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
      const ap = Number.isFinite(Number(a.current?.priceFrom));
      const bp = Number.isFinite(Number(b.current?.priceFrom));
      if (!ap && bp) return -1;
      if (ap && !bp) return 1;
      return hoursSince(b.current?.updatedAt) - hoursSince(a.current?.updatedAt);
    })
    .slice(0, MAX_CARDS_PER_RUN);

  console.log(`Targets disponibles: ${targets.length}`);
  console.log(`A actualizar en esta ejecución: ${queue.length}/${MAX_CARDS_PER_RUN}`);
  console.log(`Modo precio: ${PRICE_MODE.toUpperCase()} · España · Inglés · condición mínima ${MIN_CONDITION} · isFoil=${PRICE_MODE === "foil" ? "Y" : PRICE_MODE === "normal" ? "N" : "sin filtro"}`);

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
        console.log(`[${i + 1}/${queue.length}] OK ${PRICE_MODE.toUpperCase()} ${target.setId || ""} ${target.name}: ${result.priceFrom}€ (${result.confidence}) debug=${JSON.stringify(result.debug)}`);
      } else if (result?.blocked) {
        prices[key] = {
          priceFrom: null,
          currency: "EUR",
          url: result.url || fallbackUrl,
          source: "Cardmarket",
          sellerCountry: "ES",
          cardLanguage: "EN",
          condition: MIN_CONDITION === "3" ? "EX+" : "NM+",
          foil: PRICE_MODE === "foil" ? true : PRICE_MODE === "normal" ? false : null,
          priceMode: PRICE_MODE,
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
          currency: "EUR",
          url: result?.url || fallbackUrl,
          source: "Cardmarket",
          sellerCountry: "ES",
          cardLanguage: "EN",
          condition: MIN_CONDITION === "3" ? "EX+" : "NM+",
          foil: PRICE_MODE === "foil" ? true : PRICE_MODE === "normal" ? false : null,
          priceMode: PRICE_MODE,
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
        console.log(`[${i + 1}/${queue.length}] Sin precio ${PRICE_MODE.toUpperCase()} ${target.setId || ""} ${target.name}. URL: ${fallbackUrl} debug=${JSON.stringify(result?.debug || {})}`);
      }
    } catch (error) {
      failed += 1;
      console.warn(`[${i + 1}/${queue.length}] ERROR ${target.setId || ""} ${target.name}: ${error.message}`);
    }

    if (i < queue.length - 1) await sleep(DELAY_MS + Math.floor(Math.random() * 1000));
  }

  const output = {
    meta: {
      updatedAt: new Date().toISOString(),
      source: "Cardmarket",
      filters: `España + carta en inglés + condición mínima ${MIN_CONDITION} + modo ${PRICE_MODE}`,
      maxCardsPerRun: MAX_CARDS_PER_RUN,
      refreshHours: REFRESH_HOURS,
      retryMissingHours: RETRY_MISSING_HOURS,
      priceMode: PRICE_MODE,
      minCondition: MIN_CONDITION,
      totalTargets: targets.length,
      pricesWithValue: Object.values(prices).filter((p) => Number.isFinite(Number(p.priceFrom))).length,
      lastRun: { ok, missing, blocked, failed, queued: queue.length },
      warning: "Sin API oficial, esto depende del HTML público de Cardmarket. Si Cardmarket cambia la página o bloquea peticiones, puede dejar de actualizar.",
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
