(() => {
  const SET_SLUGS = {
    UNL: "Unleashed",
    SFD: "Spiritforged",
    OGN: "Origins",
    OGS: "Proving-Grounds",
  };

  function normalizeId(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
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

  function buildPriceKey(card) {
    if (card.priceKey) return card.priceKey;
    const code = normalizeId(card.publicCode || card.riftboundId || "");
    const safeSet = normalizeId(card.setId || "no-set");
    const safeName = normalizeId(card.name || "sin-nombre");
    return `${safeSet}:${code || safeName}:${safeName}`;
  }

  function isSimpleNormalCard(card) {
    const blob = `${card.name || ""} ${card.rarity || ""} ${card.type || ""} ${card.supertype || ""}`.toLowerCase();
    if (!card.name || !card.setId || !SET_SLUGS[card.setId]) return false;
    if (card.metadata?.alternateArt || card.metadata?.overnumbered || card.metadata?.signature) return false;
    if (/showcase|promo|alternate|signature|overnumbered|foil|v\.\s*\d|version/.test(blob)) return false;
    return true;
  }

  const stored = JSON.parse(localStorage.getItem("rb-board-pro:cards:v1") || "[]");
  const cards = Array.isArray(stored) ? stored : stored.cards || [];

  if (!cards.length) {
    alert("No encuentro cartas en localStorage. Abre la app, deja que carguen las cartas y vuelve a ejecutar este código.");
    return;
  }

  const targets = cards
    .filter(isSimpleNormalCard)
    .map((card) => {
      const setSlug = SET_SLUGS[card.setId];
      const cardSlug = slugifyCardmarketName(card.name);
      return {
        key: buildPriceKey(card),
        name: card.name,
        setId: card.setId,
        setSlug,
        setLabel: card.setLabel || setSlug,
        publicCode: String(card.publicCode || ""),
        riftboundId: String(card.riftboundId || ""),
        cardSlug,
        url: `https://www.cardmarket.com/es/Riftbound/Products/Singles/${setSlug}/${cardSlug}`,
      };
    })
    .sort((a, b) => String(a.setId).localeCompare(String(b.setId)) || String(a.publicCode).localeCompare(String(b.publicCode)) || a.name.localeCompare(b.name));

  const output = {
    meta: {
      generatedAt: new Date().toISOString(),
      source: "rb-board localStorage",
      totalCardsInApp: cards.length,
      totalTargets: targets.length,
      notes: "Cartas normales para consultar precios en Cardmarket. Variantes/alternate/showcase/promos/signature ignoradas.",
    },
    targets,
  };

  const blob = new Blob([JSON.stringify(output, null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "cardmarket-targets.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  console.log(`Descargado cardmarket-targets.json con ${targets.length} cartas normales de ${cards.length} cartas totales.`);
})();