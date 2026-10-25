export function decodeEntities(value) {
  const basic = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&apos;": "'",
    "&nbsp;": " ",
    "&dollar;": "$",
    "&pound;": "£",
    "&euro;": "€",
    "&ndash;": "–",
    "&mdash;": "—",
    "&minus;": "−",
    "&bull;": "•",
    "&middot;": "·",
    "&hellip;": "…",
    "&rsquo;": "’",
    "&lsquo;": "‘",
    "&ldquo;": "“",
    "&rdquo;": "”",
    "&thinsp;": " ",
    "&ensp;": " ",
    "&emsp;": " ",
  };
  return String(value || "").replace(
    /&(?:amp|lt|gt|quot|apos|nbsp|dollar|pound|euro|ndash|mdash|minus|bull|middot|hellip|rsquo|lsquo|ldquo|rdquo|thinsp|ensp|emsp);|&#(?:x[0-9a-f]+|\d+);/gi,
    (entity) => {
      if (basic[entity.toLowerCase()]) return basic[entity.toLowerCase()];
      const n = entity.toLowerCase().startsWith("&#x")
        ? parseInt(entity.slice(3, -1), 16)
        : Number(entity.slice(2, -1));
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : " ";
    },
  );
}
export function descriptionMarkup(value) {
  let text = String(value || "");
  for (let i = 0; i < 2 && !/<\/?[a-z][^>]*>/i.test(text); i++) {
    const decoded = decodeEntities(text);
    if (decoded === text) break;
    text = decoded;
  }
  return text;
}
export const hasDescriptionHtml = (value) =>
  /<\/?[a-z][^>]*>/i.test(descriptionMarkup(value));
export function plainText(value) {
  const text = descriptionMarkup(value)
    .replace(
      /<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
      " ",
    )
    .replace(/<\/(?:p|div|li|h\d)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  return decodeEntities(text)
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n/g, "\n\n")
    .trim();
}
