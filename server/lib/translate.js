/* 5.2 — live translation of things people type.

   Translate on WRITE, not on read: a company tagline is written once and read
   thousands of times. We store one JSONB map of language → text next to the
   source, so serving it later costs nothing and works offline.

   Provider is optional. With no key configured every function still returns a
   valid map ({ source language: original }), so nothing breaks and the app
   simply shows the original text — which is exactly the 1.0 behaviour. That is
   what lets this ship without waiting on a translation contract.

   Set TRANSLATE_PROVIDER=deepl|google and TRANSLATE_API_KEY to switch it on. */

/* Must match the languages the app actually offers. When Turkish and Chinese
   were added to the interface this list was missed, so a Turkish customer saw
   every button in Turkish and every company tagline still in Hungarian — the
   half-translated result that looks worse than not offering the language.
   Guarded by a test against the client's own list. */
export const LANGS = ["en", "hu", "de", "ro", "sk", "pl", "uk", "fr", "es", "it", "tr", "zh"];

const KEY = process.env.TRANSLATE_API_KEY || "";
const PROVIDER = (process.env.TRANSLATE_PROVIDER || "").toLowerCase();
export const translationEnabled = () => !!KEY && (PROVIDER === "deepl" || PROVIDER === "google");

/* Never machine-translate legal text — that is a deliberate rule, not an oversight. */
const MAX_CHARS = 1200;

/* DeepL does not accept every code we use verbatim. Chinese must be asked for
   as ZH-HANS (simplified) — plain "ZH" is rejected on the write endpoint — and
   English needs a variant. Anything not listed passes through unchanged. */
const DEEPL_TARGET = { zh: "ZH-HANS", en: "EN-GB" };
const deeplTarget = (l) => DEEPL_TARGET[l] || l;

async function callDeepl(text, target) {
  const host = KEY.endsWith(":fx") ? "api-free.deepl.com" : "api.deepl.com";
  const r = await fetch(`https://${host}/v2/translate`, {
    method: "POST",
    headers: { Authorization: `DeepL-Auth-Key ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text: [text], target_lang: String(target).toUpperCase() }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`deepl ${r.status}`);
  const j = await r.json();
  return j?.translations?.[0]?.text || null;
}

async function callGoogle(text, target) {
  const r = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(KEY)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q: text, target, format: "text" }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`google ${r.status}`);
  const j = await r.json();
  return j?.data?.translations?.[0]?.translatedText || null;
}

/* Translate one short string into every language we support.
   Always resolves — a provider outage degrades to "original only". */
export async function translateAll(text, sourceLang = "hu") {
  const src = String(text || "").trim();
  if (!src) return null;
  const out = { _src: sourceLang, [sourceLang]: src };
  if (!translationEnabled() || src.length > MAX_CHARS) return out;

  const targets = LANGS.filter((l) => l !== sourceLang);
  const results = await Promise.allSettled(
    targets.map((l) => (PROVIDER === "deepl" ? callDeepl(src, deeplTarget(l)) : callGoogle(src, l)))
  );
  results.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value) out[targets[i]] = r.value;
  });
  return out;
}

/* Same, for a list (requirement lines). One map per line, order preserved. */
export async function translateList(list, sourceLang = "hu") {
  const items = (Array.isArray(list) ? list : []).map((x) => String(x || "").trim()).filter(Boolean).slice(0, 12);
  if (!items.length) return null;
  const maps = [];
  for (const it of items) maps.push(await translateAll(it, sourceLang));
  return maps;
}

/* Read side — used by the client too, so keep the rule in one place:
   ask for a language, fall back to the source, then to anything we have. */
export function pick(map, lang) {
  if (!map || typeof map !== "object") return null;
  if (map[lang]) return { text: map[lang], translated: lang !== map._src };
  const srcText = map[map._src];
  if (srcText) return { text: srcText, translated: false };
  const any = LANGS.map((l) => map[l]).find(Boolean);
  return any ? { text: any, translated: true } : null;
}

/* Only re-translate when the source actually changed — otherwise we would burn
   the translation quota every time someone saves an unrelated field. */
export function sourceChanged(existingMap, newText) {
  if (!existingMap || typeof existingMap !== "object") return true;
  const src = existingMap[existingMap._src];
  return String(src || "").trim() !== String(newText || "").trim();
}
