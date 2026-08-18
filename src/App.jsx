import ReactDOM from "react-dom";
import React, { useState, useMemo, useContext, createContext, useCallback } from "react";
import { Capacitor } from "@capacitor/core";
import { StoreProvider, useStore, isLive } from "./store.jsx";
import { LANGS, getLang, LOCALES } from "./lib/i18n.js";
import { xl } from "./lib/translations.js";
import { initPush } from "./lib/push.js";
import { API_BASE, getToken } from "./lib/api.js";

/* In the installed app the layout fills the whole screen; the centered
   430px column is only for desktop web browsers. */
const NATIVE = (() => { try { return Capacitor.isNativePlatform(); } catch { return false; } })();
const SHELL_W = NATIVE ? "100%" : 430;

/* ── 4.2 Phone country codes. Default follows the device locale, so a
   Ukrainian student in Debrecen isn't forced to fight a +36 field. ── */
const DIAL_CODES = [
  { c: "HU", d: "+36", f: "🇭🇺", n: "Magyarország" },
  { c: "UA", d: "+380", f: "🇺🇦", n: "Україна" },
  { c: "RO", d: "+40", f: "🇷🇴", n: "România" },
  { c: "SK", d: "+421", f: "🇸🇰", n: "Slovensko" },
  { c: "AT", d: "+43", f: "🇦🇹", n: "Österreich" },
  { c: "DE", d: "+49", f: "🇩🇪", n: "Deutschland" },
  { c: "PL", d: "+48", f: "🇵🇱", n: "Polska" },
  { c: "RS", d: "+381", f: "🇷🇸", n: "Srbija" },
  { c: "HR", d: "+385", f: "🇭🇷", n: "Hrvatska" },
  { c: "SI", d: "+386", f: "🇸🇮", n: "Slovenija" },
  { c: "GB", d: "+44", f: "🇬🇧", n: "United Kingdom" },
  { c: "IT", d: "+39", f: "🇮🇹", n: "Italia" },
  { c: "ES", d: "+34", f: "🇪🇸", n: "España" },
  { c: "FR", d: "+33", f: "🇫🇷", n: "France" },
  { c: "NL", d: "+31", f: "🇳🇱", n: "Nederland" },
  { c: "TR", d: "+90", f: "🇹🇷", n: "Türkiye" },
  { c: "PK", d: "+92", f: "🇵🇰", n: "Pakistan" },
  { c: "IN", d: "+91", f: "🇮🇳", n: "India" },
  { c: "NG", d: "+234", f: "🇳🇬", n: "Nigeria" },
  { c: "CN", d: "+86", f: "🇨🇳", n: "中国" },
  { c: "US", d: "+1", f: "🇺🇸", n: "United States" },
];
const deviceCountry = () => {
  try {
    const l = (navigator.languages && navigator.languages[0]) || navigator.language || "hu-HU";
    const m = String(l).split("-")[1];
    if (m && DIAL_CODES.some((x) => x.c === m.toUpperCase())) return m.toUpperCase();
  } catch {}
  return "HU";
};
const dialOf = (cc) => (DIAL_CODES.find((x) => x.c === cc) || DIAL_CODES[0]).d;
/* Split a stored E.164 number back into picker + local part. */
const splitPhone = (v) => {
  const s = String(v || "").trim();
  const hit = [...DIAL_CODES].sort((a, b) => b.d.length - a.d.length).find((x) => s.startsWith(x.d));
  return hit ? { cc: hit.c, local: s.slice(hit.d.length).trim() } : { cc: deviceCountry(), local: s.replace(/^\+/, "") };
};

function PhoneField({ label, value, onChange }) {
  const init = splitPhone(value);
  const [cc, setCc] = useState(init.cc);
  const [local, setLocal] = useState(init.local);
  React.useEffect(() => { onChange(local ? dialOf(cc) + local.replace(/[^0-9]/g, "") : ""); }, [cc, local]);
  return (
    <div style={{ marginBottom: 13 }}>
      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink, marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", gap: 8 }}>
        <select value={cc} onChange={(e) => setCc(e.target.value)}
          style={{ width: 116, border: `1.5px solid ${C.line}`, borderRadius: 13, padding: "11px 8px", fontFamily: B, fontSize: 13, background: C.bg, color: C.ink, outline: "none" }}>
          {DIAL_CODES.map((x) => <option key={x.c} value={x.c}>{x.f} {x.d}</option>)}
        </select>
        <input value={local} inputMode="tel" placeholder="30 123 4567"
          onChange={(e) => setLocal(e.target.value)}
          style={{ flex: 1, minWidth: 0, border: `1.5px solid ${C.line}`, borderRadius: 13, padding: "11px 13px", fontFamily: B, fontSize: 13.5, background: C.bg, color: C.ink, outline: "none" }} />
      </div>
    </div>
  );
}

/* ── 2.1 Force-update gate ─────────────────────────────────────────
   The server publishes a minimum supported version. Below it, the app
   blocks with an update screen — this is what lets us change payment
   flows later without silently breaking people on old builds. */
const APP_VERSION = "7.0.0";
const verLt = (a, b) => {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) < (pb[i] || 0)) return true; if ((pa[i] || 0) > (pb[i] || 0)) return false; }
  return false;
};

/* ── Theme: follows the phone's light/dark mode automatically ── */
const LIGHT = {
  navy: "#1B2A6B", navyDeep: "#10194A", navyMid: "#27379B", navySoft: "#4A5BBF",
  mint: "#5EE6A8", mintSoft: "#DCFAEC",
  bg: "#F4F6FC", card: "#FFFFFF", ink: "#141C3A", inkSoft: "#69718F", inkFaint: "#9AA2C0",
  line: "#E7EAF6", gold: "#FFC555", coral: "#FF7A6B",
  green: "#118A5C", greenDeep: "#0F7A50", coralText: "#B33A2B", coralSoft: "#FFE9E5",
  amber: "#D96A2B", amberSoft: "#FFF1E8", navyChip: "#EEF1FB",
  shell: "#E7EBF6", navBg: "rgba(255,255,255,.9)",
};
const DARK = {
  navy: "#4A5BBF", navyDeep: "#0B1128", navyMid: "#27379B", navySoft: "#8E9CE8",
  mint: "#5EE6A8", mintSoft: "rgba(94,230,168,.16)",
  bg: "#111832", card: "#1B2444", ink: "#EDF0FF", inkSoft: "#A6AFD6", inkFaint: "#7079A6",
  line: "#2A3560", gold: "#FFC555", coral: "#FF8A7C",
  green: "#7FEFC0", greenDeep: "#7FEFC0", coralText: "#FF9A8C", coralSoft: "rgba(255,122,107,.14)",
  amber: "#FFB067", amberSoft: "rgba(255,180,90,.14)", navyChip: "#232D52",
  shell: "#0B1023", navBg: "rgba(24,31,60,.9)",
};
const C = { ...LIGHT };
const applyTheme = (dark) => Object.assign(C, dark ? DARK : LIGHT);

/* ── Markets: country → cities. Adding a country later = add an entry here
      (+ currency & payment provider wiring, see CONCEPT-AUDIT roadmap). ── */
const MARKETS = {
  HU: {
    name: "Magyarország",
    currency: "HUF",
    cities: ["Budapest", "Debrecen", "Szeged", "Miskolc", "Pécs", "Győr", "Nyíregyháza", "Kecskemét", "Székesfehérvár", "Szombathely"],
  },
};
const ALL_CITIES = Object.values(MARKETS).flatMap((m) => m.cities);
/* 4.3 — any city, any country. The old version only accepted one of ten
   Hungarian cities and fell back to a hardcoded "Debrecen", which is why
   anyone outside Hungary saw Debrecen no matter what they typed. */
const getCity = () => {
  try { const c = localStorage.getItem("cleanly_city"); if (c && c.trim()) return c.trim(); } catch {}
  return "";
};
const saveCity = (c) => { try { localStorage.setItem("cleanly_city", c); } catch {} };

/* Hungarian company identifiers (mirror of server-side validation) */
const huTaxIdValid = (raw) => {
  const d = String(raw || "").replace(/[^0-9]/g, "");
  if (d.length !== 11) return false;
  const w = [9, 7, 3, 1, 9, 7, 3];
  const sum = w.reduce((a, wi, i) => a + wi * Number(d[i]), 0);
  if ((10 - (sum % 10)) % 10 !== Number(d[7])) return false;
  if (!"12345".includes(d[8])) return false;
  const county = Number(d.slice(9, 11));
  return (county >= 2 && county <= 44) || county === 51;
};
const huRegNumberValid = (raw) => String(raw || "").replace(/[^0-9]/g, "").length === 10;

/* ── Phone prefix auto-detection (IP country → dial code) ── */
const DIAL = { HU: "+36", RO: "+40", SK: "+421", AT: "+43", DE: "+49", PL: "+48", CZ: "+420", HR: "+385", RS: "+381", UA: "+380", GB: "+44", IT: "+39", ES: "+34", FR: "+33", NL: "+31", PK: "+92", TR: "+90" };
let _dial = null;
async function getDial() {
  if (_dial) return _dial;
  try {
    const r = await fetch("https://ipapi.co/json/", { signal: AbortSignal.timeout(4000) });
    const j = await r.json();
    _dial = DIAL[j.country_code] || "+36";
  } catch { _dial = "+36"; }
  return _dial;
}
const F = `'Quicksand','Inter',system-ui,sans-serif`;
const B = `'Inter',system-ui,sans-serif`;
/* Bilingual helpers for literals living outside the t() dictionary.
   Components re-render on language switch (store subscribers), so these stay in sync. */
const HUL = () => getLang() === "hu";
const L = (en, hu) => { const lg = getLang(); return lg === "hu" ? hu : xl(lg, en); };
const LOC = () => LOCALES[getLang()] || "en-GB";
// A company's active offer ({pct,label,until}) or null once expired.
const promoOf = (co) => {
  const p = co && co.promo;
  if (!p || !p.pct) return null;
  if (p.until && new Date(p.until + "T23:59:59") < new Date()) return null;
  return p;
};
const everyP = (per) => (HUL()
  ? ({ weekly: "hetente", biweekly: "kéthetente", monthly: "havonta" }[per] || "havonta")
  : `every ${({ weekly: "week", biweekly: "2 weeks", monthly: "month" }[per] || "month")}`);
const huf = (n) => (n ?? 0).toLocaleString("hu-HU") + " Ft";
/* Two ladders. A cleaning finishes when the cleaner leaves; a laundry round
   finishes days later when the items come back, so "Done" must not appear the
   moment a bag is picked up. Index by status code, not by position. */
const STAGE = (status, fulfilment) => {
  const collection = fulfilment === "collection";
  const M = collection
    ? { 0: L("New", "Új"), 1: L("Assigned", "Kiosztva"), 2: L("On the way", "Úton"),
        5: L("Collected", "Elvittük"), 3: L("In progress", "Folyamatban"),
        6: L("Out for return", "Úton vissza"), 4: L("Returned ✨", "Visszahozva ✨") }
    : { 0: L("New", "Új"), 1: L("Assigned", "Kiosztva"), 2: L("On the way", "Úton"),
        3: L("Cleaning", "Takarítás"), 4: L("Done ✨", "Kész ✨") };
  return M[Number(status)] || "";
};
const stageList = () => (HUL() ? ["Új", "Kiosztva", "Úton", "Takarítás", "Kész ✨"] : ["New", "Assigned", "On the way", "Cleaning", "Done ✨"]);
/* Bookable hours. Companies tick the ones they work; customers see only those. */
const HOURS = ["06:00","07:00","08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00","18:00","19:00","20:00"];
const SLOTS = HOURS;   // legacy alias — the app books on whole hours now
/* ── Company availability ─────────────────────────────────────────
   { paused, days: { "0".."6": {on,from,to} }, closed: ["YYYY-MM-DD"] }   */
const DEFAULT_AVAIL = {
  paused: false,
  days: {
    "0": { on: false, slots: [] },
    "1": { on: true, slots: ["08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00"] },
    "2": { on: true, slots: ["08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00"] },
    "3": { on: true, slots: ["08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00"] },
    "4": { on: true, slots: ["08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00"] },
    "5": { on: true, slots: ["08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00"] },
    "6": { on: true, slots: ["09:00","10:00","11:00","12:00","13:00"] },
  },
  closed: [],
  busy: {},
};
const availOf = (co) => (co && co.availability) ? co.availability : null;
const isoOf = (d) => String((d && d.iso) ? d.iso : d).slice(0, 10);
const dowOf = (iso) => String(new Date(isoOf(iso) + "T12:00:00Z").getUTCDay());

/* The hours a company offers on a weekday. Falls back to old from/to data. */
const daySlots = (av, iso) => {
  if (!av) return HOURS;                       // company never set availability → everything
  const d = (av.days || {})[dowOf(iso)];
  if (!d || d.on === false) return [];
  if (Array.isArray(d.slots)) return d.slots;
  if (d.from && d.to) return HOURS.filter((h) => h >= d.from && h < d.to);   // legacy
  return HOURS;
};
/* Two kinds of blocked time, and the difference matters to a company that does
   more than one thing:

     busy         { "YYYY-MM-DD": ["09:00"] }               — blocked for EVERYTHING
     busyServices { "<serviceId>": { "YYYY-MM-DD": [...] } } — blocked for ONE service

   So a company whose cleaning slot is taken at 10:00 can still sell laundry at
   10:00, while a dentist appointment blocks the whole hour. Passing no serviceId
   asks the broad question: "is anything bookable then?" */
const slotBusy = (av, iso, slot, serviceId) => {
  const h = String(slot).slice(0, 5);
  const all = av && av.busy ? av.busy[isoOf(iso)] : null;
  if (Array.isArray(all) && all.includes(h)) return true;
  if (!serviceId) return false;
  const perSvc = av && av.busyServices ? (av.busyServices[serviceId] || {})[isoOf(iso)] : null;
  return Array.isArray(perSvc) && perSvc.includes(h);
};
/* The hours a customer can actually book on this date, for this service. */
const openSlots = (av, iso, serviceId) => {
  if (!av) return HOURS;
  if (av.paused) return [];
  if (Array.isArray(av.closed) && av.closed.includes(isoOf(iso))) return [];
  return daySlots(av, iso).filter((h) => !slotBusy(av, iso, h, serviceId));
};
const slotOpen = (av, iso, slot, serviceId) => openSlots(av, iso, serviceId).includes(String(slot).slice(0, 5));
/* A day is only "closed" if NOTHING at all can be booked — never grey out the
   whole day just because one service happens to be full. */
const dayClosed = (av, iso) => openSlots(av, iso).length === 0;
const COVER_PRESETS = [
  "linear-gradient(135deg,#22B573,#7BD96A)",
  "linear-gradient(135deg,#3D7BF5,#2BB8E8)",
  "linear-gradient(135deg,#7B4DE0,#B388FF)",
  "linear-gradient(135deg,#FF6B6B,#FFE66D)",
  "linear-gradient(135deg,#1B2A6B,#27379B)",
  "linear-gradient(135deg,#F9731C,#FF5E8A)",
  "linear-gradient(135deg,#00B09B,#96C93D)",
  "linear-gradient(135deg,#4776E6,#8E54E9)",
];
const coverOf = (co) => co.cover || COVER_PRESETS[0];

/* ── Recurring-schedule helpers (subscriptions) ───────────── */
const dayObjFromDate = (d) => ({ iso: localISO(d), d: d.toLocaleDateString(LOC(), { weekday: "short" }), n: d.getDate(), label: null });
const ordinal = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const cadenceLabel = (period, day) => {
  if (!day) return "";
  if (period === "monthly") return HUL() ? `Havonta, a hónap ${day.n}. napján` : `Monthly on the ${ordinal(day.n)}`;
  if (period === "biweekly") return HUL() ? `Kéthetente, ${day.d}` : `Every 2 weeks on ${day.d}`;
  return HUL() ? `Minden ${day.d}` : `Every ${day.d}`;
};

/* ── Month calendar (used for subscriptions + company schedule) ── */
function Calendar({ selected, onSelect, minISO, marks = {}, initialMonth }) {
  const today = new Date();
  const [view, setView] = useState(() => initialMonth || new Date(today.getFullYear(), today.getMonth(), 1));
  const y = view.getFullYear(), m = view.getMonth();
  const firstDow = (new Date(y, m, 1).getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const monthLabel = view.toLocaleDateString(LOC(), { month: "long", year: "numeric" });
  const canPrev = new Date(y, m, 1) > new Date(today.getFullYear(), today.getMonth(), 1);
  return (
    <div style={{ background: C.card, borderRadius: 18, padding: "12px 12px 14px", boxShadow: "0 2px 10px rgba(20,28,58,.06)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <button onClick={() => canPrev && setView(new Date(y, m - 1, 1))} disabled={!canPrev} style={{ width: 32, height: 32, borderRadius: 10, border: "none", background: C.bg, color: canPrev ? C.navy : C.inkFaint, fontSize: 15, fontWeight: 700, cursor: canPrev ? "pointer" : "default" }}>‹</button>
        <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13.5, color: C.ink }}>{monthLabel}</div>
        <button onClick={() => setView(new Date(y, m + 1, 1))} style={{ width: 32, height: 32, borderRadius: 10, border: "none", background: C.bg, color: C.navy, fontSize: 15, fontWeight: 700, cursor: "pointer" }}>›</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2, marginBottom: 4 }}>
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((w) => (
          <div key={w} style={{ textAlign: "center", fontFamily: B, fontSize: 9.5, fontWeight: 700, color: C.inkFaint, padding: "4px 0" }}>{w}</div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2 }}>
        {cells.map((n, i) => {
          if (n === null) return <div key={"e" + i} />;
          const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(n).padStart(2, "0")}`;
          const disabled = minISO && iso < minISO;
          const isSel = selected === iso;
          const mark = marks[iso];
          return (
            <button key={iso} onClick={() => !disabled && onSelect(iso)} disabled={disabled} style={{
              position: "relative", aspectRatio: "1", borderRadius: 10, border: "none", cursor: disabled ? "default" : "pointer",
              fontFamily: F, fontWeight: 700, fontSize: 12.5,
              background: isSel ? C.navy : "transparent",
              color: isSel ? "#fff" : disabled ? "#D5DAED" : C.ink,
            }}>
              {n}
              {mark > 0 && <span style={{ position: "absolute", bottom: 3, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 2 }}>
                {[...Array(Math.min(mark, 3))].map((_, k) => <span key={k} style={{ width: 4, height: 4, borderRadius: "50%", background: isSel ? C.mint : C.navySoft }} />)}
              </span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Document upload (verification papers, ID cards) ──────── */
function DocUpload({ docs = [], onChange, label, hint }) {
  const add = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    (async () => {
      let next = docs;
      for (const file of files) {
        if (next.length >= 6) break;
        try {
          const data = await prepareUpload(file);
          next = [...next, { name: file.name, type: /^image\//.test(file.type) ? "image/jpeg" : file.type, data }].slice(0, 6);
          onChange(next);
        } catch (err) {
          alert(err.message === "too-large"
            ? `${file.name}: ${L("that file is too large — 8 MB maximum", "túl nagy a fájl — legfeljebb 8 MB")}`
            : `${file.name}: ${L("could not be read", "nem sikerült beolvasni")}`);
        }
      }
    })();
  };
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink, marginBottom: 7 }}>{label}</div>
      {hint && <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft, marginBottom: 8, lineHeight: 1.5 }}>{hint}</div>}
      {docs.map((doc, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, background: C.card, borderRadius: 13, padding: "8px 12px", marginBottom: 7, boxShadow: "0 1px 5px rgba(20,28,58,.05)" }}>
          {doc.type?.startsWith("image/")
            ? <img src={doc.data} alt="" style={{ width: 38, height: 38, objectFit: "cover", borderRadius: 9, flexShrink: 0 }} />
            : <div style={{ width: 38, height: 38, borderRadius: 9, background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flexShrink: 0 }}>📄</div>}
          <span style={{ flex: 1, fontFamily: B, fontSize: 11.5, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.name}</span>
          <button onClick={() => onChange(docs.filter((_, k) => k !== i))} style={{ border: "none", background: "none", color: C.coral, fontWeight: 700, cursor: "pointer", fontSize: 13 }}>✕</button>
        </div>
      ))}
      {docs.length < 6 && (
        <label style={{ display: "block", textAlign: "center", fontFamily: F, fontWeight: 700, fontSize: 12.5, padding: "11px 0", borderRadius: 13, border: `1.5px dashed ${C.navySoft}66`, color: C.navySoft, cursor: "pointer", background: C.card }}>
          📎 Add document (photo or PDF)
          <input type="file" accept="image/*,application/pdf" multiple onChange={add} style={{ display: "none" }} />
        </label>
      )}
    </div>
  );
}

/* ── Document viewer (admin review) ───────────────────────── */
/* Opens a stored document. Data-URL "download" links are blocked inside the
   phone app, so we turn it into a blob URL and open it in the system viewer —
   from there the user can save or share it. */
async function openDoc(doc) {
  const [meta, b64] = String(doc.data || "").split(",");
  const mime = ((meta || "").match(/data:([^;]+)/) || [])[1] || "application/octet-stream";
  // Inside the phone app: save to a temp file and open the system share sheet —
  // the ONLY reliable way to view/save a PDF in an iOS/Android webview.
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.isNativePlatform() && b64) {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      const { Share } = await import("@capacitor/share");
      const name = (doc.name || "document").replace(/[^\w.\-]+/g, "_");
      const w = await Filesystem.writeFile({ path: name, data: b64, directory: Directory.Cache });
      await Share.share({ title: doc.name || "Document", url: w.uri });
      return;
    }
  } catch (e) { /* fall through to the browser path */ }
  // Browser: blob URL + download
  try {
    if (!b64) { window.open(doc.data, "_blank"); return; }
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const a = document.createElement("a");
    a.href = url; a.target = "_blank"; a.rel = "noreferrer";
    a.download = doc.name || "document";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch { try { window.open(doc.data, "_blank"); } catch {} }
}

function DocViewer({ docs, title, close }) {
  // Every admin (limited or CEO) can view AND download documents; the admin log records decisions.
  const canDownload = true;
  return (
    <Sheet title={title} close={close}>
      {(!docs || docs.length === 0) && <div style={{ fontFamily: B, fontSize: 12.5, color: C.inkSoft, textAlign: "center", padding: 24 }}>{L("No documents uploaded.", "Nincs feltöltött dokumentum.")}</div>}
      {(docs || []).map((doc, i) => (
        <div key={i} style={{ marginBottom: 14 }}>
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12, color: C.ink, marginBottom: 6 }}>{doc.name}</div>
          {doc.type?.startsWith("image/")
            ? <>
                <img src={doc.data} alt={doc.name} onContextMenu={(e) => { if (!canDownload) e.preventDefault(); }} draggable={canDownload}
                  style={{ width: "100%", borderRadius: 14, boxShadow: "0 2px 10px rgba(20,28,58,.1)", pointerEvents: canDownload ? "auto" : "none" }} />
                {canDownload && <button onClick={() => openDoc(doc)} style={{ marginTop: 6, background: "none", border: "none", padding: 0, fontFamily: B, fontWeight: 700, fontSize: 11.5, color: C.navySoft, cursor: "pointer" }}>⬇ Open / download {doc.name}</button>}
              </>
            : <button onClick={() => openDoc(doc)} style={{ display: "block", width: "100%", textAlign: "left", fontFamily: B, fontSize: 12.5, color: C.navySoft, background: C.card, border: "none", borderRadius: 13, padding: "12px 14px", cursor: "pointer", boxShadow: "0 1px 5px rgba(20,28,58,.05)" }}>📄 Open / download {doc.name}</button>}
        </div>
      ))}
    </Sheet>
  );
}

/* ── Pricing helpers (flat · hourly · subscription) ───────── */
const periodLabel = (p) => (HUL() ? ({ weekly: "hét", biweekly: "2 hét", monthly: "hónap" }[p] || p || "hónap") : ({ weekly: "week", biweekly: "2 weeks", monthly: "month" }[p] || p || "month"));
const periodShort = (p) => (HUL() ? ({ weekly: "hét", biweekly: "2hét", monthly: "hó" }[p] || p || "hó") : ({ weekly: "wk", biweekly: "2wk", monthly: "mo" }[p] || p || "mo"));
const priceLabel = (s) => {
  if (!s) return "";
  if (s.pricing_type === "hourly") return `${huf(s.hourly_rate_huf)}${L("/hr", "/óra")}`;
  if (s.pricing_type === "subscription") return `${huf(s.price_huf)} / ${periodShort(s.period)}`;
  return huf(s.price_huf);
};
// base price used for "from …" sorting/labels
const basePrice = (s) => (s.pricing_type === "hourly" ? (s.hourly_rate_huf || 0) : (s.price_huf || 0));

// Local-timezone ISO date — toISOString() shifts to UTC and books Hungarians a day early after 22:00.
/* ── Photos from a modern phone are 3–12 MB, and we were simply refusing them.
   Shrink instead of reject: draw the image to a canvas at a sane size and
   re-encode as JPEG, dropping quality a step at a time until it fits. A photo of
   an ID card or a company document is perfectly legible at 1600px, and this turns
   a 9 MB refusal into a 300 KB upload.

   Anything that isn't an image (a PDF) can't be re-encoded, so it keeps a plain
   size check — but a far more generous one now that photos aren't the problem. ── */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(file);
  });
}

async function compressImage(file, { maxEdge = 1600, maxBytes = 900 * 1024 } = {}) {
  const dataUrl = await readAsDataUrl(file);
  if (!/^image\//.test(file.type) || /image\/svg/.test(file.type)) return dataUrl;

  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("decode failed"));
    i.src = dataUrl;
  });

  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  /* White behind transparency, or a PNG logo turns black once it becomes JPEG. */
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  let out = dataUrl;
  for (const q of [0.82, 0.7, 0.6, 0.5, 0.4]) {
    out = canvas.toDataURL("image/jpeg", q);
    if (out.length * 0.75 <= maxBytes) break;
  }
  /* If shrinking somehow made it bigger (tiny images), keep the original. */
  return out.length < dataUrl.length ? out : dataUrl;
}

/* One place that turns a picked file into something safe to send. */
async function prepareUpload(file, opts) {
  if (/^image\//.test(file.type)) return await compressImage(file, opts);
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("too-large");
  return await readAsDataUrl(file);
}

/* Both maps in the app should look like the same product. Carto's minimalist
   grey basemaps: Positron in daylight, Dark Matter at night — the same family the
   live-tracking map uses, so a company setting its service circle and a customer
   watching a cleaner arrive are looking at the same cartography.
   Read at render time rather than cached, because the phone can switch theme
   while the app is open. */
const MAP_TILES = () => {
  const dark = typeof window !== "undefined" && window.matchMedia
    && window.matchMedia("(prefers-color-scheme: dark)").matches;
  return dark
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
};

/* When live tracking makes sense, which differs by job type:
     on-site     — 2 on the way, 3 cleaning (they are at your address)
     collection  — 2 coming to collect, 6 bringing it back
   Deliberately NOT during 5 (collected) or 3 (in progress) on a collection job:
   the items are at the company's premises and following a driver around town
   while your washing is in a machine is neither useful nor comfortable. */
const canTrack = (b) => {
  const st = Number(b?.status);
  return b?.fulfilment === "collection" ? (st === 2 || st === 6) : (st === 2 || st === 3);
};

/* What a search should look at. Typing "laundry" must find the company that
   offers laundry, not just one with "laundry" in its name — otherwise the only
   way to discover a service is to open every company in turn and read the list.
   Also searches translated service names, so a Hungarian typing "mosás" finds a
   service written in English and vice versa. */
function matchesSearch(company, services, q) {
  const needle = String(q || "").trim().toLowerCase();
  if (!needle) return { hit: true, services: [] };

  const inText = (v) => String(v || "").toLowerCase().includes(needle);
  const nameHit = inText(company.name) || inText(company.tagline) || inText(company.area);

  const mine = (services || []).filter((s) => s.company_id === company.id && s.is_active !== false);
  const svcHits = mine.filter((s) => {
    if (inText(s.name) || inText(s.description)) return true;
    /* the same service, in whatever language it was translated into */
    for (const map of [s.name_i18n, s.description_i18n]) {
      if (map && typeof map === "object") {
        for (const k of Object.keys(map)) { if (k !== "_src" && inText(map[k])) return true; }
      }
    }
    return false;
  });

  return { hit: nameHit || svcHits.length > 0, services: svcHits };
}

/* Mirrors the server rule so the button simply is not there once the window has
   closed — offering a button that always errors is worse than not offering it. */
const canStillCancel = (b, freeH = 48) => {
  try {
    const d = String(b.scheduled_date).slice(0, 10);
    const hm = String(b.scheduled_slot || "09:00").match(/(\d{1,2}):(\d{2})/) || [0, "9", "00"];
    const start = Date.parse(`${d}T${String(hm[1]).padStart(2, "0")}:${hm[2]}:00`);
    const h = (start - Date.now()) / 3600e3;
    return !Number.isFinite(h) ? true : h >= freeH;
  } catch { return true; }
};

const localISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/* When a job is due to start, in the phone's own timezone. Shared by the
   company's "needs attention" list so "starting soon" and "overdue" mean the
   same thing everywhere. */
const slotStartMs = (b) => {
  try {
    const d = String(b.scheduled_date).slice(0, 10);
    const hm = String(b.scheduled_slot || "09:00").match(/(\d{1,2}):(\d{2})/) || [0, "9", "00"];
    const t = Date.parse(`${d}T${String(hm[1]).padStart(2, "0")}:${hm[2]}:00`);
    return Number.isFinite(t) ? t : null;
  } catch { return null; }
};

/* "3h 20m", "45m", "12m" — deliberately short, because it sits inside a chip. */
const shortLeft = (ms) => {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60);
  return h >= 1 ? `${h}h ${m % 60}m` : `${m}m`;
};


/* How far ahead customers may book. Two months covers holidays, house moves and
   "before my parents visit", which is when people actually plan a deep clean.
   The server enforces its own outer limit, so this is only the UI. */
const BOOK_AHEAD_DAYS = 60;

/* Bounds shared by the customer's date strip and the company's busy-slot editor,
   so the two can never disagree about how far ahead the diary runs. */
const todayISO = () => localISO(new Date());
const maxBookISO = () => { const d = new Date(); d.setDate(d.getDate() + BOOK_AHEAD_DAYS); return localISO(d); };

const nextDays = (days = BOOK_AHEAD_DAYS) => {
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(); d.setDate(d.getDate() + i);
    out.push({
      iso: localISO(d),
      d: d.toLocaleDateString(LOC(), { weekday: "short" }),
      n: d.getDate(),
      month: d.toLocaleDateString(LOC(), { month: "long" }),
      monthKey: `${d.getFullYear()}-${d.getMonth()}`,
      label: i === 0 ? L("Today", "Ma") : i === 1 ? L("Tomorrow", "Holnap") : null,
    });
  }
  return out;
};
const dayLabel = (iso) => {
  if (!iso) return "";
  iso = String(iso).slice(0, 10); // tolerate full ISO timestamps from the API
  const t = new Date(); const d = new Date(iso + "T00:00:00");
  const diff = Math.round((d - new Date(t.toDateString())) / 864e5);
  if (iso === "today" || diff === 0) return L("Today", "Ma");
  if (diff === 1) return L("Tomorrow", "Holnap");
  if (diff === -1) return L("Yesterday", "Tegnap");
  return d.toLocaleDateString(LOC(), { weekday: "short", day: "numeric", month: "short" });
};

/* ── Toast system ─────────────────────────────────────────── */

const ToastCtx = createContext(null);
export const useToast = () => useContext(ToastCtx);

function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const recent = React.useRef(new Map());
  const toast = useCallback((msg, type = "success") => {
    // De-duplicate: the same message fired again within 4s is ignored, so a
    // single failure can never show as two or three stacked messages.
    const key = String(msg);
    const now = Date.now();
    const last = recent.current.get(key) || 0;
    if (now - last < 4000) return;
    recent.current.set(key, now);
    const id = now + Math.random();
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div style={{ position: "fixed", bottom: 100, left: "50%", transform: "translateX(-50%)", zIndex: 200, display: "flex", flexDirection: "column", gap: 8, width: "min(360px,calc(100vw - 40px))", pointerEvents: "none" }}>
        {toasts.map((t) => (
          <div key={t.id} className="cl-rise" style={{ background: t.type === "error" ? C.coral : C.navyDeep, color: "#fff", padding: "13px 18px", borderRadius: 16, fontFamily: B, fontSize: 13.5, boxShadow: "0 8px 24px rgba(0,0,0,.28)", fontWeight: 600, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 16 }}>{t.type === "error" ? "✕" : "✓"}</span>
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ── Atoms ────────────────────────────────────────────────── */

const Sparkle = ({ size = 14, style = {}, cls = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={style} className={cls} aria-hidden>
    <path d="M12 0 C13 7 17 11 24 12 C17 13 13 17 12 24 C11 17 7 13 0 12 C7 11 11 7 12 0 Z" fill={C.mint} />
  </svg>
);
// Brand mark — the WHITE Cleano logo, for the app's dark navy surfaces.
const Octo = ({ size = 40 }) => (
  <img src="/white-logo.png" alt="Cleano" width={size} height={size} style={{ objectFit: "contain", flexShrink: 0 }} draggable="false" />
);

// Minimalist line icons (single-path SVG, professional look — no emoji pop).
const ICON_PATHS = {
  home: "M3 10.5 12 3l9 7.5V20a1.5 1.5 0 0 1-1.5 1.5H15V14H9v7.5H4.5A1.5 1.5 0 0 1 3 20Z",
  calendar: "M17 3v3M7 3v3M4.5 5h15A1.5 1.5 0 0 1 21 6.5v13A1.5 1.5 0 0 1 19.5 21h-15A1.5 1.5 0 0 1 3 19.5v-13A1.5 1.5 0 0 1 4.5 5ZM3 10h18",
  sparkle: "M12 3.5 13.9 9 19.5 11 13.9 13 12 18.5 10.1 13 4.5 11 10.1 9Z",
  bell: "M18 8.5a6 6 0 0 0-12 0c0 6.5-2.5 8-2.5 8h17S18 15 18 8.5M13.8 20.5a2.1 2.1 0 0 1-3.6 0",
  clipboard: "M9 4.5h6M9 3a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1Zm7 1.5h1.5A1.5 1.5 0 0 1 19 6v13.5A1.5 1.5 0 0 1 17.5 21h-11A1.5 1.5 0 0 1 5 19.5V6a1.5 1.5 0 0 1 1.5-1.5H8",
  users: "M16.5 20.5v-1.8a3.6 3.6 0 0 0-3.6-3.6H6.1a3.6 3.6 0 0 0-3.6 3.6v1.8M9.3 11.5a3.9 3.9 0 1 0 0-7.8 3.9 3.9 0 0 0 0 7.8ZM21.5 20.5v-1.8a3.6 3.6 0 0 0-2.7-3.5M15.3 3.9a3.9 3.9 0 0 1 0 7.55",
  tag: "M20.3 13.7l-6.9 6.9a1.8 1.8 0 0 1-2.55 0L3 12.75V3.5h9.25l8.05 8.05a1.8 1.8 0 0 1 0 2.15ZM7.5 8h.01",
  briefcase: "M8.5 21V5.2A1.7 1.7 0 0 1 10.2 3.5h3.6a1.7 1.7 0 0 1 1.7 1.7V21M4.5 7.5h15A1.5 1.5 0 0 1 21 9v10.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5V9a1.5 1.5 0 0 1 1.5-1.5Z",
  lifebuoy: "M12 21.5a9.5 9.5 0 1 0 0-19 9.5 9.5 0 0 0 0 19Zm0-5.7a3.8 3.8 0 1 0 0-7.6 3.8 3.8 0 0 0 0 7.6ZM5.3 5.3l4 4m5.4 5.4 4 4m0-13.4-4 4m-5.4 5.4-4 4",
  settings: "M4 21v-6.5M4 10.5V3M12 21v-9M12 8V3M20 21v-4.5M20 12.5V3M1.8 14.5H6.2M9.8 8H14.2M17.8 16.5h4.4",
  grid: "M3.5 3.5h7v7h-7Zm10 0h7v7h-7Zm0 10h7v7h-7Zm-10 0h7v7h-7Z",
  building: "M3 21h18M5.5 21V6.2L12 3l6.5 3.2V21M9.5 9.5h.01M9.5 13h.01M9.5 16.5h.01M14.5 9.5h.01M14.5 13h.01M14.5 16.5h.01",
  user: "M19 20.5v-1.8a3.7 3.7 0 0 0-3.7-3.7H8.7A3.7 3.7 0 0 0 5 18.7v1.8M12 11.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  scroll: "M7 3.5h11.5A1.5 1.5 0 0 1 20 5v12M7 3.5A2.5 2.5 0 0 0 4.5 6v12.5A2 2 0 0 0 6.5 20.5H17a3 3 0 0 0 3-3v-.5M7 3.5V17M9.5 8h6M9.5 11.5h6",
  sofa: "M5 11V7.5A2.5 2.5 0 0 1 7.5 5h9A2.5 2.5 0 0 1 19 7.5V11M3.5 11.5A1.8 1.8 0 0 1 7 12v1h10v-1a1.8 1.8 0 0 1 3.5-.5c.3 1.5-.5 2.7-1.5 3.3V19h-2v-1.5H7V19H5v-4.2c-1-.6-1.8-1.8-1.5-3.3Z",
};
function Ic({ name, size = 19, color = "currentColor", sw = 1.7, style }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, display: "block", ...style }} aria-hidden="true">
      <path d={ICON_PATHS[name] || ICON_PATHS.sparkle} />
    </svg>
  );
}

// A company's own uploaded logo on a white tile; falls back to its emoji.
const CompanyLogo = ({ co, size = 46, radius }) => (
  <div style={{ width: size, height: size, borderRadius: radius ?? Math.round(size * 0.28), background: C.card, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0, fontSize: size * 0.5 }}>
    {co?.logo_url ? <img src={co.logo_url} alt={co?.name || ""} style={{ width: "100%", height: "100%", objectFit: "cover" }} draggable="false" /> : (co?.emoji || "🏢")}
  </div>
);
const Star = ({ filled = true, size = 12, onClick }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" onClick={onClick} style={onClick ? { cursor: "pointer" } : {}} aria-hidden>
    <path d="M12 2 L15 9 L22 9.5 L16.5 14.5 L18.5 22 L12 17.8 L5.5 22 L7.5 14.5 L2 9.5 L9 9 Z" fill={filled ? C.gold : C.line} />
  </svg>
);
const Pill = ({ children, bg = C.mintSoft, color = C.navy, style = {} }) => (
  <span style={{ background: bg, color, fontSize: 10.5, fontWeight: 700, padding: "4px 10px", borderRadius: 99, fontFamily: B, whiteSpace: "nowrap", ...style }}>{children}</span>
);
const Btn = ({ children, onClick, full, ghost, mint, small, disabled, danger, style = {} }) => (
  <button onClick={onClick} disabled={disabled} className="cl-btn" style={{
    fontFamily: F, fontWeight: 700, fontSize: small ? 13 : 15.5,
    padding: small ? "9px 16px" : "15px 22px", borderRadius: 16,
    border: ghost ? `1.5px solid ${C.line}` : "none",
    background: disabled ? "#C9CFE6" : ghost ? C.card : mint ? C.mint : danger ? C.coral : `linear-gradient(135deg,${C.navy},${C.navyMid})`,
    color: ghost ? (danger ? C.coral : C.navy) : mint ? C.navyDeep : "#fff",
    width: full ? "100%" : "auto", cursor: disabled ? "default" : "pointer",
    boxShadow: disabled || ghost ? "none" : mint ? "0 6px 18px rgba(94,230,168,.4)" : danger ? "0 6px 18px rgba(255,122,107,.35)" : "0 6px 18px rgba(27,42,107,.28)",
    ...style,
  }}>{children}</button>
);
const Avatar = ({ name = "?", color = C.navySoft, size = 36 }) => (
  <div style={{ width: size, height: size, borderRadius: "50%", background: color + "22", color, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F, fontWeight: 700, fontSize: size * .36, flexShrink: 0 }}>
    {name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
  </div>
);
const Field = ({ label, hint, area, ...props }) => {
  const [showPw, setShowPw] = useState(false);
  const isPw = props.type === "password";
  return (
    <div style={{ marginBottom: 13 }}>
      {label && <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink, marginBottom: 7 }}>{label}</div>}
      {area
        ? <textarea {...props} rows={props.rows || 3} style={{ width: "100%", boxSizing: "border-box", padding: "13px 15px", borderRadius: 15, border: `1.5px solid ${C.line}`, fontFamily: B, fontSize: 13.5, outline: "none", background: C.card, color: C.ink, resize: "none" }} />
        : (
          <div style={{ position: "relative" }}>
            <input {...props} type={isPw && showPw ? "text" : props.type}
              style={{ width: "100%", boxSizing: "border-box", padding: "13px 15px", paddingRight: isPw ? 46 : 15, borderRadius: 15, border: `1.5px solid ${C.line}`, fontFamily: B, fontSize: 14, outline: "none", background: C.card, color: C.ink }} />
            {isPw && (
              <button type="button" tabIndex={-1} onClick={() => setShowPw((v) => !v)} aria-label={showPw ? "Hide password" : "Show password"}
                style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 17, opacity: .7, padding: 6 }}>
                {showPw ? "🙈" : "👁️"}
              </button>
            )}
          </div>
        )}
      {hint && <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft, marginTop: 6, lineHeight: 1.5 }}>{hint}</div>}
    </div>
  );
};
const StatusPill = ({ status, fulfilment }) => {
  const ended = status === 8 || status === 9; // 8 declined · 9 cancelled
  return (
    <Pill
      bg={ended ? C.coralSoft : status >= 4 ? C.mintSoft : status === 0 ? C.amberSoft : C.navyChip}
      color={ended ? C.coral : status >= 4 ? C.green : status === 0 ? C.amber : C.navySoft}
    >{status === 9 ? L("Cancelled", "Lemondva") : status === 8 ? L("Declined", "Elutasítva") : STAGE(status, fulfilment)}</Pill>
  );
};
function Sheet({ title, close, children }) {
  React.useEffect(() => {
    document.body.classList.add("cl-modal-open");
    return () => document.body.classList.remove("cl-modal-open");
  }, []);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div onClick={close} style={{ position: "absolute", inset: 0, background: "rgba(16,25,74,.55)", backdropFilter: "blur(3px)" }} />
      <div className="cl-slideup" style={{ position: "relative", background: C.bg, borderRadius: "28px 28px 0 0", padding: "16px 22px calc(28px + env(safe-area-inset-bottom))", maxWidth: 430, width: "100%", margin: "0 auto", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ width: 40, height: 4, borderRadius: 99, background: C.line, margin: "0 auto 14px" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 17, color: C.ink }}>{title}</div>
          <button onClick={close} style={{ width: 32, height: 32, borderRadius: 11, border: "none", background: C.card, fontSize: 14, cursor: "pointer", color: C.inkSoft }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
const Progress = ({ done, total }) => (
  <div style={{ height: 5, borderRadius: 9, background: C.line, overflow: "hidden" }}>
    <div style={{ height: "100%", borderRadius: 9, width: `${total ? (done / total) * 100 : 0}%`, background: C.mint, transition: "width .3s" }} />
  </div>
);
/* Dark navy live map: the cleaner shows as the Cleano octopus, the destination
   as a mint pin, and the real driving route between them is drawn as a path so
   the cleaner can follow it too. */
/* ── 4.6 Company service area: drag the pin, drag the slider. The circle is
   what actually filters bookings; the free-text area name stays as copy. ── */
function AreaMap({ lat, lng, radiusKm, onChange, height = 240 }) {
  const ref = React.useRef(null), mapRef = React.useRef(null);
  const mkRef = React.useRef(null), cirRef = React.useRef(null);
  React.useEffect(() => {
    if (!window.L || !ref.current || mapRef.current) return;
    const L = window.L;
    const start = [Number(lat) || 47.5316, Number(lng) || 21.6273];
    const map = L.map(ref.current, { attributionControl: false }).setView(start, 12);
    mapRef.current = map;
    L.tileLayer(MAP_TILES(), { maxZoom: 19, subdomains: "abcd" }).addTo(map);
    const icon = L.divIcon({ className: "", iconSize: [26, 26], iconAnchor: [13, 13],
      html: `<div style="width:26px;height:26px;border-radius:50%;background:${C.navy};border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35)"></div>` });
    mkRef.current = L.marker(start, { icon, draggable: true }).addTo(map);
    cirRef.current = L.circle(start, { radius: (radiusKm || 10) * 1000, color: C.navy, weight: 2, fillColor: C.navy, fillOpacity: 0.12 }).addTo(map);
    const move = (ll) => { cirRef.current.setLatLng(ll); onChange({ lat: ll.lat, lng: ll.lng }); };
    mkRef.current.on("drag", (e) => move(e.target.getLatLng()));
    map.on("click", (e) => { mkRef.current.setLatLng(e.latlng); move(e.latlng); });
    setTimeout(() => map.invalidateSize(), 150);
    return () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, []);
  React.useEffect(() => { if (cirRef.current) cirRef.current.setRadius((radiusKm || 10) * 1000); }, [radiusKm]);
  if (!window.L) return <div style={{ fontFamily: B, fontSize: 12, color: C.inkSoft, textAlign: "center", padding: 20 }}>{L("Map unavailable offline.", "A térkép offline nem érhető el.")}</div>;
  return <div ref={ref} style={{ height, borderRadius: 16, overflow: "hidden", border: `1px solid ${C.line}` }} />;
}

function LiveMap({ lat, lng, destLat, destLng, height = 320 }) {
  const ref = React.useRef(null);
  const mapRef = React.useRef(null);
  const meRef = React.useRef(null);
  const destRef = React.useRef(null);
  const lineRef = React.useRef(null);
  const routedFor = React.useRef("");

  React.useEffect(() => {
    if (!window.L || !ref.current) return;
    const L = window.L;
    if (!mapRef.current) {
      mapRef.current = L.map(ref.current, { zoomControl: false, attributionControl: false })
        .setView([lat || 47.53, lng || 21.63], 14);
      // dark basemap — matches the app's navy palette
      L.tileLayer(MAP_TILES(), { maxZoom: 20, subdomains: "abcd" })
        .addTo(mapRef.current);
      L.control.zoom({ position: "bottomright" }).addTo(mapRef.current);
    }
    const map = mapRef.current;

    // cleaner = Cleano octopus in a glowing navy disc
    if (lat && lng) {
      const html = `<div style="width:46px;height:46px;border-radius:50%;background:${C.navy};border:2.5px solid ${C.mint};box-shadow:0 0 0 6px rgba(94,230,168,.22),0 6px 18px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;overflow:hidden"><img src="/white-logo.png" style="width:32px;height:32px;object-fit:contain" alt=""/></div>`;
      const icon = L.divIcon({ html, className: "", iconSize: [46, 46], iconAnchor: [23, 23] });
      if (!meRef.current) meRef.current = L.marker([lat, lng], { icon }).addTo(map);
      else { meRef.current.setLatLng([lat, lng]); meRef.current.setIcon(icon); }
    }

    // destination = mint pin
    if (destLat && destLng) {
      const dhtml = `<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${C.mint};border:2px solid #fff;box-shadow:0 4px 12px rgba(0,0,0,.45)"></div>`;
      const dicon = L.divIcon({ html: dhtml, className: "", iconSize: [22, 22], iconAnchor: [11, 22] });
      if (!destRef.current) destRef.current = L.marker([destLat, destLng], { icon: dicon }).addTo(map);
      else { destRef.current.setLatLng([destLat, destLng]); destRef.current.setIcon(dicon); }
    }

    // route path (real roads via OSRM; falls back to a straight line)
    if (lat && lng && destLat && destLng) {
      const key = [lat.toFixed(4), lng.toFixed(4), destLat.toFixed(4), destLng.toFixed(4)].join();
      if (routedFor.current !== key) {
        routedFor.current = key;
        const draw = (pts) => {
          if (lineRef.current) { map.removeLayer(lineRef.current); lineRef.current = null; }
          lineRef.current = L.polyline(pts, { color: C.mint, weight: 4, opacity: .9, lineJoin: "round" }).addTo(map);
          try { map.fitBounds(lineRef.current.getBounds(), { padding: [40, 40], maxZoom: 16 }); } catch {}
        };
        fetch(`https://router.project-osrm.org/route/v1/driving/${lng},${lat};${destLng},${destLat}?overview=full&geometries=geojson`)
          .then((r) => r.json())
          .then((d) => {
            const c = d?.routes?.[0]?.geometry?.coordinates;
            draw(c && c.length ? c.map(([x, y]) => [y, x]) : [[lat, lng], [destLat, destLng]]);
          })
          .catch(() => draw([[lat, lng], [destLat, destLng]]));
      }
    } else if (lat && lng) {
      map.setView([lat, lng], map.getZoom());
    }
  }, [lat, lng, destLat, destLng]);

  React.useEffect(() => () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } }, []);
  if (!window.L) return <div style={{ fontFamily: B, fontSize: 12, color: C.inkSoft, textAlign: "center", padding: 20 }}>{L("Map unavailable offline.", "A térkép offline nem érhető el.")}</div>;
  return <div ref={ref} style={{ width: "100%", height, borderRadius: 18, overflow: "hidden", zIndex: 0, background: C.navyDeep }} />;
}

/* Turn a written address into coordinates (cached per address). */
const geoCache = {};
async function geocodeAddress(addr) {
  if (!addr) return null;
  if (geoCache[addr] !== undefined) return geoCache[addr];
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(addr)}`);
    const d = await r.json();
    const hit = d && d[0] ? { lat: Number(d[0].lat), lng: Number(d[0].lon) } : null;
    geoCache[addr] = hit;
    return hit;
  } catch { geoCache[addr] = null; return null; }
}

function TrackSheet({ bookingId, close, booking }) {
  const { fetchLocation, session } = useStore();
  const [loc, setLoc] = React.useState(null);
  const [dest, setDest] = React.useState(null);
  React.useEffect(() => {
    let alive = true;
    const load = () => fetchLocation(bookingId).then((d) => { if (alive) setLoc(d); });
    load();
    const t = setInterval(load, 15000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  // geocode the destination so we can draw the route to it
  React.useEffect(() => {
    const addr = loc?.address || booking?.address;
    if (!addr) return;
    let alive = true;
    geocodeAddress(addr).then((p) => { if (alive && p) setDest(p); });
    return () => { alive = false; };
  }, [loc?.address, booking?.address]);

  const ago = (at) => { if (!at) return ""; const s = Math.round((Date.now() - new Date(at).getTime()) / 1000); return s < 60 ? L("just now", "épp most") : Math.round(s / 60) + " min"; };
  const addr = loc?.address || booking?.address || "";
  const isCleaner = session?.role === "employee";
  return (
    <Sheet title={isCleaner ? L("Route to the job", "Útvonal a munkához") : L("Track your cleaner", "Takarító követése")} close={close}>
      {loc && loc.lat ? (
        <>
          <LiveMap lat={loc.lat} lng={loc.lng} destLat={dest?.lat} destLng={dest?.lng} />
          <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 10, fontFamily: B, fontSize: 11.5, color: C.inkSoft }}>
            <span><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: C.navy, border: `2px solid ${C.mint}`, marginRight: 5 }} />{L("Cleaner", "Takarító")}</span>
            <span><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: C.mint, marginRight: 5 }} />{L("Destination", "Cél")}</span>
            <span>{L("Updated", "Frissítve")} {ago(loc.at)}</span>
          </div>
        </>
      ) : (
        <div style={{ fontFamily: B, fontSize: 13, color: C.inkSoft, textAlign: "center", padding: 30, lineHeight: 1.6 }}>
          {L("Waiting for them to start sharing their location. This appears once they are on the road.", "Várakozás a pozíció megosztására. Akkor jelenik meg, amint úton vannak.")}
        </div>
      )}

      {/* who + where — the cleaner needs this on the way, the customer likes seeing it */}
      {(addr || booking) && (
        <div style={{ background: C.card, borderRadius: 16, padding: 14, marginTop: 12 }}>
          {booking?.customer_name && isCleaner && (
            <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13.5, color: C.ink, marginBottom: 4 }}>{booking.customer_name}</div>
          )}
          {booking?.service_snapshot?.name && (
            <div style={{ fontFamily: B, fontSize: 12, color: C.inkSoft }}>{booking.service_snapshot.name}{booking.scheduled_slot ? ` · ${booking.scheduled_slot}` : ""}</div>
          )}
          {addr && <div style={{ fontFamily: B, fontSize: 12.5, color: C.ink, marginTop: 6, lineHeight: 1.5 }}>{addr}</div>}
          {booking?.note && <div style={{ fontFamily: B, fontSize: 11.5, color: C.inkSoft, marginTop: 6, fontStyle: "italic" }}>“{booking.note}”</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            {addr && (
              <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}`} target="_blank" rel="noreferrer"
                style={{ flex: 1, textAlign: "center", fontFamily: B, fontWeight: 700, fontSize: 12, color: C.navySoft, background: C.bg, borderRadius: 12, padding: "10px 12px", textDecoration: "none" }}>
                {L("Open in Maps", "Megnyitás a Térképen")}
              </a>
            )}
            {isCleaner && booking?.customer_phone && (
              <a href={`tel:${booking.customer_phone}`} style={{ flex: 1, textAlign: "center", fontFamily: B, fontWeight: 700, fontSize: 12, color: C.greenDeep, background: C.mintSoft, borderRadius: 12, padding: "10px 12px", textDecoration: "none" }}>
                {L("Call", "Hívás")}
              </a>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}

/* Automatic live location: starts the moment the cleaner taps "On the way" and
   keeps going through the whole cleaning until "Complete job" — no switch to
   forget. (Runs while the app is open; a resumed app picks it straight back up.) */
function LocationShare({ bookingId }) {
  const { postLocation } = useStore();
  const [on, setOn] = React.useState(false);
  React.useEffect(() => {
    if (!navigator.geolocation) return;
    let last = 0;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setOn(true);
        const now = Date.now();
        if (now - last > 12000) { last = now; postLocation(bookingId, pos.coords.latitude, pos.coords.longitude); }
      },
      () => setOn(false),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
    );
    // belt & braces: also push a fresh fix every 20s even if the phone is still
    const iv = setInterval(() => {
      navigator.geolocation.getCurrentPosition(
        (pos) => { setOn(true); postLocation(bookingId, pos.coords.latitude, pos.coords.longitude); },
        () => {}, { enableHighAccuracy: true, maximumAge: 15000, timeout: 15000 }
      );
    }, 20000);
    return () => { navigator.geolocation.clearWatch(id); clearInterval(iv); };
  }, [bookingId]);
  return <div style={{ fontFamily: B, fontSize: 11, fontWeight: 700, color: on ? C.green : C.inkSoft, textAlign: "center", marginTop: 8 }}>{on ? L("Sharing your live location", "Élő helyzet megosztása") : L("Turn on location to share your position", "Kapcsold be a helymeghatározást")}</div>;
}

/* Notifications: no bell. New ones slide in as a top banner, auto-hide,
   and the full history lives in Profile → Notifications. */
function NotificationBanner() {
  const { notifications, unreadNotif, fetchNotifications, markNotificationsRead, isLive } = useStore();
  const [show, setShow] = React.useState(null); // the notification being flashed
  const seenRef = React.useRef(new Set());
  React.useEffect(() => {
    if (!isLive) return;
    fetchNotifications();
    const t = setInterval(fetchNotifications, 30000);
    return () => clearInterval(t);
  }, []);
  // A push that arrives while the app is open shows as our own banner
  // (iOS hides the system banner in the foreground).
  React.useEffect(() => {
    const onPush = (e) => {
      const d = (e && e.detail) || {};
      if (!d.title) return;
      setShow({ id: "push-" + Date.now(), title: d.title, body: d.body });
      setTimeout(() => setShow(null), 6000);
      fetchNotifications();
    };
    window.addEventListener("cleano-push", onPush);
    return () => window.removeEventListener("cleano-push", onPush);
  }, []);
  React.useEffect(() => {
    // A notification banners ONCE, ever — the shown-ids survive relaunches.
    let shown = [];
    try { shown = JSON.parse(localStorage.getItem("cleano_bannered") || "[]"); } catch {}
    const shownSet = new Set(shown);
    const isFreshEnough = (n) => {
      // Older items (arrived while the app was closed → phone already got the
      // push) go straight to the list, no banner.
      try { return Date.now() - new Date(n.created_at).getTime() < 3 * 60 * 1000; } catch { return false; }
    };
    const fresh = (notifications || []).find((n) => !n.is_read && !shownSet.has(n.id) && !seenRef.current.has(n.id) && isFreshEnough(n));
    // remember every current id either way so nothing ever re-banners
    const merged = [...new Set([...shown, ...(notifications || []).map((n) => n.id)])].slice(-300);
    try { localStorage.setItem("cleano_bannered", JSON.stringify(merged)); } catch {}
    if (fresh) {
      seenRef.current.add(fresh.id);
      setShow(fresh);
      const t = setTimeout(() => setShow(null), 6000);
      return () => clearTimeout(t);
    }
  }, [notifications]);
  React.useEffect(() => { if (unreadNotif > 0) { const t = setTimeout(markNotificationsRead, 8000); return () => clearTimeout(t); } }, [unreadNotif]);
  if (!show) return null;
  return ReactDOM.createPortal(
    <div className="cl-rise" onClick={() => setShow(null)}
      style={{ position: "fixed", top: "calc(env(safe-area-inset-top) + 10px)", left: 0, right: 0, margin: "0 auto", width: "min(400px, calc(100vw - 28px))", zIndex: 220, background: C.navBg, backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)", border: `1px solid ${C.line}`, borderRadius: 18, padding: "13px 16px", boxShadow: "0 14px 40px rgba(16,25,74,.28)", cursor: "pointer" }}>
      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13.5, color: C.ink }}>{show.title}</div>
      {show.body && <div style={{ fontFamily: B, fontSize: 12, color: C.inkSoft, marginTop: 3, lineHeight: 1.5 }}>{show.body}</div>}
    </div>,
    document.body
  );
}

function NotificationHistory() {
  const { notifications, isLive, clearNotifications } = useStore();
  const [open, setOpen] = useState(false);
  if (!isLive) return null;
  const list = notifications || [];
  return (
    <div style={{ marginTop: 14 }}>
      <button onClick={() => setOpen(!open)} style={{ background: "none", border: `1.5px dashed ${C.line}`, borderRadius: 15, width: "100%", padding: "11px 14px", fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.navySoft, cursor: "pointer", textAlign: "left", display: "flex", justifyContent: "space-between" }}>
        <span>{L("Notifications", "Értesítések")} ({list.length})</span><span>{open ? "▴" : "▾"}</span>
      </button>
      {open && list.length > 0 && (
        <button onClick={clearNotifications} style={{ background: "none", border: "none", padding: "8px 2px 0", fontFamily: B, fontWeight: 700, fontSize: 11.5, color: C.coral, cursor: "pointer" }}>{L("Clear all", "Összes törlése")}</button>
      )}
      {open && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 7, maxHeight: 260, overflowY: "auto" }}>
          {list.length === 0 && <div style={{ fontFamily: B, fontSize: 12, color: C.inkFaint, textAlign: "center", padding: 14 }}>{L("Nothing yet.", "Még semmi.")}</div>}
          {list.map((n) => (
            <div key={n.id} style={{ background: C.bg, borderRadius: 13, padding: "10px 13px" }}>
              <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink }}>{n.title}</div>
              {n.body && <div style={{ fontFamily: B, fontSize: 11.5, color: C.inkSoft, marginTop: 2, lineHeight: 1.5 }}>{n.body}</div>}
              <div style={{ fontFamily: B, fontSize: 10, color: C.inkFaint, marginTop: 4 }}>{(() => { try { return new Date(n.created_at).toLocaleString(); } catch { return ""; } })()}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ConfirmDialog({ title, body, confirmLabel, onConfirm, onCancel }) {
  React.useEffect(() => {
    document.body.classList.add("cl-modal-open");
    return () => document.body.classList.remove("cl-modal-open");
  }, []);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 24px" }}>
      <div onClick={onCancel} style={{ position: "absolute", inset: 0, background: "rgba(16,25,74,.6)", backdropFilter: "blur(3px)" }} />
      <div className="cl-pop" style={{ position: "relative", background: C.card, borderRadius: 24, padding: "28px 24px", width: "100%", maxWidth: 340, boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
        <div style={{ fontFamily: F, fontWeight: 700, fontSize: 18, color: C.ink }}>{title}</div>
        <div style={{ fontFamily: B, fontSize: 13, color: C.inkSoft, marginTop: 10, lineHeight: 1.6 }}>{body}</div>
        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          <Btn ghost full onClick={onCancel}>{L("Go back", "Vissza")}</Btn>
          <Btn full danger onClick={onConfirm}>{confirmLabel || L("Confirm", "Megerősítés")}</Btn>
        </div>
      </div>
    </div>
  );
}

/* ── Structured address picker: current location / saved / recent / structured new — no freeform typing ── */
/* Extract a known city from an address string (auto-city: no manual toggle). */
function cityFromAddress(addr) {
  if (!addr) return null;
  const low = String(addr).toLowerCase();
  const known = ALL_CITIES.find((c) => low.includes(c.toLowerCase()));
  if (known) return known;
  // any address: take the token after the postcode, else the last comma-part
  const m = String(addr).match(/\b\d{4,5}\s+([A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű' -]{2,40})/);
  if (m) return m[1].trim();
  const parts = String(addr).split(",").map((x) => x.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 2] || parts[parts.length - 1] : null;
}

/* Street autocomplete via Photon (OpenStreetMap, free, typo-tolerant). */
async function suggestStreets(q, city) {
  try {
    const query = city ? `${q}, ${city}` : q;
    const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=6&lang=${getLang() === "hu" ? "hu" : "en"}`, { signal: AbortSignal.timeout(5000) });
    const j = await r.json();
    const seen = new Set();
    return (j.features || [])
      .filter((f) => f.properties?.countrycode === "HU" && (f.properties.street || f.properties.name))
      .map((f) => {
        const pr = f.properties;
        const street = pr.street || pr.name;
        const cty = pr.city || pr.county || "";
        return { street, city: cty, key: `${street}|${cty}` };
      })
      .filter((x) => (seen.has(x.key) ? false : seen.add(x.key)));
  } catch { return []; }
}

function ChangePasswordBox() {
  const { changePassword, isLive } = useStore();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState("");
  const [nw, setNw] = useState("");
  const [busy, setBusy] = useState(false);
  if (!isLive) return null;
  return (
    <div style={{ marginTop: 14 }}>
      {!open ? (
        <button onClick={() => setOpen(true)} style={{ background: "none", border: `1.5px dashed ${C.line}`, borderRadius: 15, width: "100%", padding: "11px 14px", fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.navySoft, cursor: "pointer" }}>
          {L("Change password", "Jelszó módosítása")}
        </button>
      ) : (
        <div style={{ background: C.bg, borderRadius: 15, padding: 14 }}>
          <Field label={L("Current password", "Jelenlegi jelszó")} type="password" value={cur} onChange={(e) => setCur(e.target.value)} />
          <Field label={L("New password", "Új jelszó")} type="password" placeholder={L("Min. 6 characters", "Min. 6 karakter")} value={nw} onChange={(e) => setNw(e.target.value)} />
          <div style={{ display: "flex", gap: 8 }}>
            <Btn small ghost onClick={() => { setOpen(false); setCur(""); setNw(""); }}>{L("Cancel", "Mégse")}</Btn>
            <Btn small full disabled={busy || nw.length < 6 || !cur} onClick={async () => {
              setBusy(true);
              const r = await changePassword(cur, nw);
              setBusy(false);
              if (r?.error) toast(r.error, "error");
              else { toast(L("Password changed", "Jelszó módosítva")); setOpen(false); setCur(""); setNw(""); }
            }}>{L("Save", "Mentés")}</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

function AddressPicker({ value, onChange }) {
  const { session: rawSession, bookings, updateProfile } = useStore();
  const session = rawSession || {};
  const toast = useToast();
  const [locBusy, setLocBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [street, setStreet] = useState("");
  const [streetPicked, setStreetPicked] = useState(null); // {street, city} chosen from suggestions
  const [sugs, setSugs] = useState([]);
  const [houseNo, setHouseNo] = useState("");
  const [floor, setFloor] = useState("");
  const [extra, setExtra] = useState("");
  const [saveAs, setSaveAs] = useState("");
  const debounceRef = React.useRef(null);
  const saved = session.savedAddresses || [];

  // live street suggestions — the street cannot be typed wrong
  const onStreetInput = (v) => {
    setStreet(v); setStreetPicked(null);
    clearTimeout(debounceRef.current);
    if (v.trim().length < 2) { setSugs([]); return; }
    debounceRef.current = setTimeout(async () => setSugs(await suggestStreets(v.trim(), getCity())), 350);
  };

  const applyCityFrom = (addr) => { const c = cityFromAddress(addr); if (c) saveCity(c); };

  const recent = useMemo(() => {
    const seen = new Set([session.address, ...saved.map((a) => a.address)].filter(Boolean).map((a) => a.trim()));
    const out = [];
    for (const b of bookings) {
      if ((b.customer_id === session.userId || b.customer_name === session.name) && b.address) {
        const a = String(b.address).trim();
        if (!seen.has(a)) { seen.add(a); out.push(a); }
        if (out.length >= 2) break;
      }
    }
    return out;
  }, [bookings, session, saved]);

  const useCurrentLocation = () => {
    if (!navigator.geolocation) { toast(L("Location is not available on this device", "A helymeghatározás nem elérhető ezen az eszközön"), "error"); return; }
    setLocBusy(true);
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        const { latitude, longitude } = pos.coords;
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&accept-language=${getLang()}`);
        const j = await r.json();
        const a = j.address || {};
        const road = a.road || a.pedestrian || a.square || "";
        const num = a.house_number ? ` ${a.house_number}` : "";
        const city = a.city || a.town || a.village || getCity();
        const label = road ? `${road}${num}, ${city}` : (j.display_name || "").split(",").slice(0, 3).join(",");
        if (!label) throw new Error("empty");
        applyCityFrom(label);
        // Prefill the editable fields so the customer can correct the street and
        // add house number, bell, floor — GPS rarely knows those.
        setStreet(road || label.split(",")[0] || "");
        setStreetPicked(road ? { street: road, city } : null);
        setHouseNo(a.house_number ? String(a.house_number) : "");
        setAdding(true);
        toast(L("Location found — add your house and bell number", "Helyzet megvan — add meg a házszámot és a csengőt"));
      } catch {
        toast(L("Couldn't read your location — add the address instead", "Nem sikerült beolvasni a helyzeted — add meg a címet"), "error");
      } finally { setLocBusy(false); }
    }, () => { setLocBusy(false); toast(L("Location permission denied — pick another option", "Helymeghatározás letiltva — válassz másik lehetőséget"), "error"); }, { enableHighAccuracy: true, timeout: 10000 });
  };

  // if permission is already granted, prefill silently the first time
  React.useEffect(() => {
    if (value || session.address || saved.length) return;
    try {
      navigator.permissions?.query({ name: "geolocation" }).then((st) => { if (st.state === "granted") useCurrentLocation(); });
    } catch {}
  }, []);
  const canSave = !!rawSession; // save-as needs a logged-in profile

  const labelIcon = (lbl) => (/home|otthon/i.test(lbl) ? "🏠" : /office|iroda|work|munka/i.test(lbl) ? "💼" : "📍");

  const removeSaved = async (addr) => {
    const next = saved.filter((a) => a.address !== addr.address);
    await updateProfile({ saved_addresses: next });
    toast(L("Address removed", "Cím törölve"));
  };

  const Opt = ({ icon, label, sub, selected, onPress, busy, onRemove }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
      <button onClick={onPress} disabled={busy} style={{ flex: 1, textAlign: "left", display: "flex", alignItems: "center", gap: 12, padding: "13px 14px", borderRadius: 15, border: selected ? `2px solid ${C.navy}` : `2px solid transparent`, background: C.card, cursor: "pointer", boxShadow: "0 1px 6px rgba(20,28,58,.05)", opacity: busy ? .6 : 1, minWidth: 0 }}>
        <span style={{ fontSize: 19 }}>{icon}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontFamily: F, fontWeight: 700, fontSize: 13.5, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
          {sub && <span style={{ display: "block", fontFamily: B, fontSize: 11, color: C.inkSoft, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</span>}
        </span>
        {selected && <span style={{ color: C.green, fontWeight: 900 }}>✓</span>}
      </button>
      {onRemove && (
        <button onClick={onRemove} title={L("Remove", "Törlés")} style={{ border: "none", background: C.bg, color: C.inkFaint, width: 28, height: 28, borderRadius: 10, cursor: "pointer", fontSize: 12, flexShrink: 0 }}>✕</button>
      )}
    </div>
  );

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink, marginBottom: 8 }}>{L("Address", "Cím")}</div>
      <Opt icon={locBusy ? "⏳" : "📍"} busy={locBusy}
        label={locBusy ? L("Locating…", "Helymeghatározás…") : L("Use my current location", "Jelenlegi helyzetem használata")}
        sub={L("GPS fills the exact address for you", "A GPS kitölti a pontos címet")}
        selected={false} onPress={useCurrentLocation} />
      {saved.map((a) => (
        <Opt key={a.address} icon={labelIcon(a.label)} label={a.label} sub={a.address}
          selected={value === a.address} onPress={() => { onChange(a.address); applyCityFrom(a.address); setAdding(false); }}
          onRemove={() => removeSaved(a)} />
      ))}
      {session.address && !saved.some((a) => a.address === session.address) && (
        <Opt icon="🏠" label={L("Home address", "Lakcím")} sub={session.address}
          selected={value === session.address} onPress={() => { onChange(session.address); applyCityFrom(session.address); setAdding(false); }} />
      )}
      {recent.map((a) => (
        <Opt key={a} icon="🕘" label={a} sub={L("Recently used", "Korábban használt")}
          selected={value === a} onPress={() => { onChange(a); applyCityFrom(a); setAdding(false); }} />
      ))}
      {value && value !== session.address && !saved.some((a) => a.address === value) && !recent.includes(value) && (
        <Opt icon="📌" label={value} sub={L("Selected address", "Kiválasztott cím")} selected onPress={() => {}} />
      )}
      {!adding ? (
        <button onClick={() => setAdding(true)} style={{ background: "none", border: `1.5px dashed ${C.line}`, borderRadius: 15, width: "100%", padding: "12px 14px", fontFamily: F, fontWeight: 700, fontSize: 13, color: C.navySoft, cursor: "pointer" }}>
          + {L("Add a new address", "Új cím megadása")}
        </button>
      ) : (
        <div style={{ background: C.card, borderRadius: 15, padding: 14, boxShadow: "0 1px 6px rgba(20,28,58,.05)" }}>
          <div style={{ position: "relative" }}>
            <Field label={L("Street", "Utca")} placeholder={L("Start typing — e.g. Bolyai", "Kezdj el gépelni — pl. Bolyai")}
              value={streetPicked ? `${streetPicked.street}` : street} onChange={(e) => onStreetInput(e.target.value)} />
            {streetPicked && (
              <span style={{ position: "absolute", right: 10, top: 38, fontFamily: B, fontSize: 10.5, fontWeight: 700, color: C.green, background: C.mintSoft, borderRadius: 99, padding: "3px 9px" }}>
                ✓ {streetPicked.city || getCity()}
              </span>
            )}
            {!streetPicked && sugs.length > 0 && (
              <div style={{ position: "absolute", zIndex: 30, left: 0, right: 0, top: 74, background: C.card, borderRadius: 13, boxShadow: "0 10px 30px rgba(20,28,58,.18)", border: `1.5px solid ${C.line}`, overflow: "hidden" }}>
                {sugs.map((sg) => (
                  <button key={sg.key} onClick={() => { setStreetPicked(sg); setSugs([]); if (sg.city) saveCity(cityFromAddress(sg.city) || sg.city); }}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "11px 14px", border: "none", borderBottom: `1px solid ${C.line}`, background: "transparent", cursor: "pointer", fontFamily: B, fontSize: 13, color: C.ink }}>
                    {sg.street} <span style={{ color: C.inkSoft, fontSize: 11.5 }}>— {sg.city || "?"}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}><Field label={L("House no.", "Házszám")} placeholder="26" value={houseNo} onChange={(e) => setHouseNo(e.target.value)} /></div>
            <div style={{ flex: 1.4 }}><Field label={L("Floor / door (optional)", "Emelet / ajtó (opcionális)")} placeholder="3/12" value={floor} onChange={(e) => setFloor(e.target.value)} /></div>
          </div>
          <Field label={L("Bell / entrance / other details (optional)", "Csengő / bejárat / egyéb (opcionális)")}
            placeholder={L("e.g. bell 12, second entrance, gate code 1234", "pl. 12-es csengő, második bejárat, kapukód 1234")}
            value={extra} onChange={(e) => setExtra(e.target.value)} />
          {canSave && <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12, color: C.ink, margin: "2px 0 7px" }}>{L("Save this address as (optional)", "Cím mentése mint (opcionális)")}</div>}
          {canSave && <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            {[L("Home", "Otthon"), L("Office", "Iroda")].map((lbl) => (
              <button key={lbl} onClick={() => setSaveAs(saveAs === lbl ? "" : lbl)}
                style={{ border: saveAs === lbl ? `2px solid ${C.navy}` : `1.5px solid ${C.line}`, background: C.card, color: C.ink, borderRadius: 99, padding: "7px 14px", fontFamily: F, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                {labelIcon(lbl)} {lbl}
              </button>
            ))}
            <input value={/^(Home|Otthon|Office|Iroda)$/.test(saveAs) ? "" : saveAs} onChange={(e) => setSaveAs(e.target.value)} placeholder={L("Custom…", "Egyéni…")}
              style={{ flex: 1, minWidth: 90, border: `1.5px solid ${C.line}`, borderRadius: 99, padding: "7px 13px", fontFamily: B, fontSize: 12, background: C.card, color: C.ink, outline: "none" }} />
          </div>}
          <Btn small full disabled={!(streetPicked || street.trim().length >= 3) || !houseNo.trim()} onClick={async () => {
            const st = streetPicked ? streetPicked.street : street.trim();
            const cty = (streetPicked && (cityFromAddress(streetPicked.city) || streetPicked.city)) || getCity();
            const full = `${st} ${houseNo.trim()}${floor.trim() ? ", " + floor.trim() : ""}, ${cty}${extra.trim() ? " (" + extra.trim() + ")" : ""}`;
            onChange(full); applyCityFrom(full);
            if (canSave && saveAs.trim()) {
              const next = [...saved.filter((a) => a.label !== saveAs.trim()), { label: saveAs.trim(), address: full }].slice(0, 6);
              await updateProfile({ saved_addresses: next });
              toast(L("Address saved to your profile", "Cím elmentve a profilodba"));
            }
            setAdding(false); setStreet(""); setStreetPicked(null); setHouseNo(""); setFloor(""); setSaveAs(""); setSugs([]);
          }}>{L("Use this address", "Ezt a címet használom")}</Btn>
        </div>
      )}
    </div>
  );
}

/* ── Phone verification gate: blocks customers/cleaners until the code
      they receive on WhatsApp/SMS is entered. Appears ONLY when the
      Twilio keys are configured on the server. ── */
function PhoneVerifyGate() {
  const { session, verifyConfig, verifyStart, verifyCheck, emailVerifyStart, emailVerifyCheck, logout, isLive } = useStore();
  const [enabled, setEnabled] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  React.useEffect(() => { if (isLive) verifyConfig().then((c) => { setEnabled(!!c.enabled); setEmailEnabled(!!c.emailEnabled); }); }, [isLive]);
  const needsEmail = emailEnabled && session && ["customer", "employee", "company"].includes(session.role) && !session.emailVerified;
  const needsPhone = enabled && session && ["customer", "employee"].includes(session.role) && session.phone && !session.phoneVerified;
  const mode = needsEmail ? "email" : needsPhone ? "phone" : null;
  if (!mode) return null;
  const send = async (channel) => {
    setBusy(true); setErr("");
    const r = mode === "email" ? await emailVerifyStart() : await verifyStart(channel);
    setBusy(false);
    if (r?.error) setErr(r.error); else setSent(true);
  };
  const check = async () => {
    setBusy(true); setErr("");
    const r = mode === "email" ? await emailVerifyCheck(code) : await verifyCheck(code);
    setBusy(false);
    if (!r?.verified) setErr(r?.error || L("Wrong code — try again", "Hibás kód — próbáld újra"));
    else { setSent(false); setCode(""); }
  };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 95, background: C.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 34px", textAlign: "center" }}>
      <div style={{ fontSize: 52 }}>{mode === "email" ? "✉️" : "📱"}</div>
      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 21, color: C.ink, marginTop: 14 }}>{mode === "email" ? L("Verify your email", "Erősítsd meg az e-mail címed") : L("Verify your number", "Erősítsd meg a számodat")}</div>
      <div style={{ fontFamily: B, fontSize: 13, color: C.inkSoft, marginTop: 8, lineHeight: 1.6, maxWidth: 320 }}>
        {sent
          ? L(`Enter the code we sent to ${mode === "email" ? session.email : session.phone}`, `Írd be a(z) ${mode === "email" ? session.email : session.phone} címre küldött kódot`)
          : L(`We'll send a confirmation code to ${mode === "email" ? session.email : session.phone}`, `Megerősítő kódot küldünk: ${mode === "email" ? session.email : session.phone}`)}
      </div>
      {err && <div style={{ fontFamily: B, fontSize: 12.5, color: C.coralText, marginTop: 12 }}>{err}</div>}
      <div style={{ width: "100%", maxWidth: 300, marginTop: 22, display: "flex", flexDirection: "column", gap: 10 }}>
        {!sent ? (
          mode === "email" ? (
            <Btn full disabled={busy} onClick={() => send()}>{L("Send code to my email", "Kód küldése e-mailben")}</Btn>
          ) : (
          <>
            <Btn full disabled={busy} onClick={() => send("whatsapp")}>{L("Send code via WhatsApp", "Kód küldése WhatsAppon")}</Btn>
            <Btn ghost full disabled={busy} onClick={() => send("sms")}>{L("Send as SMS instead", "Inkább SMS-ben")}</Btn>
          </>
          )
        ) : (
          <>
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 8))} inputMode="numeric" placeholder="• • • • • •"
              style={{ textAlign: "center", letterSpacing: 8, fontSize: 22, fontFamily: F, fontWeight: 700, padding: "14px 10px", borderRadius: 15, border: `1.5px solid ${C.line}`, background: C.card, color: C.ink, outline: "none" }} />
            <Btn full disabled={busy || code.length < 4} onClick={check}>{busy ? "..." : L("Verify", "Megerősítés")}</Btn>
            <Btn ghost full disabled={busy} onClick={() => send(mode === "email" ? undefined : "sms")}>{mode === "email" ? L("Resend code", "Kód újraküldése") : L("Resend as SMS", "Újraküldés SMS-ben")}</Btn>
          </>
        )}
        <button onClick={logout} style={{ background: "none", border: "none", fontFamily: B, fontSize: 12, fontWeight: 700, color: C.inkFaint, cursor: "pointer", marginTop: 6 }}>{L("Log out", "Kijelentkezés")}</button>
      </div>
    </div>
  );
}

/* ── Card payment wait overlay (payment gateway opened in browser) ── */
function PaymentWait({ url, check, onPaid, onCancel }) {
  const [dots, setDots] = useState("");
  React.useEffect(() => {
    let alive = true;
    const poll = setInterval(async () => {
      const status = await check();
      if (alive && status === "paid") { clearInterval(poll); onPaid(); }
    }, 2500);
    const anim = setInterval(() => setDots(d => (d.length >= 3 ? "" : d + ".")), 500);
    return () => { alive = false; clearInterval(poll); clearInterval(anim); };
  }, []);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 90, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 24px" }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(16,25,74,.65)", backdropFilter: "blur(4px)" }} />
      <div className="cl-pop" style={{ position: "relative", background: C.card, borderRadius: 24, padding: "30px 24px", width: "100%", maxWidth: 340, textAlign: "center", boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
        <div style={{ fontSize: 44 }}>💳</div>
        <div style={{ fontFamily: F, fontWeight: 700, fontSize: 17, color: C.ink, marginTop: 10 }}>{L("Waiting for payment", "Várakozás a fizetésre")}{dots}</div>
        <div style={{ fontFamily: B, fontSize: 12.5, color: C.inkSoft, marginTop: 8, lineHeight: 1.6 }}>
          {L("Finish paying in the secure payment window that just opened. This screen updates automatically.", "Fejezd be a fizetést a most megnyílt biztonságos fizetési ablakban. Ez a képernyő automatikusan frissül.")}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 20 }}>
          <Btn full onClick={() => window.open(url, "_blank")}>{L("Reopen payment page", "Fizetési oldal újranyitása")}</Btn>
          <Btn ghost full onClick={onCancel}>{L("Cancel booking", "Foglalás lemondása")}</Btn>
        </div>
      </div>
    </div>
  );
}

/* ── Profile sheet (all roles) ────────────────────────────── */

function ProfileSheet({ close }) {
  const { session, updateProfile, deleteAccount, logout, t, lang, setLang } = useStore();
  const toast = useToast();
  const [f, setF] = useState({ name: session.name || "", phone: session.phone || "", custType: session.custType || "student", address: session.address || "", paymentMethod: session.paymentMethod || "card", documents: session.documents || [] });
  const wantsUpgrade = session.role === "customer" && session.custType !== "student" && f.custType === "student";
  const [upgradeDocs, setUpgradeDocs] = useState([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    if (wantsUpgrade && upgradeDocs.length === 0) { toast(L("Upload your student card photo first", "Előbb töltsd fel a diákigazolvány fotóját"), "error"); return; }
    const res = await updateProfile({ full_name: f.name, phone: f.phone, ...(session.role === "customer" ? { customer_type: f.custType, address: f.address, payment_method: f.paymentMethod, ...(wantsUpgrade ? { documents: upgradeDocs } : {}) } : {}), ...(session.role === "employee" ? { documents: f.documents } : {}) });
    if (!res?.error && wantsUpgrade) { toast(L("Card sent for verification — discount activates once approved 🎓", "Igazolvány beküldve — a kedvezmény jóváhagyás után aktiválódik 🎓")); }
    setBusy(false);
    if (res?.error) toast(res.error, "error");
    else { toast(t("profile.updated")); close(); }
  };

  return (
    <Sheet title={t("profile.title")} close={close}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, background: C.bg, borderRadius: 16, padding: "14px 16px", marginBottom: 20 }}>
        <Avatar name={session.name} size={48} color={C.navySoft} />
        <div>
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 15, color: C.ink }}>{session.name}</div>
          <div style={{ fontFamily: B, fontSize: 11.5, color: C.inkSoft, marginTop: 2 }}>
            {session.role === "customer" ? (session.custType === "student" ? "🎓 Student" : "🏡 Resident") : session.role === "employee" ? "🧽 Cleaner" : session.role === "admin" ? "🛡️ Platform admin" : "🏢 Company admin"}
          </div>
        </div>
      </div>

      <Field label={t("profile.fullName")} placeholder={L("Your name", "A neved")} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />

      {session.role === "customer" && (
        <div style={{ marginBottom: 13 }}>
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink, marginBottom: 8 }}>{t("profile.accountType")}</div>
          <div style={{ display: "flex", gap: 10 }}>
            {[{ id: "student", label: "🎓 Student", sub: "Save up to 20%" }, { id: "resident", label: "🏡 Resident", sub: "Standard pricing" }].map((o) => (
              <button key={o.id} onClick={() => setF({ ...f, custType: o.id })} style={{
                flex: 1, textAlign: "left", padding: "12px 14px", borderRadius: 14, cursor: "pointer",
                border: f.custType === o.id ? `2px solid ${C.navy}` : "2px solid transparent",
                background: f.custType === o.id ? C.card : C.bg, boxShadow: f.custType === o.id ? "0 2px 10px rgba(27,42,107,.12)" : "none",
              }}>
                <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13, color: C.ink }}>{o.label}</div>
                <div style={{ fontFamily: B, fontSize: 10.5, color: C.inkSoft, marginTop: 2 }}>{o.sub}</div>
              </button>
            ))}
          </div>
          {wantsUpgrade && (
            <div style={{ marginTop: 10, background: C.amberSoft, borderRadius: 14, padding: "12px 14px" }}>
              <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12, color: C.ink, marginBottom: 6 }}>{L("Student card photo required", "Diákigazolvány fotó szükséges")}</div>
              <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft, marginBottom: 8, lineHeight: 1.5 }}>{L("Our team verifies it — the discount activates after approval.", "Csapatunk ellenőrzi — a kedvezmény jóváhagyás után aktiválódik.")}</div>
              <DocUpload docs={upgradeDocs} onChange={setUpgradeDocs} label={L("Student card", "Diákigazolvány")} />
            </div>
          )}
        </div>
      )}

      {session.role === "customer" && (
        <>
          <div style={{ marginBottom: 4 }}>
            <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink, marginBottom: 7 }}>{t("profile.homeAddress")}</div>
            <AddressPicker value={f.address} onChange={(v) => setF({ ...f, address: v })} />
          </div>
          <PhoneField label={t("profile.phone")} value={f.phone} onChange={(v) => setF({ ...f, phone: v })} />
          <div style={{ marginBottom: 13 }}>
            <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink, marginBottom: 8 }}>{t("profile.paymentMethod")}</div>
            <div style={{ display: "flex", gap: 10 }}>
              {(isLive ? [{ id: "card", label: t("profile.card"), sub: t("profile.cardSub") }] : [{ id: "cash", label: t("profile.cash"), sub: t("profile.cashSub") }, { id: "card", label: t("profile.card"), sub: t("profile.cardSub") }]).map((o) => (
                <button key={o.id} onClick={() => setF({ ...f, paymentMethod: o.id })} style={{ flex: 1, textAlign: "left", padding: "12px 14px", borderRadius: 14, cursor: "pointer", border: f.paymentMethod === o.id ? `2px solid ${C.navy}` : "2px solid transparent", background: f.paymentMethod === o.id ? C.card : C.bg, boxShadow: f.paymentMethod === o.id ? "0 2px 10px rgba(27,42,107,.12)" : "none" }}>
                  <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13, color: C.ink }}>{o.label}</div>
                  <div style={{ fontFamily: B, fontSize: 10.5, color: C.inkSoft, marginTop: 2 }}>{o.sub}</div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {session.role === "employee" && (
        <>
          <PhoneField label={L("Phone number", "Telefonszám")} value={f.phone} onChange={(v) => setF({ ...f, phone: v })} />
          <DocUpload
            label={L("Identity documents", "Személyazonosító okmányok")}
            hint="ID card or residence card — your company and the platform admin can verify you."
            docs={f.documents}
            onChange={(docs) => setF({ ...f, documents: docs })}
          />
        </>
      )}

      <div style={{ marginBottom: 13 }}>
        <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink, marginBottom: 8 }}>{t("profile.language")}</div>
        <select value={lang} onChange={(e) => setLang(e.target.value)} style={{ width: "100%", boxSizing: "border-box", padding: "12px 14px", borderRadius: 14, border: `1.5px solid ${C.line}`, background: C.bg, fontFamily: F, fontWeight: 700, fontSize: 13, color: C.ink, cursor: "pointer", appearance: "none", WebkitAppearance: "none", outline: "none" }}>
          {LANGS.map((o) => <option key={o.id} value={o.id}>{o.label} · {o.name}</option>)}
        </select>
      </div>

      {!isLive && (
        <div style={{ background: C.mintSoft, borderRadius: 12, padding: "10px 14px", marginBottom: 14, fontFamily: B, fontSize: 11, color: C.greenDeep }}>
          Demo mode — changes persist for this session only.
        </div>
      )}

      <Btn full disabled={busy || !f.name.trim()} onClick={save}>{busy ? t("common.saving") : t("profile.saveProfile")}</Btn>
      <div style={{ marginTop: 10 }}>
        <Btn ghost full onClick={() => { close(); logout(); }}>{t("common.logout")}</Btn>
      </div>

      <NotificationHistory />
      <CalendarSync />
      <ChangePasswordBox />
      <div style={{ display: "flex", justifyContent: "center", gap: 14, marginTop: 14, fontFamily: B, fontSize: 11 }}>
        <a href={(API_BASE || "") + (session.role === "company" ? "/partner-terms" : "/terms")} target="_blank" rel="noreferrer" style={{ color: C.inkFaint }}>{L("Terms", "ÁSZF")}</a>
        <a href={(API_BASE || "") + "/privacy"} target="_blank" rel="noreferrer" style={{ color: C.inkFaint }}>{L("Privacy", "Adatkezelés")}</a>
      </div>
      <div style={{ borderTop: `1.5px dashed ${C.line}`, margin: "20px 0 14px" }} />
      <button onClick={() => setConfirmDelete(true)}
        style={{ background: "none", border: "none", width: "100%", fontFamily: B, fontSize: 12.5, fontWeight: 700, color: C.coral, cursor: "pointer", padding: "6px 0" }}>
        {L("Delete my account", "Fiók törlése")}
      </button>
      <div style={{ fontFamily: B, fontSize: 10.5, color: C.inkFaint, textAlign: "center", marginTop: 2 }}>
        {L("Removes your personal data permanently (GDPR). Bookings history is anonymised.", "Személyes adataid véglegesen törlődnek (GDPR). A foglalási előzmények anonimizálódnak.")}
      </div>
      {confirmDelete && (
        <ConfirmDialog
          title={L("Delete account?", "Törlöd a fiókodat?")}
          body={L("Your personal data is removed immediately and you will be signed out. This cannot be undone.", "Személyes adataid azonnal törlődnek és kijelentkeztetünk. Ez nem vonható vissza.")}
          confirmLabel={L("Delete forever", "Végleges törlés")}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => { const ok = await deleteAccount(); if (ok) close(); }}
        />
      )}
    </Sheet>
  );
}

/* ════════════════════════════════════════════════════════════
   AUTH
════════════════════════════════════════════════════════════ */

function Auth() {
  // wake the free-tier server while the user is still looking at the welcome screen
  React.useEffect(() => { if (isLive) fetch((API_BASE || "") + "/api/health").catch(() => {}); }, []);
  const store = useStore();
  const { t, lang, setLang } = store;
  const [role, setRole] = useState(null);
  const [mode, setMode] = useState("signup");
  const [f, setF] = useState({ name: "", email: "", password: "", code: "", companyName: "", taxId: "", regNumber: "", contactPhone: "", custType: "student", address: "", city: "", phone: "", documents: [], terms: false });
  React.useEffect(() => { getDial().then((d) => setF((prev) => (prev.phone ? prev : { ...prev, phone: d + " " }))); }, []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const roles = [
    { id: "customer", icon: "sofa", title: t("auth.r.customer.title"), sub: t("auth.r.customer.sub") },
    { id: "employee", icon: "sparkle", title: t("auth.r.employee.title"), sub: t("auth.r.employee.sub") },
    { id: "company", icon: "building", title: t("auth.r.company.title"), sub: t("auth.r.company.sub") },
  ];

  const [pendingScreen, setPendingScreen] = useState(false);
  const [forgot, setForgot] = useState(0); // 0=off 1=email sent, enter code+new pw
  const [fpCode, setFpCode] = useState("");
  const [fpNew, setFpNew] = useState("");
  const submit = async () => {
    setBusy(true); setErr(null);
    let res;
    if (mode === "login") res = await store.login(f);
    else if (role === "customer") res = await store.signupCustomer(f);
    else if (role === "employee") res = await store.signupEmployee(f);
    else res = await store.signupCompany(f);
    setBusy(false);
    if (res?.pending) { setPendingScreen(true); return; }
    if (res?.error) setErr(res.error);
  };

  if (pendingScreen)
    return (
      <div className="cl-fade" style={{ minHeight: "100vh", background: C.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 34px", textAlign: "center" }}>
        <div className="cl-pop" style={{ fontSize: 58 }}>🎓</div>
        <div style={{ fontFamily: F, fontWeight: 700, fontSize: 22, color: C.ink, marginTop: 18 }}>{L("Application received!", "Jelentkezés beérkezett!")}</div>
        <div style={{ fontFamily: B, fontSize: 13.5, color: C.inkSoft, marginTop: 12, lineHeight: 1.7, maxWidth: 340 }}>
          {L("Our team is verifying your student card. You'll get an email as soon as your account is approved — then just log in.",
             "Csapatunk ellenőrzi a diákigazolványodat. E-mailt küldünk, amint jóváhagytuk a fiókodat — utána már be is léphetsz.")}
        </div>
        <Btn style={{ marginTop: 26 }} onClick={() => { setPendingScreen(false); setRole(null); }}>{L("Back to start", "Vissza a kezdőlapra")}</Btn>
      </div>
    );

  if (!role)
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: `radial-gradient(130% 100% at 50% 0%, ${C.navyMid}, ${C.navyDeep} 72%)`, padding: "0 26px", position: "relative", overflow: "hidden" }}>
        <div className="cl-bubble" style={{ left: "16%" }} />
        <div className="cl-bubble" style={{ left: "72%", animationDelay: ".9s", width: 13, height: 13 }} />
        <div style={{ position: "absolute", top: "calc(16px + env(safe-area-inset-top))", right: 18, zIndex: 2 }}>
          <select value={lang} onChange={(e) => setLang(e.target.value)} style={{ fontFamily: B, fontWeight: 700, fontSize: 11.5, padding: "7px 12px", borderRadius: 99, border: "1px solid rgba(255,255,255,.3)", background: "rgba(255,255,255,.14)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", color: "#fff", cursor: "pointer", appearance: "none", WebkitAppearance: "none", outline: "none" }}>
            {LANGS.map((o) => <option key={o.id} value={o.id} style={{ color: "#1B2A6B" }}>{o.label} · {o.name}</option>)}
          </select>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div className="cl-pop" style={{ margin: "0 auto", display: "flex", justifyContent: "center" }}>
            <img src="/white-logo-full.png" alt="Cleano" style={{ width: 210, height: 242, objectFit: "contain" }} draggable="false" />
          </div>
          <div className="cl-rise" style={{ fontFamily: B, fontSize: 13, color: "#9FB0E8", textAlign: "center", marginTop: 4, animationDelay: ".15s" }}>{t("auth.tagline")}</div>
          <div style={{ marginTop: 34 }}>
            {roles.map((r, i) => (
              <button key={r.id} onClick={() => { setRole(r.id); setMode("signup"); setErr(null); }} className="cl-rise cl-card" style={{
                width: "100%", display: "flex", alignItems: "center", gap: 14, textAlign: "left",
                background: C.card, border: "none", borderRadius: 20, padding: "16px 18px",
                marginBottom: 12, cursor: "pointer", boxShadow: "0 8px 24px rgba(0,0,0,.22)", animationDelay: `${.2 + i * .09}s`,
              }}>
                <div style={{ width: 48, height: 48, borderRadius: 15, background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: C.navySoft }}><Ic name={r.icon} size={24} /></div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: F, fontWeight: 700, fontSize: 15.5, color: C.ink }}>{r.title}</div>
                  <div style={{ fontFamily: B, fontSize: 11.5, color: C.inkSoft, marginTop: 3, lineHeight: 1.45 }}>{r.sub}</div>
                </div>
                <span style={{ color: C.inkFaint, fontSize: 18 }}>›</span>
              </button>
            ))}
          </div>
          {isLive && (
            <button onClick={() => { setRole("customer"); setMode("login"); }} style={{ background: "none", border: "none", fontFamily: B, fontSize: 12.5, fontWeight: 700, color: C.mint, cursor: "pointer", marginTop: 8 }}>
              {t("auth.haveAccount")}
            </button>
          )}
          {!isLive && store.demoSwitchRole && (
            <button onClick={() => store.demoSwitchRole("admin")} style={{ background: "none", border: `1px solid rgba(255,255,255,.18)`, borderRadius: 12, padding: "9px 0", width: "100%", fontFamily: B, fontSize: 12, fontWeight: 700, color: "#C9D2F5", cursor: "pointer", marginTop: 10 }}>
              {t("auth.peekAdmin")}
            </button>
          )}
        </div>
        <div style={{ fontFamily: B, fontSize: 10.5, color: "#6B7BC4", textAlign: "center", paddingBottom: 26 }}>
          {t("auth.footer")}{!isLive && " · DEMO MODE"}
        </div>
      </div>
    );

  const h = {
    customer: { icon: "🛋️", title: mode === "login" ? "Welcome back" : "Create your account", sub: "Students get automatic discounts at checkout." },
    employee: { icon: "🧽", title: "Cleaner sign-up", sub: "Use the invite code your company gave you." },
    company: { icon: "🏢", title: "Register your company", sub: "Free to list — manage your team and bookings." },
  }[role];

  const ready = mode === "login"
    ? f.email && f.password
    : !f.terms ? false
    : role === "customer" ? f.name && f.address.trim() && f.phone.replace(/[^0-9]/g, "").length >= 8 && (f.custType !== "student" || f.documents.length >= 1) && (!isLive || (f.email && f.password.length >= 6))
    : role === "employee" ? f.code.trim().length >= 4 && f.address.trim() && f.phone.replace(/[^0-9]/g, "").length >= 8 && (!isLive || (f.name && f.email && f.password.length >= 6))
    : (f.companyName.trim() && huTaxIdValid(f.taxId) && (!f.regNumber.trim() || huRegNumberValid(f.regNumber)) && (!isLive || (f.email && f.password.length >= 6)));

  return (
    <div className="cl-fade" style={{ height: "100dvh", minHeight: "100vh", background: C.bg, display: "flex", flexDirection: "column", padding: "0 26px", overflow: "hidden", boxSizing: "border-box" }}>
      <div style={{ paddingTop: "calc(22px + env(safe-area-inset-top))", flexShrink: 0 }}>
        <button onClick={() => setRole(null)} style={{ background: C.card, border: "none", width: 38, height: 38, borderRadius: 13, fontSize: 16, cursor: "pointer", boxShadow: "0 2px 8px rgba(20,28,58,.08)" }}>←</button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", paddingTop: 24 }}>
        <div className="cl-pop" style={{ width: 72, height: 72, borderRadius: 23, background: `linear-gradient(135deg,${C.navy},${C.navyMid})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, boxShadow: "0 12px 30px rgba(27,42,107,.25)" }}>{h.icon}</div>
        <div style={{ fontFamily: F, fontWeight: 700, fontSize: 22, color: C.ink, marginTop: 18 }}>{h.title}</div>
        <div style={{ fontFamily: B, fontSize: 12.5, color: C.inkSoft, marginTop: 6, lineHeight: 1.6 }}>{h.sub}</div>
        <div style={{ marginTop: 22 }}>
          {!isLive && (
            <div style={{ background: C.mintSoft, borderRadius: 14, padding: "11px 14px", marginBottom: 14, fontFamily: B, fontSize: 11.5, color: C.greenDeep, lineHeight: 1.55 }}>
              <b>{L("Demo mode", "Demó mód")}</b> — {L("no email needed. Run the backend (see README) and set VITE_USE_API=true for real accounts.", "nincs szükség e-mailre. Indítsd el a szervert (lásd README), és állítsd be a VITE_USE_API=true értéket az éles fiókokhoz.")}
            </div>
          )}
          {mode === "signup" && role === "customer" && (
            <>
              <Field label="Your name" placeholder="e.g. Musa Gillani" value={f.name} onChange={set("name")} />
              <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink, marginBottom: 8 }}>I am a…</div>
              <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                {[{ id: "student", icon: "🎓", t: "Student", s: "Uni email verification · save up to 20%" }, { id: "resident", icon: "🏡", t: "Resident", s: "Standard pricing, full service" }].map((o) => (
                  <button key={o.id} onClick={() => setF({ ...f, custType: o.id })} style={{ flex: 1, textAlign: "left", padding: 14, borderRadius: 17, cursor: "pointer", border: f.custType === o.id ? `2px solid ${C.navy}` : "2px solid transparent", background: C.card, boxShadow: "0 1px 6px rgba(20,28,58,.06)" }}>
                    <div style={{ fontSize: 22 }}>{o.icon}</div>
                    <div style={{ fontFamily: F, fontWeight: 700, fontSize: 14, color: C.ink, marginTop: 6 }}>{o.t}</div>
                    <div style={{ fontFamily: B, fontSize: 10.5, color: C.inkSoft, marginTop: 4, lineHeight: 1.45 }}>{o.s}</div>
                  </button>
                ))}
              </div>
              <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink, marginBottom: 7 }}>{L("Residence address *", "Lakcím *")}</div>
              <AddressPicker value={f.address} onChange={(v) => setF({ ...f, address: v })} />
              <Field label={L("Phone number", "Telefonszám")} hint={L("One number = one account. Country code detected automatically.", "Egy szám = egy fiók. Az országkódot automatikusan felismertük.")} value={f.phone} onChange={set("phone")} />
              {f.custType === "student" && (
                <DocUpload
                  label={L("Student card photo *", "Diákigazolvány fotó *")}
                  hint={L("Required for the student discount — our team verifies it. Max 2 MB.", "A diákkedvezményhez kötelező — csapatunk ellenőrzi. Max 2 MB.")}
                  docs={f.documents}
                  onChange={(docs) => setF({ ...f, documents: docs })}
                />
              )}
            </>
          )}
          {mode === "signup" && role === "employee" && (
            <>
              <Field label={L("Company invite code", "Céges meghívókód")} placeholder={L("e.g. SPARK-7K4D", "pl. SPARK-7K4D")} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
              {isLive && <Field label={L("Your name", "A neved")} placeholder={L("Full name", "Teljes név")} value={f.name} onChange={set("name")} />}
              <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink, marginBottom: 7 }}>{L("Residence address *", "Lakcím *")}</div>
              <AddressPicker value={f.address} onChange={(v) => setF({ ...f, address: v })} />
              <Field label={L("Phone number", "Telefonszám")} hint={L("One number = one account.", "Egy szám = egy fiók.")} value={f.phone} onChange={set("phone")} />
              <DocUpload
                label={L("Identity document", "Személyazonosító okmány")}
                hint="ID card or residence card (lakcímkártya / tartózkodási engedély) — required before your first job."
                docs={f.documents}
                onChange={(docs) => setF({ ...f, documents: docs })}
              />
            </>
          )}
          {mode === "signup" && role === "company" && (
            <>
              <Field label={L("Company name *", "Cégnév *")} placeholder="e.g. SparkClean Kft." value={f.companyName} onChange={set("companyName")} />
              <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink, marginBottom: 7 }}>{L("City you serve *", "Melyik városban dolgoztok? *")}</div>
              <select value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })}
                style={{ width: "100%", boxSizing: "border-box", padding: "13px 15px", borderRadius: 15, border: `1.5px solid ${C.line}`, fontFamily: B, fontSize: 14, background: C.card, color: C.ink, marginBottom: 14, outline: "none" }}>
                {ALL_CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <Field label={L("Tax number (adószám) *", "Adószám *")} placeholder="12345678-1-42"
                hint={f.taxId.trim() ? (huTaxIdValid(f.taxId) ? "✅ " + L("Valid tax number", "Érvényes adószám") : "❌ " + L("Invalid — check the digits (format: 12345678-1-42)", "Hibás — ellenőrizd a számokat (formátum: 12345678-1-42)")) : L("We verify this against the official checksum.", "A hivatalos ellenőrzőszám alapján ellenőrizzük.")}
                value={f.taxId} onChange={set("taxId")} />
              <Field label={L("Company registration no.", "Cégjegyzékszám")} placeholder="e.g. 09-09-123456" value={f.regNumber} onChange={set("regNumber")} />
              <PhoneField label={L("Contact phone", "Kapcsolattartó telefonszám")} value={f.contactPhone} onChange={(v) => setF((p) => ({ ...p, contactPhone: v }))} />
              <DocUpload
                label={L("Verification documents", "Igazoló dokumentumok")}
                hint="Company registration extract (cégkivonat), tax certificate — photos or PDFs. Speeds up approval."
                docs={f.documents}
                onChange={(docs) => setF({ ...f, documents: docs })}
              />
              <div style={{ background: C.navyChip, borderRadius: 13, padding: "10px 13px", marginBottom: 14, fontFamily: B, fontSize: 11, color: C.navySoft, lineHeight: 1.5 }}>
                🛡️ These details are submitted for verification. You can sign in straight away, but your company is listed to customers only after an admin approves your documents.
              </div>
            </>
          )}
          {isLive && (
            <>
              <Field label="Email" type="email" placeholder="you@example.com" value={f.email} onChange={set("email")} />
              <Field label="Password" type="password" placeholder="Min. 6 characters" value={f.password} onChange={set("password")} />
            </>
          )}
          {err && <div style={{ background: C.coralSoft, borderRadius: 13, padding: "11px 14px", fontFamily: B, fontSize: 12, color: C.coralText, marginBottom: 12 }}>{err}</div>}
        </div>
      </div>
      <div style={{ paddingTop: 12, paddingBottom: "calc(22px + env(safe-area-inset-bottom))", flexShrink: 0 }}>
          {mode === "login" && !forgot && (
            <button onClick={async () => {
              if (!f.email) { setErr(L("Enter your email above first", "Add meg előbb az e-mail címed")); return; }
              setBusy(true);
              const r = await store.forgotPassword(f.email);
              setBusy(false);
              if (r?.error) setErr(r.error);
              else { setForgot(1); setErr(null); }
            }} style={{ background: "none", border: "none", fontFamily: B, fontSize: 12, fontWeight: 700, color: C.navySoft, cursor: "pointer", padding: 0, marginBottom: 12 }}>
              {L("Forgot your password?", "Elfelejtetted a jelszavad?")}
            </button>
          )}
          {mode === "login" && forgot === 1 && (
            <div style={{ background: C.card, borderRadius: 15, padding: 14, marginBottom: 14, boxShadow: "0 1px 6px rgba(20,28,58,.05)" }}>
              <div style={{ fontFamily: B, fontSize: 12, color: C.inkSoft, marginBottom: 10 }}>{L("We emailed a 6-digit code to", "Elküldtük a 6 jegyű kódot ide:")} <b>{f.email}</b></div>
              <Field label={L("Code from the email", "Kód az e-mailből")} inputMode="numeric" placeholder="• • • • • •" value={fpCode} onChange={(e) => setFpCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))} />
              <Field label={L("New password", "Új jelszó")} type="password" placeholder={L("Min. 6 characters", "Min. 6 karakter")} value={fpNew} onChange={(e) => setFpNew(e.target.value)} />
              <Btn small full disabled={busy || fpCode.length < 6 || fpNew.length < 6} onClick={async () => {
                setBusy(true);
                const r = await store.resetPassword(f.email, fpCode, fpNew);
                setBusy(false);
                if (r?.error) setErr(r.error);
                else { setForgot(0); setFpCode(""); setFpNew(""); setErr(null); setF({ ...f, password: "" }); alert(L("Password changed — log in with the new one", "Jelszó megváltoztatva — lépj be az újjal")); }
              }}>{L("Set new password", "Új jelszó beállítása")}</Btn>
            </div>
          )}
          {mode === "signup" && (
            <label style={{ display: "flex", alignItems: "flex-start", gap: 10, margin: "4px 0 14px", cursor: "pointer" }}>
              <input type="checkbox" checked={f.terms} onChange={(e) => setF({ ...f, terms: e.target.checked })} style={{ marginTop: 3, width: 17, height: 17, accentColor: "#5EE6A8" }} />
              <span style={{ fontFamily: B, fontSize: 11.5, color: C.inkSoft, lineHeight: 1.55 }}>
                {L("I accept the ", "Elfogadom az ")}
                <a href={(API_BASE || "") + (role === "company" ? "/partner-terms" : "/terms")} target="_blank" rel="noreferrer" style={{ color: C.navySoft, fontWeight: 700 }}>{role === "company" ? L("Partner Terms", "Partneri ÁSZF-et") : L("Terms of Service", "ÁSZF-et")}</a>
                {L(" and the ", " és az ")}
                <a href={(API_BASE || "") + "/privacy"} target="_blank" rel="noreferrer" style={{ color: C.navySoft, fontWeight: 700 }}>{L("Privacy Policy", "Adatkezelési tájékoztatót")}</a>.
              </span>
            </label>
          )}
        <Btn full disabled={!ready || busy} onClick={submit}>
          {busy ? "One moment…" : mode === "login" ? "Log in →" : role === "customer" ? "Create account →" : role === "company" ? "Register company →" : "Join my company →"}
        </Btn>
        {isLive && (
          <button onClick={() => { setMode(mode === "login" ? "signup" : "login"); setErr(null); }} style={{ background: "none", border: "none", width: "100%", fontFamily: B, fontSize: 12, fontWeight: 700, color: C.navySoft, cursor: "pointer", marginTop: 12 }}>
            {mode === "login" ? "New here? Create an account" : "Already registered? Log in"}
          </button>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   CUSTOMER
════════════════════════════════════════════════════════════ */

function CityPickerSheet({ close, city, onPick }) {
  return (
    <Sheet title={L("Choose your city", "Válassz várost")} close={close}>
      {Object.values(MARKETS).map((m) => (
        <React.Fragment key={m.name}>
          <div style={{ fontFamily: B, fontSize: 11, fontWeight: 700, color: C.inkFaint, margin: "4px 0 8px", letterSpacing: .5 }}>🇭🇺 {m.name}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
            {m.cities.map((c) => (
              <button key={c} onClick={() => { onPick(c); close(); }}
                style={{ padding: "13px 10px", borderRadius: 14, border: city === c ? `2px solid ${C.navy}` : "2px solid transparent", background: C.card, boxShadow: "0 1px 6px rgba(20,28,58,.05)", cursor: "pointer", fontFamily: F, fontWeight: 700, fontSize: 13.5, color: C.ink }}>
                {city === c ? "📍 " : ""}{c}
              </button>
            ))}
          </div>
        </React.Fragment>
      ))}
      <div style={{ fontFamily: B, fontSize: 11, color: C.inkFaint, textAlign: "center", marginTop: 4 }}>
        {L("More cities and countries coming as Cleano grows 🐙", "Új városok és országok jönnek, ahogy a Cleano növekszik 🐙")}
      </div>
    </Sheet>
  );
}

function MiniLang({ light }) {
  const { lang, setLang } = useStore();
  return (
    <select value={lang} onChange={(e) => setLang(e.target.value)} style={{ flexShrink: 0, fontFamily: B, fontWeight: 700, fontSize: 10.5, padding: "5px 9px", borderRadius: 99, cursor: "pointer", appearance: "none", WebkitAppearance: "none", outline: "none",
      border: light ? "1px solid rgba(255,255,255,.3)" : `1.5px solid ${C.line}`,
      background: light ? "rgba(255,255,255,.14)" : C.bg, color: light ? "#fff" : C.ink }}>
      {LANGS.map((o) => <option key={o.id} value={o.id} style={{ color: "#1B2A6B" }}>{o.label}</option>)}
    </select>
  );
}

function CustomerHome({ openBooking, openProfile }) {
  const { session, companies, services, reviews, t } = useStore();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("rating");
  // City is DERIVED (profile/saved addresses → cached choice → default), never toggled.
  const derivedCity = useMemo(() => {
    for (const a of [session.address, ...(session.savedAddresses || []).map((x) => x.address)]) {
      const c = cityFromAddress(a);
      if (c) return c;
    }
    return getCity();
  }, [session]);
  const city = derivedCity;
  React.useEffect(() => { saveCity(derivedCity); }, [derivedCity]);
  const isStudent = session.custType === "student";

  const list = useMemo(() => {
    let res = companies
      .filter((c) => !city || !c.city || String(c.city).toLowerCase() === String(city).toLowerCase())
      .filter((c) => c.is_approved !== false && c.is_listed !== false)
      .filter((c) => matchesSearch(c, services, q).hit);
    if (sort === "rating") res = [...res].sort((a, b) => b.rating - a.rating);
    else if (sort === "price") res = [...res].sort((a, b) => {
      // hourly services store price_huf 0 — rank by real base price (rate or flat), same as the card labels
      const min = (co) => { const p = services.filter((s) => s.company_id === co.id && s.is_active).map(basePrice).filter((n) => n > 0); return p.length ? Math.min(...p) : Infinity; };
      return min(a) - min(b);
    });
    else if (sort === "discount") res = [...res].sort((a, b) => b.student_discount - a.student_discount);
    return res;
  }, [companies, services, q, sort, city]);

  return (
    <div className="cl-fade">
      <div style={{ background: `radial-gradient(140% 120% at 20% 0%, ${C.navyMid}, ${C.navyDeep} 75%)`, padding: "calc(24px + env(safe-area-inset-top)) 20px 44px", position: "relative", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={openProfile} aria-label={L("Edit profile", "Profil szerkesztése")}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 10, textAlign: "left", minWidth: 0 }}>
            <Octo size={32} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: F, fontWeight: 700, fontSize: 18, color: "#fff", display: "flex", alignItems: "center", gap: 6 }}>
                {t("home.hi")} {session.name.split(" ")[0]} 👋
                <span style={{ fontSize: 11, color: C.mint, background: "rgba(94,230,168,.16)", borderRadius: 99, padding: "2px 8px", fontFamily: B, fontWeight: 700 }}>✎</span>
              </div>
              <div style={{ marginTop: 2, display: "flex", alignItems: "center", gap: 4, maxWidth: 220 }}>
                <span style={{ fontFamily: B, fontSize: 11.5, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📍 {session.address ? session.address : t("home.setAddress")}</span>
                <span style={{ color: C.mint, fontSize: 11 }}>▾</span>
              </div>
            </div>
          </button>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <MiniLang light />
            <Pill bg={isStudent ? "rgba(94,230,168,.18)" : "rgba(255,255,255,.12)"} color={isStudent ? C.mint : "#C9D2F5"}>
              {isStudent ? t("home.student") : t("home.resident")}
            </Pill>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10, marginTop: 20 }}>
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 23, color: "#fff", lineHeight: 1.3 }}>
            {t("home.whatSparkle")} <Sparkle size={15} style={{ display: "inline-block" }} />
          </div>
          <span style={{ flexShrink: 0, fontFamily: F, fontWeight: 700, fontSize: 12, color: "#C9D2F5", padding: "7px 4px" }}>
            📍 {city}
          </span>
        </div>
        <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10, background: C.card, borderRadius: 16, padding: "12px 16px", boxShadow: "0 10px 30px rgba(0,0,0,.18)" }}>
          <span style={{ fontSize: 15, opacity: .55 }}>🔍</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("home.search")}
            style={{ flex: 1, border: "none", outline: "none", fontFamily: B, fontSize: 14, color: C.ink, background: "transparent" }} />
          {q && <button onClick={() => setQ("")} style={{ border: "none", background: "none", color: C.inkFaint, cursor: "pointer", fontSize: 16 }}>✕</button>}
        </div>
      </div>
      <svg viewBox="0 0 375 26" style={{ display: "block", marginTop: -25, width: "100%", position: "relative" }} preserveAspectRatio="none">
        <path d="M0 26 L0 14 C 95 32 280 32 375 14 L375 26 Z" fill={C.bg} />
      </svg>

      <div style={{ padding: "8px 20px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "8px 0 14px" }}>
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 16, color: C.ink }}>{t("home.companiesNearYou")}</div>
          <div style={{ display: "flex", gap: 6 }}>
            {[{ id: "rating", label: t("home.sort.rating") }, { id: "price", label: t("home.sort.price") }, ...(isStudent ? [{ id: "discount", label: t("home.sort.discount") }] : [])].map((s) => (
              <button key={s.id} onClick={() => setSort(s.id)} style={{ fontFamily: B, fontWeight: 700, fontSize: 10.5, padding: "5px 10px", borderRadius: 99, border: "none", cursor: "pointer", background: sort === s.id ? C.navy : C.card, color: sort === s.id ? "#fff" : C.navySoft, boxShadow: "0 1px 4px rgba(20,28,58,.08)" }}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {list.map((co, i) => {
          const svcs = services.filter((s) => s.company_id === co.id && s.is_active);
          const prices = svcs.map(basePrice).filter((n) => n > 0);
          const minPrice = prices.length ? Math.min(...prices) : null;
          const hasHourly = svcs.some((s) => s.pricing_type === "hourly");
          const hasSub = svcs.some((s) => s.pricing_type === "subscription");
          /* When someone searched, say WHY this company came back — otherwise a
             search for "laundry" returns a cleaning company with no explanation. */
          const hitSvcs = matchesSearch(co, services, q).services;
          return (
            <div key={co.id} onClick={() => openBooking(co)} className="cl-card cl-rise" style={{ background: C.card, borderRadius: 22, marginBottom: 14, overflow: "hidden", cursor: "pointer", boxShadow: "0 4px 18px rgba(20,28,58,.07)", animationDelay: `${i * .07}s` }}>
              <div style={{ height: 70, background: coverOf(co), display: "flex", alignItems: "center", padding: "0 16px" }}>
                <CompanyLogo co={co} size={46} radius={14} />
              </div>
              <div style={{ padding: "13px 16px 15px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontFamily: F, fontWeight: 700, fontSize: 15.5, color: C.ink, display: "flex", alignItems: "center", gap: 5 }}>
                    {co.name}
                    {co.is_approved !== false && <span title={L("Documents verified by Cleano", "A Cleano ellenőrizte a dokumentumokat")} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 15, height: 15, borderRadius: "50%", background: C.mint, color: C.navyDeep, fontSize: 9.5, fontWeight: 900, flexShrink: 0 }}>✓</span>}
                  </div>
                  {availOf(co)?.paused && <Pill bg={C.amberSoft} color={C.amber}>{L("Fully booked", "Betelt")}</Pill>}
                  {promoOf(co) && <Pill bg={C.mintSoft} color={C.green}>−{promoOf(co).pct}%{promoOf(co).label ? ` ${promoOf(co).label}` : ""}</Pill>}
                  {isStudent && !promoOf(co) && <Pill bg={C.mintSoft} color={C.green}>−{co.student_discount}% 🎓</Pill>}
                </div>
                {co.tagline && <div style={{ fontFamily: B, fontSize: 11.5, color: C.inkSoft, marginTop: 3 }}><Translated map={co.tagline_i18n} fallback={co.tagline} /></div>}
                {hitSvcs.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
                    {hitSvcs.slice(0, 3).map((sv) => (
                      <span key={sv.id} style={{ fontFamily: B, fontWeight: 700, fontSize: 10, padding: "4px 9px", borderRadius: 99, background: C.mintSoft, color: C.greenDeep }}>
                        {sv.icon} <Translated map={sv.name_i18n} fallback={sv.name} />
                      </span>
                    ))}
                    {hitSvcs.length > 3 && (
                      <span style={{ fontFamily: B, fontWeight: 700, fontSize: 10, padding: "4px 9px", borderRadius: 99, background: C.bg, color: C.inkFaint }}>
                        +{hitSvcs.length - 3}
                      </span>
                    )}
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10, fontFamily: B, fontSize: 11.5, color: C.inkSoft }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Star size={12} /> <b style={{ color: C.ink }}>{co.rating}</b> ({co.review_count})</span>
                  <><span>·</span><span>📍 {co.city || ""}{co.area ? ` · ${co.area}` : ""}{co.distance_km != null ? ` · ${co.distance_km} km` : ""}</span></>
                  {minPrice != null && <><span>·</span><span style={{ fontWeight: 700, color: C.navy }}>{L(`from ${huf(minPrice)}`, `${huf(minPrice)}-tól`)}</span></>}
                </div>
                {(hasHourly || hasSub) && (
                  <div style={{ display: "flex", gap: 6, marginTop: 9 }}>
                    {hasHourly && <Pill bg={C.navyChip} color={C.navySoft}>{t("home.hourly")}</Pill>}
                    {hasSub && <Pill bg={C.navyChip} color={C.navySoft}>{t("home.plans")}</Pill>}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {list.length === 0 && (
          <div style={{ textAlign: "center", padding: "50px 30px" }}>
            <div style={{ fontSize: 40 }}>🫧</div>
            <div style={{ fontFamily: B, fontSize: 13, color: C.inkSoft, marginTop: 10 }}>
              {q ? t("home.noMatch") : L(`No companies in ${city} yet — be the first! Companies can register free from the login screen.`, `${city} városban még nincs partnerünk — cégek ingyen regisztrálhatnak a belépő képernyőről.`)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BookingFlow({ company, close, onBooked }) {
  const { session, services, reviews, createBooking, startPayment, getPaymentStatus, feePct, cancelBooking, cancelPolicy } = useStore();
  const [reqAck, setReqAck] = useState(false);
  const reqList = React.useMemo(() => {
    const a = Array.isArray(company?.requirements) ? company.requirements : [];
    const b = Array.isArray(svc?.requirements) ? svc.requirements : [];
    return [...a, ...b].map((x) => String(x).trim()).filter(Boolean).slice(0, 12);
  }, [company, svc]);
  const reqMaps = Array.isArray(company?.requirements_i18n) ? company.requirements_i18n : [];
  const toast = useToast();
  const svcs = services.filter((s) => s.company_id === company.id && s.is_active);
  const revs = reviews.filter((r) => r.company_id === company.id);
  const DAYS = useMemo(nextDays, []);
  const [step, setStep] = useState(0);
  const [svc, setSvc] = useState(null);
  const [hours, setHours] = useState(2);
  const [schedSel, setSchedSel] = useState(null); // subscription: chosen weekday index or day-of-month
  const [day, setDay] = useState(null);
  const [slot, setSlot] = useState(null);
  const [addr, setAddr] = useState(session.address || "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [payWait, setPayWait] = useState(null);
  const isStudent = session.custType === "student";
  const isHourly = svc?.pricing_type === "hourly";
  const isUnit = svc?.pricing_type === "unit";
  const unitMin = Number(svc?.min_units) || 1;
  const unitMax = Number(svc?.max_units) || 50;
  const [units, setUnits] = useState(unitMin);
  React.useEffect(() => { setUnits(Number(svc?.min_units) || 1); }, [svc?.id]);
  const isSub = svc?.pricing_type === "subscription";
  const promo = promoOf(company);
  const effPct = (s) => Math.max(s && s.promo_pct ? s.promo_pct : 0, promo ? promo.pct : 0, isStudent ? company.student_discount || 0 : 0);
  const discPct = effPct(svc);
  const stud = (n) => Math.round((n || 0) * discPct / 100);
  const gross = !svc ? 0 : isHourly ? (svc.hourly_rate_huf || 0) * hours : isUnit ? Math.round((svc.unit_price_huf || 0) * units) : (svc.price_huf || 0);
  const discount = stud(gross);
  const companyShare = gross - discount;
  const serviceFee = Math.round(companyShare * (feePct ?? 10) / 100);
  const total = companyShare + serviceFee;
  const youPay = (s) => {
    const g = s.pricing_type === "hourly" ? s.hourly_rate_huf : s.price_huf;
    const d = g - Math.round((g || 0) * effPct(s) / 100);
    if (s.pricing_type === "hourly") return `${huf(d)}/hr`;
    if (s.pricing_type === "subscription") return `${huf(d)} / ${periodShort(s.period)}`;
    return huf(d);
  };
  const pickSvc = (s) => { setSvc(s); setSchedSel(null); setDay(null); if (s.pricing_type === "hourly") setHours(s.min_hours || 2); };
  const canNext = [svc, day && slot, addr.trim(), true][step];
  const labels = HUL() ? ["Szolgáltatás", "Időpont", "Adatok", "Összegzés"] : ["Service", "Time", "Details", "Review"];

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div onClick={close} style={{ position: "absolute", inset: 0, background: "rgba(16,25,74,.55)", backdropFilter: "blur(3px)" }} />
      <div className="cl-slideup" style={{ position: "relative", background: C.bg, borderRadius: "28px 28px 0 0", maxHeight: "92vh", display: "flex", flexDirection: "column", maxWidth: 430, width: "100%", margin: "0 auto" }}>
        <div style={{ padding: "14px 22px 0" }}>
          <div style={{ width: 40, height: 4, borderRadius: 99, background: C.line, margin: "0 auto 13px" }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <CompanyLogo co={company} size={38} radius={12} />
              <div>
                <div style={{ fontFamily: F, fontWeight: 700, fontSize: 15, color: C.ink }}>{company.name}</div>
                <div style={{ fontFamily: B, fontSize: 10.5, color: C.inkSoft }}>★ {company.rating} · {company.area}</div>
              </div>
            </div>
            <button onClick={close} style={{ width: 32, height: 32, borderRadius: 11, border: "none", background: C.card, fontSize: 14, cursor: "pointer", color: C.inkSoft }}>✕</button>
          </div>
          <div style={{ display: "flex", alignItems: "center", margin: "15px 0 3px" }}>
            {labels.map((l, i) => (
              <React.Fragment key={l}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <div style={{ width: 25, height: 25, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F, fontWeight: 700, fontSize: 11, transition: "all .3s", background: step > i ? C.mint : step === i ? C.navy : C.card, color: step > i ? C.navyDeep : step === i ? "#fff" : C.inkFaint, border: step >= i ? "none" : `1.5px solid ${C.line}` }}>{step > i ? "✓" : i + 1}</div>
                  <span style={{ fontFamily: B, fontSize: 9, fontWeight: 700, color: step === i ? C.navy : C.inkFaint }}>{l}</span>
                </div>
                {i < 3 && <div style={{ flex: 1, height: 2, margin: "0 4px 14px", borderRadius: 9, background: step > i ? C.mint : C.line }} />}
              </React.Fragment>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "10px 22px 14px" }}>
          {step === 0 && (
            <>
              {svcs.map((s) => (
                <button key={s.id} onClick={() => pickSvc(s)} className="cl-fade" style={{ width: "100%", textAlign: "left", display: "flex", gap: 12, padding: 14, borderRadius: 17, marginBottom: 10, border: svc?.id === s.id ? `2px solid ${C.navy}` : "2px solid transparent", background: C.card, cursor: "pointer", boxShadow: "0 1px 6px rgba(20,28,58,.05)" }}>
                  <div style={{ width: 42, height: 42, borderRadius: 13, background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{s.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontFamily: F, fontWeight: 700, fontSize: 14, color: C.ink }}>{s.name}</span>
                      <span style={{ fontFamily: F, fontWeight: 700, fontSize: 13.5, color: C.navy, whiteSpace: "nowrap" }}>{priceLabel(s)}</span>
                    </div>
                    <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft, marginTop: 3, lineHeight: 1.45 }}>{s.description} · ⏱ ~{s.minutes} {L("min", "perc")}{s.pricing_type === "subscription" ? ` · 🔁 ${everyP(s.period)}` : s.pricing_type === "hourly" ? L(` · pick ${s.min_hours || 2}–${s.max_hours || 8} h`, ` · ${s.min_hours || 2}–${s.max_hours || 8} óra választható`) : ""}</div>
                    {isStudent && <div style={{ fontFamily: B, fontSize: 10.5, color: C.green, fontWeight: 700, marginTop: 4 }}>🎓 {L("You pay:", "A te árad:")} {youPay(s)}</div>}
                  </div>
                </button>
              ))}
              {isHourly && (
                <div className="cl-fade" style={{ background: C.card, borderRadius: 16, padding: 16, marginBottom: 10, boxShadow: "0 1px 6px rgba(20,28,58,.05)" }}>
                  <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13, color: C.ink, marginBottom: 12 }}>{L("How many hours do you need?", "Hány órára van szükséged?")}</div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <button onClick={() => setHours((h) => Math.max(svc.min_hours || 2, h - 1))} style={{ width: 44, height: 44, borderRadius: 14, border: "none", background: C.bg, fontSize: 22, fontWeight: 700, color: C.navy, cursor: "pointer" }}>−</button>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 26, color: C.navy }}>{hours} <span style={{ fontSize: 14 }}>{L("hours", "óra")}</span></div>
                      <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft, marginTop: 2 }}>{huf(svc.hourly_rate_huf)} × {hours} = <b style={{ color: C.ink }}>{huf((svc.hourly_rate_huf || 0) * hours)}</b></div>
                    </div>
                    <button onClick={() => setHours((h) => Math.min(svc.max_hours || 8, h + 1))} style={{ width: 44, height: 44, borderRadius: 14, border: "none", background: C.bg, fontSize: 22, fontWeight: 700, color: C.navy, cursor: "pointer" }}>+</button>
                  </div>
                </div>
              )}
              {isUnit && (
                <div className="cl-fade" style={{ background: C.card, borderRadius: 18, padding: 16, marginBottom: 12, boxShadow: "0 2px 10px rgba(20,28,58,.05)" }}>
                  <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13, color: C.ink, marginBottom: 12 }}>
                    {L("How much do you need cleaned?", "Mennyit kell kitisztítani?")}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <button onClick={() => setUnits((u) => Math.max(unitMin, Math.round((u - 1) * 100) / 100))}
                      style={{ width: 44, height: 44, borderRadius: 14, border: "none", background: C.bg, fontSize: 22, fontWeight: 700, color: C.navy, cursor: "pointer" }}>−</button>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 26, color: C.navy }}>
                        {units} <span style={{ fontSize: 14 }}>{svc.unit_label}</span>
                      </div>
                      <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft, marginTop: 2 }}>
                        {huf(svc.unit_price_huf)}/{svc.unit_label} × {units} = <b style={{ color: C.ink }}>{huf(Math.round((svc.unit_price_huf || 0) * units))}</b>
                      </div>
                    </div>
                    <button onClick={() => setUnits((u) => Math.min(unitMax, Math.round((u + 1) * 100) / 100))}
                      style={{ width: 44, height: 44, borderRadius: 14, border: "none", background: C.bg, fontSize: 22, fontWeight: 700, color: C.navy, cursor: "pointer" }}>+</button>
                  </div>
                  <div style={{ fontFamily: B, fontSize: 10.5, color: C.inkFaint, textAlign: "center", marginTop: 8, lineHeight: 1.5 }}>
                    {L("An estimate is fine — the company checks it when they arrive.", "A becslés is elég — a cég a helyszínen ellenőrzi.")}
                  </div>
                </div>
              )}
              {isSub && (
                <div className="cl-fade" style={{ background: C.mintSoft, borderRadius: 14, padding: "11px 14px", marginBottom: 10, fontFamily: B, fontSize: 11.5, color: C.greenDeep, lineHeight: 1.5 }}>
                  {L(`🔁 Subscription — recurs ${everyP(svc.period)}. We schedule the first clean next; cancel anytime.`, `🔁 Előfizetés — ${everyP(svc.period)} ismétlődik. Most az első takarítást időzítjük; bármikor lemondhatod.`)}
                </div>
              )}
              {revs.length > 0 && (
                <>
                  <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13, color: C.ink, margin: "14px 0 8px" }}>{L("Recent reviews", "Friss értékelések")}</div>
                  {revs.slice(0, 3).map((r) => (
                    <div key={r.id} style={{ background: C.card, borderRadius: 15, padding: 13, marginBottom: 8, boxShadow: "0 1px 6px rgba(20,28,58,.04)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Avatar name={r.customer_name || "C"} size={28} />
                        <span style={{ fontFamily: F, fontWeight: 700, fontSize: 12, color: C.ink }}>{r.customer_name || L("Customer", "Ügyfél")}</span>
                        <span style={{ display: "flex", gap: 1, marginLeft: "auto" }}>{[...Array(5)].map((_, k) => <Star key={k} filled={k < r.stars} size={10} />)}</span>
                      </div>
                      {r.body && <div style={{ fontFamily: B, fontSize: 11.5, color: C.inkSoft, lineHeight: 1.55, marginTop: 7 }}>{r.body}</div>}
                    </div>
                  ))}
                </>
              )}
            </>
          )}

          {step === 1 && (
            <div className="cl-fade">
              {(isHourly || isSub) && (
                <div style={{ background: C.navyChip, borderRadius: 13, padding: "10px 13px", marginBottom: 12, fontFamily: B, fontSize: 11.5, color: C.navySoft, lineHeight: 1.5 }}>
                  {isHourly
                    ? L(`⏱ Choose the day and start time for your ${hours}-hour clean.`, `⏱ Válaszd ki a napot és a kezdési időt a ${hours} órás takarításhoz.`)
                    : L(`🔁 Choose your recurring schedule — repeats ${everyP(svc.period)}.`, `🔁 Válaszd ki az ismétlődő időpontot — ${everyP(svc.period)} ismétlődik.`)}
                </div>
              )}

              {isSub ? (
                <>
                  <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13, color: C.ink, margin: "6px 0 10px" }}>{L("Pick your first visit on the calendar", "Válaszd ki az első alkalmat a naptárban")}</div>
                  <Calendar
                    selected={day?.iso}
                    minISO={localISO(new Date())}
                    onSelect={(iso) => {
                      const [yy, mm, dd] = iso.split("-").map(Number);
                      setDay(dayObjFromDate(new Date(yy, mm - 1, dd)));
                      setSchedSel(iso);
                    }}
                  />
                  {day && (
                    <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft, marginTop: 8, lineHeight: 1.5 }}>
                      🔁 {cadenceLabel(svc.period, day)} — {L("after each completed visit, the next one is scheduled automatically. You can cancel anytime.", "minden befejezett alkalom után automatikusan időzítjük a következőt. Bármikor lemondhatod.")}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "6px 0 10px" }}>
                    <span style={{ fontFamily: F, fontWeight: 700, fontSize: 13, color: C.ink }}>{L("Day", "Nap")}</span>
                    <span style={{ fontFamily: B, fontSize: 10.5, color: C.inkFaint }}>{L("Book up to 2 months ahead", "Két hónapra előre foglalhatsz")}</span>
                  </div>
                  {/* Two months of days is too many to scroll blindly, so they are
                      grouped by month and the strip snaps to whole weeks. */}
                  <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 6, scrollSnapType: "x proximity" }} className="cl-noscroll">
                    {Object.entries(DAYS.reduce((acc, d) => { (acc[d.monthKey] ||= []).push(d); return acc; }, {})).map(([mk, mdays]) => (
                      <div key={mk} style={{ flex: "0 0 auto" }}>
                        <div style={{ fontFamily: B, fontSize: 10, fontWeight: 700, color: C.inkFaint, textTransform: "capitalize", marginBottom: 6, paddingLeft: 2 }}>{mdays[0].month}</div>
                        <div style={{ display: "flex", gap: 8 }}>
                          {mdays.map((d) => {
                            const closed = dayClosed(availOf(company), d.iso);
                            const full = !closed && openSlots(availOf(company), d.iso, svc?.id).length === 0;
                            const off = closed || full;
                            return (
                              <button key={d.iso} disabled={off} onClick={() => setDay(d)}
                                title={full ? L("Fully booked", "Teljesen betelt") : undefined}
                                style={{ minWidth: 58, padding: "11px 0", borderRadius: 16, border: "none", scrollSnapAlign: "start",
                                  opacity: off ? .3 : 1, cursor: off ? "not-allowed" : "pointer",
                                  background: day?.iso === d.iso ? C.navy : C.card,
                                  boxShadow: day?.iso === d.iso ? "0 4px 14px rgba(27,42,107,.3)" : "0 1px 5px rgba(20,28,58,.06)" }}>
                                <div style={{ fontFamily: B, fontSize: 10, fontWeight: 700, color: day?.iso === d.iso ? "#9FB0E8" : C.inkFaint }}>{d.d}</div>
                                <div style={{ fontFamily: F, fontSize: 16, fontWeight: 700, color: day?.iso === d.iso ? "#fff" : C.ink, marginTop: 2 }}>{d.n}</div>
                                {d.label && <div style={{ fontFamily: B, fontSize: 8.5, fontWeight: 700, color: day?.iso === d.iso ? C.mint : C.navySoft, marginTop: 2 }}>{d.label}</div>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13, color: C.ink, margin: "16px 0 10px" }}>{L("Time", "Időpont")}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                {day && openSlots(availOf(company), day.iso, svc?.id).length === 0 && (
                  <div style={{ gridColumn: "1 / -1", fontFamily: B, fontSize: 12, color: C.inkSoft, textAlign: "center", padding: "14px 8px", lineHeight: 1.5 }}>
                    {L("No free times on this day — please pick another.", "Ezen a napon nincs szabad időpont — válassz másikat.")}
                  </div>
                )}
                {(day ? openSlots(availOf(company), day.iso, svc?.id) : []).map((s) => (
                  <button key={s} onClick={() => setSlot(s)} style={{ padding: "12px 0", borderRadius: 14, border: "none", cursor: "pointer", fontFamily: F, fontWeight: 700, fontSize: 13.5, background: slot === s ? C.navy : C.card, color: slot === s ? "#fff" : C.ink, boxShadow: slot === s ? "0 4px 14px rgba(27,42,107,.28)" : "0 1px 5px rgba(20,28,58,.06)" }}>
                    {s}
                  </button>
                ))}
              </div>

              {isSub && day && slot && (
                <div style={{ background: C.mintSoft, borderRadius: 12, padding: "9px 13px", marginTop: 12, fontFamily: B, fontSize: 11.5, color: C.greenDeep, fontWeight: 600 }}>
                  📅 {cadenceLabel(svc.period, day)} · {slot} · {L("first visit", "első alkalom:")} {dayLabel(day.iso)}
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="cl-fade" style={{ paddingTop: 6 }}>
              <AddressPicker value={addr} onChange={setAddr} />
              <Field area label={L("Notes for the team (optional)", "Megjegyzés a csapatnak (opcionális)")} placeholder={L("Door code, pets, what to focus on…", "Kapukód, háziállat, mire figyeljenek…")} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          )}

          {step === 3 && svc && (
            <div className="cl-fade" style={{ paddingTop: 6 }}>
              {svc?.fulfilment === "collection" && (
                <div style={{ background: C.navyChip, borderRadius: 18, padding: "13px 16px", marginBottom: 12 }}>
                  <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13, color: C.ink, marginBottom: 5 }}>
                    🚚 {L("We collect and bring it back", "Elvisszük és visszahozzuk")}
                  </div>
                  <div style={{ fontFamily: B, fontSize: 12, color: C.inkSoft, lineHeight: 1.55 }}>
                    {L("We pick your items up at the time you chose above. You'll get them back about {d} days later, and we'll message you before we return them.", "A fent választott időpontban elvisszük a holmidat. Körülbelül {d} nap múlva kapod vissza, és a visszaszállítás előtt üzenünk.")
                      .replace("{d}", svc.turnaround_days ?? 3)}
                  </div>
                </div>
              )}

              {/* ── What happens if you cancel. One line, no sliding scale. ── */}
              <div style={{ background: C.card, borderRadius: 18, padding: "13px 16px", marginBottom: 12, boxShadow: "0 2px 10px rgba(20,28,58,.05)" }}>
                <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13, color: C.ink, marginBottom: 7 }}>
                  {L("If you need to cancel", "Ha le kell mondanod")}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "4px 0" }}>
                  <span style={{ fontFamily: B, fontSize: 12, color: C.inkSoft }}>
                    {L("More than {h}h before", "Több mint {h} órával előtte").replace("{h}", cancelPolicy.freeH)}
                  </span>
                  <span style={{ fontFamily: B, fontSize: 12, fontWeight: 700, color: C.green }}>{L("Full refund", "Teljes visszatérítés")}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "4px 0" }}>
                  <span style={{ fontFamily: B, fontSize: 12, color: C.inkSoft }}>
                    {L("Within {h}h", "{h} órán belül").replace("{h}", cancelPolicy.freeH)}
                  </span>
                  <span style={{ fontFamily: B, fontSize: 12, fontWeight: 700, color: C.inkSoft }}>{L("Cannot be cancelled", "Nem mondható le")}</span>
                </div>
                <div style={{ fontFamily: B, fontSize: 11, color: C.inkFaint, marginTop: 7, lineHeight: 1.5 }}>
                  {L("If the company cancels, you always get 100% back.", "Ha a cég mondja le, mindig 100%-ot kapsz vissza.")}
                </div>
              </div>

              {/* ── 5.4 What the company needs from you — acknowledged BEFORE paying ── */}
              {reqList.length > 0 && (
                <div style={{ background: C.amberSoft, borderRadius: 18, padding: "14px 16px", marginBottom: 12 }}>
                  <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13, color: C.ink, marginBottom: 8 }}>
                    {L("Before they arrive", "Mielőtt megérkeznek")}
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {reqList.map((r, i) => (
                      <li key={i} style={{ fontFamily: B, fontSize: 12.5, color: C.ink, lineHeight: 1.7 }}>
                        <Translated map={reqMaps[i]} fallback={r} />
                      </li>
                    ))}
                  </ul>
                  <label style={{ display: "flex", alignItems: "flex-start", gap: 9, marginTop: 11, cursor: "pointer" }}>
                    <input type="checkbox" checked={reqAck} onChange={(e) => setReqAck(e.target.checked)}
                      style={{ width: 18, height: 18, accentColor: C.navy, marginTop: 1, flexShrink: 0 }} />
                    <span style={{ fontFamily: B, fontWeight: 700, fontSize: 12.5, color: C.ink }}>
                      {L("I understand and will have these ready", "Megértettem, és ezeket biztosítom")}
                    </span>
                  </label>
                </div>
              )}
              <div style={{ background: C.card, borderRadius: 18, padding: 16, boxShadow: "0 2px 10px rgba(20,28,58,.05)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontFamily: B, fontSize: 12.5, color: C.inkSoft }}>
                  <span>{svc.name}{isHourly ? ` · ${hours} ${L("h", "óra")} × ${huf(svc.hourly_rate_huf)}` : isUnit ? ` · ${units} ${svc.unit_label} × ${huf(svc.unit_price_huf)}` : isSub ? ` · ${everyP(svc.period)}` : ""}</span><span>{huf(gross)}</span>
                </div>
                {discPct > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", fontFamily: B, fontSize: 12.5, color: C.green, fontWeight: 700, marginTop: 7 }}>
                    <span>{svc.promo_pct && svc.promo_pct >= discPct ? `${L("Offer", "Akció")} (−${discPct}%)` : promo && promo.pct >= (isStudent ? company.student_discount || 0 : 0) ? `${promo.label || L("Offer", "Akció")} (−${discPct}%)` : `${L("Student discount", "Diákkedvezmény")} (−${discPct}%)`}</span><span>−{huf(discount)}</span>
                  </div>
                )}
                {serviceFee > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", fontFamily: B, fontSize: 12.5, color: C.inkSoft, marginTop: 7 }}>
                    <span>{L(`Cleano service fee (${feePct ?? 10}%)`, `Cleano szolgáltatási díj (${feePct ?? 10}%)`)}</span><span>+{huf(serviceFee)}</span>
                  </div>
                )}
                <div style={{ borderTop: `1.5px dashed ${C.line}`, margin: "12px 0" }} />
                <div style={{ display: "flex", justifyContent: "space-between", fontFamily: F, fontWeight: 700, fontSize: 17, color: C.ink }}>
                  <span>{isSub ? (HUL() ? everyP(svc.period).charAt(0).toUpperCase() + everyP(svc.period).slice(1) : `Per ${periodLabel(svc.period)}`) : L("Total", "Összesen")}</span><span>{huf(total)}</span>
                </div>
                <div style={{ fontFamily: B, fontSize: 11, color: C.inkFaint, marginTop: 7, lineHeight: 1.6 }}>
                  {isSub
                    ? <>🔁 {cadenceLabel(svc.period, day)} · {slot} · {L("first visit", "első alkalom:")} {dayLabel(day?.iso)}<br />📍 {addr} · {isLive ? L("💳 Card per visit", "💳 Kártya alkalmanként") : L("💵 Cash each visit (demo)", "💵 Készpénz minden alkalommal (demo)")} · {L("renews after each visit", "minden alkalom után megújul")}</>
                    : <>📅 {day?.label || dayLabel(day?.iso)} · {slot}<br />📍 {addr} · {isLive ? L("💳 Card payment", "💳 Kártyás fizetés") : L("💵 Cash (demo)", "💵 Készpénz (demo)")}</>}
                </div>
              </div>
              {svc.tasks?.length > 0 && (
                <div style={{ background: C.card, borderRadius: 15, padding: 14, marginTop: 10, boxShadow: "0 1px 6px rgba(20,28,58,.04)" }}>
                  <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12, color: C.ink, marginBottom: 8 }}>{L(`Cleaner will complete (${svc.tasks.length} tasks)`, `A takarító elvégzi (${svc.tasks.length} feladat)`)}</div>
                  {svc.tasks.map((t, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: B, fontSize: 11.5, color: C.inkSoft, marginBottom: 5 }}>
                      <span style={{ color: C.mint, fontWeight: 700 }}>✓</span>{t}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {payWait && (
          <PaymentWait
            url={payWait.url}
            check={() => getPaymentStatus(payWait.row.id)}
            onPaid={() => { toast(L("Payment received 🎉", "Sikeres fizetés 🎉")); onBooked(payWait.row); }}
            onCancel={async () => { await cancelBooking(payWait.row.id); toast(L("Booking cancelled — nothing was charged", "Foglalás lemondva — nem történt terhelés")); close(); }}
          />
        )}
        <div style={{ padding: "12px 22px calc(22px + env(safe-area-inset-bottom))", borderTop: `1px solid ${C.line}`, display: "flex", gap: 10 }}>
          {step > 0 && <Btn ghost onClick={() => setStep(step - 1)}>←</Btn>}
          <Btn full disabled={!canNext || busy || (step === 3 && reqList.length > 0 && !reqAck)} onClick={async () => {
            if (step < 3) { setStep(step + 1); return; }
            setBusy(true);
            const row = await createBooking({ companyId: company.id, service: svc, date: day.iso, slot, address: addr, note, total, pricingType: svc.pricing_type, hours: isHourly ? hours : null, units: isUnit ? units : null, period: isSub ? svc.period : null, requirementsAck: reqList.length > 0 ? reqAck : undefined });
            setBusy(false);
            if (!row) { toast(L("Booking failed — try again", "A foglalás nem sikerült — próbáld újra"), "error"); return; }
            // Card + live backend + one-off booking → provider checkout (Stripe/SimplePay/Barion) in the browser
            if (isLive && !isSub) { // live = card only (no cash handling on the platform)
              const pay = await startPayment(row.id);
              if (pay?.gatewayUrl) {
                window.open(pay.gatewayUrl, "_blank");
                setPayWait({ row, url: pay.gatewayUrl });
                return;
              }
              toast(L("Card payment unavailable — pay on completion instead", "A kártyás fizetés most nem elérhető — fizess a szolgáltatás után"), "error");
            }
            onBooked(row);
          }}>
            {busy ? L("Booking…", "Foglalás…") : step < 3 ? L("Continue", "Tovább") : isSub ? `${L("Subscribe", "Előfizetek")} · ${huf(total)}/${periodShort(svc.period)}` : `${L("Confirm", "Foglalás")} · ${huf(total)}`}
          </Btn>
        </div>
      </div>
    </div>
  );
}

function CustomerBookings({ openBooking }) {
  const { session, bookings, allEmployees, companies, reviews, cancelBooking, addReview, submitComplaint, startPayment, fetchSubscriptions, subscriptionAction } = useStore();
  const toast = useToast();
  const mine = bookings.filter((b) => b.customer_id === session.userId || b.customer_name === session.name);
  const [plans, setPlans] = useState([]);
  const [cancelPlan, setCancelPlan] = useState(null);
  const reloadPlans = React.useCallback(() => { fetchSubscriptions().then(setPlans); }, []);
  React.useEffect(() => { reloadPlans(); }, []);
  const [reviewing, setReviewing] = useState(null);
  const [stars, setStars] = useState(5);
  const [body, setBody] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(null);
  const [complaining, setComplaining] = useState(null);
  const [googlePrompt, setGooglePrompt] = useState(null);
  const [compSubject, setCompSubject] = useState("");
  const [compBody, setCompBody] = useState("");
  const [showReports, setShowReports] = useState(false);
  const [trackId, setTrackId] = useState(null);

  return (
    <div className="cl-fade" style={{ padding: "calc(20px + env(safe-area-inset-top)) 20px 30px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "8px 0 18px" }}>
        <div style={{ fontFamily: F, fontWeight: 700, fontSize: 21, color: C.ink }}>{L("My bookings", "Foglalásaim")}</div>
        <button onClick={() => setShowReports(true)} style={{ fontFamily: B, fontWeight: 700, fontSize: 11.5, padding: "7px 13px", borderRadius: 99, border: `1.5px solid ${C.line}`, background: C.card, color: C.navySoft, cursor: "pointer" }}>🛟 {L("My reports", "Bejelentéseim")}</button>
      </div>
      {showReports && <CustomerReports close={() => setShowReports(false)} />}
      {trackId && <TrackSheet bookingId={trackId} booking={(bookings || []).find((x) => x.id === trackId)} close={() => setTrackId(null)} />}

      {/* ── 3.4 Recurring plans — the schedule itself, not just its bookings ── */}
      {plans.filter((p) => p.status !== "cancelled").length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.inkSoft, marginBottom: 8 }}>{L("Recurring plans", "Ismétlődő csomagok")}</div>
          {plans.filter((p) => p.status !== "cancelled").map((p) => (
            <div key={p.id} style={{ background: C.card, borderRadius: 18, padding: "13px 15px", marginBottom: 9, boxShadow: "0 2px 10px rgba(20,28,58,.06)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13.5, color: C.ink }}>{p.company_emoji || "🫧"} {p.company_name}</div>
                  <div style={{ fontFamily: B, fontSize: 11.5, color: C.inkSoft, marginTop: 3 }}>
                    {p.frequency === "weekly" ? L("Every week", "Hetente") : p.frequency === "biweekly" ? L("Every 2 weeks", "Kéthetente") : L("Every month", "Havonta")} · {p.slot}
                  </div>
                  <div style={{ fontFamily: B, fontSize: 11, color: C.inkFaint, marginTop: 3 }}>
                    {p.status === "paused"
                      ? L("Paused", "Szüneteltetve")
                      : p.next_date ? L("Next: ", "Következő: ") + String(p.next_date).slice(0, 10) : L("Scheduling…", "Ütemezés…")}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <button onClick={async () => {
                    const r = await subscriptionAction(p.id, p.status === "paused" ? "resume" : "pause");
                    if (r?.error) toast(r.error, "error");
                    else { toast(p.status === "paused" ? L("Plan resumed", "Csomag folytatva") : L("Plan paused", "Csomag szüneteltetve")); reloadPlans(); }
                  }} style={{ fontFamily: B, fontWeight: 700, fontSize: 11, padding: "6px 12px", borderRadius: 99, border: `1.5px solid ${C.line}`, background: C.bg, color: C.navySoft, cursor: "pointer" }}>
                    {p.status === "paused" ? L("Resume", "Folytatás") : L("Pause", "Szünet")}
                  </button>
                  <button onClick={() => setCancelPlan(p)} style={{ fontFamily: B, fontWeight: 700, fontSize: 11, padding: "6px 12px", borderRadius: 99, border: `1.5px solid ${C.coral}`, background: C.card, color: C.coral, cursor: "pointer" }}>
                    {L("Cancel plan", "Lemondás")}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {cancelPlan && (
        <ConfirmDialog
          title={L("Cancel this plan?", "Lemondod a csomagot?")}
          body={L("Future visits will be cancelled and anything already paid for them refunded in full.", "A jövőbeli alkalmakat lemondjuk, és a már kifizetett összeget teljes egészében visszatérítjük.")}
          confirmLabel={L("Cancel plan", "Csomag lemondása")}
          onCancel={() => setCancelPlan(null)}
          onConfirm={async () => {
            const r = await subscriptionAction(cancelPlan.id, "cancel");
            setCancelPlan(null);
            if (r?.error) toast(r.error, "error");
            else { toast(L("Plan cancelled", "Csomag lemondva")); reloadPlans(); }
          }} />
      )}
      {mine.length === 0 && (
        <div style={{ textAlign: "center", padding: "70px 30px" }}>
          <div style={{ width: 88, height: 88, borderRadius: 28, background: C.card, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 38, boxShadow: "0 4px 18px rgba(20,28,58,.07)" }}>🫧</div>
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 16, color: C.ink, marginTop: 18 }}>{L("Nothing booked yet", "Még nincs foglalásod")}</div>
          <div style={{ fontFamily: B, fontSize: 12.5, color: C.inkSoft, marginTop: 8 }}>{L("Book your first clean from the Home tab.", "Foglald le az első takarítást a Főoldal fülről.")}</div>
        </div>
      )}
      {mine.map((b) => {
        // API mode delivers assigned_name on the row; demo mode looks it up in the full staff list
        const cleanerName = b.assigned_name || allEmployees.find((e) => e.id === b.assigned_to)?.full_name;
        const co = companies.find((c) => c.id === b.company_id);
        const reviewed = reviews.some((r) => r.booking_id === b.id);
        const svc = b.service_snapshot || {};
        return (
          <div key={b.id} className="cl-rise" style={{ background: C.card, borderRadius: 22, padding: 18, marginBottom: 14, boxShadow: "0 4px 18px rgba(20,28,58,.07)", opacity: (b.status === 9 || b.status === 8) ? .65 : 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div style={{ width: 40, height: 40, borderRadius: 13, background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19 }}>{svc.icon || "🧽"}</div>
                <div>
                  <div style={{ fontFamily: F, fontWeight: 700, fontSize: 14.5, color: C.ink }}>{svc.name}</div>
                  <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft, marginTop: 1 }}>{co ? `${co.emoji} ${co.name}` : ""}</div>
                </div>
              </div>
              <>{b.payment_status === "paid" && <Pill bg={C.mintSoft} color={C.green}>💳 Paid</Pill>} <StatusPill status={b.status} fulfilment={b.fulfilment} /></>
            </div>

            {b.status !== 9 && b.status !== 8 && (
              <>
                <div style={{ display: "flex", alignItems: "center", margin: "16px 2px 5px" }}>
                  {stageList().map((s, k) => (
                    <React.Fragment key={s}>
                      <div style={{ width: 12, height: 12, borderRadius: "50%", flexShrink: 0, background: k <= b.status ? C.mint : C.line, boxShadow: k === b.status ? `0 0 0 5px ${C.mint}33` : "none", transition: "all .3s" }} />
                      {k < stageList().length - 1 && <div style={{ flex: 1, height: 3, borderRadius: 9, background: k < b.status ? C.mint : C.line }} />}
                    </React.Fragment>
                  ))}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontFamily: B, fontSize: 9, fontWeight: 700, color: C.inkFaint, marginBottom: 12 }}>
                  <span>{L("Booked", "Foglalva")}</span><span>{L("Done", "Kész")}</span>
                </div>
              </>
            )}

            {b.status === 8 && (
              <div style={{ background: C.coralSoft, border: "1px solid #FFD8D1", borderRadius: 13, padding: "10px 13px", marginTop: 12, fontFamily: B, fontSize: 11.5, color: C.coralText, lineHeight: 1.55 }}>
                ✕ <b>{L("Declined by", "Elutasította:")} {co?.name || L("the company", "a cég")}.</b>{b.decline_reason ? ` ${b.decline_reason}.` : ""} {L("Try another time or company.", "Próbálj másik időpontot vagy céget.")}
              </div>
            )}

            {cleanerName && b.status > 0 && b.status < 8 && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.bg, borderRadius: 13, padding: "10px 13px", marginBottom: 10 }}>
                <Avatar name={cleanerName} size={32} />
                <div style={{ fontFamily: B, fontSize: 11.5, color: C.inkSoft }}>
                  <b style={{ color: C.ink, fontFamily: F }}>{cleanerName}</b>{L(" is your cleaner", " a takarítód")}{b.pricing_type === "subscription" ? L(" — they stay with your plan", " — ő marad az előfizetésednél") : ""}
                </div>
              </div>
            )}
            {canTrack(b) && (
              <Btn small ghost style={{ width: "100%", marginBottom: 10 }} onClick={() => setTrackId(b.id)}>
                {b.fulfilment === "collection" && Number(b.status) === 6
                  ? L("Track the return on map", "Visszaút követése a térképen")
                  : L("Track cleaner on map", "Takarító követése a térképen")}
              </Btn>
            )}

            {b.pricing_type === "subscription" && b.status !== 9 && b.status !== 8 && (
              <div style={{ background: C.mintSoft, borderRadius: 13, padding: "9px 13px", marginBottom: 10, fontFamily: B, fontSize: 11.5, color: C.greenDeep, fontWeight: 600, lineHeight: 1.5 }}>
                {L(`🔁 Active subscription — repeats ${everyP(b.period)}.`, `🔁 Aktív előfizetés — ${everyP(b.period)} ismétlődik.`)} {L("Next visit", "Következő:")} {dayLabel(b.scheduled_date)} · {b.scheduled_slot}.
              </div>
            )}

            <div style={{ fontFamily: B, fontSize: 11.5, color: C.inkSoft, lineHeight: 1.7, background: C.bg, borderRadius: 13, padding: "10px 13px" }}>
              📅 {dayLabel(b.scheduled_date)} · {b.scheduled_slot} · 📍 {b.address}<br />
              💰 {huf(b.total_huf)}{b.pricing_type === "hourly" && b.hours ? ` · ⏱ ${b.hours} ${L("h", "óra")}` : b.pricing_type === "subscription" && b.period ? ` · 🔁 ${everyP(b.period)}` : ""} {b.customer_type === "student" && L("· 🎓 student price", "· 🎓 diákár")}
            </div>

            {b.fulfilment === "collection" && b.return_date && b.status !== 8 && b.status !== 9 && (
              <div style={{ background: C.navyChip, borderRadius: 12, padding: "9px 12px", marginTop: 9, fontFamily: B, fontSize: 11.5, color: C.ink }}>
                🚚 {Number(b.status) >= 4
                  ? L("Returned to you", "Visszahoztuk")
                  : `${L("Back with you on", "Nálad lesz")} ${dayLabel(b.return_date)}`}
              </div>
            )}
            <CustomerInvoiceLine booking={b} />

            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              {b.status !== 9 && b.status !== 8 && <AddToCalendar booking={b} />}
              {b.status <= 1 && canStillCancel(b) && (
                <Btn small ghost style={{ flex: 1, color: C.coral, borderColor: C.line }} onClick={() => setConfirmCancel(b)}>{b.pricing_type === "subscription" ? L("Cancel subscription", "Előfizetés lemondása") : L("Cancel booking", "Foglalás lemondása")}</Btn>
              )}
              {b.status === 4 && !reviewed && <Btn small mint style={{ flex: 1 }} onClick={() => { setReviewing(b); setStars(5); setBody(""); }}>{L("Rate this clean", "Értékeld a takarítást")}</Btn>}
              {b.status === 4 && reviewed && <Pill style={{ alignSelf: "center" }}>{L("Thanks for your review ⭐", "Köszönjük az értékelést ⭐")}</Pill>}
              {(b.status === 4 || b.status === 8 || b.status === 9) && b.pricing_type !== "subscription" && co && openBooking && (
                <Btn small ghost style={{ flex: 1 }} onClick={() => openBooking(co)}>{L("Rebook", "Újrafoglalás")}</Btn>
              )}
              {b.status >= 1 && b.status !== 9 && (
                <Btn small ghost style={{ flex: 1 }} onClick={() => setComplaining(b)}>{L("Report", "Bejelentés")}</Btn>
              )}
              {b.invoice && (
                <a href={b.invoice.data} download={b.invoice.name} style={{ flex: 1, textAlign: "center", fontFamily: B, fontWeight: 700, fontSize: 12, padding: "9px 0", borderRadius: 99, border: `1.5px solid ${C.mint}`, color: C.green, textDecoration: "none" }}>{L("Invoice", "Számla")}</a>
              )}
              {isLive && b.payment_status !== "paid" && b.status !== 9 && b.status !== 8 && (
                <Btn small mint style={{ flex: 1 }} onClick={async () => {
                  const pay = await startPayment(b.id);
                  if (pay?.gatewayUrl) { window.open(pay.gatewayUrl, "_blank"); toast(L("Finish the payment in the opened window, then pull to refresh", "Fejezd be a fizetést a megnyílt ablakban, majd frissíts")); }
                  else toast(pay?.error || L("Payment unavailable right now", "A fizetés most nem elérhető"), "error");
                }}>{L("Pay now", "Fizetés most")}</Btn>
              )}
            </div>
          </div>
        );
      })}

      {confirmCancel && (
        <ConfirmDialog
          title={L("Cancel this booking?", "Lemondod a foglalást?")}
          body={L(`Your booking with ${companies.find((c) => c.id === confirmCancel.company_id)?.name || "the company"} will be cancelled. This can't be undone.`, `A(z) ${companies.find((c) => c.id === confirmCancel.company_id)?.name || "cég"} felé leadott foglalásod törlésre kerül. Ez nem vonható vissza.`)}
          confirmLabel={L("Yes, cancel", "Igen, lemondom")}
          onConfirm={() => { cancelBooking(confirmCancel.id); toast(L("Booking cancelled", "Foglalás lemondva")); setConfirmCancel(null); }}
          onCancel={() => setConfirmCancel(null)}
        />
      )}

      {googlePrompt && (
        <ConfirmDialog
          title={L("Loved it? Tell Google too ⭐", "Tetszett? Mondd el a Google-ön is ⭐")}
          body={L(`A Google review helps ${googlePrompt.name} get found by more people. It takes 30 seconds.`, `Egy Google-értékelés segít, hogy többen megtalálják: ${googlePrompt.name}. 30 másodperc az egész.`)}
          confirmLabel={L("Review on Google", "Értékelés Google-ön")}
          onCancel={() => setGooglePrompt(null)}
          onConfirm={() => { window.open(`https://search.google.com/local/writereview?placeid=${googlePrompt.google_place_id}`, "_blank"); setGooglePrompt(null); }}
        />
      )}

      {complaining && (
        <Sheet title={L("Report a problem", "Probléma bejelentése")} close={() => setComplaining(null)}>
          <div style={{ fontFamily: B, fontSize: 12, color: C.inkSoft, marginBottom: 14, lineHeight: 1.6 }}>
            {L("Tell us what went wrong — the Cleano team reviews every report.", "Írd le, mi történt — a Cleano csapata minden bejelentést átnéz.")}
          </div>
          <Field label={L("Subject", "Tárgy")} placeholder={L("e.g. Cleaner arrived late", "pl. A takarító késett")} value={compSubject} onChange={(e) => setCompSubject(e.target.value)} />
          <Field area label={L("Details", "Részletek")} placeholder={L("What happened?", "Mi történt?")} value={compBody} onChange={(e) => setCompBody(e.target.value)} />
          <Btn full disabled={!compSubject.trim()} onClick={async () => {
            const r = await submitComplaint({ bookingId: complaining.id, subject: compSubject, body: compBody });
            if (r?.error) toast(r.error, "error");
            else toast(L("Report sent — we'll get back to you", "Bejelentés elküldve — hamarosan jelentkezünk"));
            setComplaining(null); setCompSubject(""); setCompBody("");
          }}>{L("Send report", "Bejelentés küldése")}</Btn>
        </Sheet>
      )}

      {reviewing && (
        <Sheet title={L("How was your clean?", "Milyen volt a takarítás?")} close={() => setReviewing(null)}>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", margin: "6px 0 18px" }}>
            {[1, 2, 3, 4, 5].map((n) => <Star key={n} size={34} filled={n <= stars} onClick={() => setStars(n)} />)}
          </div>
          <Field area placeholder={L("What stood out? (optional)", "Mi tetszett? (opcionális)")} value={body} onChange={(e) => setBody(e.target.value)} />
          <Btn full onClick={() => {
            addReview({ bookingId: reviewing.id, companyId: reviewing.company_id, stars, body });
            const co2 = companies.find((c) => c.id === reviewing.company_id);
            toast(L("Review submitted — thank you!", "Értékelés elküldve — köszönjük!"));
            if (co2?.google_place_id && stars >= 4) setGooglePrompt(co2);
            setReviewing(null);
          }}>
            {L("Submit review", "Értékelés küldése")}
          </Btn>
        </Sheet>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   EMPLOYEE
════════════════════════════════════════════════════════════ */

function EmployeeJobs({ openProfile }) {
  const { session, bookings, toggleTask, setStatus, companies, reviews } = useStore();
  const toast = useToast();
  const my = bookings.filter((b) => b.assigned_to === session.userId && b.status !== 9 && b.status !== 8);
  const open = my.filter((b) => b.status < 4);
  const done = my.filter((b) => b.status >= 4);
  const co = companies.find((c) => c.id === session.companyId);
  const myReviews = reviews.filter((r) => done.some((b) => b.id === r.booking_id));
  const isoOf = (x) => String(x).slice(0, 10);
  const todayIso = new Date().toISOString().slice(0, 10);
  const todays = open.filter((b) => isoOf(b.scheduled_date) === todayIso)
    .sort((a, b) => String(a.scheduled_slot).localeCompare(String(b.scheduled_slot)));
  const calDays = React.useMemo(() => {
    const out = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(); d.setDate(d.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      out.push({ iso, isToday: i === 0, dom: d.getDate(),
        dow: d.toLocaleDateString(LOC(), { weekday: "narrow" }),
        jobs: open.filter((b) => isoOf(b.scheduled_date) === iso) });
    }
    return out;
  }, [bookings, session.userId]);
  const avgRating = myReviews.length ? (myReviews.reduce((a, r) => a + r.stars, 0) / myReviews.length).toFixed(1) : null;

  return (
    <div className="cl-fade">
      <div style={{ background: `radial-gradient(140% 120% at 20% 0%, ${C.navyMid}, ${C.navyDeep} 75%)`, padding: "calc(24px + env(safe-area-inset-top)) 20px 40px", position: "relative", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={openProfile} style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }} aria-label={L("Profile", "Profil")}>
            <Avatar name={session.name} color="#fff" size={44} />
          </button>
          <div>
            <div style={{ fontFamily: F, fontWeight: 700, fontSize: 18, color: "#fff" }}>{session.name}</div>
            <div style={{ fontFamily: B, fontSize: 11, color: "#9FB0E8", marginTop: 2 }}>{co ? `${co.emoji} ${co.name}` : "Cleaner"}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          {[
            { k: L("Open jobs", "Nyitott munkák"), v: open.length },
            { k: L("Completed", "Elvégzett"), v: done.length },
            { k: L("Rating", "Értékelés"), v: avgRating ? `${avgRating} ★` : "—" },
          ].map((s) => (
            <div key={s.k} style={{ flex: 1, background: "rgba(255,255,255,.1)", borderRadius: 15, padding: "11px 12px" }}>
              <div style={{ fontFamily: F, fontWeight: 700, fontSize: 16, color: "#fff" }}>{s.v}</div>
              <div style={{ fontFamily: B, fontSize: 9.5, color: "#9FB0E8", marginTop: 3, fontWeight: 600 }}>{s.k}</div>
            </div>
          ))}
        </div>
      </div>
      <svg viewBox="0 0 375 26" style={{ display: "block", marginTop: -25, width: "100%", position: "relative" }} preserveAspectRatio="none">
        <path d="M0 26 L0 14 C 95 32 280 32 375 14 L375 26 Z" fill={C.bg} />
      </svg>

      <div style={{ padding: "8px 20px 30px" }}>
        {/* ── 5.6 What you're doing today, before anything else ── */}
        {todays.length > 0 && (
          <div style={{ background: C.navy, borderRadius: 22, padding: 18, marginBottom: 16, boxShadow: "0 6px 20px rgba(27,42,107,.22)" }}>
            <div style={{ fontFamily: F, fontWeight: 700, fontSize: 15, color: "#fff" }}>
              {L("Today", "Ma")} · {todays.length} {todays.length === 1 ? L("job", "munka") : L("jobs", "munka")}
            </div>
            {todays.map((b) => (
              <div key={b.id} style={{ display: "flex", gap: 11, alignItems: "flex-start", marginTop: 12 }}>
                <div style={{ background: "rgba(255,255,255,.14)", borderRadius: 11, padding: "6px 9px", fontFamily: F, fontWeight: 700, fontSize: 13, color: "#fff", flexShrink: 0 }}>{b.scheduled_slot}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: B, fontWeight: 700, fontSize: 12.5, color: "#fff" }}>{(b.service_snapshot || {}).name}</div>
                  <div style={{ fontFamily: B, fontSize: 11, color: "#9FB0E8", marginTop: 2, lineHeight: 1.5 }}>{b.address}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── 5.6 The week ahead, so nothing is a surprise ── */}
        {open.length > 0 && (
          <div style={{ background: C.card, borderRadius: 20, padding: "14px 16px", marginBottom: 16, boxShadow: "0 2px 12px rgba(20,28,58,.05)" }}>
            <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13.5, color: C.ink, marginBottom: 10 }}>{L("Next 14 days", "Következő 14 nap")}</div>
            <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2, WebkitOverflowScrolling: "touch" }}>
              {calDays.map((d) => (
                <div key={d.iso} style={{ flex: "0 0 auto", width: 44, textAlign: "center", borderRadius: 13, padding: "8px 0",
                  background: d.isToday ? C.navy : d.jobs.length ? C.navyChip : C.bg }}>
                  <div style={{ fontFamily: B, fontSize: 9.5, fontWeight: 700, color: d.isToday ? "#9FB0E8" : C.inkFaint }}>{d.dow}</div>
                  <div style={{ fontFamily: F, fontWeight: 700, fontSize: 14, color: d.isToday ? "#fff" : C.ink, marginTop: 1 }}>{d.dom}</div>
                  <div style={{ height: 5, marginTop: 4, display: "flex", gap: 2, justifyContent: "center" }}>
                    {d.jobs.slice(0, 3).map((_, i) => (
                      <span key={i} style={{ width: 4, height: 4, borderRadius: 99, background: d.isToday ? "#fff" : C.navy, display: "block" }} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ fontFamily: F, fontWeight: 700, fontSize: 16, color: C.ink, margin: "8px 0 12px" }}>{L("My jobs", "Munkáim")}</div>
        {open.length === 0 && (
          <div style={{ textAlign: "center", padding: "44px 30px", background: C.card, borderRadius: 20, boxShadow: "0 2px 12px rgba(20,28,58,.05)" }}>
            <div style={{ fontSize: 36 }}>🛋️</div>
            <div style={{ fontFamily: F, fontWeight: 700, fontSize: 14.5, color: C.ink, marginTop: 12 }}>{L("No jobs assigned", "Nincs kiosztott munka")}</div>
            <div style={{ fontFamily: B, fontSize: 12, color: C.inkSoft, marginTop: 6 }}>{L("New assignments appear here automatically.", "Az új megbízások automatikusan itt jelennek meg.")}</div>
          </div>
        )}
        {open.map((b) => {
          const svc = b.service_snapshot || {};
          const tasks = svc.tasks || [];
          const allDone = tasks.length > 0 && b.tasks_done.length === tasks.length;
          return (
            <div key={b.id} className="cl-rise" style={{ background: C.card, borderRadius: 22, padding: 18, marginBottom: 14, boxShadow: "0 4px 18px rgba(20,28,58,.07)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontFamily: F, fontWeight: 700, fontSize: 15, color: C.ink }}>{svc.icon} {svc.name}</div>
                  <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft, marginTop: 4, lineHeight: 1.6 }}>
                    🕘 {dayLabel(b.scheduled_date)}, {b.scheduled_slot} · ⏱ ~{svc.minutes} min<br />
                    📍 {b.address} · 👤 {b.customer_name || "Customer"}
                  </div>
                </div>
                <StatusPill status={b.status} fulfilment={b.fulfilment} />
              </div>

              {b.note && (
                <div style={{ background: "#FFF8EA", border: `1px solid ${C.gold}55`, borderRadius: 13, padding: "10px 13px", marginTop: 12, fontFamily: B, fontSize: 11.5, color: "#8A6A1F", lineHeight: 1.55 }}>
                  📝 <b>Customer note:</b> {b.note}
                </div>
              )}

              {tasks.length > 0 && b.status >= 3 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 9 }}>
                    <span style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink }}>{L("Task checklist", "Feladatlista")}</span>
                    <span style={{ fontFamily: B, fontSize: 10.5, fontWeight: 700, color: allDone ? C.green : C.inkFaint }}>{b.tasks_done.length}/{tasks.length}</span>
                  </div>
                  <div style={{ marginBottom: 11 }}><Progress done={b.tasks_done.length} total={tasks.length} /></div>
                  {tasks.map((t, i) => {
                    const isDone = b.tasks_done.includes(i);
                    return (
                      <button key={i} onClick={() => toggleTask(b.id, i)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: 13, marginBottom: 6, border: "none", cursor: "pointer", background: isDone ? C.mintSoft : C.bg, textAlign: "left" }}>
                        <span style={{ width: 21, height: 21, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", background: isDone ? C.mint : C.card, border: isDone ? "none" : `1.5px solid ${C.line}`, fontSize: 11, fontWeight: 700, color: C.navyDeep, flexShrink: 0 }}>{isDone ? "✓" : ""}</span>
                        <span style={{ fontFamily: B, fontSize: 12.5, color: isDone ? C.green : C.ink, textDecoration: isDone ? "line-through" : "none", fontWeight: 500 }}>{t}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              <div style={{ marginTop: 12 }}>
                <div style={{ marginBottom: 8 }}><AddToCalendar booking={b} /></div>
                {b.status === 1 && <Btn small full onClick={() => { setStatus(b.id, 2); toast(L("Status updated — on the way!", "Állapot frissítve — úton vagy!")); }}>🚗 {L("I'm on the way", "Úton vagyok")}</Btn>}
                {/* A collection job goes: on the way → collected → in progress →
                    out for return → returned. Nothing says "done" until it is back. */}
                {b.fulfilment === "collection" ? (
                  <>
                    {b.status === 2 && <Btn small full onClick={() => { setStatus(b.id, 5); toast(L("Items collected", "Holmi elvive")); }}>📦 {L("I've collected the items", "Elvittem a holmit")}</Btn>}
                    {b.status === 5 && <Btn small full onClick={() => { setStatus(b.id, 3); toast(L("Work started", "Munka elkezdve")); }}>🧺 {L("Start the work", "Munka indítása")}</Btn>}
                    {b.status === 3 && <Btn small full onClick={() => { setStatus(b.id, 6); toast(L("On the way back", "Úton vissza")); }}>🚚 {L("Taking it back", "Viszem vissza")}</Btn>}
                    {b.status === 6 && <Btn small full mint onClick={() => { setStatus(b.id, 4); toast(L("Returned to the customer ✓", "Visszaadva az ügyfélnek ✓")); }}>✓ {L("Returned to the customer", "Visszaadva az ügyfélnek")}</Btn>}
                  </>
                ) : (
                  b.status === 2 && <Btn small full onClick={() => { setStatus(b.id, 3); toast(L("Cleaning started", "Takarítás elkezdve")); }}>🧽 {L("Start cleaning", "Takarítás indítása")}</Btn>
                )}
                {canTrack(b) && <LocationShare bookingId={b.id} />}
                {b.status === 3 && b.fulfilment !== "collection" && (
                  <Btn small full mint disabled={!allDone && tasks.length > 0} onClick={() => { setStatus(b.id, 4); toast(L("Job completed ✓", "Munka kész ✓")); }}>
                    {allDone || tasks.length === 0 ? `✓ ${L("Complete job", "Munka befejezése")}` : `${L("Finish all tasks", "Fejezd be az összes feladatot")} (${b.tasks_done.length}/${tasks.length})`}
                  </Btn>
                )}
              </div>
            </div>
          );
        })}

        {done.length > 0 && (
          <>
            <div style={{ fontFamily: F, fontWeight: 700, fontSize: 14, color: C.inkSoft, margin: "16px 0 10px" }}>{L("Completed", "Elvégzett")}</div>
            {done.map((b) => (
              <div key={b.id} style={{ background: C.card, borderRadius: 16, padding: "13px 16px", marginBottom: 9, display: "flex", justifyContent: "space-between", alignItems: "center", boxShadow: "0 1px 6px rgba(20,28,58,.04)", opacity: .8 }}>
                <div>
                  <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13, color: C.ink }}>{(b.service_snapshot || {}).name}</div>
                  <div style={{ fontFamily: B, fontSize: 10.5, color: C.inkFaint, marginTop: 2 }}>{b.customer_name} · {dayLabel(b.scheduled_date)}</div>
                </div>
                <Pill>Done ✨</Pill>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function EmployeeNotices() {
  const { session, notices, markNoticeRead, deleteNotice, companies, sendCompanyMessage } = useStore();
  const toast = useToast();
  const mine = notices.filter((n) => n.to_employee === session.userId);
  const unread = mine.filter((n) => !n.is_read).length;
  const co = companies.find((c) => c.id === session.companyId);
  const [reply, setReply] = useState("");

  return (
    <div className="cl-fade" style={{ padding: "calc(20px + env(safe-area-inset-top)) 20px 30px" }}>
      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 21, color: C.ink, margin: "8px 0 18px" }}>
        From {co?.name || "your company"} {unread > 0 && <Pill bg={C.coral} color="#fff" style={{ marginLeft: 6 }}>{unread} new</Pill>}
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder={L("Message your company…", "Írj a cégednek…")} style={{ flex: 1, border: `1.5px solid ${C.line}`, borderRadius: 14, padding: "11px 14px", fontFamily: B, fontSize: 13, color: C.ink, background: C.card, outline: "none" }} />
        <Btn small mint disabled={!reply.trim()} onClick={async () => { const r = await sendCompanyMessage(reply.trim()); if (r?.error) toast(r.error, "error"); else { toast(L("Message sent to your company", "Üzenet elküldve a cégednek")); setReply(""); } }}>Send</Btn>
      </div>
      {mine.length === 0 && <div style={{ fontFamily: B, fontSize: 13, color: C.inkSoft, textAlign: "center", padding: 50 }}>{L("No messages from your company yet.", "Még nincs üzenet a cégedtől.")}</div>}
      {mine.map((n) => (
        <div key={n.id} onClick={() => { if (!n.from_employee && !n.is_read) { markNoticeRead(n.id); toast("Marked as read"); } }} style={{ background: n.from_employee ? C.mintSoft : C.card, borderRadius: 18, padding: 16, marginBottom: 12, boxShadow: "0 2px 12px rgba(20,28,58,.06)", border: (n.from_employee || n.is_read) ? "2px solid transparent" : `2px solid ${C.mint}`, cursor: (n.from_employee || n.is_read) ? "default" : "pointer" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", gap: 9, alignItems: "center" }}>
              {n.from_employee ? <div style={{ width: 32, height: 32, borderRadius: 10, background: C.mint, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>🧽</div> : <CompanyLogo co={co} size={32} radius={10} />}
              <span style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink }}>{n.from_employee ? "You → company" : (co?.name || "Company")}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontFamily: B, fontSize: 10, color: C.inkFaint }}>{typeof n.created_at === "string" && n.created_at.length < 25 ? n.created_at : new Date(n.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
              <button onClick={(e) => { e.stopPropagation(); deleteNotice(n.id); toast(L("Notice cleared", "Értesítés törölve")); }}
                title={L("Clear from my list", "Törlés a listámról")}
                style={{ border: "none", background: C.bg, color: C.inkFaint, width: 26, height: 26, borderRadius: 9, cursor: "pointer", fontSize: 12 }}>✕</button>
            </div>
          </div>
          <div style={{ fontFamily: B, fontSize: 13, color: C.inkSoft, lineHeight: 1.65, marginTop: 10 }}>{n.body}</div>
          {!n.from_employee && !n.is_read && <div style={{ fontFamily: B, fontSize: 10.5, fontWeight: 700, color: C.green, marginTop: 8 }}>Tap to mark as read ✓</div>}
        </div>
      ))}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   COMPANY
════════════════════════════════════════════════════════════ */

function CompanyJobs({ openProfile }) {
  const { session, bookings, employees, assignBooking, declineBooking, companies, uploadInvoice, archiveBooking, hideDeletedIdentity } = useStore();
  const [jobTrackId, setJobTrackId] = React.useState(null);
  // While any job is on-the-way/cleaning, poll faster so task ticks appear live
  const { refreshData } = useStore();
  const liveJob = bookings.some((x) => x.company_id === session.companyId && (x.status === 2 || x.status === 3));
  React.useEffect(() => {
    if (!liveJob) return;
    const iv = setInterval(() => refreshData?.(), 8000);
    return () => clearInterval(iv);
  }, [liveJob]);
  const toast = useToast();
  const [declining, setDeclining] = useState(null); // booking being declined
  const [reason, setReason] = useState("");
  const [filter, setFilter] = useState("all"); // all · new · unassigned · today · subs
  const co = companies.find((c) => c.id === session.companyId);
  const mine = bookings.filter((b) => b.company_id === session.companyId);
  const open = mine.filter((b) => b.status < 4 && b.status !== 9);
  const done = mine.filter((b) => b.status === 4 && !b.archived_by_company);
  const cancelled = mine.filter((b) => b.status === 9 || b.status === 8);
  const net = (b) => (b.total_huf || 0) - (b.service_fee_huf || 0); // company share (Cleano fee excluded)
  const revenue = done.reduce((a, b) => a + net(b), 0);
  const pipeline = open.reduce((a, b) => a + net(b), 0);
  const unassigned = open.filter((b) => !b.assigned_to).length;
  const todayISO2 = localISO(new Date());
  const isToday = (b) => String(b.scheduled_date).slice(0, 10) === todayISO2;
  const todayJobs = done.filter(isToday);
  const todayRevenue = todayJobs.reduce((a, b) => a + net(b), 0);
  const subs = open.filter((b) => b.pricing_type === "subscription");

  /* ── What actually needs the owner, right now ──────────────────────────
     "Open jobs" is a number that only ever goes up. These three buckets are
     the ones that cost money if ignored:
       · unaccepted — the customer has paid and nobody has agreed to come. The
         server auto-cancels and refunds these, so the clock is real revenue.
       · unassigned and starting soon — accepted, but no cleaner is going.
       · overdue — the slot has been and gone and nobody set off.            */
  const [, forceTick] = React.useState(0);
  const unaccepted = open.filter((b) => Number(b.status) === 0);
  React.useEffect(() => {
    if (!unaccepted.length) return;
    const iv = setInterval(() => forceTick((n) => n + 1), 30000);
    return () => clearInterval(iv);
  }, [unaccepted.length]);

  const msLeft = (b) => (b.accept_deadline ? Date.parse(b.accept_deadline) - Date.now() : null);
  const soonest = unaccepted.reduce((acc, b) => {
    const m = msLeft(b);
    return m != null && Number.isFinite(m) && (acc == null || m < acc) ? m : acc;
  }, null);
  const startsWithin = (b, h) => {
    const t = slotStartMs(b);
    return t != null && t - Date.now() > 0 && t - Date.now() <= h * 3600e3;
  };
  const unassignedSoon = open.filter((b) => Number(b.status) > 0 && !b.assigned_to && startsWithin(b, 24));
  const overdue = open.filter((b) => {
    const t = slotStartMs(b);
    return t != null && t < Date.now() && Number(b.status) < 2;
  });
  /* One job can land in two buckets — an unaccepted booking whose slot has
     already passed is both unaccepted AND overdue. Counting the raw
     concatenation told the owner "4 need you" when three jobs did, and a count
     that overstates is a count nobody trusts. Dedupe by id; the per-bucket
     lines below still explain the same job twice, which is correct because it
     is wrong in two ways. */
  const attention = [...new Map([...unaccepted, ...unassignedSoon, ...overdue].map((b) => [b.id, b])).values()];
  const needsAttention = attention.length;

  const shownOpen = open.filter((b) =>
    filter === "new" ? b.status === 0 :
    filter === "unassigned" ? !b.assigned_to :
    filter === "today" ? isToday(b) :
    filter === "attention" ? attention.some((x) => x.id === b.id) :
    filter === "subs" ? b.pricing_type === "subscription" : true
  );

  return (
    <div className="cl-fade" style={{ padding: "calc(20px + env(safe-area-inset-top)) 20px 30px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "8px 0 4px" }}>
        <div>
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 21, color: C.ink }}>{co?.name || "My company"}</div>
          <div style={{ fontFamily: B, fontSize: 11.5, color: C.inkSoft, marginTop: 2 }}>
            Admin · {new Date().toLocaleDateString(LOC(), { weekday: "long", day: "numeric", month: "short" })}
          </div>
        </div>
        <button onClick={openProfile} style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }} aria-label={L("Profile", "Profil")}>
          <CompanyLogo co={co} size={42} radius={14} />
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, margin: "16px 0" }}>
        {[
          { k: "Open jobs", v: open.length, accent: C.navy, sub: `${unassigned} unassigned` },
          { k: "Pipeline", v: huf(pipeline), accent: C.navySoft, sub: "potential revenue" },
          { k: "Total earned", v: huf(revenue), accent: C.green, sub: `${done.length} jobs done` },
          { k: "Today", v: huf(todayRevenue), accent: unassigned ? C.coral : C.navySoft, sub: `${todayJobs.length} completed today` },
        ].map((s) => (
          <div key={s.k} style={{ background: C.card, borderRadius: 16, padding: "13px 14px", boxShadow: "0 2px 10px rgba(20,28,58,.05)" }}>
            <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13.5, color: s.accent, lineHeight: 1.2 }}>{s.v}</div>
            <div style={{ fontFamily: F, fontWeight: 700, fontSize: 11, color: C.ink, marginTop: 4 }}>{s.k}</div>
            <div style={{ fontFamily: B, fontSize: 10, color: C.inkFaint, marginTop: 2 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {needsAttention > 0 && (
        <div style={{ background: C.amberSoft, border: `1.5px solid ${C.coral}44`, borderRadius: 14, padding: "12px 14px", marginBottom: 14 }}>
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.amber }}>
            {L("Needs you", "Rád vár")} · {needsAttention}
          </div>
          {unaccepted.length > 0 && (
            <div style={{ fontFamily: B, fontSize: 11.5, color: C.amber, marginTop: 6, lineHeight: 1.55 }}>
              <b>{unaccepted.length}</b> {L("paid and waiting for you to accept", "kifizetve, elfogadásra vár")}
              {soonest != null && soonest > 0 && <> — {L("the first is cancelled and refunded in", "az elsőt ennyi idő múlva lemondjuk és visszatérítjük:")} <b>{shortLeft(soonest)}</b></>}
              {soonest != null && soonest <= 0 && <> — {L("one is past its deadline", "az egyik már lejárt")}</>}
            </div>
          )}
          {unassignedSoon.length > 0 && (
            <div style={{ fontFamily: B, fontSize: 11.5, color: C.amber, marginTop: 5, lineHeight: 1.55 }}>
              <b>{unassignedSoon.length}</b> {L("start within 24 hours with no cleaner assigned", "24 órán belül kezdődik, kijelölt takarító nélkül")}
            </div>
          )}
          {overdue.length > 0 && (
            <div style={{ fontFamily: B, fontSize: 11.5, color: C.coralText || C.coral, marginTop: 5, lineHeight: 1.55 }}>
              <b>{overdue.length}</b> {L("should have started already", "már el kellett volna kezdődnie")}
            </div>
          )}
          {employees.length === 0 && (
            <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft, marginTop: 7 }}>
              {L("Add your cleaners in the Team tab before you can assign anyone.", "Előbb vedd fel a takarítókat a Csapat fülön, hogy ki tudd osztani a munkát.")}
            </div>
          )}
        </div>
      )}

      {subs.length > 0 && (
        <div style={{ background: "linear-gradient(135deg,#EAFBF2,#E7F0FF)", borderRadius: 16, padding: "12px 15px", marginBottom: 14 }}>
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink }}>🔁 {subs.length} active subscription{subs.length > 1 ? "s" : ""} — recurring revenue {huf(subs.reduce((a, b) => a + (b.total_huf || 0), 0))} / cycle</div>
          <div style={{ fontFamily: B, fontSize: 10.5, color: C.inkSoft, marginTop: 3 }}>{L("Each completed visit automatically schedules the next one with the same cleaner.", "Minden teljesített alkalom automatikusan időpontot foglal a következőre, ugyanazzal a takarítóval.")}</div>
        </div>
      )}

      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 15.5, color: C.ink, marginBottom: 10 }}>{L("Incoming & active jobs", "Beérkező és folyamatban lévő munkák")}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {[
          { id: "attention", label: `⚠️ ${L("Needs you", "Rád vár")} (${needsAttention})`, hide: !needsAttention },
          { id: "all", label: `${L("All", "Mind")} (${open.length})` },
          { id: "new", label: `🆕 ${L("Not accepted", "Nincs elfogadva")} (${unaccepted.length})` },
          { id: "unassigned", label: `👤 ${L("No cleaner", "Nincs takarító")} (${unassigned})` },
          { id: "today", label: `📅 ${L("Today", "Ma")} (${open.filter(isToday).length})` },
          { id: "subs", label: `🔁 ${L("Plans", "Bérletek")} (${subs.length})` },
        ].filter((f) => !f.hide).map((f) => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{ fontFamily: B, fontWeight: 700, fontSize: 10.5, padding: "6px 11px", borderRadius: 99, border: "none", cursor: "pointer", background: filter === f.id ? C.navy : C.card, color: filter === f.id ? "#fff" : C.navySoft, boxShadow: "0 1px 4px rgba(20,28,58,.07)" }}>{f.label}</button>
        ))}
      </div>
      {shownOpen.length === 0 && <div style={{ fontFamily: B, fontSize: 12.5, color: C.inkSoft, textAlign: "center", padding: 36, background: C.card, borderRadius: 18, boxShadow: "0 2px 10px rgba(20,28,58,.04)" }}>{open.length === 0 ? L("No open jobs right now. New customer bookings will appear here.", "Most nincs nyitott munka. Az új foglalások itt jelennek meg.") : L("Nothing matches this filter.", "Semmi nem felel meg ennek a szűrőnek.")}</div>}
      {[...shownOpen].sort((a, b) => (a.assigned_to ? 1 : 0) - (b.assigned_to ? 1 : 0)).map((b) => {
        const svc = b.service_snapshot || {};
        const tasks = svc.tasks || [];
        return (
          <div key={b.id} style={{ background: C.card, borderRadius: 20, padding: 16, marginBottom: 12, boxShadow: "0 2px 12px rgba(20,28,58,.06)", border: !b.assigned_to ? `2px solid ${C.coral}55` : "2px solid transparent" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontFamily: F, fontWeight: 700, fontSize: 14.5, color: C.ink }}>{svc.icon} {svc.name}</div>
                <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft, marginTop: 4, lineHeight: 1.6 }}>
                  👤 {b.customer_name || "Customer"} {b.customer_type === "student" && "🎓"} · 🕘 {dayLabel(b.scheduled_date)}, {b.scheduled_slot}<br />
                  📍 {b.address}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <StatusPill status={b.status} fulfilment={b.fulfilment} />
                <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13.5, color: C.navy, marginTop: 7 }}>{huf(b.total_huf)}</div>
                {/* The clock the company could not see. Past zero we say so
                    plainly rather than showing a negative number. */}
                {Number(b.status) === 0 && b.accept_deadline && (() => {
                  const left = msLeft(b);
                  const urgent = left != null && left < 3 * 3600e3;
                  return (
                    <div style={{ marginTop: 6, display: "inline-block", background: urgent ? C.coralSoft : C.amberSoft, color: urgent ? (C.coralText || C.coral) : C.amber, borderRadius: 99, padding: "3px 9px", fontFamily: B, fontWeight: 700, fontSize: 10 }}>
                      {left != null && left > 0
                        ? `⏳ ${shortLeft(left)} ${L("to accept", "az elfogadásra")}`
                        : L("⏳ deadline passed", "⏳ határidő lejárt")}
                    </div>
                  );
                })()}
              </div>
            </div>

            {b.status >= 2 && tasks.length > 0 && (
              <div style={{ marginTop: 11 }}>
                <Progress done={b.tasks_done.length} total={tasks.length} />
                <div style={{ fontFamily: B, fontSize: 10, color: C.inkFaint, fontWeight: 700, marginTop: 5 }}>
                  {b.tasks_done.length}/{tasks.length} {L("tasks done on site", "feladat kész a helyszínen")}
                </div>
                {b.status >= 3 && (
                  <div style={{ marginTop: 8 }}>
                    {tasks.map((tk, i) => {
                      const dn = (b.tasks_done || []).includes(i);
                      return (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 2px" }}>
                          <span style={{ width: 16, height: 16, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", background: dn ? C.mint : C.bg, border: dn ? "none" : `1.5px solid ${C.line}`, fontSize: 9, fontWeight: 700, color: C.navyDeep, flexShrink: 0 }}>{dn ? "✓" : ""}</span>
                          <span style={{ fontFamily: B, fontSize: 11.5, color: dn ? C.green : C.inkSoft, textDecoration: dn ? "line-through" : "none" }}>{tk}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontFamily: B, fontSize: 10, fontWeight: 700, color: C.inkFaint }}>ASSIGN:</span>
              {employees.filter((e) => e.is_active !== false).map((m) => (
                <button key={m.id} onClick={() => { assignBooking(b.id, m.id); toast(`Assigned to ${m.full_name.split(" ")[0]}`); }} style={{ fontFamily: B, fontSize: 11, fontWeight: 700, padding: "6px 12px", borderRadius: 99, border: "none", cursor: "pointer", background: b.assigned_to === m.id ? C.navy : C.bg, color: b.assigned_to === m.id ? "#fff" : C.navySoft }}>
                  {b.assigned_to === m.id ? "✓ " : ""}{m.full_name.split(" ")[0]}
                </button>
              ))}
              {employees.length === 0 && <span style={{ fontFamily: B, fontSize: 11, color: C.coral }}>{L("Add employees in the Team tab first.", "Előbb adj hozzá munkatársakat a Csapat fülön.")}</span>}
            </div>
            {b.status !== 9 && b.status !== 8 && (
              <div style={{ marginTop: 10 }}><AddToCalendar booking={b} /></div>
            )}
            {(b.enroute_at || b.started_at || b.finished_at || b.collected_at || b.returned_at) && (
              <div style={{ background: C.bg, borderRadius: 12, padding: "9px 12px", marginTop: 10 }}>
                <div style={{ fontFamily: B, fontWeight: 700, fontSize: 10, color: C.inkFaint, letterSpacing: .3, marginBottom: 4 }}>
                  {L("WHAT ACTUALLY HAPPENED", "AMI VALÓJÁBAN TÖRTÉNT")}
                </div>
                {[[b.enroute_at, L("Set off", "Elindult")],
                  [b.collected_at, L("Collected", "Elvitte")],
                  [b.started_at, L("Started", "Elkezdte")],
                  [b.finished_at, L("Finished", "Befejezte")],
                  [b.returned_at, L("Returned", "Visszahozta")]].filter(([t]) => t).map(([t, lbl], i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", fontFamily: B, fontSize: 11, color: C.inkSoft, padding: "2px 0" }}>
                    <span>{lbl}</span>
                    <span style={{ color: C.ink, fontWeight: 600 }}>{(() => { try { return new Date(t).toLocaleString(LOC(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return ""; } })()}</span>
                  </div>
                ))}
              </div>
            )}
            <PartnerInvoiceBox booking={b} />
            <ReportCustomerBox booking={b} />
            {canTrack(b) && (
              <Btn small ghost style={{ width: "100%", marginTop: 10 }} onClick={() => setJobTrackId(b.id)}>
                {L("Track cleaner on map", "Takarító követése a térképen")}
              </Btn>
            )}
            {b.status <= 1 && (
              <div style={{ marginTop: 8 }}>
                <button onClick={() => { setDeclining(b); setReason(""); }} style={{ fontFamily: B, fontSize: 11, fontWeight: 700, padding: "6px 12px", borderRadius: 99, border: "1.5px solid #FFD8D1", background: C.card, color: C.coral, cursor: "pointer" }}>
                  ✕ Decline — not available for this time
                </button>
              </div>
            )}
          </div>
        );
      })}

      {jobTrackId && <TrackSheet bookingId={jobTrackId} booking={(bookings || []).find((x) => x.id === jobTrackId)} close={() => setJobTrackId(null)} />}

      {done.length > 0 && (
        <>
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 14, color: C.inkSoft, margin: "20px 0 10px" }}>{L("Completed jobs", "Elvégzett munkák")}</div>
          {done.map((b) => (
            <div key={b.id} style={{ background: C.card, borderRadius: 16, padding: "13px 16px", marginBottom: 9, boxShadow: "0 1px 6px rgba(20,28,58,.04)", opacity: .9 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13, color: C.ink }}>
                    {(b.service_snapshot || {}).name} · {b.customer_name}
                    {b.customer_deleted && (
                      <button onClick={async (e) => { e.stopPropagation(); await hideDeletedIdentity(b.id); toast(L("Removed from this booking", "Eltávolítva erről a foglalásról")); }}
                        title={L("Remove the deleted user's details from this booking", "A törölt felhasználó adatainak eltávolítása")}
                        style={{ marginLeft: 6, background: "none", border: "none", padding: 0, cursor: "pointer", color: C.inkFaint, fontSize: 11 }}>✕</button>
                    )}
                  </div>
                  <div style={{ fontFamily: B, fontSize: 10.5, color: C.inkFaint, marginTop: 2 }}>{dayLabel(b.scheduled_date)} · {huf((b.total_huf || 0) - (b.service_fee_huf || 0))} your share</div>
                </div>
                <Pill>Done ✨</Pill>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 9, alignItems: "center" }}>
                {b.invoice ? (
                  <a href={b.invoice.data} download={b.invoice.name} style={{ fontFamily: B, fontWeight: 700, fontSize: 11, padding: "6px 12px", borderRadius: 99, border: `1.5px solid ${C.mint}`, color: C.green, textDecoration: "none" }}>{b.invoice.name.slice(0, 22)}</a>
                ) : (
                  <label style={{ fontFamily: B, fontWeight: 700, fontSize: 11, padding: "6px 12px", borderRadius: 99, border: `1.5px solid ${C.line}`, color: C.navySoft, cursor: "pointer" }}>
                    Upload invoice
                    <input type="file" accept="application/pdf,image/*" style={{ display: "none" }} onChange={(e) => {
                      const file = e.target.files?.[0]; e.target.value = "";
                      if (!file) return;
                      (async () => {
                        try {
                          const data = await prepareUpload(file);
                          upsertBooking({ ...b, invoice: { name: file.name, type: file.type, data } });
                          toast(L("Invoice uploaded", "Számla feltöltve"));
                        } catch (err) {
                          toast(err.message === "too-large" ? L("That file is too large — 8 MB maximum", "Túl nagy a fájl — legfeljebb 8 MB") : L("Could not read that file", "Nem sikerült beolvasni a fájlt"), "error");
                        }
                      })();
                    }} />
                  </label>
                )}
                <button onClick={async () => { const r = await archiveBooking(b.id); if (r?.error) toast(r.error, "error"); else toast(L("Moved to history (Settings)", "Áthelyezve az előzményekbe (Beállítások)")); }}
                  style={{ marginLeft: "auto", border: "none", background: C.bg, color: C.inkFaint, borderRadius: 9, padding: "6px 11px", fontFamily: B, fontWeight: 700, fontSize: 11, cursor: "pointer" }}>{L("Clear", "Törlés")}</button>
              </div>
            </div>
          ))}
        </>
      )}
      {cancelled.length > 0 && (
        <div style={{ fontFamily: B, fontSize: 11, color: C.inkFaint, marginTop: 14 }}>{cancelled.length} cancelled / declined booking(s) hidden.</div>
      )}

      {declining && (
        <Sheet title={L("Decline this booking?", "Elutasítod ezt a foglalást?")} close={() => setDeclining(null)}>
          <div style={{ fontFamily: B, fontSize: 12.5, color: C.inkSoft, lineHeight: 1.6, marginBottom: 14 }}>
            Tell {declining.customer_name || "the customer"} why you can't take <b style={{ color: C.ink }}>{(declining.service_snapshot || {}).name}</b> on {dayLabel(declining.scheduled_date)} at {declining.scheduled_slot}.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            {["Not available at this time", "Fully booked that day", "Outside our service area", "Team off that day"].map((q) => (
              <button key={q} onClick={() => setReason(q)} style={{ fontFamily: B, fontSize: 11.5, fontWeight: 600, padding: "8px 12px", borderRadius: 99, border: `1.5px solid ${C.line}`, background: reason === q ? C.coralSoft : C.card, color: reason === q ? C.coral : C.navySoft, cursor: "pointer" }}>{q}</button>
            ))}
          </div>
          <Field area placeholder={L("Add a note (optional)…", "Megjegyzés (nem kötelező)…")} value={reason} onChange={(e) => setReason(e.target.value)} />
          <Btn full danger onClick={() => { declineBooking(declining.id, reason || L("Not available for this time", "Ebben az időpontban nem elérhető")); toast(L("Booking declined", "Foglalás elutasítva")); setDeclining(null); }}>
            Decline booking
          </Btn>
        </Sheet>
      )}
    </div>
  );
}

/* ── Company CRM: every client, aggregated from booking history ── */
function CompanyClients() {
  const { session, bookings, reviews } = useStore();
  const [q, setQ] = useState("");
  const mine = bookings.filter((b) => b.company_id === session.companyId);
  const clients = useMemo(() => {
    const map = new Map();
    for (const b of mine) {
      const key = b.customer_id || b.customer_name;
      if (!key) continue;
      const c = map.get(key) || { key, name: b.customer_name || "Customer", phone: b.customer_phone || null, kind: b.customer_kind || b.customer_type, addresses: new Set(), jobs: 0, done: 0, spend: 0, last: "", hasSub: false };
      c.jobs += 1;
      if (b.status === 4) { c.done += 1; c.spend += (b.total_huf || 0) - (b.service_fee_huf || 0); }
      if (b.pricing_type === "subscription" && b.status < 8) c.hasSub = true;
      if (b.address) c.addresses.add(b.address);
      if (String(b.scheduled_date) > c.last) c.last = String(b.scheduled_date).slice(0, 10);
      if (b.customer_phone) c.phone = b.customer_phone;
      map.set(key, c);
    }
    return [...map.values()].sort((a, b) => b.spend - a.spend);
  }, [mine]);
  const filtered = clients.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));
  const totalSpend = clients.reduce((a, c) => a + c.spend, 0);
  return (
    <div className="cl-fade" style={{ padding: "calc(20px + env(safe-area-inset-top)) 20px 30px" }}>
      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 21, color: C.ink, margin: "8px 0 12px" }}>Clients ({clients.length})</div>
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1, background: C.card, borderRadius: 14, padding: "12px 14px", boxShadow: "0 1px 6px rgba(20,28,58,.05)" }}>
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 17, color: C.ink }}>{huf(totalSpend)}</div>
          <div style={{ fontFamily: B, fontSize: 10.5, color: C.inkSoft }}>{L("lifetime revenue", "teljes bevétel")}</div>
        </div>
        <div style={{ flex: 1, background: C.card, borderRadius: 14, padding: "12px 14px", boxShadow: "0 1px 6px rgba(20,28,58,.05)" }}>
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 17, color: C.ink }}>{clients.filter((c) => c.hasSub).length}</div>
          <div style={{ fontFamily: B, fontSize: 10.5, color: C.inkSoft }}>{L("active subscribers", "aktív előfizető")}</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.card, borderRadius: 14, padding: "11px 14px", marginBottom: 14, boxShadow: "0 1px 6px rgba(20,28,58,.05)" }}>
        <span style={{ opacity: .45 }}>🔍</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("Search clients…", "Ügyfelek keresése…")} style={{ flex: 1, border: "none", outline: "none", fontFamily: B, fontSize: 13.5, color: C.ink, background: "transparent" }} />
      </div>
      {filtered.length === 0 && <div style={{ textAlign: "center", padding: 40, fontFamily: B, fontSize: 13, color: C.inkSoft }}>No clients yet — they appear after the first booking.</div>}
      {filtered.map((c) => (
        <div key={c.key} style={{ background: C.card, borderRadius: 16, padding: "14px 16px", marginBottom: 10, boxShadow: "0 1px 8px rgba(20,28,58,.05)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <Avatar name={c.name} size={40} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: F, fontWeight: 700, fontSize: 14, color: C.ink, display: "flex", alignItems: "center", gap: 6 }}>
                {c.name}
                {c.kind === "student" && <Pill bg={C.mintSoft} color={C.green}>🎓</Pill>}
                {c.hasSub && <Pill bg={C.navyChip} color={C.navySoft}>🔁 plan</Pill>}
              </div>
              <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft, marginTop: 2 }}>
                {c.done}/{c.jobs} jobs done · {huf(c.spend)} · last: {c.last ? dayLabel(c.last) : "—"}
              </div>
              {c.addresses.size > 0 && <div style={{ fontFamily: B, fontSize: 10.5, color: C.inkFaint, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📍 {[...c.addresses][0]}</div>}
            </div>
            {c.phone && <a href={`tel:${c.phone}`} style={{ textDecoration: "none", fontFamily: B, fontWeight: 700, fontSize: 11, padding: "7px 12px", borderRadius: 99, border: `1.5px solid ${C.line}`, color: C.navySoft, background: C.card }}>📞 Call</a>}
          </div>
        </div>
      ))}
    </div>
  );
}

function CompanySchedule() {
  const { session, bookings, allEmployees } = useStore();
  const [selDay, setSelDay] = useState(localISO(new Date()));
  const [trackId, setTrackId] = useState(null);
  const mine = bookings.filter((b) => b.company_id === session.companyId && b.status !== 9 && b.status !== 8);
  const marks = {};
  mine.forEach((b) => { const k = String(b.scheduled_date).slice(0, 10); marks[k] = (marks[k] || 0) + 1; });
  const dayJobs = mine.filter((b) => String(b.scheduled_date).slice(0, 10) === selDay)
    .sort((a, b) => (a.scheduled_slot || "").localeCompare(b.scheduled_slot || ""));
  const dayRevenue = dayJobs.reduce((a, b) => a + (b.total_huf || 0), 0);

  return (
    <div className="cl-fade" style={{ padding: "calc(20px + env(safe-area-inset-top)) 20px 30px" }}>
      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 21, color: C.ink, margin: "8px 0 6px" }}>{L("Schedule", "Beosztás")}</div>
      <div style={{ fontFamily: B, fontSize: 11.5, color: C.inkSoft, marginBottom: 14 }}>Your whole pipeline on a calendar — dots mark days with jobs.</div>
      <Calendar selected={selDay} onSelect={setSelDay} marks={marks} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "16px 0 10px" }}>
        <div style={{ fontFamily: F, fontWeight: 700, fontSize: 14.5, color: C.ink }}>{dayLabel(selDay)} · {dayJobs.length} job{dayJobs.length === 1 ? "" : "s"}</div>
        {dayJobs.length > 0 && <Pill bg={C.mintSoft} color={C.green}>{huf(dayRevenue)}</Pill>}
      </div>
      {dayJobs.length === 0 && (
        <div style={{ fontFamily: B, fontSize: 12.5, color: C.inkSoft, textAlign: "center", padding: 30, background: C.card, borderRadius: 18, boxShadow: "0 2px 10px rgba(20,28,58,.04)" }}>{L("Nothing scheduled this day.", "Erre a napra nincs semmi.")}</div>
      )}
      {dayJobs.map((b) => {
        const svc = b.service_snapshot || {};
        const cleaner = b.assigned_name || allEmployees.find((e) => e.id === b.assigned_to)?.full_name;
        return (
          <div key={b.id} style={{ background: C.card, borderRadius: 16, padding: "13px 15px", marginBottom: 10, boxShadow: "0 1px 8px rgba(20,28,58,.05)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13.5, color: C.ink }}>🕘 {b.scheduled_slot} · {svc.icon} {svc.name}{b.pricing_type === "subscription" ? " 🔁" : ""}</div>
                <div style={{ fontFamily: B, fontSize: 10.5, color: C.inkSoft, marginTop: 3, lineHeight: 1.6 }}>
                  👤 {b.customer_name || "Customer"} · 📍 {b.address}<br />
                  🧽 {cleaner || "Unassigned — assign in Jobs tab"}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <StatusPill status={b.status} fulfilment={b.fulfilment} />
                <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.navy, marginTop: 6 }}>{huf(b.total_huf)}</div>
              </div>
            </div>
            {canTrack(b) && <Btn small ghost style={{ width: "100%", marginTop: 10 }} onClick={() => setTrackId(b.id)}>{L("Track cleaner on map", "Takarító követése")}</Btn>}
          </div>
        );
      })}
      {trackId && <TrackSheet bookingId={trackId} booking={(bookings || []).find((x) => x.id === trackId)} close={() => setTrackId(null)} />}
    </div>
  );
}

function CompanyServices() {
  const { session, services, upsertService } = useStore();
  const toast = useToast();
  const mine = services.filter((s) => s.company_id === session.companyId);
  const [editing, setEditing] = useState(null);
  const [f, setF] = useState({});
  const openEditor = (svc) => {
    setF(svc ? { ...svc, tasksText: (svc.tasks || []).join("\n") } : { name: "", description: "", icon: "🏠", price_huf: "", minutes: 120, tasksText: "", pricing_type: "flat", hourly_rate_huf: "", min_hours: 2, max_hours: 8, period: "weekly", promo_pct: 0,
      fulfilment: "onsite", turnaround_days: 3, slot_capacity: null, dur_unit: "min" });
    setEditing(svc ? "edit" : "new");
  };

  return (
    <div className="cl-fade" style={{ padding: "calc(20px + env(safe-area-inset-top)) 20px 30px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "8px 0 16px" }}>
        <div style={{ fontFamily: F, fontWeight: 700, fontSize: 21, color: C.ink }}>Services & prices</div>
        <Btn small onClick={() => openEditor(null)}>+ {L("New service", "Új szolgáltatás")}</Btn>
      </div>
      <div style={{ fontFamily: B, fontSize: 12, color: C.inkSoft, lineHeight: 1.6, marginBottom: 16 }}>
        What customers see when they book you. The task checklist becomes your cleaner's on-site to-do list.
      </div>

      {mine.map((s) => (
        <div key={s.id} style={{ background: C.card, borderRadius: 18, padding: 16, marginBottom: 12, boxShadow: "0 2px 12px rgba(20,28,58,.06)", opacity: s.is_active ? 1 : .55 }}>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ width: 42, height: 42, borderRadius: 13, background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{s.icon}</div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontFamily: F, fontWeight: 700, fontSize: 14, color: C.ink }}>{s.name}</span>
                <span style={{ fontFamily: F, fontWeight: 700, fontSize: 13.5, color: C.navy, whiteSpace: "nowrap" }}>{priceLabel(s)}</span>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 5 }}>
                <Pill bg={C.navyChip} color={C.navySoft}>{s.pricing_type === "hourly" ? `⏱ ${L("Hourly", "Óradíj")}` : s.pricing_type === "unit" ? `⚖️ ${huf(s.unit_price_huf)}/${s.unit_label || ""}` : s.pricing_type === "subscription" ? `🔁 ${periodLabel(s.period)}` : `💰 ${L("Flat", "Fix")}`}</Pill>
              </div>
              <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft, marginTop: 5, lineHeight: 1.5 }}>{s.description} · ⏱ {s.minutes} min · {(s.tasks || []).length} tasks</div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <Btn small ghost onClick={() => openEditor(s)}>✏️ Edit</Btn>
                {s.promo_pct > 0 && <Pill bg={C.mintSoft} color={C.greenDeep}>−{s.promo_pct}%</Pill>}
                <Btn small ghost onClick={() => { upsertService({ ...s, is_active: !s.is_active }); toast(s.is_active ? L("Service hidden", "Szolgáltatás elrejtve") : L("Service re-listed", "Szolgáltatás újra látható")); }} style={{ color: s.is_active ? C.coral : C.green }}>
                  {s.is_active ? L("Hide", "Elrejtés") : L("Re-list", "Újra listázom")}
                </Btn>
              </div>
            </div>
          </div>
        </div>
      ))}
      {mine.length === 0 && <div style={{ fontFamily: B, fontSize: 12.5, color: C.inkSoft, textAlign: "center", padding: 30 }}>No services yet — add your first one so customers can book you.</div>}

      {editing && (
        <Sheet title={editing === "new" ? "New service" : "Edit service"} close={() => setEditing(null)}>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ width: 84 }}>
              <Field label={L("Icon", "Ikon")} placeholder="🏠" value={f.icon} onChange={(e) => setF({ ...f, icon: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <Field label={L("Name", "Név")} placeholder={L("e.g. Deep clean", "pl. Nagytakarítás")} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </div>
            <div style={{ width: 110 }}>
              <Field label={L("Discount %", "Kedvezmény %")} type="number" placeholder="0" value={f.promo_pct ?? ""} onChange={(e) => setF({ ...f, promo_pct: e.target.value === "" ? null : Math.min(90, Math.max(0, parseInt(e.target.value, 10) || 0)) })} />
            </div>
          </div>
          <Field label={L("Description", "Leírás")} placeholder={L("What's included, in one line", "Mit tartalmaz, egy sorban")} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          {/* ── How this service is delivered. Cleaning happens at the address;
                 laundry is taken away and brought back — a different job with a
                 different ending, so it gets its own stages. ── */}
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink, marginBottom: 6 }}>{L("How it works", "Hogyan zajlik")}</div>
          <div style={{ display: "flex", gap: 7, marginBottom: 12 }}>
            {[["onsite", "🏠", L("We work at their address", "Náluk dolgozunk")],
              ["collection", "🚚", L("We collect and bring it back", "Elvisszük és visszahozzuk")]].map(([id, ic, lbl]) => (
              <button key={id} onClick={() => setF({ ...f, fulfilment: id })}
                style={{ flex: 1, border: "none", cursor: "pointer", borderRadius: 14, padding: "11px 9px", textAlign: "left",
                  background: (f.fulfilment || "onsite") === id ? C.navy : C.bg, color: (f.fulfilment || "onsite") === id ? "#fff" : C.inkSoft }}>
                <div style={{ fontSize: 16 }}>{ic}</div>
                <div style={{ fontFamily: B, fontWeight: 700, fontSize: 11, marginTop: 3, lineHeight: 1.35 }}>{lbl}</div>
              </button>
            ))}
          </div>
          {(f.fulfilment || "onsite") === "collection" && (
            <div style={{ background: C.navyChip, borderRadius: 14, padding: "12px 14px", marginBottom: 12 }}>
              <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft, marginBottom: 9, lineHeight: 1.5 }}>
                {L("The customer is told when their things come back, and the job only counts as finished once you return them.", "Az ügyfél megtudja, mikor kapja vissza a holmiját, és a munka csak a visszaszállításkor számít késznek.")}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }}><Field label={L("Ready in (days)", "Elkészül (nap)")} type="number" placeholder="3"
                  value={f.turnaround_days ?? 3} onChange={(e) => setF({ ...f, turnaround_days: Math.min(60, Math.max(0, parseInt(e.target.value, 10) || 0)) })} /></div>
                <div style={{ flex: 1 }}><Field label={L("Pickups per hour", "Felvétel óránként")} type="number" placeholder={L("team size", "csapatlétszám")}
                  value={f.slot_capacity ?? ""} onChange={(e) => setF({ ...f, slot_capacity: e.target.value === "" ? null : Math.min(100, Math.max(1, parseInt(e.target.value, 10) || 1)) })} /></div>
              </div>
              <div style={{ fontFamily: B, fontSize: 10, color: C.inkFaint, marginTop: 4, lineHeight: 1.5 }}>
                {L("Leave pickups per hour empty to use your team size. One van can usually call at several addresses in an hour.", "Hagyd üresen, ha a csapatlétszámot használnád. Egy furgon általában több címre is eljut egy óra alatt.")}
              </div>
            </div>
          )}

          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink, marginBottom: 8 }}>{L("Pricing model", "Árazás módja")}</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            {[{ id: "flat", t: L("Flat", "Fix"), icon: "💰" }, { id: "hourly", t: L("Hourly", "Óradíj"), icon: "⏱️" },
              { id: "unit", t: L("Per unit", "Egységár"), icon: "⚖️" }, { id: "subscription", t: L("Plan", "Bérlet"), icon: "🔁" }].map((o) => (
              <button key={o.id} onClick={() => setF({ ...f, pricing_type: o.id })} style={{ flex: 1, padding: "10px 4px", borderRadius: 13, cursor: "pointer", border: (f.pricing_type || "flat") === o.id ? `2px solid ${C.navy}` : "2px solid transparent", background: C.card, boxShadow: "0 1px 6px rgba(20,28,58,.06)", textAlign: "center" }}>
                <div style={{ fontSize: 18 }}>{o.icon}</div>
                <div style={{ fontFamily: F, fontWeight: 700, fontSize: 11.5, color: C.ink, marginTop: 3 }}>{o.t}</div>
              </button>
            ))}
          </div>

          {(f.pricing_type || "flat") === "unit" && (
            <>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}><Field label={L("Price per unit (HUF)", "Egységár (Ft)")} type="number" placeholder="1200"
                  value={f.unit_price_huf ?? ""} onChange={(e) => setF({ ...f, unit_price_huf: e.target.value })} /></div>
                <div style={{ flex: 1 }}><Field label={L("Unit name", "Mértékegység")} placeholder={L("kg, m², piece", "kg, m², darab")}
                  value={f.unit_label ?? ""} onChange={(e) => setF({ ...f, unit_label: e.target.value.slice(0, 12) })} /></div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}><Field label={L("Minimum quantity", "Minimum mennyiség")} type="number" placeholder="1"
                  value={f.min_units ?? ""} onChange={(e) => setF({ ...f, min_units: e.target.value })} /></div>
                <div style={{ flex: 1 }}><Field label={L("Maximum quantity", "Maximum mennyiség")} type="number" placeholder="50"
                  value={f.max_units ?? ""} onChange={(e) => setF({ ...f, max_units: e.target.value })} /></div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: -2, marginBottom: 8 }}>
                {[["kg", L("kg — laundry by weight", "kg — mosás súly szerint")],
                  ["m²", L("m² — carpets, floors", "m² — szőnyeg, padló")],
                  [L("piece", "darab"), L("piece — ironing, curtains", "darab — vasalás, függöny")]].map(([u, hint]) => (
                  <button key={u} title={hint} onClick={() => setF({ ...f, unit_label: u })}
                    style={{ border: "none", cursor: "pointer", fontFamily: B, fontWeight: 700, fontSize: 11, padding: "6px 12px", borderRadius: 99,
                      background: f.unit_label === u ? C.navy : C.bg, color: f.unit_label === u ? "#fff" : C.inkSoft }}>{u}</button>
                ))}
              </div>
              <div style={{ fontFamily: B, fontSize: 10.5, color: C.inkFaint, marginTop: -4, marginBottom: 10, lineHeight: 1.5 }}>
                {L("The customer chooses how much, and the price is worked out from it — 1,200 Ft per kg, 5 kg, 6,000 Ft. Use 'piece' for ironing.", "Az ügyfél választja a mennyiséget, az árat abból számoljuk — 1 200 Ft/kg, 5 kg, 6 000 Ft. Vasaláshoz használd a „darab” egységet.")}
              </div>
            </>
          )}

          {(f.pricing_type || "flat") === "flat" && (
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}><Field label={L("Price (HUF)", "Ár (Ft)")} type="number" placeholder="15900" value={f.price_huf} onChange={(e) => setF({ ...f, price_huf: e.target.value })} /></div>
              <div style={{ flex: 1 }}>
                {/* Minutes or hours. A deep clean is "3 hours" in the company's head,
                    not "180 minutes" — but minutes stay the stored unit so nothing
                    downstream has to learn a second one. */}
                <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink, marginBottom: 5 }}>{L("How long it takes", "Mennyi ideig tart")}</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input type="number" min="0" step={f.dur_unit === "h" ? "0.5" : "5"}
                    value={f.dur_unit === "h" ? (f.minutes === "" || f.minutes == null ? "" : Math.round((Number(f.minutes) / 60) * 100) / 100) : (f.minutes ?? "")}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "") return setF({ ...f, minutes: "" });
                      setF({ ...f, minutes: f.dur_unit === "h" ? Math.round(Number(v) * 60) : Math.round(Number(v)) });
                    }}
                    style={{ flex: 1, minWidth: 0, boxSizing: "border-box", background: C.bg, border: "none", borderRadius: 13, padding: "12px 14px", fontFamily: B, fontSize: 13, color: C.ink, outline: "none" }} />
                  <div style={{ display: "flex", background: C.bg, borderRadius: 13, padding: 3 }}>
                    {[["min", L("min", "perc")], ["h", L("hours", "óra")]].map(([u, lbl]) => (
                      <button key={u} onClick={() => setF({ ...f, dur_unit: u })}
                        style={{ border: "none", cursor: "pointer", borderRadius: 10, padding: "8px 11px", fontFamily: B, fontWeight: 700, fontSize: 11,
                          background: (f.dur_unit || "min") === u ? C.card : "transparent", color: (f.dur_unit || "min") === u ? C.ink : C.inkFaint }}>{lbl}</button>
                    ))}
                  </div>
                </div>
                {Number(f.minutes) > 0 && (
                  <div style={{ fontFamily: B, fontSize: 10.5, color: C.inkFaint, marginTop: 4 }}>
                    = {Math.floor(Number(f.minutes) / 60) > 0 ? `${Math.floor(Number(f.minutes) / 60)} ${L("h", "óra")} ` : ""}{Number(f.minutes) % 60 > 0 ? `${Number(f.minutes) % 60} ${L("min", "perc")}` : ""}
                  </div>
                )}
              </div>
            </div>
          )}
          {f.pricing_type === "hourly" && (
            <>
              <Field label={L("Hourly rate (HUF / hour)", "Óradíj (Ft / óra)")} type="number" placeholder="4500" value={f.hourly_rate_huf} onChange={(e) => setF({ ...f, hourly_rate_huf: e.target.value })} />
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}><Field label={L("Min hours", "Min. óra")} type="number" value={f.min_hours ?? 2} onChange={(e) => setF({ ...f, min_hours: e.target.value })} /></div>
                <div style={{ flex: 1 }}><Field label={L("Max hours", "Max. óra")} type="number" value={f.max_hours ?? 8} onChange={(e) => setF({ ...f, max_hours: e.target.value })} /></div>
              </div>
            </>
          )}
          {f.pricing_type === "subscription" && (
            <>
              <Field label={L("Price per period (HUF)", "Ár időszakonként (Ft)")} type="number" placeholder="13900" value={f.price_huf} onChange={(e) => setF({ ...f, price_huf: e.target.value })} />
              <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink, marginBottom: 8 }}>{L("Billing period", "Számlázási időszak")}</div>
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                {["weekly", "biweekly", "monthly"].map((p) => (
                  <button key={p} onClick={() => setF({ ...f, period: p })} style={{ flex: 1, padding: "10px 4px", borderRadius: 13, cursor: "pointer", border: (f.period || "weekly") === p ? `2px solid ${C.navy}` : "2px solid transparent", background: C.card, boxShadow: "0 1px 6px rgba(20,28,58,.06)", fontFamily: F, fontWeight: 700, fontSize: 11, color: C.ink, textTransform: "capitalize" }}>{p}</button>
                ))}
              </div>
            </>
          )}

          <Field area rows={5} label={L("Cleaner task checklist (one per line)", "Takarítói feladatlista (soronként egy)")} placeholder={"Kitchen surfaces & sink\nBathroom full clean\nVacuum & mop"} value={f.tasksText} onChange={(e) => setF({ ...f, tasksText: e.target.value })} />
          <Btn full disabled={!f.name || (f.pricing_type === "hourly" ? !f.hourly_rate_huf : !f.price_huf)} onClick={() => {
            upsertService({ id: editing === "edit" ? f.id : undefined, name: f.name, description: f.description, icon: f.icon || "🏠", price_huf: parseInt(f.price_huf, 10) || 0, minutes: parseInt(f.minutes, 10) || 120, tasks: f.tasksText.split("\n").map((t) => t.trim()).filter(Boolean), is_active: f.is_active !== false, pricing_type: f.pricing_type || "flat", hourly_rate_huf: f.pricing_type === "hourly" ? (parseInt(f.hourly_rate_huf, 10) || 0) : null, min_hours: parseInt(f.min_hours, 10) || 2, max_hours: parseInt(f.max_hours, 10) || 8, period: f.pricing_type === "subscription" ? (f.period || "weekly") : null,
              /* The per-service discount was bound to this form but never sent — a
                 dead input. Send 0 to clear it, which the server maps to NULL. */
              promo_pct: f.promo_pct === "" || f.promo_pct == null ? 0 : (parseInt(f.promo_pct, 10) || 0),
              fulfilment: f.fulfilment || "onsite",
              turnaround_days: parseInt(f.turnaround_days, 10) || 3,
              slot_capacity: f.slot_capacity == null || f.slot_capacity === "" ? null : parseInt(f.slot_capacity, 10) });
            toast(editing === "new" ? "Service added" : "Service updated");
            setEditing(null);
          }}>
            {editing === "new" ? "Add service" : "Save changes"}
          </Btn>
        </Sheet>
      )}
    </div>
  );
}

function CompanyTeam() {
  const { employees, invites, bookings, createInvite, deleteInvite, sendNotice, notices, session, deleteNotice , removeEmployee , fetchPendingCleaners, decideCleaner } = useStore();
  const [pendingCleaners, setPendingCleaners] = React.useState([]);
  const [viewCleanerDocs, setViewCleanerDocs] = React.useState(null);
  const loadPending = React.useCallback(() => { fetchPendingCleaners().then(setPendingCleaners); }, []);
  React.useEffect(() => { loadPending(); const iv = setInterval(loadPending, 30000); return () => clearInterval(iv); }, [loadPending]);
  const [confirmRm, setConfirmRm] = useState(null);
  const toast = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [showMsg, setShowMsg] = useState(null);
  const [label, setLabel] = useState("");
  const [msg, setMsg] = useState("");
  const [newCode, setNewCode] = useState(null);

  const copyCode = (code) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(code).then(() => toast(L("Code copied to clipboard!", "Kód a vágólapra másolva!"))).catch(() => toast(L("Copy failed", "A másolás nem sikerült"), "error"));
    } else {
      toast(L("Code: ", "Kód: ") + code);
    }
  };

  return (
    <div className="cl-fade" style={{ padding: "calc(20px + env(safe-area-inset-top)) 20px 30px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "8px 0 16px" }}>
        <div style={{ fontFamily: F, fontWeight: 700, fontSize: 21, color: C.ink }}>Team</div>
        <Btn small onClick={() => { setShowAdd(true); setNewCode(null); setLabel(""); }}>+ {L("Invite employee", "Munkatárs meghívása")}</Btn>
      </div>

      {employees.length === 0 && !invites.length && (
        <div style={{ textAlign: "center", padding: "44px 24px", background: C.card, borderRadius: 20, boxShadow: "0 2px 10px rgba(20,28,58,.05)", marginBottom: 16 }}>
          <div style={{ fontSize: 34 }}>👥</div>
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 15, color: C.ink, marginTop: 12 }}>{L("No team members yet", "Még nincs csapattag")}</div>
          <div style={{ fontFamily: B, fontSize: 12, color: C.inkSoft, marginTop: 6, lineHeight: 1.55 }}>Invite your first cleaner. They sign up with the code and are instantly linked to your company.</div>
        </div>
      )}

      {pendingCleaners.length > 0 && (
        <div style={{ background: C.amberSoft, borderRadius: 20, padding: 16, marginBottom: 14 }}>
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 14, color: C.ink, marginBottom: 4 }}>
            {L("Waiting for your approval", "Jóváhagyásra vár")} ({pendingCleaners.length})
          </div>
          <div style={{ fontFamily: B, fontSize: 11.5, color: C.inkSoft, marginBottom: 10, lineHeight: 1.5 }}>
            {L("These cleaners signed up with your invite code. They can only log in once you approve them.", "Ezek a takarítók a meghívókódoddal regisztráltak. Csak jóváhagyás után tudnak belépni.")}
          </div>
          {pendingCleaners.map((p) => (
            <div key={p.id} style={{ background: C.card, borderRadius: 14, padding: "12px 14px", marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Avatar name={p.full_name || "?"} size={36} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13.5, color: C.ink }}>{p.full_name}</div>
                  <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft, overflow: "hidden", textOverflow: "ellipsis" }}>{p.email}{p.phone ? " · " + p.phone : ""}</div>
                </div>
              </div>
              {(p.documents || []).length > 0 && (
                <button onClick={() => setViewCleanerDocs({ title: `${p.full_name} — documents`, docs: p.documents })}
                  style={{ marginTop: 8, fontFamily: B, fontWeight: 700, fontSize: 11, padding: "6px 12px", borderRadius: 99, border: `1.5px solid ${C.line}`, background: C.bg, color: C.navySoft, cursor: "pointer" }}>
                  {L("View documents", "Dokumentumok")} ({p.documents.length})
                </button>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <Btn small style={{ flex: 1 }} onClick={async () => {
                  const r = await decideCleaner(p.id, "approved");
                  if (r?.error) toast(r.error, "error"); else { toast(L("Cleaner approved", "Takarító jóváhagyva")); loadPending(); }
                }}>{L("Approve", "Jóváhagyás")}</Btn>
                <Btn small ghost style={{ flex: 1, color: C.coral }} onClick={async () => {
                  const r = await decideCleaner(p.id, "rejected");
                  if (r?.error) toast(r.error, "error"); else { toast(L("Declined", "Elutasítva")); loadPending(); }
                }}>{L("Decline", "Elutasítás")}</Btn>
              </div>
            </div>
          ))}
        </div>
      )}
      {viewCleanerDocs && <DocViewer title={viewCleanerDocs.title} docs={viewCleanerDocs.docs} close={() => setViewCleanerDocs(null)} />}

      {employees.map((m) => (
        <div key={m.id} style={{ background: C.card, borderRadius: 20, padding: 16, marginBottom: 12, boxShadow: "0 2px 12px rgba(20,28,58,.06)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Avatar name={m.full_name} size={42} />
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: F, fontWeight: 700, fontSize: 14.5, color: C.ink }}>{m.full_name}</div>
              <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft, marginTop: 2 }}>{m.title || "Cleaner"}{m.phone ? ` · ${m.phone}` : ""}</div>
            </div>
            <Pill bg={C.mintSoft} color={C.green}>{L("Active", "Aktív")}</Pill>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 13 }}>
            <Btn small ghost style={{ flex: 1 }} onClick={() => { setShowMsg(m); setMsg(""); }}>💬 {L("Send notice", "Üzenet küldése")}</Btn>
            <Btn small ghost style={{ flex: 1 }}>📋 {bookings.filter((b) => b.assigned_to === m.id && b.status < 4).length} open</Btn>
            <Btn small ghost style={{ color: C.coral }} onClick={() => setConfirmRm(m)}>{L("Remove", "Törlés")}</Btn>
          </div>
        </div>
      ))}

      {invites.filter((i) => !i.used_by).length > 0 && (
        <>
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 14, color: C.inkSoft, margin: "16px 0 10px" }}>{L("Pending invites", "Függő meghívók")}</div>
          {invites.filter((i) => !i.used_by).map((i) => (
            <div key={i.code} style={{ background: C.card, borderRadius: 16, padding: "13px 16px", marginBottom: 9, boxShadow: "0 1px 6px rgba(20,28,58,.04)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 14, color: C.navy, letterSpacing: 1.5 }}>{i.code}</div>
                  {i.label && <div style={{ fontFamily: B, fontSize: 10.5, color: C.inkFaint, marginTop: 2 }}>for {i.label}</div>}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <Pill bg={C.amberSoft} color={C.amber}>{L("Waiting", "Várakozik")}</Pill>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <Btn small ghost style={{ flex: 1 }} onClick={() => copyCode(i.code)}>📋 {L("Copy code", "Kód másolása")}</Btn>
                <Btn small ghost style={{ flex: 1, color: C.coral }} onClick={() => { deleteInvite(i.code); toast(L("Invite deleted", "Meghívó törölve")); }}>✕ Revoke</Btn>
              </div>
            </div>
          ))}
        </>
      )}

      {showAdd && (
        <Sheet title={L("Invite an employee", "Munkatárs meghívása")} close={() => setShowAdd(false)}>
          {!newCode ? (
            <>
              <Field label={L("Who is this invite for? (optional)", "Kinek szól a meghívó? (nem kötelező)")} placeholder={L("e.g. Zoltán Farkas", "pl. Farkas Zoltán")} value={label} onChange={(e) => setLabel(e.target.value)} />
              <div style={{ fontFamily: B, fontSize: 11.5, color: C.inkSoft, lineHeight: 1.6, background: C.mintSoft, borderRadius: 13, padding: "11px 14px", marginBottom: 16 }}>
                {L("A one-time invite code is generated. They open Cleano, choose \"I'm a cleaner\", and sign up with the code — they're instantly linked to your company.", "Egyszer használatos meghívókód készül. Megnyitják a Cleanót, a „Takarító vagyok” lehetőséget választják, és a kóddal regisztrálnak — azonnal a céghez kerülnek.")}
              </div>
              <Btn full onClick={async () => { const code = await createInvite(label); if (code) setNewCode(code); else toast(L("Failed to generate code", "A kód létrehozása nem sikerült"), "error"); }}>{L("Generate invite code", "Meghívókód létrehozása")}</Btn>
            </>
          ) : (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontFamily: B, fontSize: 12, color: C.inkSoft, marginBottom: 12 }}>Share this code with {label || "your employee"}:</div>
              <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 26, color: C.navy, letterSpacing: 3, background: C.card, borderRadius: 16, padding: "18px 0", boxShadow: "0 2px 12px rgba(20,28,58,.07)", marginBottom: 14 }}>{newCode}</div>
              <Btn ghost full onClick={() => copyCode(newCode)} style={{ marginBottom: 10 }}>📋 {L("Copy to clipboard", "Másolás a vágólapra")}</Btn>
              <Btn full mint onClick={() => setShowAdd(false)}>Done</Btn>
            </div>
          )}
        </Sheet>
      )}

      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 16, color: C.ink, margin: "22px 0 12px" }}>{L("Sent notices", "Elküldött üzenetek")}</div>
      {notices.filter((n) => n.company_id === session.companyId).length === 0 && (
        <div style={{ fontFamily: B, fontSize: 12.5, color: C.inkSoft, background: C.card, borderRadius: 14, padding: 16, boxShadow: "0 1px 6px rgba(20,28,58,.05)" }}>
          No notices sent yet — use the 💬 button on a team member.
        </div>
      )}
      {notices.filter((n) => n.company_id === session.companyId).map((n) => {
        const emp = employees.find((e) => e.id === n.to_employee);
        return (
          <div key={n.id} style={{ background: n.from_employee ? C.mintSoft : C.card, borderRadius: 15, padding: "13px 15px", marginBottom: 9, boxShadow: "0 1px 6px rgba(20,28,58,.05)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <Avatar name={n.employee_name || emp?.full_name || "?"} size={30} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink }}>{n.from_employee ? `↩ ${n.employee_name || emp?.full_name || "Cleaner"}` : (n.employee_name || emp?.full_name || "Employee")}</div>
                <div style={{ fontFamily: B, fontSize: 12, color: C.inkSoft, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.body}</div>
              </div>
              {n.from_employee
                ? <Pill bg={C.mintSoft} color={C.green}>💬 Reply</Pill>
                : n.is_read
                ? <Pill bg={C.mintSoft} color={C.green}>✓✓ {n.read_at ? new Date(n.read_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Seen"}</Pill>
                : <Pill bg={C.amberSoft} color={C.amber}>✓ {L("Not seen yet", "Még nem látta")}</Pill>}
              <button onClick={() => { deleteNotice(n.id); }}
                title={L("Clear from my list", "Törlés a listámról")}
                style={{ border: "none", background: C.bg, color: C.inkFaint, width: 26, height: 26, borderRadius: 9, cursor: "pointer", fontSize: 12, flexShrink: 0 }}>✕</button>
            </div>
          </div>
        );
      })}

      {confirmRm && (
        <ConfirmDialog
          title={`Remove ${confirmRm.full_name}?`}
          body="They lose access to the app, and their unfinished jobs return to the unassigned pool. This cannot be undone."
          confirmLabel="Remove cleaner"
          danger
          onCancel={() => setConfirmRm(null)}
          onConfirm={async () => {
            const r = await removeEmployee(confirmRm.id);
            setConfirmRm(null);
          }}
        />
      )}
      {showMsg && (
        <Sheet title={`Notice to ${showMsg.full_name.split(" ")[0]}`} close={() => setShowMsg(null)}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            {["Bring HEPA vacuum 🌬️", "Call me when free 📞", "Schedule change tomorrow 🗓️", "Check the job notes carefully 📋"].map((q) => (
              <button key={q} onClick={() => setMsg(q)} style={{ fontFamily: B, fontSize: 11.5, fontWeight: 600, padding: "8px 12px", borderRadius: 99, border: `1.5px solid ${C.line}`, background: msg === q ? C.mintSoft : C.card, color: C.navySoft, cursor: "pointer" }}>{q}</button>
            ))}
          </div>
          <Field area placeholder={L("Write your message…", "Írd meg az üzeneted…")} value={msg} onChange={(e) => setMsg(e.target.value)} />
          <Btn full disabled={!msg.trim()} onClick={() => { sendNotice(showMsg.id, msg); toast(`Notice sent to ${showMsg.full_name.split(" ")[0]}`); setShowMsg(null); }}>Send notice →</Btn>
        </Sheet>
      )}
    </div>
  );
}

/* ── Completed-job history (archived jobs live here, data never lost) ── */
function JobHistory() {
  const { session, bookings } = useStore();
  const [open, setOpen] = useState(false);
  const done = bookings.filter((b) => b.company_id === session.companyId && b.status === 4);
  const total = done.reduce((a, b) => a + (b.total_huf || 0) - (b.service_fee_huf || 0), 0);
  return (
    <div style={{ background: C.card, borderRadius: 16, padding: 16, marginBottom: 14, boxShadow: "0 1px 8px rgba(20,28,58,.05)" }}>
      <button onClick={() => setOpen(!open)} style={{ width: "100%", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, padding: 0, textAlign: "left" }}>
        <span style={{ fontSize: 20 }}>🗄</span>
        <span style={{ flex: 1 }}>
          <span style={{ display: "block", fontFamily: F, fontWeight: 700, fontSize: 14, color: C.ink }}>{L("Completed jobs history", "Elvégzett munkák előzményei")}</span>
          <span style={{ display: "block", fontFamily: B, fontSize: 11.5, color: C.inkSoft, marginTop: 2 }}>{done.length} jobs · {huf(total)} earned all-time</span>
        </span>
        <span style={{ color: C.inkFaint }}>{open ? "▴" : "▾"}</span>
      </button>
      {open && done.map((b) => (
        <div key={b.id} style={{ borderTop: `1px dashed ${C.line}`, paddingTop: 9, marginTop: 9, display: "flex", justifyContent: "space-between", gap: 8, fontFamily: B, fontSize: 12 }}>
          <span style={{ color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(b.service_snapshot || {}).name} · {b.customer_name}</span>
          <span style={{ color: C.inkSoft, flexShrink: 0 }}>{String(b.scheduled_date).slice(0, 10)} · {huf((b.total_huf || 0) - (b.service_fee_huf || 0))}</span>
        </div>
      ))}
      {open && done.length === 0 && <div style={{ fontFamily: B, fontSize: 12, color: C.inkFaint, marginTop: 10 }}>{L("Nothing completed yet.", "Még nincs elvégzett munka.")}</div>}
    </div>
  );
}

/* ── Company payout onboarding (Stripe Connect) ── */
function PayoutSetup() {
  const { connectStatus, connectOnboard, connectDashboard, isLive, dataVersion } = useStore();
  const toast = useToast();
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  React.useEffect(() => { if (isLive) connectStatus().then(setSt); }, [isLive, dataVersion]);
  if (!isLive || !st || !st.available) return null;
  const ready = st.connected && st.chargesEnabled;
  return (
    <div style={{ background: C.card, borderRadius: 16, padding: 16, marginBottom: 14, boxShadow: "0 1px 8px rgba(20,28,58,.05)", border: ready ? `1.5px solid ${C.mint}` : `1.5px dashed ${C.line}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 22 }}>{ready ? "✅" : "⚡"}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 14, color: C.ink }}>
            {ready ? "Automatic payouts active" : "Set up automatic payouts"}
          </div>
          <div style={{ fontFamily: B, fontSize: 11.5, color: C.inkSoft, marginTop: 2, lineHeight: 1.5 }}>
            {ready
              ? "Card payments land in your bank automatically, service fee already deducted."
              : st.connected
              ? "Onboarding started but not finished — continue below."
              : "Connect your bank via Stripe: card bookings then pay out to you automatically."}
          </div>
        </div>
        {!ready && (
          <Btn small disabled={busy} onClick={async () => {
            setBusy(true);
            const r = await connectOnboard();
            setBusy(false);
            if (r?.url) window.open(r.url, "_blank");
            else toast(r?.error || "Could not start onboarding", "error");
          }}>{st.connected ? "Continue" : "Connect"}</Btn>
        )}
        {ready && (
          <Btn small ghost disabled={busy} onClick={async () => {
            setBusy(true);
            const r = await connectDashboard();
            setBusy(false);
            if (r?.url) window.open(r.url, "_blank");
            else toast(r?.error || "Could not open payouts", "error");
          }}>{L("View payouts", "Kifizetések")}</Btn>
        )}
      </div>
    </div>
  );
}

/* ── 5.2 User-written text, shown in the reader's language.
   The server stores a lang → text map on write; we just pick. If there is no
   translation we show the original silently — never an empty space. Tapping the
   label reveals what the person actually wrote, which matters for trust. ── */
function Translated({ map, fallback, style, labelStyle }) {
  const [showSrc, setShowSrc] = React.useState(false);
  const lang = getLang();
  const m = map && typeof map === "object" ? map : null;
  const src = m ? m[m._src] : null;
  const mine = m ? m[lang] : null;
  const text = showSrc ? (src || fallback) : (mine || src || fallback);
  if (!text) return null;
  const isTranslated = !!(m && mine && lang !== m._src);
  return (
    <span style={style}>
      {text}
      {isTranslated && (
        <button onClick={(e) => { e.stopPropagation(); setShowSrc(!showSrc); }}
          style={{ border: "none", background: "none", padding: "0 0 0 6px", cursor: "pointer", fontFamily: B, fontSize: 10, fontWeight: 700, color: C.inkFaint, ...labelStyle }}>
          {showSrc ? L("Show translation", "Fordítás mutatása") : L("Translated", "Fordítva")}
        </button>
      )}
    </span>
  );
}

/* ── Subscribe the phone's calendar to Cleano.
   A one-off .ics is a snapshot; this is a live feed, so when a booking moves or
   is cancelled the calendar follows without anyone doing anything. The URL holds
   a secret, so we say so plainly and give a one-tap way to revoke it. ── */
function CalendarSync() {
  const toast = useToast();
  const [link, setLink] = React.useState(null);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const load = async () => {
    setBusy(true);
    try {
      const { api } = await import("./lib/api.js");
      setLink(await api("/calendar/me"));
    } catch { toast(L("Could not load your calendar link", "Nem sikerült betölteni a naptár linkedet"), "error"); }
    finally { setBusy(false); }
  };
  React.useEffect(() => { if (open && !link) load(); }, [open]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link.url);
      toast(L("Link copied", "Link másolva"));
    } catch { toast(L("Copy failed — select the link and copy it manually", "A másolás nem sikerült — jelöld ki és másold kézzel"), "error"); }
  };

  const reset = async () => {
    setBusy(true);
    try {
      const { api } = await import("./lib/api.js");
      setLink(await api("/calendar/reset", { method: "POST" }));
      toast(L("New link created — the old one no longer works", "Új link készült — a régi már nem működik"));
    } catch { toast(L("Could not reset the link", "Nem sikerült új linket készíteni"), "error"); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ background: C.card, borderRadius: 18, padding: 16, marginTop: 14 }}>
      <button onClick={() => setOpen(!open)} style={{ background: "none", border: "none", padding: 0, width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
        <div style={{ textAlign: "left" }}>
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13.5, color: C.ink }}>{L("Sync with my calendar", "Szinkronizálás a naptárammal")}</div>
          <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft, marginTop: 2 }}>
            {L("Your bookings appear in your phone's calendar and stay up to date on their own.", "A foglalásaid megjelennek a telefonod naptárában, és maguktól frissülnek.")}
          </div>
        </div>
        <span style={{ color: C.inkFaint, fontSize: 15 }}>{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div style={{ marginTop: 13 }}>
          {busy && !link && <div style={{ fontFamily: B, fontSize: 12, color: C.inkSoft }}>{L("Loading…", "Betöltés…")}</div>}
          {link && (
            <>
              <div style={{ background: C.bg, borderRadius: 12, padding: "10px 12px", fontFamily: "monospace", fontSize: 10.5, color: C.inkSoft, wordBreak: "break-all", lineHeight: 1.5 }}>
                {link.url}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <Btn small onClick={copy}>{L("Copy link", "Link másolása")}</Btn>
                <Btn small ghost onClick={() => { try { window.open(link.webcal, "_blank"); } catch {} }}>
                  {L("Open in calendar", "Megnyitás a naptárban")}
                </Btn>
              </div>
              <div style={{ fontFamily: B, fontSize: 10.5, color: C.inkSoft, marginTop: 11, lineHeight: 1.6 }}>
                <b style={{ color: C.ink }}>{L("iPhone", "iPhone")}:</b> {L("Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar, then paste the link.", "Beállítások → Naptár → Fiókok → Fiók hozzáadása → Egyéb → Feliratkozás naptárra, majd illeszd be a linket.")}
                <br />
                <b style={{ color: C.ink }}>{L("Android", "Android")}:</b> {L("Open Google Calendar on a computer → Other calendars → From URL, then paste the link.", "Nyisd meg a Google Naptárt számítógépen → Egyéb naptárak → URL alapján, majd illeszd be a linket.")}
              </div>
              <div style={{ background: C.amberSoft, borderRadius: 12, padding: "10px 12px", marginTop: 11, fontFamily: B, fontSize: 10.5, color: C.ink, lineHeight: 1.55 }}>
                {L("Treat this link like a password — anyone who has it can see your schedule. It cannot be used to log in or change anything.", "Kezeld ezt a linket jelszóként — aki megkapja, látja a beosztásodat. Bejelentkezni vagy módosítani nem lehet vele.")}
              </div>
              <button onClick={reset} disabled={busy}
                style={{ background: "none", border: "none", padding: "10px 0 0", cursor: "pointer", fontFamily: B, fontWeight: 700, fontSize: 11.5, color: C.coral }}>
                {L("Create a new link and stop the old one", "Új link készítése, a régi letiltása")}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Add a booking to the phone's calendar.
   We fetch the .ics from the server (it knows what this role is allowed to see),
   then hand it to the OS: the share sheet inside the app, a download in a browser.
   Opening a .ics is what makes iOS and Android offer "Add to Calendar". ── */
async function addBookingToCalendar(bookingId, orderNo) {
  const { API_BASE, getToken } = await import("./lib/api.js");
  const res = await fetch(`${API_BASE}/api/calendar/booking/${bookingId}.ics`, {
    headers: { Authorization: "Bearer " + getToken() },
  });
  if (!res.ok) throw new Error("calendar " + res.status);
  const text = await res.text();
  const name = `cleano-booking-${orderNo || "1"}.ics`;

  try {
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.isNativePlatform()) {
      const { Filesystem, Directory, Encoding } = await import("@capacitor/filesystem");
      const { Share } = await import("@capacitor/share");
      const w = await Filesystem.writeFile({ path: name, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
      await Share.share({ title: "Add to calendar", url: w.uri });
      return;
    }
  } catch (e) { /* fall through to the browser path */ }

  const blob = new Blob([text], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* Small button used on every booking card, for all three roles. */
function AddToCalendar({ booking, small = true }) {
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  if (!booking?.id) return null;
  return (
    <button
      disabled={busy}
      onClick={async (e) => {
        e.stopPropagation();
        setBusy(true);
        try { await addBookingToCalendar(booking.id, booking.order_no); }
        catch { toast(L("Could not open the calendar file", "Nem sikerült megnyitni a naptárfájlt"), "error"); }
        finally { setBusy(false); }
      }}
      style={{ border: `1.5px solid ${C.line}`, background: C.card, color: C.navySoft, cursor: "pointer",
        fontFamily: B, fontWeight: 700, fontSize: small ? 11 : 12.5, padding: small ? "6px 12px" : "9px 15px",
        borderRadius: 99, opacity: busy ? .6 : 1 }}>
      {busy ? "…" : L("Add to calendar", "Naptárhoz adom")}
    </button>
  );
}

/* ── The partner uploads the invoice they issued to the customer.
   Cleano never issues in their name, so this is the only way the customer gets
   their invoice in the app — which means the nudge to do it has to be visible
   on the job itself, not buried in a settings screen. ── */
function PartnerInvoiceBox({ booking }) {
  const { fetchInvoices, uploadPartnerInvoice } = useStore();
  const toast = useToast();
  const [inv, setInv] = React.useState(undefined);
  const [open, setOpen] = React.useState(false);
  const [num, setNum] = React.useState("");
  const [date, setDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [pdf, setPdf] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => { fetchInvoices(booking.id).then((r) => setInv(r || null)); }, [booking.id]);
  if (booking.status !== 4 || booking.payment_status !== "paid") return null;
  if (inv === undefined) return null;

  if (inv?.partner) {
    return (
      <div style={{ background: C.mintSoft, borderRadius: 12, padding: "9px 12px", marginTop: 10, fontFamily: B, fontSize: 11.5, color: C.ink }}>
        ✓ {L("Invoice uploaded", "Számla feltöltve")} · <b>{inv.partner.number}</b>
      </div>
    );
  }

  const pick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast(L("That file is too large — 5 MB maximum", "Túl nagy a fájl — legfeljebb 5 MB"), "error"); return; }
    const r = new FileReader();
    r.onload = () => setPdf(String(r.result));
    r.readAsDataURL(file);
  };

  const send = async () => {
    setBusy(true);
    const res = await uploadPartnerInvoice(booking.id, { invoiceNumber: num.trim(), issuedAt: date, pdf });
    setBusy(false);
    if (res?.error) { toast(res.error, "error"); return; }
    toast(L("Invoice saved — the customer can see it now", "Számla mentve — az ügyfél már látja"));
    setInv({ partner: { number: num.trim() } });
    setOpen(false);
  };

  return (
    <div style={{ background: C.amberSoft, borderRadius: 12, padding: "10px 12px", marginTop: 10 }}>
      <div style={{ fontFamily: B, fontWeight: 700, fontSize: 11.5, color: C.ink }}>
        {L("This job still needs your invoice", "Ehhez a munkához még hiányzik a számlád")}
      </div>
      <div style={{ fontFamily: B, fontSize: 10.5, color: C.inkSoft, marginTop: 3, lineHeight: 1.5 }}>
        {L("Issue it in your own system for the full amount, with the Cleano platform fee as a separate intermediated line, then upload it here.", "Állítsd ki a saját rendszeredben a teljes összegről, a Cleano platformdíjjal külön, közvetített szolgáltatásként, majd töltsd fel ide.")}
      </div>
      {!open ? (
        <Btn small style={{ marginTop: 9 }} onClick={() => setOpen(true)}>{L("Upload invoice", "Számla feltöltése")}</Btn>
      ) : (
        <div style={{ marginTop: 9 }}>
          <input value={num} onChange={(e) => setNum(e.target.value)} placeholder={L("Invoice number", "Számla sorszáma")}
            style={{ width: "100%", boxSizing: "border-box", background: C.card, border: "none", borderRadius: 11, padding: "10px 12px", fontFamily: B, fontSize: 12.5, color: C.ink, outline: "none", marginBottom: 7 }} />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", background: C.card, border: "none", borderRadius: 11, padding: "10px 12px", fontFamily: B, fontSize: 12.5, color: C.ink, outline: "none", marginBottom: 7 }} />
          <input type="file" accept="application/pdf" onChange={pick}
            style={{ width: "100%", fontFamily: B, fontSize: 11, color: C.inkSoft, marginBottom: 9 }} />
          <div style={{ display: "flex", gap: 8 }}>
            <Btn small ghost full onClick={() => setOpen(false)}>{L("Cancel", "Mégse")}</Btn>
            <Btn small full disabled={busy || num.trim().length < 3} onClick={send}>{busy ? "…" : L("Save", "Mentés")}</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

/* The customer's view: one line, and a download if the partner attached a PDF. */
function CustomerInvoiceLine({ booking }) {
  const { fetchInvoices } = useStore();
  const [inv, setInv] = React.useState(undefined);
  React.useEffect(() => { fetchInvoices(booking.id).then((r) => setInv(r || null)); }, [booking.id]);
  if (booking.payment_status !== "paid") return null;
  if (inv === undefined) return null;

  if (!inv?.partner) {
    return (
      <div style={{ fontFamily: B, fontSize: 11, color: C.inkFaint, marginTop: 8 }}>
        {L("Your invoice will appear here once the company issues it.", "A számlád itt jelenik meg, amint a cég kiállítja.")}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, background: C.bg, borderRadius: 11, padding: "8px 11px", marginTop: 9 }}>
      <span style={{ fontFamily: B, fontSize: 11.5, color: C.ink }}>🧾 {L("Invoice", "Számla")} {inv.partner.number}</span>
      {inv.partner.hasPdf && (
        <button onClick={async () => {
          const { API_BASE, getToken } = await import("./lib/api.js");
          const res = await fetch(`${API_BASE}/api/invoices/${booking.id}/partner.pdf`, { headers: { Authorization: "Bearer " + getToken() } });
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a"); a.href = url; a.download = `${inv.partner.number}.pdf`;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 4000);
        }} style={{ border: "none", background: "none", cursor: "pointer", fontFamily: B, fontWeight: 700, fontSize: 11, color: C.navySoft }}>
          {L("Download", "Letöltés")}
        </button>
      )}
    </div>
  );
}

/* ── A company reports a customer. Never shown to the customer: this is a safety
   channel to the platform, not a public rating. Telling someone they were
   reported for being abusive is how you make abuse worse. ── */
function ReportCustomerBox({ booking }) {
  const { reportCustomer } = useStore();
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [cat, setCat] = React.useState("abusive");
  const [detail, setDetail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  if (Number(booking.status) < 2) return null;   // nothing to report before anyone turned up

  const CATS = [
    ["abusive", L("Abusive or threatening", "Bántalmazó vagy fenyegető")],
    ["absent", L("Nobody there / no access", "Senki nem volt ott / nem lehetett bejutni")],
    ["unsafe", L("Unsafe conditions", "Nem biztonságos körülmények")],
    ["payment", L("Payment problem", "Fizetési probléma")],
    ["other", L("Something else", "Egyéb")],
  ];

  if (sent) return (
    <div style={{ background: C.mintSoft, borderRadius: 12, padding: "9px 12px", marginTop: 9, fontFamily: B, fontSize: 11.5, color: C.ink }}>
      ✓ {L("Reported to Cleano — we'll look into it", "Bejelentve a Cleanónak — megvizsgáljuk")}
    </div>
  );

  return (
    <>
      <button onClick={() => setOpen(true)}
        style={{ border: "none", background: "none", padding: "8px 0 0", cursor: "pointer", fontFamily: B, fontWeight: 700, fontSize: 11, color: C.inkFaint }}>
        ⚑ {L("Report a problem with this customer", "Probléma bejelentése az ügyfélről")}
      </button>
      {open && (
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(12,16,38,.55)", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center", padding: 22 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, borderRadius: 22, padding: 22, width: "100%", maxWidth: 380, maxHeight: "88vh", overflowY: "auto" }}>
            <div style={{ fontFamily: F, fontWeight: 700, fontSize: 16, color: C.ink }}>{L("Report a problem with this customer", "Probléma bejelentése az ügyfélről")}</div>
            <div style={{ fontFamily: B, fontSize: 11.5, color: C.inkSoft, marginTop: 6, lineHeight: 1.55 }}>
              {L("This goes to Cleano only — the customer is never told and never sees it. Nobody is suspended automatically; a person reads every report.", "Ez csak a Cleanóhoz jut el — az ügyfél nem értesül róla és nem látja. Senkit nem függesztünk fel automatikusan; minden bejelentést ember olvas el.")}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 13 }}>
              {CATS.map(([id, lbl]) => (
                <button key={id} onClick={() => setCat(id)}
                  style={{ border: "none", cursor: "pointer", fontFamily: B, fontWeight: 700, fontSize: 11, padding: "7px 12px", borderRadius: 99,
                    background: cat === id ? C.navy : C.bg, color: cat === id ? "#fff" : C.inkSoft }}>{lbl}</button>
              ))}
            </div>
            <textarea rows={5} value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={2000}
              placeholder={L("What happened? Dates, times and what was said or done help us act on it.", "Mi történt? A dátum, az időpont és az elhangzottak segítenek intézkedni.")}
              style={{ width: "100%", boxSizing: "border-box", background: C.bg, border: "none", borderRadius: 13, padding: "12px 14px", fontFamily: B, fontSize: 13, color: C.ink, outline: "none", resize: "vertical", marginTop: 12 }} />
            <div style={{ display: "flex", gap: 8, marginTop: 13 }}>
              <Btn full ghost onClick={() => setOpen(false)}>{L("Cancel", "Mégse")}</Btn>
              <Btn full disabled={busy || detail.trim().length < 10} onClick={async () => {
                setBusy(true);
                const res = await reportCustomer(booking.id, cat, detail.trim());
                setBusy(false);
                if (res?.error) { toast(res.error, "error"); return; }
                setSent(true); setOpen(false);
                toast(L("Reported to Cleano — we'll look into it", "Bejelentve a Cleanónak — megvizsgáljuk"));
              }}>{busy ? "…" : L("Send report", "Bejelentés küldése")}</Btn>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function CompanyReviews() {
  const { fetchCompanyReviews, dataVersion, reportReview } = useStore();
  const toast = useToast();
  const [data, setData] = React.useState(null);
  const [filter, setFilter] = React.useState("all");
  const [reporting, setReporting] = React.useState(null);
  const [reason, setReason] = React.useState("");
  const [rBusy, setRBusy] = React.useState(false);
  React.useEffect(() => { fetchCompanyReviews().then(setData); }, [dataVersion]);
  if (!data) return <div style={{ textAlign: "center", padding: 60, fontFamily: B, color: C.inkSoft }}>Loading reviews…</div>;
  const reviews = data.reviews || [];
  const cleaners = data.cleaners || [];
  const shown = filter === "all" ? reviews : reviews.filter((r) => String(r.cleaner_id || "unassigned") === filter);
  /* Two different numbers, and the difference matters:
       · the COMPANY rating is what customers see on your card — one figure,
         no cleaner attached, because a review is of the company;
       · the per-cleaner averages are yours alone, for managing your team.
     Take the headline from the server so it matches the marketplace exactly. */
  const headline = data.company?.rating != null ? Number(data.company.rating) : null;
  const headlineCount = Number(data.company?.reviewCount ?? reviews.length);
  const avg = reviews.length ? Math.round((reviews.reduce((a, r) => a + (Number(r.rating) || 0), 0) / reviews.length) * 10) / 10 : 0;
  const stars = (n) => "★".repeat(Math.round(n || 0)) + "☆".repeat(Math.max(0, 5 - Math.round(n || 0)));
  return (
    <div className="cl-fade" style={{ padding: "calc(20px + env(safe-area-inset-top)) 20px 30px" }}>
      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 21, color: C.ink, margin: "8px 0 4px" }}>{L("Reviews", "Értékelések")}</div>
      <div style={{ fontFamily: B, fontSize: 12.5, color: C.inkSoft, marginBottom: 16 }}>
        {headlineCount} {L("reviews", "értékelés")} · {L("average", "átlag")} <b style={{ color: C.navy }}>{(headline ?? avg) || "—"}</b> <span style={{ color: C.amber }}>{stars(avg)}</span>
      </div>

      <div style={{ background: C.navyChip, borderRadius: 14, padding: "11px 13px", marginBottom: 12, fontFamily: B, fontSize: 11, color: C.inkSoft, lineHeight: 1.55 }}>
        {L("Customers see one rating for your company — never which cleaner did the job. The breakdown below is yours alone.", "Az ügyfelek egyetlen céges értékelést látnak — azt soha nem, hogy melyik takarító végezte a munkát. Az alábbi bontás csak a tiéd.")}
      </div>

      {cleaners.length > 0 && (
        <div style={{ background: C.card, borderRadius: 20, padding: 16, marginBottom: 16, boxShadow: "0 2px 12px rgba(20,28,58,.06)" }}>
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13.5, color: C.ink, marginBottom: 10 }}>{L("By cleaner", "Takarítónként")}</div>
          {cleaners.map((c) => (
            <button key={c.cleanerId || "unassigned"} onClick={() => setFilter(String(c.cleanerId || "unassigned"))}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, background: filter === String(c.cleanerId || "unassigned") ? C.bg : "transparent", border: "none", borderRadius: 13, padding: "9px 10px", cursor: "pointer", textAlign: "left" }}>
              <Avatar name={c.name} size={32} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13, color: C.ink }}>{c.name}</div>
                <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft }}>{c.count} {L("reviews", "értékelés")}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontFamily: F, fontWeight: 700, fontSize: 14, color: C.navy }}>{c.average}</div>
                <div style={{ fontSize: 10, color: C.amber }}>{stars(c.average)}</div>
              </div>
            </button>
          ))}
          {filter !== "all" && (
            <button onClick={() => setFilter("all")} style={{ marginTop: 8, background: "none", border: "none", fontFamily: B, fontWeight: 700, fontSize: 11.5, color: C.navySoft, cursor: "pointer" }}>
              ← {L("Show all reviews", "Összes értékelés")}
            </button>
          )}
        </div>
      )}

      {shown.length === 0 && <div style={{ fontFamily: B, fontSize: 13, color: C.inkSoft, textAlign: "center", padding: 40 }}>{L("No reviews yet.", "Még nincs értékelés.")}</div>}
      {shown.map((r) => (
        <div key={r.id} style={{ background: C.card, borderRadius: 18, padding: 15, marginBottom: 10, boxShadow: "0 2px 10px rgba(20,28,58,.05)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13.5, color: C.ink }}>{r.customer_name || L("Customer", "Ügyfél")}</div>
            <div style={{ color: C.amber, fontSize: 13 }}>{stars(r.rating)}</div>
          </div>
          <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft, marginTop: 3 }}>
            {r.service_snapshot && r.service_snapshot.name ? r.service_snapshot.name + " · " : ""}
            {r.cleaner_name ? r.cleaner_name + " · " : ""}
            {(() => { try { return new Date(r.created_at).toLocaleDateString(LOC()); } catch { return ""; } })()}
          </div>
          {r.comment && <div style={{ fontFamily: B, fontSize: 12.5, color: C.ink, marginTop: 8, lineHeight: 1.55 }}>“<Translated map={r.body_i18n} fallback={r.comment} />”</div>}
          {r.reported_at ? (
            <div style={{ fontFamily: B, fontSize: 11, color: C.amber, fontWeight: 700, marginTop: 9 }}>
              ⚑ {L("Reported — an admin is reviewing it", "Bejelentve — az admin átnézi")}
            </div>
          ) : (
            <button onClick={() => setReporting(r)} style={{ border: "none", background: "none", padding: "8px 0 0", cursor: "pointer", fontFamily: B, fontWeight: 700, fontSize: 11, color: C.inkFaint }}>
              ⚑ {L("Report this review", "Értékelés bejelentése")}
            </button>
          )}
        </div>
      ))}

      {/* report dialog — a real reason, so admins can judge it fairly */}
      {reporting && (
        <div onClick={() => setReporting(null)} style={{ position: "fixed", inset: 0, background: "rgba(12,16,38,.55)", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center", padding: 22 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, borderRadius: 22, padding: 22, width: "100%", maxWidth: 360 }}>
            <div style={{ fontFamily: F, fontWeight: 700, fontSize: 16, color: C.ink }}>{L("Report this review", "Értékelés bejelentése")}</div>
            <div style={{ fontFamily: B, fontSize: 12, color: C.inkSoft, marginTop: 6, lineHeight: 1.55 }}>
              {L("Tell us what's wrong with it. An admin reads every report. Reviews are only removed if they break the rules — not for being negative.", "Írd le, mi a baj vele. Minden bejelentést admin olvas el. Csak szabálysértő értékelést törlünk — a negatívat nem.")}
            </div>
            <textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500}
              placeholder={L("e.g. abusive language, not a real customer, mentions a different company", "pl. sértő hangnem, nem valódi ügyfél, más céget említ")}
              style={{ width: "100%", boxSizing: "border-box", background: C.bg, border: "none", borderRadius: 13, padding: "12px 14px", fontFamily: B, fontSize: 13, color: C.ink, outline: "none", resize: "vertical", marginTop: 12 }} />
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <Btn full ghost onClick={() => setReporting(null)}>{L("Cancel", "Mégse")}</Btn>
              <Btn full disabled={reason.trim().length < 5 || rBusy} onClick={async () => {
                setRBusy(true);
                const res = await reportReview(reporting.id, reason.trim());
                setRBusy(false);
                if (res?.error) { toast(res.error, "error"); return; }
                toast(L("Reported — thank you", "Bejelentve — köszönjük"));
                setReporting(null); setReason("");
              }}>{rBusy ? "…" : L("Report", "Bejelentés")}</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CompanySettings() {
  const { session, companies, updateCompany, bookings, services } = useStore();
  const toast = useToast();
  const co = companies.find((c) => c.id === session.companyId);
  const [f, setF] = useState({
    name: co?.name || "", tagline: co?.tagline || "", area: co?.area || "", city: co?.city || "",
    country: co?.country || "HU",
    service_lat: co?.service_lat ?? null, service_lng: co?.service_lng ?? null,
    service_radius_km: co?.service_radius_km || 10,
    emoji: co?.emoji || "🫧", student_discount: co?.student_discount ?? 10,
    promo_on: !!promoOf(co), promo_pct: promoOf(co)?.pct ?? 10, promo_label: promoOf(co)?.label || "", promo_until: promoOf(co)?.until || "",
    cover: co?.cover || COVER_PRESETS[0], logo_url: co?.logo_url || null,
    tax_id: co?.tax_id || "", reg_number: co?.reg_number || "", contact_phone: co?.contact_phone || "", google_place_id: co?.google_place_id || "",
    documents: co?.documents || [],
    requirements: Array.isArray(co?.requirements) ? co.requirements : [],
    billing_name: co?.billing_name || "", billing_zip: co?.billing_zip || "",
    billing_city: co?.billing_city || "", billing_address: co?.billing_address || "",
    billing_email: co?.billing_email || "",
  });
  const [avail, setAvail] = React.useState(() => {
    const a = co?.availability;
    if (!a) return { ...JSON.parse(JSON.stringify(DEFAULT_AVAIL)), busy: {}, busyServices: {} };
    return { paused: !!a.paused, days: { ...DEFAULT_AVAIL.days, ...(a.days || {}) }, closed: Array.isArray(a.closed) ? a.closed : [], busy: a.busy && typeof a.busy === "object" ? a.busy : {}, busyServices: a.busyServices && typeof a.busyServices === "object" ? a.busyServices : {} };
  });
  const [closedDate, setClosedDate] = React.useState("");
  const [busyDate, setBusyDate] = React.useState("");
  const [busySvc, setBusySvc] = React.useState("");   // "" = blocks every service
  const myServices = (services || []).filter((x) => x.company_id === session.companyId && x.is_active !== false);
  /* Which hours on the chosen date already hold a real, live booking. Blocking one
     of those would hide the job from the company without cancelling it. */
  const bookedSlots = React.useMemo(() => {
    const out = new Set();
    for (const b of bookings || []) {
      if (b.company_id !== session.companyId) continue;
      if (Number(b.status) === 8 || Number(b.status) === 9) continue;
      if (String(b.scheduled_date).slice(0, 10) !== busyDate) continue;
      out.add(String(b.scheduled_slot).slice(0, 5));
    }
    return out;
  }, [bookings, busyDate, session.companyId]);
  const DAY_NAMES = HUL()
    ? ["Vasárnap", "Hétfő", "Kedd", "Szerda", "Csütörtök", "Péntek", "Szombat"]
    : [L("Sunday","Vasárnap"), L("Monday","Hétfő"), L("Tuesday","Kedd"), L("Wednesday","Szerda"), L("Thursday","Csütörtök"), L("Friday","Péntek"), L("Saturday","Szombat")];
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const onLogoFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast(L("Please choose a PNG image", "Válassz PNG képet"), "error");
    /* Logos are shrunk too, so a 6 MB export from a design tool just works.
       A logo is displayed small, so 512px is plenty. */
    compressImage(file, { maxEdge: 512, maxBytes: 200 * 1024 })
      .then((data) => setF((p) => ({ ...p, logo_url: data })))
      .catch(() => toast(L("Could not read that image", "Nem sikerült beolvasni a képet"), "error"));
  };

  const save = async () => {
    if (!f.name.trim()) return toast(L("Company name is required", "A cégnév kötelező"), "error");
    const disc = parseInt(f.student_discount, 10);
    if (isNaN(disc) || disc < 0 || disc > 50) return toast(L("Discount must be 0–50%", "A kedvezmény 0–50% között lehet"), "error");
    setBusy(true);
    const res = await updateCompany({ name: f.name.trim(), tagline: f.tagline, area: f.area, emoji: f.emoji || "🫧", student_discount: disc, promo: f.promo_on ? { pct: parseInt(f.promo_pct, 10) || 10, label: f.promo_label, until: f.promo_until || null } : null, cover: f.cover, logo_url: f.logo_url, tax_id: f.tax_id, reg_number: f.reg_number, contact_phone: f.contact_phone, google_place_id: f.google_place_id, documents: f.documents, availability: avail,
      billingName: f.billing_name.trim(), billingZip: f.billing_zip.trim(), billingCity: f.billing_city.trim(),
      billingAddress: f.billing_address.trim(), billingEmail: f.billing_email.trim(),
      city: (f.city || "").trim(), requirements: (f.requirements || []).map((x) => String(x).trim()).filter(Boolean).slice(0, 12),
      country: f.country, serviceLat: f.service_lat, serviceLng: f.service_lng, serviceRadiusKm: f.service_radius_km });
    setBusy(false);
    if (res?.error) toast(res.error, "error");
    else toast(L("Company profile updated ✓", "Cégprofil frissítve ✓"));
  };

  return (
    <div className="cl-fade" style={{ padding: "calc(20px + env(safe-area-inset-top)) 20px 30px" }}>
      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 21, color: C.ink, margin: "8px 0 18px" }}>{L("Company settings", "Cégbeállítások")}</div>

      <div style={{ height: 110, background: f.cover, borderRadius: 20, marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden" }}>
        <div style={{ width: 68, height: 68, borderRadius: 18, background: C.card, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, overflow: "hidden" }}>
          {f.logo_url ? <img src={f.logo_url} alt="logo" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (f.emoji || "🫧")}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center" }}>
        <label style={{ flex: 1, textAlign: "center", fontFamily: F, fontWeight: 700, fontSize: 13, padding: "12px 0", borderRadius: 14, background: `linear-gradient(135deg,${C.navy},${C.navyMid})`, color: "#fff", cursor: "pointer", boxShadow: "0 6px 18px rgba(27,42,107,.28)" }}>
          ⬆️ Upload your logo (PNG)
          <input type="file" accept="image/png,image/*" onChange={onLogoFile} style={{ display: "none" }} />
        </label>
        {f.logo_url && <Btn small ghost onClick={() => setF({ ...f, logo_url: null })} style={{ color: C.coral }}>{L("Remove", "Törlés")}</Btn>}
      </div>

      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12, color: C.ink, marginBottom: 8 }}>{L("Cover colour", "Borítószín")}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
        {COVER_PRESETS.map((p) => (
          <button key={p} onClick={() => setF({ ...f, cover: p })} style={{ width: 38, height: 38, borderRadius: 11, background: p, border: f.cover === p ? `3px solid ${C.navy}` : "3px solid transparent", cursor: "pointer", outline: f.cover === p ? `2px solid #fff` : "none", outlineOffset: -4 }} />
        ))}
      </div>

      <Field label={L("Emoji (shown if no logo uploaded)", "Emoji (ha nincs feltöltött logó)")} placeholder="🫧" value={f.emoji} onChange={set("emoji")} />
      <Field label={L("Company name *", "Cégnév *")} placeholder={L("SparkClean Kft.", "Ragyogó Kft.")} value={f.name} onChange={set("name")} />
      {/* 4.3 — free text with suggestions, so any city in any country works */}
      <Field label={L("City served", "Kiszolgált város")} placeholder="Debrecen" list="cleano-cities"
        value={f.city || ""} onChange={set("city")} />
      <datalist id="cleano-cities">{ALL_CITIES.map((c) => <option key={c} value={c} />)}</datalist>
      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink, marginBottom: 7 }}>{L("Country", "Ország")}</div>
      <select value={f.country || "HU"} onChange={(e) => setF({ ...f, country: e.target.value })}
        style={{ width: "100%", boxSizing: "border-box", padding: "13px 15px", borderRadius: 15, border: `1.5px solid ${C.line}`, fontFamily: B, fontSize: 14, background: C.card, color: C.ink, marginBottom: 14, outline: "none" }}>
        {DIAL_CODES.map((x) => <option key={x.c} value={x.c}>{x.f} {x.n}</option>)}
      </select>
      <Field label={L("Tagline", "Szlogen")} placeholder={L("What makes you different?", "Miben vagytok mások?")} value={f.tagline} onChange={set("tagline")} />
      <Field label={L("Service area (shown on your card)", "Ellátott terület (a kártyádon látszik)")} placeholder="e.g. Belváros · Nagyerdő" value={f.area} onChange={set("area")} />

      {/* ── 4.6 the circle that actually decides who can book you ── */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink, marginBottom: 3 }}>{L("Where you work", "Hol dolgozol")}</div>
        <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft, marginBottom: 8, lineHeight: 1.5 }}>
          {L("Drag the pin to your base and set how far you travel. Only customers inside the circle can book you.", "Húzd a jelölőt a bázisodhoz, és állítsd be, milyen messzire mész el. Csak a körön belüli ügyfelek tudnak foglalni.")}
        </div>
        <AreaMap lat={f.service_lat} lng={f.service_lng} radiusKm={f.service_radius_km || 10}
          onChange={({ lat, lng }) => setF((p) => ({ ...p, service_lat: lat, service_lng: lng }))} />
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
          <input type="range" min="1" max="50" value={f.service_radius_km || 10}
            onChange={(e) => setF((p) => ({ ...p, service_radius_km: Number(e.target.value) }))}
            style={{ flex: 1, accentColor: C.navy }} />
          <span style={{ fontFamily: F, fontWeight: 700, fontSize: 13, color: C.ink, minWidth: 52, textAlign: "right" }}>{f.service_radius_km || 10} km</span>
        </div>
      </div>

      {/* ── 5.4 What you need the customer to have ready ── */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink, marginBottom: 3 }}>{L("What customers must provide", "Mit kell az ügyfélnek biztosítania")}</div>
        <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft, marginBottom: 8, lineHeight: 1.5 }}>
          {L("Shown before they pay, and they must tick to agree. One per line — e.g. \"Parking space for our van\", \"Hot running water\", \"Someone home to let us in\".", "A fizetés előtt látják, és pipálniuk kell. Soronként egyet — pl. „Parkolóhely a furgonnak”, „Meleg folyóvíz”, „Legyen otthon valaki”.")}
        </div>
        <textarea rows={4} value={(f.requirements || []).join("\n")}
          onChange={(e) => setF((p) => ({ ...p, requirements: e.target.value.split("\n").map((x) => x.slice(0, 160)) }))}
          placeholder={L("Parking space for our van\nHot running water\nSomeone home to let us in", "Parkolóhely a furgonnak\nMeleg folyóvíz\nLegyen otthon valaki")}
          style={{ width: "100%", boxSizing: "border-box", background: C.bg, border: "none", borderRadius: 13, padding: "12px 14px", fontFamily: B, fontSize: 13, color: C.ink, outline: "none", resize: "vertical", lineHeight: 1.7 }} />
      </div>

      {/* ── Billing address. Cleano invoices you the platform fee, and a Hungarian
             invoice is not valid without a postcode, town and street. ── */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink, marginBottom: 3 }}>{L("Billing address", "Számlázási cím")}</div>
        <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft, marginBottom: 8, lineHeight: 1.5 }}>
          {L("Cleano invoices you for the platform fee, so we need your billing details exactly as they should appear on an invoice.", "A Cleano a platformdíjról számlát állít ki neked, ezért pontosan úgy kérjük az adataidat, ahogy a számlán szerepelniük kell.")}
        </div>
        <Field label={L("Billing name (if different from the company name)", "Számlázási név (ha eltér a cégnévtől)")} value={f.billing_name} onChange={set("billing_name")} />
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ width: 110 }}><Field label={L("Postcode", "Irányítószám")} value={f.billing_zip} onChange={set("billing_zip")} placeholder="4032" /></div>
          <div style={{ flex: 1 }}><Field label={L("Town", "Település")} value={f.billing_city} onChange={set("billing_city")} placeholder="Debrecen" /></div>
        </div>
        <Field label={L("Street and number", "Utca, házszám")} value={f.billing_address} onChange={set("billing_address")} placeholder={L("Bolyai utca 11.", "Bolyai utca 11.")} />
        <Field label={L("Where should we send invoices?", "Hová küldjük a számlákat?")} value={f.billing_email} onChange={set("billing_email")} placeholder="szamla@ceged.hu" />
      </div>

      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink, margin: "4px 0 8px" }}>Business details (for verification & invoicing)</div>
      <Field label={L("Tax number (adószám)", "Adószám")} placeholder="12345678-1-42"
        hint={f.tax_id?.trim() ? (huTaxIdValid(f.tax_id) ? "✅ Valid" : "❌ Invalid format — 12345678-1-42") : undefined}
        value={f.tax_id} onChange={set("tax_id")} />
      <Field label={L("Company registration no.", "Cégjegyzékszám")} placeholder="09-09-123456" value={f.reg_number} onChange={set("reg_number")} />
      <PhoneField label={L("Contact phone", "Kapcsolattartó telefonszám")} value={f.contact_phone} onChange={(v) => setF((p) => ({ ...p, contact_phone: v }))} />
      <JobHistory />
      <PayoutSetup />
      <Field label="Google Place ID (optional)" hint={L("Happy customers get a one-tap 'Review on Google' button. Search 'Google Place ID finder' to get yours.", "Az elégedett ügyfelek egy gombbal értékelhetnek Google-ön. Keresd: 'Google Place ID finder'.")} placeholder="ChIJ…" value={f.google_place_id || ""} onChange={set("google_place_id")} />
      <DocUpload
        label={L("Verification documents", "Igazoló dokumentumok")}
        hint="Cégkivonat, tax certificate, insurance — reviewed by the Cleano admin."
        docs={f.documents || []}
        onChange={(docs) => setF({ ...f, documents: docs })}
      />

      <div style={{ marginBottom: 13 }}>
        <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink, marginBottom: 7 }}>{L("Student discount %", "Diákkedvezmény %")}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <input type="range" min={0} max={50} step={5} value={f.student_discount} onChange={set("student_discount")} style={{ flex: 1, accentColor: C.navy }} />
          <span style={{ fontFamily: F, fontWeight: 700, fontSize: 15, color: C.navy, minWidth: 44 }}>{f.student_discount}%</span>
        </div>
        <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft, marginTop: 5 }}>{L("Students see this as a discount at checkout.", "A diákok ezt kedvezményként látják fizetéskor.")}</div>
      </div>

      <div style={{ background: C.card, borderRadius: 18, padding: 16, marginBottom: 16, boxShadow: "0 2px 10px rgba(20,28,58,.05)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13.5, color: C.ink }}>{L("Special offer", "Akció")}</div>
            <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft, marginTop: 2 }}>A discount for all customers — shown on your card and applied at checkout.</div>
          </div>
          <button onClick={() => setF({ ...f, promo_on: !f.promo_on })} style={{ width: 46, height: 26, borderRadius: 99, border: "none", cursor: "pointer", background: f.promo_on ? C.green : C.line, position: "relative", transition: "background .2s", flexShrink: 0 }}>
            <span style={{ position: "absolute", top: 3, left: f.promo_on ? 23 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .2s", boxShadow: "0 1px 4px rgba(0,0,0,.25)" }} />
          </button>
        </div>
        {f.promo_on && (
          <div style={{ marginTop: 13 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
              <input type="range" min={5} max={50} step={5} value={f.promo_pct} onChange={set("promo_pct")} style={{ flex: 1, accentColor: C.green }} />
              <span style={{ fontFamily: F, fontWeight: 700, fontSize: 15, color: C.greenDeep, minWidth: 44 }}>−{f.promo_pct}%</span>
            </div>
            <Field label={L("Offer name (optional)", "Akció neve (nem kötelező)")} placeholder={L("e.g. Spring cleaning week", "pl. Tavaszi nagytakarítás hete")} value={f.promo_label} onChange={set("promo_label")} />
            <Field label={L("Ends on (optional — empty = until you turn it off)", "Meddig tart (nem kötelező — üresen: amíg ki nem kapcsolod)")} type="date" value={f.promo_until} onChange={set("promo_until")} />
            <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft }}>If a student's discount is higher, they get the better one — never both.</div>
          </div>
        )}
      </div>

      <div style={{ background: C.card, borderRadius: 18, padding: 16, marginBottom: 16, boxShadow: "0 2px 10px rgba(20,28,58,.05)" }}>
        <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13.5, color: C.ink }}>{L("Availability", "Elérhetőség")}</div>
        <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft, marginTop: 2, marginBottom: 12, lineHeight: 1.5 }}>
          {L("Tap the hours you accept bookings. Customers see exactly these times — nothing else.", "Koppints az órákra, amikor vállalsz munkát. Az ügyfelek pontosan ezeket látják.")}
        </div>

        {/* fully booked / paused */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: avail.paused ? C.amberSoft : C.bg, borderRadius: 14, padding: "11px 13px", marginBottom: 12 }}>
          <div style={{ flex: 1, paddingRight: 10 }}>
            <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink }}>{L("Fully booked — pause new bookings", "Betelt — foglalások szüneteltetése")}</div>
            <div style={{ fontFamily: B, fontSize: 10.5, color: C.inkSoft, marginTop: 2 }}>{L("You stay listed, but nobody can book until you switch this off.", "A profilod látható marad, de nem lehet foglalni.")}</div>
          </div>
          <button onClick={() => setAvail({ ...avail, paused: !avail.paused })}
            style={{ width: 46, height: 26, borderRadius: 99, border: "none", cursor: "pointer", background: avail.paused ? C.amber : C.line, position: "relative", flexShrink: 0 }}>
            <span style={{ position: "absolute", top: 3, left: avail.paused ? 23 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .2s", boxShadow: "0 1px 4px rgba(0,0,0,.25)" }} />
          </button>
        </div>

        {/* per-weekday hours */}
        {["1","2","3","4","5","6","0"].map((k) => {
          const d = avail.days[k] || { on: false, slots: [] };
          const sel = Array.isArray(d.slots) ? d.slots : [];
          const setDay = (patch) => setAvail({ ...avail, days: { ...avail.days, [k]: { ...d, ...patch } } });
          const toggleHour = (h) => {
            const next = sel.includes(h) ? sel.filter((x) => x !== h) : [...sel, h].sort();
            setDay({ slots: next, on: next.length > 0 });
          };
          return (
            <div key={k} style={{ padding: "10px 0", borderBottom: `1px solid ${C.line}55` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: d.on ? 8 : 0 }}>
                <button onClick={() => setDay({ on: !d.on, slots: !d.on && sel.length === 0 ? ["08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00"] : sel })}
                  style={{ width: 38, height: 22, borderRadius: 99, border: "none", cursor: "pointer", background: d.on ? C.green : C.line, position: "relative", flexShrink: 0 }}>
                  <span style={{ position: "absolute", top: 3, left: d.on ? 19 : 3, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left .2s" }} />
                </button>
                <span style={{ flex: 1, fontFamily: B, fontWeight: 700, fontSize: 12, color: d.on ? C.ink : C.inkFaint }}>{DAY_NAMES[Number(k)]}</span>
                <span style={{ fontFamily: B, fontSize: 10.5, color: C.inkFaint }}>
                  {d.on ? `${sel.length} ${L("hours", "óra")}` : L("Closed", "Zárva")}
                </span>
              </div>
              {d.on && (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 5 }}>
                    {HOURS.map((h) => {
                      const on = sel.includes(h);
                      return (
                        <button key={h} onClick={() => toggleHour(h)}
                          style={{ padding: "7px 0", borderRadius: 10, border: "none", cursor: "pointer", fontFamily: B, fontWeight: 700, fontSize: 11,
                            background: on ? C.navy : C.bg, color: on ? "#fff" : C.inkFaint }}>
                          {h.slice(0, 2)}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                    <button onClick={() => setDay({ slots: [...HOURS] })} style={{ background: "none", border: "none", padding: 0, fontFamily: B, fontWeight: 700, fontSize: 10.5, color: C.navySoft, cursor: "pointer" }}>{L("All", "Mind")}</button>
                    <button onClick={() => setDay({ slots: [] , on: false })} style={{ background: "none", border: "none", padding: 0, fontFamily: B, fontWeight: 700, fontSize: 10.5, color: C.inkFaint, cursor: "pointer" }}>{L("None", "Egyik sem")}</button>
                    {Number(k) >= 1 && Number(k) <= 5 && (
                      <button onClick={() => {
                        const days = { ...avail.days };
                        for (const wd of ["1","2","3","4","5"]) days[wd] = { on: sel.length > 0, slots: [...sel] };
                        setAvail({ ...avail, days });
                      }} style={{ background: "none", border: "none", padding: 0, fontFamily: B, fontWeight: 700, fontSize: 10.5, color: C.green, cursor: "pointer" }}>
                        {L("Copy to Mon–Fri", "Másolás H–P")}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}

        {/* specific days off (holidays, etc.) */}
        <div style={{ marginTop: 14 }}>
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink, marginBottom: 6 }}>{L("Days off", "Szabadnapok")}</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input type="date" value={closedDate} onChange={(e) => setClosedDate(e.target.value)}
              style={{ flex: 1, border: `1.5px solid ${C.line}`, borderRadius: 12, padding: "9px 11px", fontFamily: B, fontSize: 12.5, background: C.bg, color: C.ink, outline: "none" }} />
            <Btn small disabled={!closedDate} onClick={() => {
              if (!closedDate || avail.closed.includes(closedDate)) return;
              setAvail({ ...avail, closed: [...avail.closed, closedDate].sort() });
              setClosedDate("");
            }}>{L("Add", "Hozzáad")}</Btn>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {avail.closed.length === 0 && <span style={{ fontFamily: B, fontSize: 11, color: C.inkFaint }}>{L("No days off set.", "Nincs beállított szabadnap.")}</span>}
            {avail.closed.map((dt) => (
              <button key={dt} onClick={() => setAvail({ ...avail, closed: avail.closed.filter((x) => x !== dt) })}
                style={{ fontFamily: B, fontWeight: 700, fontSize: 11, padding: "6px 10px", borderRadius: 99, border: "none", background: C.bg, color: C.inkSoft, cursor: "pointer" }}>
                {dt} ✕
              </button>
            ))}
          </div>
        </div>

        {/* ── busy time slots on a specific date ── */}
        <div style={{ marginTop: 16, borderTop: `1px solid ${C.line}55`, paddingTop: 14 }}>
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink, marginBottom: 3 }}>{L("Busy time slots", "Foglalt időpontok")}</div>
          <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft, marginBottom: 8, lineHeight: 1.5 }}>
            {L("Pick any date in the next 2 months, then tap the times you're already busy — customers can't book those.", "Válassz bármely dátumot a következő 2 hónapban, majd koppints a foglalt időpontokra — azokat nem lehet lefoglalni.")}
          </div>
          {/* Quick jumps, because a native date picker is a lot of taps for "next Saturday". */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            {[[0, L("Today", "Ma")], [1, L("Tomorrow", "Holnap")], [7, L("In a week", "Egy hét múlva")], [30, L("In a month", "Egy hónap múlva")]].map(([n, lbl]) => {
              const iso = (() => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
              return (
                <button key={n} onClick={() => setBusyDate(iso)}
                  style={{ border: "none", cursor: "pointer", fontFamily: B, fontWeight: 700, fontSize: 10.5, padding: "6px 11px", borderRadius: 99,
                    background: busyDate === iso ? C.navy : C.bg, color: busyDate === iso ? "#fff" : C.inkSoft }}>{lbl}</button>
              );
            })}
          </div>
          <input type="date" value={busyDate} onChange={(e) => setBusyDate(e.target.value)}
            min={todayISO()} max={maxBookISO()}
            style={{ width: "100%", boxSizing: "border-box", border: `1.5px solid ${C.line}`, borderRadius: 12, padding: "9px 11px", fontFamily: B, fontSize: 12.5, background: C.bg, color: C.ink, outline: "none", marginBottom: 9 }} />
          {busyDate && myServices.length > 0 && (
            <div style={{ marginBottom: 9 }}>
              <div style={{ fontFamily: B, fontSize: 10.5, fontWeight: 700, color: C.inkFaint, marginBottom: 5 }}>
                {L("Block for", "Mire vonatkozik")}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button onClick={() => setBusySvc("")}
                  style={{ border: "none", cursor: "pointer", fontFamily: B, fontWeight: 700, fontSize: 10.5, padding: "6px 11px", borderRadius: 99,
                    background: busySvc === "" ? C.navy : C.bg, color: busySvc === "" ? "#fff" : C.inkSoft }}>
                  {L("Everything", "Minden")}
                </button>
                {myServices.map((sv) => (
                  <button key={sv.id} onClick={() => setBusySvc(sv.id)}
                    style={{ border: "none", cursor: "pointer", fontFamily: B, fontWeight: 700, fontSize: 10.5, padding: "6px 11px", borderRadius: 99,
                      background: busySvc === sv.id ? C.navy : C.bg, color: busySvc === sv.id ? "#fff" : C.inkSoft }}>
                    {sv.icon} {sv.name}
                  </button>
                ))}
              </div>
              <div style={{ fontFamily: B, fontSize: 10, color: C.inkFaint, marginTop: 6, lineHeight: 1.5 }}>
                {busySvc
                  ? L("Only this service is blocked — your other services stay bookable at these times.", "Csak ez a szolgáltatás lesz letiltva — a többi ezekben az időpontokban is foglalható marad.")
                  : L("Blocks every service at these times.", "Ezekben az időpontokban minden szolgáltatást letilt.")}
              </div>
            </div>
          )}
          {busyDate && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 7 }}>
              {(daySlots(avail, busyDate).length ? daySlots(avail, busyDate) : HOURS).map((sl) => {
                const list = busySvc
                  ? ((avail.busyServices?.[busySvc] || {})[busyDate] || [])
                  : (avail.busy[busyDate] || []);
                const isBusy = list.includes(sl);
                /* A slot with a real booking in it is shown as taken and cannot be
                   toggled — blocking it would not cancel the job, it would just
                   hide it from you. */
                const booked = bookedSlots.has(sl);
                return (
                  <button key={sl} disabled={booked} title={booked ? L("Already booked by a customer", "Egy ügyfél már lefoglalta") : undefined}
                    onClick={() => {
                      const next = isBusy ? list.filter((x) => x !== sl) : [...list, sl].sort();
                      if (busySvc) {
                        const bs = { ...(avail.busyServices || {}) };
                        const forSvc = { ...(bs[busySvc] || {}) };
                        if (next.length) forSvc[busyDate] = next; else delete forSvc[busyDate];
                        if (Object.keys(forSvc).length) bs[busySvc] = forSvc; else delete bs[busySvc];
                        setAvail({ ...avail, busyServices: bs });
                      } else {
                        const busy = { ...avail.busy };
                        if (next.length) busy[busyDate] = next; else delete busy[busyDate];
                        setAvail({ ...avail, busy });
                      }
                    }} style={{ padding: "9px 0", borderRadius: 12, border: "none", cursor: booked ? "not-allowed" : "pointer", fontFamily: B, fontWeight: 700, fontSize: 11.5,
                      background: booked ? C.navyChip : isBusy ? C.coral : C.bg, color: booked ? C.navy : isBusy ? "#fff" : C.inkSoft }}>
                    {sl}{booked ? " ✓" : ""}
                  </button>
                );
              })}
            </div>
          )}
          {Object.keys(avail.busy || {}).length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontFamily: B, fontSize: 10.5, fontWeight: 700, color: C.inkFaint, marginBottom: 5 }}>{L("Blocked", "Letiltva")}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {Object.entries(avail.busy).sort().map(([dt, list]) => (
                  <button key={dt} onClick={() => { const busy = { ...avail.busy }; delete busy[dt]; setAvail({ ...avail, busy }); }}
                    style={{ fontFamily: B, fontWeight: 700, fontSize: 10.5, padding: "6px 10px", borderRadius: 99, border: "none", background: C.coralSoft, color: C.coral, cursor: "pointer" }}>
                    {dt}: {list.join(", ")} ✕
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <Btn full disabled={busy} onClick={save}>{busy ? "Saving…" : "Save company profile"}</Btn>

      <div style={{ marginTop: 22, padding: "14px 16px", background: co?.is_approved ? C.mintSoft : C.amberSoft, borderRadius: 16 }}>
        <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13, color: C.ink, marginBottom: 5 }}>
          {co?.is_approved ? "✅ Approved & live" : "⏳ Pending admin approval"}
        </div>
        <div style={{ fontFamily: B, fontSize: 11.5, color: co?.is_approved ? C.greenDeep : C.amber, lineHeight: 1.6 }}>
          {co?.is_approved
            ? "Your company is verified and visible to customers in search."
            : "Your documents are under review. Set everything up now — customers will see you as soon as an admin approves your account."}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   ADMIN
════════════════════════════════════════════════════════════ */

function AnnouncementComposer() {
  const { adminBroadcast, adminAllUsers: adminUsers, adminFetchUsers } = useStore();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [aud, setAud] = useState("all");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [person, setPerson] = useState(null);   // { id, name, email }
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null); // { count }
  const AUDS = [["all", "Everyone"], ["customer", "Customers"], ["company", "Companies"], ["employee", "Cleaners"]];

  const filters = person ? { userId: person.id }
    : { city: city.trim() || undefined, country: country.trim() || undefined };

  /* Search people by name or email, from the admin user list already loaded. */
  const matches = React.useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return [];
    return (adminUsers || []).filter((u) => u.role !== "admin" &&
      ((u.name || "").toLowerCase().includes(t) || (u.email || "").toLowerCase().includes(t))).slice(0, 6);
  }, [q, adminUsers]);

  useEffect(() => { if (open && !(adminUsers || []).length) adminFetchUsers?.(); }, [open]);

  const describe = () => {
    if (person) return `${person.name} (${person.email})`;
    const bits = [AUDS.find((x) => x[0] === aud)?.[1] || "Everyone"];
    if (city.trim()) bits.push(`in ${city.trim()}`);
    if (country.trim()) bits.push(`· ${country.trim().toUpperCase()}`);
    return bits.join(" ");
  };

  /* Step 1 — ask the server how many people this actually hits. */
  const preview = async () => {
    if (!title.trim()) return;
    setBusy(true);
    const res = await adminBroadcast(title.trim(), body.trim(), aud, { ...filters, preview: true });
    setBusy(false);
    if (res?.error) { toast(res.error); return; }
    if (!res?.count) { toast(L("That audience matches nobody", "Ehhez a körhöz senki nem tartozik")); return; }
    setConfirm({ count: res.count });
  };

  /* Step 2 — only now does anything leave the building. */
  const send = async () => {
    setBusy(true);
    const res = await adminBroadcast(title.trim(), body.trim(), aud, filters);
    setBusy(false);
    setConfirm(null);
    if (res?.error) { toast(res.error); return; }
    toast(`Sent to ${res.sent} user${res.sent === 1 ? "" : "s"}`);
    setTitle(""); setBody(""); setCity(""); setCountry(""); setPerson(null); setQ(""); setOpen(false);
  };

  const inputS = { width: "100%", boxSizing: "border-box", background: C.bg, border: "none", borderRadius: 13, padding: "12px 14px", fontFamily: B, fontSize: 13, color: C.ink, outline: "none" };

  return (
    <div className="cl-card" style={{ background: C.card, borderRadius: 20, padding: 18, marginBottom: 14 }}>
      <button onClick={() => setOpen(!open)} style={{ background: "none", border: "none", padding: 0, width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
        <div style={{ textAlign: "left" }}>
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 14.5, color: C.ink }}>{L("Send announcement", "Hirdetmény küldése")}</div>
          <div style={{ fontFamily: B, fontSize: 11.5, color: C.inkSoft, marginTop: 2 }}>Target everyone, a role, a city, a country — or one person. You see the recipient count before it sends.</div>
        </div>
        <span style={{ color: C.inkFaint, fontSize: 15 }}>{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div style={{ marginTop: 14 }}>
          {/* who */}
          <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap", opacity: person ? .4 : 1, pointerEvents: person ? "none" : "auto" }}>
            {AUDS.map(([id, label]) => (
              <button key={id} onClick={() => setAud(id)} style={{ border: "none", cursor: "pointer", fontFamily: B, fontWeight: 700, fontSize: 11.5, padding: "7px 13px", borderRadius: 99, background: aud === id ? C.navy : C.bg, color: aud === id ? "#fff" : C.inkSoft }}>{label}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10, opacity: person ? .4 : 1, pointerEvents: person ? "none" : "auto" }}>
            <input value={city} onChange={(e) => setCity(e.target.value)} placeholder={L("City (optional)", "Város (nem kötelező)")} style={{ ...inputS, flex: 1 }} />
            <input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))} placeholder="HU" maxLength={2} style={{ ...inputS, width: 74, textAlign: "center", flex: "0 0 auto" }} />
          </div>

          {/* one person */}
          {person ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: C.navySoft, borderRadius: 13, padding: "10px 14px", marginBottom: 10 }}>
              <div>
                <div style={{ fontFamily: B, fontWeight: 700, fontSize: 12.5, color: C.ink }}>{person.name}</div>
                <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft }}>{person.email}</div>
              </div>
              <button onClick={() => { setPerson(null); setQ(""); }} style={{ border: "none", background: "none", cursor: "pointer", fontFamily: B, fontWeight: 700, fontSize: 11.5, color: C.red }}>{L("Clear", "Törlés")}</button>
            </div>
          ) : (
            <div style={{ position: "relative", marginBottom: 10 }}>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("…or send to one person — search name or email", "…vagy küldd egy embernek — keress névre vagy e-mailre")} style={inputS} />
              {matches.length > 0 && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20, background: C.card, borderRadius: 13, boxShadow: "0 8px 24px rgba(20,28,58,.16)", overflow: "hidden", marginTop: 4 }}>
                  {matches.map((u) => (
                    <button key={u.id} onClick={() => { setPerson({ id: u.id, name: u.name, email: u.email }); setQ(""); }}
                      style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "none", cursor: "pointer", padding: "10px 14px", fontFamily: B, fontSize: 12.5, color: C.ink }}>
                      {u.name} <span style={{ color: C.inkFaint }}>· {u.email}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={L("Title — e.g. 20% off your first clean this week", "Cím — pl. 20% kedvezmény az első takarításra a héten")} style={{ ...inputS, marginBottom: 8 }} />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={500} rows={3} placeholder={L("Message (optional)", "Üzenet (nem kötelező)")} style={{ ...inputS, resize: "vertical", marginBottom: 10 }} />
          <div style={{ fontFamily: B, fontSize: 11.5, color: C.inkSoft, marginBottom: 8 }}>Sending to: <b style={{ color: C.ink }}>{describe()}</b></div>
          <Btn full onClick={preview} disabled={busy || !title.trim()}>{busy ? "Checking…" : "Review before sending"}</Btn>
        </div>
      )}

      {/* confirmation — the last stop before a few thousand phones buzz */}
      {confirm && (
        <div onClick={() => setConfirm(null)} style={{ position: "fixed", inset: 0, background: "rgba(12,16,38,.55)", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center", padding: 22 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, borderRadius: 22, padding: 22, width: "100%", maxWidth: 340 }}>
            <div style={{ fontFamily: F, fontWeight: 700, fontSize: 16, color: C.ink }}>Send to {confirm.count} {confirm.count === 1 ? "person" : "people"}?</div>
            <div style={{ fontFamily: B, fontSize: 12.5, color: C.inkSoft, marginTop: 6, lineHeight: 1.6 }}>
              {describe()}<br /><b style={{ color: C.ink }}>{title}</b>{body ? <><br />{body}</> : null}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <Btn full ghost onClick={() => setConfirm(null)}>{L("Cancel", "Mégse")}</Btn>
              <Btn full onClick={send} disabled={busy}>{busy ? "Sending…" : "Send now"}</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminDashboard() {
  const { adminStats, adminFetchStats, adminRevenue, adminFetchRevenue } = useStore();
  const [busy, setBusy] = useState(false);
  const [tries, setTries] = useState(0);

  React.useEffect(() => {
    if (!adminStats) { setBusy(true); Promise.all([adminFetchStats(), adminFetchRevenue()]).finally(() => setBusy(false)); }
  }, [tries]);

  if (busy)
    return <div style={{ textAlign: "center", padding: 60, fontFamily: B, color: C.inkSoft }}>Loading stats…</div>;
  if (!adminStats)
    return (
      <div style={{ textAlign: "center", padding: 60 }}>
        <div style={{ fontFamily: B, fontSize: 13, color: C.inkSoft, marginBottom: 14 }}>{L("Couldn't load platform stats.", "Nem sikerült betölteni a statisztikákat.")}</div>
        <Btn small onClick={() => setTries(t => t + 1)}>↻ Retry</Btn>
      </div>
    );

  const s = adminStats;
  const kpis = [
    { k: "Total users", v: s.totalUsers, icon: "👤" },
    { k: "Companies", v: s.totalCompanies, icon: "🏢" },
    { k: "Bookings", v: s.totalBookings, icon: "📅" },
    { k: "Completed", v: s.completedBookings, icon: "✅" },
    { k: "Active now", v: s.activeBookings, icon: "🔥" },
    { k: "Platform revenue", v: huf(s.totalRevenue || 0), icon: "💰" },
  ];

  const maxRev = Math.max(...(adminRevenue || []).map((r) => r.revenue || 0), 1);

  return (
    <div className="cl-fade" style={{ padding: "calc(20px + env(safe-area-inset-top)) 20px 30px" }}>
      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 21, color: C.ink, margin: "8px 0 18px" }}>{L("Platform dashboard", "Platform áttekintés")}</div>
      {useStore().session?.isSuper === true && <AnnouncementComposer />}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
        {kpis.map((k) => (
          <div key={k.k} style={{ background: C.card, borderRadius: 16, padding: "13px 14px", boxShadow: "0 2px 10px rgba(20,28,58,.05)" }}>
            <div style={{ fontSize: 20, marginBottom: 6 }}>{k.icon}</div>
            <div style={{ fontFamily: F, fontWeight: 700, fontSize: 17, color: C.navy }}>{k.v}</div>
            <div style={{ fontFamily: B, fontSize: 10.5, color: C.inkSoft, marginTop: 2 }}>{k.k}</div>
          </div>
        ))}
      </div>

      {adminRevenue && adminRevenue.length > 0 && (
        <>
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 14, color: C.ink, marginBottom: 12 }}>Revenue — last 30 days</div>
          <div style={{ background: C.card, borderRadius: 16, padding: "16px 14px", boxShadow: "0 2px 10px rgba(20,28,58,.05)" }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 80 }}>
              {adminRevenue.map((r, i) => (
                <div key={i} title={`${r.date}: ${huf(r.revenue)}`} style={{ flex: 1, background: `linear-gradient(180deg,${C.navySoft},${C.navy})`, borderRadius: "4px 4px 0 0", height: `${Math.max(4, (r.revenue / maxRev) * 100)}%`, opacity: r.revenue > 0 ? 1 : .15 }} />
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontFamily: B, fontSize: 9.5, color: C.inkFaint, marginTop: 6 }}>
              <span>{adminRevenue[0]?.date?.slice(5)}</span>
              <span>{adminRevenue[adminRevenue.length - 1]?.date?.slice(5)}</span>
            </div>
          </div>
        </>
      )}

      {s.bookingsByStatus && (
        <>
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 14, color: C.ink, margin: "18px 0 10px" }}>{L("Bookings by status", "Foglalások állapot szerint")}</div>
          {Object.entries(s.bookingsByStatus).map(([st, cnt]) => {
            const label = st === "9" ? "Cancelled" : st === "8" ? "Declined" : stageList()[parseInt(st)] || `Status ${st}`;
            return (
              <div key={st} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                <div style={{ width: 80, fontFamily: B, fontSize: 11.5, color: C.inkSoft }}>{label}</div>
                <div style={{ flex: 1, height: 8, borderRadius: 9, background: C.line, overflow: "hidden" }}>
                  <div style={{ height: "100%", background: C.navySoft, borderRadius: 9, width: `${Math.max(2, (cnt / s.totalBookings) * 100)}%` }} />
                </div>
                <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12, color: C.navy, minWidth: 24, textAlign: "right" }}>{cnt}</div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

function AdminCompanies() {
  const { adminAllCompanies, adminFetchAllCompanies, adminUpdateCompany, adminFetchCompanyServices } = useStore();
  const [svcOpen, setSvcOpen] = useState(null);
  const openListings = async (co) => setSvcOpen({ name: co.name, list: await adminFetchCompanyServices(co.id) });
  const toast = useToast();
  const [busy, setBusy] = useState(!adminAllCompanies);
  const [viewDocs, setViewDocs] = useState(null);

  React.useEffect(() => {
    if (!adminAllCompanies) adminFetchAllCompanies().finally(() => setBusy(false));
  }, []);

  if (busy) return <div style={{ textAlign: "center", padding: 60, fontFamily: B, color: C.inkSoft }}>Loading…</div>;

  return (
    <div className="cl-fade" style={{ padding: "calc(20px + env(safe-area-inset-top)) 20px 30px" }}>
      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 21, color: C.ink, margin: "8px 0 18px" }}>Companies ({(adminAllCompanies || []).length})</div>
      {(() => {
        const offers = (adminAllCompanies || []).filter((c) => promoOf(c));
        if (!offers.length) return null;
        return (
          <div style={{ background: C.mintSoft, borderRadius: 18, padding: "14px 16px", marginBottom: 14 }}>
            <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13, color: C.greenDeep, marginBottom: 8 }}>Active offers ({offers.length})</div>
            {offers.map((c) => {
              const p = promoOf(c);
              return (
                <div key={c.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontFamily: B, fontSize: 12, color: C.ink, padding: "4px 0" }}>
                  <span style={{ fontWeight: 700 }}>{c.name}</span>
                  <span style={{ color: C.greenDeep, fontWeight: 700, whiteSpace: "nowrap" }}>−{p.pct}%{p.label ? ` · ${p.label}` : ""}{p.until ? ` · until ${p.until}` : ""}</span>
                </div>
              );
            })}
          </div>
        );
      })()}
      {(adminAllCompanies || []).map((co) => (
        <div key={co.id} style={{ background: C.card, borderRadius: 18, padding: 16, marginBottom: 12, boxShadow: "0 2px 12px rgba(20,28,58,.06)", opacity: co.is_approved ? 1 : .65 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <CompanyLogo co={co} size={42} radius={13} />
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: F, fontWeight: 700, fontSize: 14.5, color: C.ink, display: "flex", alignItems: "center", gap: 7 }}>{co.name}{promoOf(co) && <Pill bg={C.mintSoft} color={C.greenDeep}>−{promoOf(co).pct}%</Pill>}</div>
              <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft, marginTop: 2 }}>
                ★ {co.rating} · {co.booking_count} bookings · {huf(co.revenue || 0)}
              </div>
              <div style={{ fontFamily: B, fontSize: 10.5, color: C.inkFaint, marginTop: 1 }}>Owner: {co.owner_name || "—"} · {co.owner_email || "—"}</div>
              {(co.tax_id || co.reg_number) && <div style={{ fontFamily: B, fontSize: 10.5, color: C.inkFaint, marginTop: 1 }}>🧾 Tax ID: {co.tax_id || "—"}{co.reg_number ? ` · Reg: ${co.reg_number}` : ""}</div>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <Pill bg={co.is_approved ? C.mintSoft : C.coralSoft} color={co.is_approved ? C.green : C.coral}>
              {co.is_approved ? "Approved" : "Suspended"}
            </Pill>
            <Pill bg={co.is_listed ? C.navyChip : "#F5F5F5"} color={co.is_listed ? C.navySoft : C.inkFaint}>
              {co.is_listed ? "Listed" : "Unlisted"}
            </Pill>
            <button onClick={async () => {
              const res = await adminUpdateCompany(co.id, { is_approved: !co.is_approved });
              if (res?.error) toast(res.error, "error");
              else { toast(co.is_approved ? "Company suspended" : "Company approved"); adminFetchAllCompanies(); }
            }} style={{ marginLeft: "auto", fontFamily: B, fontWeight: 700, fontSize: 11, padding: "6px 12px", borderRadius: 99, border: `1.5px solid ${co.is_approved ? C.coral : C.green}`, background: C.card, color: co.is_approved ? C.coral : C.green, cursor: "pointer" }}>
              {co.is_approved ? "Suspend" : "Approve"}
            </button>
            <button onClick={async () => {
              const res = await adminUpdateCompany(co.id, { is_listed: !co.is_listed });
              if (res?.error) toast(res.error, "error");
              else { toast(co.is_listed ? "Company unlisted" : "Company listed"); adminFetchAllCompanies(); }
            }} style={{ fontFamily: B, fontWeight: 700, fontSize: 11, padding: "6px 12px", borderRadius: 99, border: `1.5px solid ${C.line}`, background: C.card, color: C.navySoft, cursor: "pointer" }}>
              {co.is_listed ? "Unlist" : "Re-list"}
            </button>
            <button onClick={() => openListings(co)} style={{ fontFamily: B, fontWeight: 700, fontSize: 11, padding: "6px 12px", borderRadius: 99, border: `1.5px solid ${C.line}`, background: C.card, color: C.navySoft, cursor: "pointer", marginRight: 6 }}>
              Listings
            </button>
            <button onClick={() => setViewDocs({ title: `${co.name} — documents`, docs: co.documents || [] })} style={{ fontFamily: B, fontWeight: 700, fontSize: 11, padding: "6px 12px", borderRadius: 99, border: `1.5px solid ${C.line}`, background: C.card, color: C.navySoft, cursor: "pointer" }}>
              📄 Docs ({(co.documents || []).length})
            </button>
          </div>
        </div>
      ))}
      {viewDocs && <DocViewer title={viewDocs.title} docs={viewDocs.docs} close={() => setViewDocs(null)} />}
      {detail && <AdminUserDetail userId={detail} close={() => setDetail(null)} onChanged={adminFetchUsers} />}
      {svcOpen && (
        <Sheet title={`${svcOpen.name} — listings (${svcOpen.list.length})`} close={() => setSvcOpen(null)}>
          {svcOpen.list.length === 0 && <div style={{ fontFamily: B, fontSize: 12.5, color: C.inkSoft, textAlign: "center", padding: 24 }}>{L("This company has no service listings yet.", "Ennek a cégnek még nincs szolgáltatása.")}</div>}
          {svcOpen.list.map((sv) => (
            <div key={sv.id} style={{ background: C.bg, borderRadius: 14, padding: "12px 14px", marginBottom: 9 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13, color: C.ink }}>{sv.name}</div>
                <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13, color: C.navy, whiteSpace: "nowrap" }}>{priceLabel(sv)}</div>
              </div>
              <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft, marginTop: 3 }}>
                {sv.pricing_type}{sv.is_active ? "" : " · HIDDEN"}{sv.description ? ` · ${String(sv.description).slice(0, 80)}` : ""}
              </div>
            </div>
          ))}
        </Sheet>
      )}
    </div>
  );
}

function ComplaintThread({ complaint, role, close, onChange }) {
  const { fetchComplaintThread, sendComplaintMessage, adminUpdateComplaint, assignComplaint, adminAllCompanies, adminFetchAllCompanies, setComplaintHandler, setCompanyAction, dataVersion } = useStore();
  const toast = useToast();
  const [msgs, setMsgs] = React.useState([]);
  const [text, setText] = React.useState("");
  const [note, setNote] = React.useState("");
  const [assignTo, setAssignTo] = React.useState("");
  const [status, setStatus] = React.useState(complaint.status);
  const [assigned, setAssigned] = React.useState(complaint.assigned_company_name || "");
  const [handledBy, setHandledBy] = React.useState(complaint.handled_by || "admin");
  const [coAction, setCoAction] = React.useState(complaint.company_action || "");
  const [cbNote, setCbNote] = React.useState("");
  const load = () => fetchComplaintThread(complaint.id).then((m) => setMsgs(m || []));
  React.useEffect(() => { load(); }, [dataVersion]);
  React.useEffect(() => { if (role === "admin" && (!adminAllCompanies || adminAllCompanies.length === 0)) adminFetchAllCompanies(); }, []);
  const send = async () => { if (!text.trim()) return; const r = await sendComplaintMessage(complaint.id, text.trim()); if (r?.error) toast(r.error, "error"); else { setText(""); load(); } };
  const doResolve = async () => { const r = await adminUpdateComplaint(complaint.id, { status: "resolved", resolution: note }); if (r?.error) toast(r.error, "error"); else { setStatus("resolved"); toast(L("Marked resolved", "Megoldottnak jelölve")); onChange && onChange(); } };
  const doAssign = async () => { if (!assignTo) return; const r = await assignComplaint(complaint.id, assignTo); if (r?.error) toast(r.error, "error"); else { const co = (adminAllCompanies || []).find((c) => c.id === assignTo); setAssigned(co?.name || "company"); setStatus("in_progress"); toast(L("Assigned to ", "Kiosztva: ") + (co?.name || L("company", "cég"))); onChange && onChange(); } };
  return (
    <Sheet title={`🛟 ${complaint.subject}`} close={close}>
      <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft, marginBottom: 10 }}>
        {complaint.user_name ? `From ${complaint.user_name} · ` : ""}{new Date(complaint.created_at).toLocaleString()}
        {assigned && <div style={{ marginTop: 4, color: C.navySoft, fontWeight: 700 }}>➡ Assigned to {assigned}</div>}
      </div>
      {complaint.body && <div style={{ background: C.bg, borderRadius: 12, padding: "10px 12px", fontFamily: B, fontSize: 12.5, color: C.ink, lineHeight: 1.6, marginBottom: 10 }}>{complaint.body}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 12, maxHeight: 280, overflowY: "auto" }}>
        {msgs.map((m) => {
          const mine = m.sender_role === role;
          return (
            <div key={m.id} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "82%", background: mine ? C.mint : C.card, borderRadius: 13, padding: "9px 12px", boxShadow: "0 1px 4px rgba(20,28,58,.06)" }}>
              <div style={{ fontFamily: B, fontWeight: 700, fontSize: 10, color: mine ? C.navyDeep : C.navySoft, marginBottom: 2, textTransform: "capitalize" }}>{mine ? "You" : (m.sender_name || m.sender_role)}</div>
              <div style={{ fontFamily: B, fontSize: 12.5, color: mine ? C.navyDeep : C.ink, lineHeight: 1.5 }}>{m.body}</div>
            </div>
          );
        })}
        {msgs.length === 0 && <div style={{ fontFamily: B, fontSize: 11.5, color: C.inkFaint, textAlign: "center", padding: 10 }}>{L("No replies yet.", "Még nincs válasz.")}</div>}
      </div>

      {/* ── who is talking to the customer ── */}
      {role === "admin" && (
        <div style={{ background: C.card, borderRadius: 16, padding: 14, marginBottom: 12 }}>
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink, marginBottom: 8 }}>{L("Who replies to the customer?", "Ki válaszol az ügyfélnek?")}</div>
          <div style={{ display: "flex", gap: 8 }}>
            {[["admin", "🛡️ Cleano handles it"], ["company", "🏢 Hand to the company"]].map(([id, label]) => (
              <button key={id} onClick={async () => {
                const r = await setComplaintHandler(complaint.id, id);
                if (r?.error) toast(r.error, "error");
                else { setHandledBy(id); toast(id === "company" ? "Handed to the company" : "Cleano is handling it"); onChange && onChange(); }
              }} style={{ flex: 1, fontFamily: B, fontWeight: 700, fontSize: 11.5, padding: "9px 10px", borderRadius: 12, cursor: "pointer",
                border: handledBy === id ? `2px solid ${C.navy}` : `1.5px solid ${C.line}`,
                background: handledBy === id ? C.navyChip : C.bg, color: handledBy === id ? C.navy : C.inkSoft }}>{label}</button>
            ))}
          </div>
          {handledBy === "company" && !assigned && (
            <div style={{ fontFamily: B, fontSize: 11, color: C.coral, marginTop: 7 }}>{L("Assign a company above first.", "Előbb rendelj hozzá egy céget fent.")}</div>
          )}
          {coAction && (
            <div style={{ fontFamily: B, fontSize: 11.5, color: C.inkSoft, marginTop: 8 }}>
              Company chose: <b style={{ color: C.ink }}>{coAction === "callback" ? "call the customer back" : "solve it in chat"}</b>
            </div>
          )}
        </div>
      )}

      {/* ── the company picks how to handle it ── */}
      {role === "company" && (complaint.handled_by === "company" || handledBy === "company") && (
        <div style={{ background: coAction ? C.mintSoft : C.amberSoft, borderRadius: 16, padding: 14, marginBottom: 12 }}>
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink, marginBottom: 4 }}>
            {coAction ? (coAction === "callback" ? "You chose to call the customer" : "You're solving this in chat") : "Cleano passed this report to you"}
          </div>
          <div style={{ fontFamily: B, fontSize: 11.5, color: C.inkSoft, marginBottom: 10, lineHeight: 1.5 }}>
            {coAction ? "You can still reply here at any time." : "Solve it right here in the chat, or call the customer back and report the outcome afterwards."}
          </div>
          {!coAction && (
            <>
              <Field label={L("Note to the customer (optional)", "Üzenet az ügyfélnek (nem kötelező)")} placeholder={L("e.g. we'll call you within the hour", "pl. egy órán belül hívunk")} value={cbNote} onChange={(e) => setCbNote(e.target.value)} />
              <div style={{ display: "flex", gap: 8 }}>
                <Btn small style={{ flex: 1 }} onClick={async () => {
                  const r = await setCompanyAction(complaint.id, "chat", cbNote);
                  if (r?.error) toast(r.error, "error"); else { setCoAction("chat"); toast(L("Replying here", "Válasz itt")); load(); onChange && onChange(); }
                }}>💬 {L("Solve in chat", "Megoldás chatben")}</Btn>
                <Btn small ghost style={{ flex: 1 }} onClick={async () => {
                  const r = await setCompanyAction(complaint.id, "callback", cbNote);
                  if (r?.error) toast(r.error, "error"); else { setCoAction("callback"); toast(L("Customer told you'll call", "Az ügyfél értesítve, hogy telefonálsz")); load(); onChange && onChange(); }
                }}>📞 {L("Call back", "Visszahívás")}</Btn>
              </div>
            </>
          )}
        </div>
      )}
      {status !== "resolved" ? (

        <div style={{ display: "flex", gap: 8, marginBottom: (role === "admin" || role === "company") ? 14 : 0 }}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a reply…" style={{ flex: 1, border: `1.5px solid ${C.line}`, borderRadius: 12, padding: "10px 13px", fontFamily: B, fontSize: 13, background: C.card, color: C.ink, outline: "none" }} />
          <Btn small mint disabled={!text.trim()} onClick={send}>Send</Btn>
        </div>
      ) : (
        <div style={{ fontFamily: B, fontSize: 12, fontWeight: 700, color: C.green, textAlign: "center", padding: 8 }}>✓ Resolved{complaint.resolution ? ` — ${complaint.resolution}` : ""}</div>
      )}
      {role === "admin" && status !== "resolved" && (
        <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 12, marginBottom: 12 }}>
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12, color: C.ink, marginBottom: 8 }}>{L("Move to a company to resolve", "Céghez rendelés megoldásra")}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)} style={{ flex: 1, border: `1.5px solid ${C.line}`, borderRadius: 12, padding: "9px 11px", fontFamily: B, fontSize: 12.5, background: C.card, color: C.ink }}>
              <option value="">Select a company…</option>
              {(adminAllCompanies || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <Btn small ghost disabled={!assignTo} onClick={doAssign}>Assign →</Btn>
          </div>
        </div>
      )}
      {(role === "admin" || role === "company") && status !== "resolved" && (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={L("Resolution note…", "Megoldás leírása…")} style={{ flex: 1, border: `1.5px solid ${C.line}`, borderRadius: 12, padding: "9px 11px", fontFamily: B, fontSize: 12.5, background: C.card, color: C.ink, outline: "none" }} />
          <Btn small mint onClick={doResolve}>✓ Resolve</Btn>
        </div>
      )}
    </Sheet>
  );
}

function CompanyComplaints() {
  const { myComplaints, fetchMyComplaints } = useStore();
  const [busy, setBusy] = useState(true);
  const [open, setOpen] = useState(null);
  React.useEffect(() => { fetchMyComplaints().finally(() => setBusy(false)); }, []);
  if (busy) return <div style={{ textAlign: "center", padding: 60, fontFamily: B, color: C.inkSoft }}>Loading…</div>;
  const list = myComplaints || [];
  const stat = { open: { l: "Open", bg: C.amberSoft, c: C.amber }, in_progress: { l: "To resolve", bg: C.navyChip, c: C.navySoft }, resolved: { l: "Resolved", bg: C.mintSoft, c: C.green } };
  return (
    <div className="cl-fade" style={{ padding: "calc(20px + env(safe-area-inset-top)) 20px 30px" }}>
      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 21, color: C.ink, margin: "8px 0 4px" }}>{L("Issues to resolve", "Megoldandó ügyek")}</div>
      <div style={{ fontFamily: B, fontSize: 12, color: C.inkSoft, marginBottom: 14 }}>{L("Complaints Cleano assigned to your company.", "A Cleano által a cégedhez rendelt panaszok.")}</div>
      {list.length === 0 && <div style={{ textAlign: "center", padding: 50, fontFamily: B, fontSize: 13, color: C.inkSoft }}>Nothing assigned to you 🎉</div>}
      {list.map((c) => (
        <div key={c.id} style={{ background: C.card, borderRadius: 16, padding: "13px 15px", marginBottom: 10, boxShadow: "0 1px 8px rgba(20,28,58,.05)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13.5, color: C.ink }}>{c.subject}</div>
            <Pill bg={stat[c.status]?.bg} color={stat[c.status]?.c}>{stat[c.status]?.l || c.status}</Pill>
          </div>
          <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft, marginTop: 4 }}>{c.user_name || "Customer"} · {new Date(c.created_at).toLocaleDateString()}</div>
          {c.body && <div style={{ fontFamily: B, fontSize: 12, color: C.ink, marginTop: 8, background: C.bg, borderRadius: 11, padding: "8px 11px", lineHeight: 1.55 }}>{c.body}</div>}
          <Btn small ghost style={{ marginTop: 10 }} onClick={() => setOpen(c)}>{c.status === "resolved" ? "View thread" : "Open & resolve →"}</Btn>
        </div>
      ))}
      {open && <ComplaintThread complaint={open} role="company" close={() => { setOpen(null); fetchMyComplaints(); }} onChange={fetchMyComplaints} />}
    </div>
  );
}

function CustomerReports({ close }) {
  const { myComplaints, fetchMyComplaints } = useStore();
  const [open, setOpen] = React.useState(null);
  React.useEffect(() => { fetchMyComplaints(); }, []);
  const list = myComplaints || [];
  const stat = { open: "🟠 Open", in_progress: "🔵 In progress", resolved: "🟢 Resolved" };
  return (
    <Sheet title={`🛟 ${L("My reports", "Bejelentéseim")}`} close={close}>
      {list.length === 0 && <div style={{ fontFamily: B, fontSize: 13, color: C.inkSoft, textAlign: "center", padding: 24 }}>{L("You haven't filed any reports.", "Még nem küldtél be bejelentést.")}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {list.map((c) => (
          <button key={c.id} onClick={() => setOpen(c)} style={{ textAlign: "left", border: "none", cursor: "pointer", background: C.card, borderRadius: 13, padding: "11px 13px", boxShadow: "0 1px 5px rgba(20,28,58,.05)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontFamily: F, fontWeight: 700, fontSize: 13, color: C.ink }}>{c.subject}</span>
              <span style={{ fontFamily: B, fontSize: 10.5, color: C.inkSoft, whiteSpace: "nowrap" }}>{stat[c.status] || c.status}</span>
            </div>
            {c.assigned_company_name && <div style={{ fontFamily: B, fontSize: 10.5, color: C.navySoft, marginTop: 3 }}>➡ {c.assigned_company_name}</div>}
          </button>
        ))}
      </div>
      {open && <ComplaintThread complaint={open} role="customer" close={() => { setOpen(null); fetchMyComplaints(); }} />}
    </Sheet>
  );
}

/* ── 5.9 Reported reviews. Lives with Complaints — same job, same instinct. ── */
function ReviewReports() {
  const { adminFetchReportedReviews, adminRemoveReview, adminDismissReport } = useStore();
  const toast = useToast();
  const [list, setList] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => adminFetchReportedReviews().then(setList);
  React.useEffect(() => { load(); }, []);
  if (!list || !list.length) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 14.5, color: C.ink, marginBottom: 4 }}>Reported reviews · {list.length}</div>
      <div style={{ fontFamily: B, fontSize: 11.5, color: C.inkSoft, marginBottom: 10 }}>{L("Remove only what breaks the rules. A bad score is not a reason.", "Csak a szabálysértőt töröld. A rossz pontszám nem indok.")}</div>
      {list.map((r) => (
        <div key={r.id} style={{ background: C.card, borderRadius: 18, padding: 15, marginBottom: 10, boxShadow: "0 2px 10px rgba(20,28,58,.05)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13, color: C.ink }}>{r.customer_name || "Customer"} → {r.company_name || "—"}</div>
            <div style={{ color: C.amber, fontSize: 12.5 }}>{stars(r.rating)}</div>
          </div>
          {r.comment && <div style={{ fontFamily: B, fontSize: 12.5, color: C.ink, marginTop: 8, lineHeight: 1.55 }}>“<Translated map={r.body_i18n} fallback={r.comment} />”</div>}
          <div style={{ background: C.amberSoft, borderRadius: 12, padding: "9px 12px", marginTop: 10 }}>
            <div style={{ fontFamily: B, fontWeight: 700, fontSize: 10.5, color: C.amber, letterSpacing: .3 }}>{L("REPORTED BY THE COMPANY", "A CÉG JELENTETTE BE")}</div>
            <div style={{ fontFamily: B, fontSize: 12, color: C.ink, marginTop: 3, lineHeight: 1.5 }}>{r.reported_reason}</div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 11 }}>
            <Btn full ghost onClick={async () => {
              const res = await adminDismissReport(r.id);
              if (res?.error) toast(res.error, "error"); else { toast(L("Report dismissed — review stays up", "Bejelentés elutasítva — az értékelés marad")); load(); }
            }}>{L("Keep it", "Marad")}</Btn>
            <Btn full danger onClick={() => { setRemoving(r); setReason(""); }}>{L("Remove", "Törlés")}</Btn>
          </div>
        </div>
      ))}
      {removing && (
        <div onClick={() => setRemoving(null)} style={{ position: "fixed", inset: 0, background: "rgba(12,16,38,.55)", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center", padding: 22 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, borderRadius: 22, padding: 22, width: "100%", maxWidth: 360 }}>
            <div style={{ fontFamily: F, fontWeight: 700, fontSize: 16, color: C.ink }}>{L("Remove this review", "Értékelés törlése")}</div>
            <div style={{ fontFamily: B, fontSize: 12, color: C.inkSoft, marginTop: 6, lineHeight: 1.55 }}>
              Your reason is logged permanently against your admin account, and the company's rating is recalculated.
            </div>
            <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={400}
              placeholder={L("Why it breaks the rules", "Miért sérti a szabályokat")}
              style={{ width: "100%", boxSizing: "border-box", background: C.bg, border: "none", borderRadius: 13, padding: "12px 14px", fontFamily: B, fontSize: 13, color: C.ink, outline: "none", resize: "vertical", marginTop: 12 }} />
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <Btn full ghost onClick={() => setRemoving(null)}>{L("Cancel", "Mégse")}</Btn>
              <Btn full danger disabled={reason.trim().length < 5 || busy} onClick={async () => {
                setBusy(true);
                const res = await adminRemoveReview(removing.id, reason.trim());
                setBusy(false);
                if (res?.error) { toast(res.error, "error"); return; }
                toast(L("Review removed", "Értékelés eltávolítva")); setRemoving(null); load();
              }}>{busy ? "…" : "Remove"}</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── The admin's queue of customers a company has reported. Sits with the other
   abuse handling, because it is the same job: read it, decide, write down why. ── */
function CustomerReportQueue() {
  const { adminCustomerReports, adminHandleCustomerReport } = useStore();
  const toast = useToast();
  const [list, setList] = React.useState(null);
  const [acting, setActing] = React.useState(null);   // { id, decision }
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const load = () => adminCustomerReports().then(setList);
  React.useEffect(() => { load(); }, []);
  if (!list || !list.length) return null;
  const open = list.filter((r) => r.status === "open");

  const CAT = { abusive: "Abusive or threatening", absent: "Nobody there / no access", unsafe: "Unsafe conditions", payment: "Payment problem", other: "Something else" };

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 14.5, color: C.ink, marginBottom: 4 }}>
        Customers reported by companies · {open.length} open
      </div>
      <div style={{ fontFamily: B, fontSize: 11.5, color: C.inkSoft, marginBottom: 10 }}>
        The customer is never told they were reported. Nobody is suspended automatically — you decide.
      </div>
      {list.slice(0, 40).map((r) => (
        <div key={r.id} style={{ background: C.card, borderRadius: 18, padding: 15, marginBottom: 10, boxShadow: "0 2px 10px rgba(20,28,58,.05)", opacity: r.status === "open" ? 1 : .6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13, color: C.ink }}>{r.customer_name || "—"}</div>
              <div style={{ fontFamily: B, fontSize: 10.5, color: C.inkSoft, marginTop: 2 }}>
                {r.company_name} · {r.order_no != null ? `#${r.order_no}` : ""} · {(() => { try { return new Date(r.created_at).toLocaleDateString(LOC()); } catch { return ""; } })()}
              </div>
            </div>
            <Pill bg={r.status === "open" ? C.amberSoft : C.bg} color={r.status === "open" ? C.amber : C.inkFaint}>
              {r.status === "open" ? "Open" : r.status === "reviewed" ? "Actioned" : "Dismissed"}
            </Pill>
          </div>
          <div style={{ fontFamily: B, fontWeight: 700, fontSize: 11, color: C.coral, marginTop: 8 }}>{CAT[r.category] || r.category}</div>
          <div style={{ fontFamily: B, fontSize: 12.5, color: C.ink, marginTop: 4, lineHeight: 1.55 }}>{r.detail}</div>
          {Number(r.reports_about_them) > 1 && (
            <div style={{ background: C.coralSoft, borderRadius: 10, padding: "7px 10px", marginTop: 8, fontFamily: B, fontWeight: 700, fontSize: 11, color: C.coral }}>
              ⚠ {r.reports_about_them} reports about this customer
            </div>
          )}
          {r.admin_note && (
            <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft, marginTop: 8, fontStyle: "italic" }}>Your note: {r.admin_note}</div>
          )}
          {r.status === "open" && (
            <div style={{ display: "flex", gap: 8, marginTop: 11 }}>
              <Btn full ghost onClick={() => { setActing({ id: r.id, decision: "dismissed" }); setNote(""); }}>{L("No action", "Nincs teendő")}</Btn>
              <Btn full danger onClick={() => { setActing({ id: r.id, decision: "reviewed" }); setNote(""); }}>{L("Record action", "Intézkedés rögzítése")}</Btn>
            </div>
          )}
        </div>
      ))}
      {acting && (
        <div onClick={() => setActing(null)} style={{ position: "fixed", inset: 0, background: "rgba(12,16,38,.55)", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center", padding: 22 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, borderRadius: 22, padding: 22, width: "100%", maxWidth: 360 }}>
            <div style={{ fontFamily: F, fontWeight: 700, fontSize: 16, color: C.ink }}>
              {acting.decision === "reviewed" ? "Record what you did" : "Close without action"}
            </div>
            <div style={{ fontFamily: B, fontSize: 12, color: C.inkSoft, marginTop: 6, lineHeight: 1.55 }}>
              Your note is kept permanently against this report and signed with your name.
            </div>
            <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000}
              placeholder={acting.decision === "reviewed" ? "e.g. called the customer, warned them, company reassigned" : "e.g. spoke to both sides, misunderstanding"}
              style={{ width: "100%", boxSizing: "border-box", background: C.bg, border: "none", borderRadius: 13, padding: "12px 14px", fontFamily: B, fontSize: 13, color: C.ink, outline: "none", resize: "vertical", marginTop: 12 }} />
            <div style={{ display: "flex", gap: 8, marginTop: 13 }}>
              <Btn full ghost onClick={() => setActing(null)}>Cancel</Btn>
              <Btn full disabled={busy || note.trim().length < 5} onClick={async () => {
                setBusy(true);
                const res = await adminHandleCustomerReport(acting.id, acting.decision, note.trim());
                setBusy(false);
                if (res?.error) { toast(res.error, "error"); return; }
                toast(L("Saved", "Mentve")); setActing(null); load();
              }}>{busy ? "…" : "Save"}</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminComplaints() {
  const { adminComplaints, adminFetchComplaints } = useStore();
  const [busy, setBusy] = useState(!adminComplaints);
  const [open, setOpen] = useState(null);
  React.useEffect(() => { if (!adminComplaints) adminFetchComplaints().finally(() => setBusy(false)); }, []);
  if (busy) return <div style={{ textAlign: "center", padding: 60, fontFamily: B, color: C.inkSoft }}>Loading…</div>;
  const list = adminComplaints || [];
  const stat = { open: { l: "Open", bg: C.amberSoft, c: C.amber }, in_progress: { l: "In progress", bg: C.navyChip, c: C.navySoft }, resolved: { l: "Resolved", bg: C.mintSoft, c: C.green } };
  return (
    <div className="cl-fade" style={{ padding: "calc(20px + env(safe-area-inset-top)) 20px 30px" }}>
      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 21, color: C.ink, margin: "8px 0 14px" }}>Complaints ({list.filter(c => c.status !== "resolved").length} open)</div>
      {list.length === 0 && <div style={{ textAlign: "center", padding: 50, fontFamily: B, fontSize: 13, color: C.inkSoft }}>No complaints — happy customers 🎉</div>}
      {list.map((c) => (
        <div key={c.id} style={{ background: C.card, borderRadius: 16, padding: "14px 16px", marginBottom: 12, boxShadow: "0 1px 8px rgba(20,28,58,.05)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13.5, color: C.ink }}>{c.subject}</div>
            <Pill bg={stat[c.status]?.bg} color={stat[c.status]?.c}>{stat[c.status]?.l || c.status}</Pill>
          </div>
          <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft, marginTop: 4 }}>
            {c.user_name || "User"} · {new Date(c.created_at).toLocaleString()}{c.assigned_company_name ? ` · ➡ ${c.assigned_company_name}` : ""}
          </div>
          {c.body && <div style={{ fontFamily: B, fontSize: 12.5, color: C.ink, marginTop: 8, lineHeight: 1.6, background: C.bg, borderRadius: 12, padding: "9px 12px" }}>{c.body}</div>}
          {c.resolution && <div style={{ fontFamily: B, fontSize: 11.5, color: C.green, marginTop: 8 }}>✓ {c.resolution}</div>}
          <Btn small ghost style={{ marginTop: 10 }} onClick={() => setOpen(c)}>💬 Manage / assign →</Btn>
        </div>
      ))}
      {open && <ComplaintThread complaint={open} role="admin" close={() => { setOpen(null); adminFetchComplaints(); }} onChange={adminFetchComplaints} />}
    </div>
  );
}

/* ── 5.10 Everything we hold on one person, in one place. 5.11 lets an admin
   correct a company's details — never its prices, its Stripe account or its
   password. Every edit is written to the audit log with before → after. ── */
function AdminUserDetail({ userId, close, onChanged }) {
  const { adminUserFull, adminEditCompanyDetails } = useStore();
  const toast = useToast();
  const [d, setD] = useState(null);
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  React.useEffect(() => { adminUserFull(userId).then(setD); }, [userId]);

  const startEdit = () => {
    const c = d.company || {};
    setF({ name: c.name || "", tagline: c.tagline || "", area: c.area || "", city: c.city || "",
      country: c.country || "HU", contact_phone: c.contact_phone || "", tax_id: c.tax_id || "",
      reg_number: c.reg_number || "", service_radius_km: c.service_radius_km || 10,
      is_listed: c.is_listed !== false, is_approved: c.is_approved === true });
    setEditing(true);
  };
  const save = async () => {
    setBusy(true);
    const res = await adminEditCompanyDetails(d.company.id, f);
    setBusy(false);
    if (res?.error) { toast(res.error, "error"); return; }
    toast(res.changed ? `Saved · ${res.changed} field${res.changed === 1 ? "" : "s"} changed` : "No changes");
    setEditing(false);
    adminUserFull(userId).then(setD);
    onChanged?.();
  };

  const Row = ({ k, v }) => v === null || v === undefined || v === "" ? null : (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 0", borderBottom: `1px solid ${C.line}` }}>
      <span style={{ fontFamily: B, fontSize: 11.5, color: C.inkSoft, flexShrink: 0 }}>{k}</span>
      <span style={{ fontFamily: B, fontSize: 11.5, color: C.ink, fontWeight: 600, textAlign: "right", wordBreak: "break-word" }}>{String(v)}</span>
    </div>
  );
  const Sec = ({ t, children }) => (
    <div style={{ background: C.card, borderRadius: 16, padding: "13px 15px", marginBottom: 10 }}>
      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13, color: C.ink, marginBottom: 6 }}>{t}</div>
      {children}
    </div>
  );
  const inputS = { width: "100%", boxSizing: "border-box", background: C.bg, border: "none", borderRadius: 11, padding: "10px 12px", fontFamily: B, fontSize: 12.5, color: C.ink, outline: "none", marginBottom: 7 };
  const dt = (x) => { try { return new Date(x).toLocaleDateString(LOC()); } catch { return "—"; } };

  return (
    <div style={{ position: "fixed", inset: 0, background: C.bg, zIndex: 500, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
      <div style={{ position: "sticky", top: 0, background: C.bg, padding: "calc(14px + env(safe-area-inset-top)) 18px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 2 }}>
        <div style={{ fontFamily: F, fontWeight: 700, fontSize: 17, color: C.ink }}>{L("Full record", "Teljes adatlap")}</div>
        <button onClick={close} style={{ border: "none", background: C.card, borderRadius: 99, width: 34, height: 34, fontSize: 15, color: C.inkSoft, cursor: "pointer" }}>✕</button>
      </div>
      <div style={{ padding: "0 18px calc(30px + env(safe-area-inset-bottom))" }}>
        {!d ? <div style={{ textAlign: "center", padding: 60, fontFamily: B, color: C.inkSoft }}>Loading…</div> : (
          <>
            <Sec t="Account">
              <Row k={L("Name", "Név")} v={d.user?.full_name} /><Row k={L("Email", "E-mail")} v={d.user?.email} />
              <Row k={L("Phone", "Telefon")} v={d.user?.phone} /><Row k={L("Address", "Cím")} v={d.user?.address} />
              <Row k={L("City", "Város")} v={d.user?.city} /><Row k={L("Country", "Ország")} v={d.user?.country} />
              <Row k={L("Role", "Szerep")} v={d.user?.role} /><Row k={L("Customer type", "Ügyfél típusa")} v={d.user?.customer_type} />
              <Row k={L("Phone verified", "Telefon ellenőrizve")} v={d.user?.phone_verified ? "yes" : "no"} />
              <Row k={L("Email verified", "E-mail ellenőrizve")} v={d.user?.email_verified ? "yes" : "no"} />
              <Row k={L("Active", "Aktív")} v={d.user?.is_active === false ? "suspended" : "yes"} />
              <Row k={L("Joined", "Csatlakozott")} v={d.user?.created_at ? dt(d.user.created_at) : null} />
            </Sec>

            {d.company && (
              <Sec t="Company">
                {!editing ? (
                  <>
                    <Row k={L("Name", "Név")} v={d.company.name} /><Row k={L("Tagline", "Szlogen")} v={d.company.tagline} />
                    <Row k={L("Area", "Terület")} v={d.company.area} /><Row k={L("City", "Város")} v={d.company.city} />
                    <Row k={L("Country", "Ország")} v={d.company.country} /><Row k={L("Phone", "Telefon")} v={d.company.contact_phone} />
                    <Row k={L("Tax ID", "Adószám")} v={d.company.tax_id} /><Row k={L("Reg. number", "Cégjegyzékszám")} v={d.company.reg_number} />
                    <Row k={L("Radius", "Sugár")} v={d.company.service_radius_km ? d.company.service_radius_km + " km" : null} />
                    <Row k={L("Currency", "Pénznem")} v={d.company.currency} />
                    <Row k={L("Rating", "Értékelés")} v={d.company.rating ? `${d.company.rating} (${d.company.review_count || 0})` : "—"} />
                    <Row k={L("Listed", "Listázva")} v={d.company.is_listed === false ? "no" : "yes"} />
                    <Row k={L("Approved", "Jóváhagyva")} v={d.company.is_approved ? "yes" : "no"} />
                    <Row k={L("Payouts set up", "Kifizetés beállítva")} v={d.company.stripe_ready ? "yes" : "no"} />
                    <div style={{ marginTop: 11 }}><Btn full ghost onClick={startEdit}>{L("Edit these details", "Adatok szerkesztése")}</Btn></div>
                  </>
                ) : (
                  <>
                    <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft, marginBottom: 9, lineHeight: 1.5 }}>
                      Prices, services and payout accounts are not editable here on purpose — only the company can change those.
                    </div>
                    <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={L("Name", "Név")} style={inputS} />
                    <input value={f.tagline} onChange={(e) => setF({ ...f, tagline: e.target.value })} placeholder={L("Tagline", "Szlogen")} style={inputS} />
                    <input value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} placeholder={L("Service area", "Ellátott terület")} style={inputS} />
                    <div style={{ display: "flex", gap: 7 }}>
                      <input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} placeholder={L("City", "Város")} style={{ ...inputS, flex: 1 }} />
                      <input value={f.country} onChange={(e) => setF({ ...f, country: e.target.value.toUpperCase().slice(0, 2) })} maxLength={2} placeholder="HU" style={{ ...inputS, width: 68, textAlign: "center" }} />
                    </div>
                    <input value={f.contact_phone} onChange={(e) => setF({ ...f, contact_phone: e.target.value })} placeholder={L("Contact phone", "Kapcsolattartó telefon")} style={inputS} />
                    <div style={{ display: "flex", gap: 7 }}>
                      <input value={f.tax_id} onChange={(e) => setF({ ...f, tax_id: e.target.value })} placeholder={L("Tax ID", "Adószám")} style={{ ...inputS, flex: 1 }} />
                      <input value={f.reg_number} onChange={(e) => setF({ ...f, reg_number: e.target.value })} placeholder={L("Reg. number", "Cégjegyzékszám")} style={{ ...inputS, flex: 1 }} />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "3px 0 9px" }}>
                      <span style={{ fontFamily: B, fontSize: 11.5, color: C.inkSoft }}>{L("Radius", "Sugár")}</span>
                      <input type="range" min="1" max="200" value={f.service_radius_km} onChange={(e) => setF({ ...f, service_radius_km: Number(e.target.value) })} style={{ flex: 1, accentColor: C.navy }} />
                      <span style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink, minWidth: 48, textAlign: "right" }}>{f.service_radius_km} km</span>
                    </div>
                    {[["is_approved", "Approved"], ["is_listed", "Listed publicly"]].map(([k, label]) => (
                      <label key={k} style={{ display: "flex", alignItems: "center", gap: 9, padding: "5px 0", cursor: "pointer" }}>
                        <input type="checkbox" checked={!!f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} style={{ width: 17, height: 17, accentColor: C.navy }} />
                        <span style={{ fontFamily: B, fontWeight: 700, fontSize: 12, color: C.ink }}>{label}</span>
                      </label>
                    ))}
                    <div style={{ display: "flex", gap: 8, marginTop: 11 }}>
                      <Btn full ghost onClick={() => setEditing(false)}>{L("Cancel", "Mégse")}</Btn>
                      <Btn full onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Btn>
                    </div>
                  </>
                )}
              </Sec>
            )}

            <Sec t={`Bookings · ${(d.bookings || []).length}`}>
              {!(d.bookings || []).length && <div style={{ fontFamily: B, fontSize: 12, color: C.inkFaint }}>{L("None.", "Nincs.")}</div>}
              {(d.bookings || []).slice(0, 40).map((b) => (
                <React.Fragment key={b.id}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "7px 0", borderBottom: (b.started_at || b.finished_at || b.collected_at || b.returned_at) ? "none" : `1px solid ${C.line}` }}>
                  <span style={{ fontFamily: B, fontSize: 11.5, color: C.ink }}>#{b.order_no} · {b.scheduled_date} {b.scheduled_slot}</span>
                  <span style={{ fontFamily: B, fontSize: 11.5, color: C.inkSoft, textAlign: "right" }}>{b.total_huf != null ? huf(b.total_huf) : "—"} · {b.payment_status || "—"}</span>
                </div>
                {(b.started_at || b.finished_at || b.collected_at || b.returned_at) && (
                  <div style={{ fontFamily: B, fontSize: 10.5, color: C.inkFaint, paddingBottom: 5 }}>
                    {[[b.started_at, "started"], [b.finished_at, "finished"], [b.collected_at, "collected"], [b.returned_at, "returned"]]
                      .filter(([t]) => t)
                      .map(([t, lbl]) => `${lbl} ${(() => { try { return new Date(t).toLocaleString(LOC(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return ""; } })()}`)
                      .join(" · ")}
                  </div>
                )}
                </React.Fragment>
              ))}
            </Sec>

            <Sec t={`Reviews · ${(d.reviews || []).length}`}>
              {!(d.reviews || []).length && <div style={{ fontFamily: B, fontSize: 12, color: C.inkFaint }}>{L("None.", "Nincs.")}</div>}
              {(d.reviews || []).map((r) => (
                <div key={r.id} style={{ padding: "7px 0", borderBottom: `1px solid ${C.line}` }}>
                  <div style={{ color: C.amber, fontSize: 12 }}>{stars(r.stars ?? r.rating)}{r.removed_at ? <span style={{ color: C.red, fontFamily: B, fontSize: 10.5, fontWeight: 700 }}> · REMOVED</span> : null}</div>
                  {(r.body || r.comment) && <div style={{ fontFamily: B, fontSize: 11.5, color: C.ink, marginTop: 2 }}>“{r.body || r.comment}”</div>}
                </div>
              ))}
            </Sec>

            <Sec t={`Complaints · ${(d.complaints || []).length}`}>
              {!(d.complaints || []).length && <div style={{ fontFamily: B, fontSize: 12, color: C.inkFaint }}>{L("None.", "Nincs.")}</div>}
              {(d.complaints || []).map((x) => (
                <div key={x.id} style={{ padding: "7px 0", borderBottom: `1px solid ${C.line}` }}>
                  <div style={{ fontFamily: B, fontWeight: 700, fontSize: 11.5, color: C.ink }}>{x.subject || x.status}</div>
                  {x.body && <div style={{ fontFamily: B, fontSize: 11.5, color: C.inkSoft, marginTop: 2 }}>{x.body}</div>}
                </div>
              ))}
            </Sec>
          </>
        )}
      </div>
    </div>
  );
}

function AdminUsers() {
  const { adminAllUsers, adminFetchUsers, adminUpdateUser, adminDeleteUser , session } = useStore();
  const isCeo = session?.isSuper === true;
  const toast = useToast();
  const [busy, setBusy] = useState(!adminAllUsers);
  const [q, setQ] = useState("");
  const [viewDocs, setViewDocs] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [detail, setDetail] = useState(null);   // user id whose full record is open

  React.useEffect(() => {
    if (!adminAllUsers) adminFetchUsers().finally(() => setBusy(false));
  }, []);

  if (busy) return <div style={{ textAlign: "center", padding: 60, fontFamily: B, color: C.inkSoft }}>Loading…</div>;

  const filtered = (adminAllUsers || []).filter((u) =>
    (isCeo || u.role !== "admin") &&
    ((u.full_name || "").toLowerCase().includes(q.toLowerCase()) ||
     (u.email || "").toLowerCase().includes(q.toLowerCase()))
  );

  const roleColor = { customer: C.navySoft, employee: C.green, company: "#7B4DE0" };

  return (
    <div className="cl-fade" style={{ padding: "calc(20px + env(safe-area-inset-top)) 20px 30px" }}>
      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 21, color: C.ink, margin: "8px 0 12px" }}>Users ({(adminAllUsers || []).length})</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.card, borderRadius: 14, padding: "11px 14px", marginBottom: 16, boxShadow: "0 1px 6px rgba(20,28,58,.05)" }}>
        <span style={{ opacity: .45 }}>🔍</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("Search name or email…", "Keresés név vagy e-mail alapján…")} style={{ flex: 1, border: "none", outline: "none", fontFamily: B, fontSize: 13.5, color: C.ink, background: "transparent" }} />
        {q && <button onClick={() => setQ("")} style={{ border: "none", background: "none", color: C.inkFaint, cursor: "pointer" }}>✕</button>}
      </div>
      {filtered.map((u) => (
        <div key={u.id} style={{ background: C.card, borderRadius: 16, padding: "13px 15px", marginBottom: 10, boxShadow: "0 1px 8px rgba(20,28,58,.05)", opacity: u.is_active === false ? .6 : 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Avatar name={u.full_name || "?"} size={38} color={roleColor[u.role] || C.navySoft} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13.5, color: C.ink }}>
                {u.deleted_name ? `${u.deleted_name} (deleted)` : (u.full_name || "—")}
              </div>
              <div style={{ fontFamily: B, fontSize: 10.5, color: C.inkSoft, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.deleted_email || u.email}</div>
              {(u.phone || u.address || u.company_name) && (
                <div style={{ fontFamily: B, fontSize: 10.5, color: C.inkFaint, marginTop: 3, lineHeight: 1.5 }}>
                  {u.phone ? <span>{u.phone}{u.phone_verified ? " ✓" : ""}</span> : null}
                  {u.phone && (u.address || u.company_name) ? " · " : ""}
                  {u.company_name || ""}
                  {u.address ? <div style={{ marginTop: 1 }}>{u.address}</div> : null}
                </div>
              )}
              <div style={{ fontFamily: B, fontSize: 10, color: C.inkFaint, marginTop: 3 }}>
                {u.customer_type ? u.customer_type + " · " : ""}
                {u.email_verified ? "email ✓ " : ""}
                {L("joined", "csatlakozott")} {(() => { try { return new Date(u.created_at).toLocaleDateString(LOC()); } catch { return ""; } })()}
              </div>
            </div>
            {u.role === "admin"
              ? <Pill color={u.is_super ? "#fff" : C.navy} bg={u.is_super ? C.navy : C.navyChip}>{u.is_super ? "CEO" : "Admin"}</Pill>
              : <Pill color={roleColor[u.role] || C.navySoft} bg={roleColor[u.role] + "18" || C.navyChip} style={{ textTransform: "capitalize" }}>{u.role}</Pill>}
          </div>
          {u.company_name && <div style={{ fontFamily: B, fontSize: 10.5, color: C.inkFaint, marginTop: 6, marginLeft: 48 }}>🏢 {u.company_name}</div>}
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
            <button onClick={() => setDetail(u.id)} style={{ fontFamily: B, fontWeight: 700, fontSize: 11, padding: "6px 12px", borderRadius: 99, border: "none", background: C.navyChip, color: C.navy, cursor: "pointer" }}>
              📋 Full record
            </button>
            {(u.documents || []).length > 0 && (
              <button onClick={() => setViewDocs({ title: `${u.full_name} — documents`, docs: u.documents })} style={{ fontFamily: B, fontWeight: 700, fontSize: 11, padding: "6px 12px", borderRadius: 99, border: `1.5px solid ${C.line}`, background: C.card, color: C.navySoft, cursor: "pointer" }}>
                🪪 Docs ({u.documents.length})
              </button>
            )}
            {u.student_upgrade && (
              <>
                <Pill bg={C.amberSoft} color={C.amber}>🎓 {L("Upgrade requested", "Igényelt átsorolás")}</Pill>
                <button onClick={async () => {
                  const res = await adminUpdateUser(u.id, { upgradeDecision: "approve" });
                  if (res?.error) toast(res.error, "error");
                  else { toast(L("Student discount activated for them 🎓", "Diákkedvezmény aktiválva 🎓")); adminFetchUsers(); }
                }} style={{ fontFamily: B, fontWeight: 700, fontSize: 11, padding: "6px 14px", borderRadius: 99, border: `1.5px solid ${C.green}`, background: C.card, color: C.green, cursor: "pointer" }}>
                  ✓ Approve card
                </button>
                <button onClick={async () => {
                  const res = await adminUpdateUser(u.id, { upgradeDecision: "reject" });
                  if (res?.error) toast(res.error, "error");
                  else { toast(L("Upgrade declined", "Átsorolás elutasítva")); adminFetchUsers(); }
                }} style={{ fontFamily: B, fontWeight: 700, fontSize: 11, padding: "6px 14px", borderRadius: 99, border: `1.5px solid ${C.coral}`, background: C.card, color: C.coral, cursor: "pointer" }}>
                  ✕ Decline
                </button>
              </>
            )}
            {u.approval_status === "pending" && (
              <>
                <Pill bg={C.amberSoft} color={C.amber}>🎓 {L("Pending review", "Elbírálás alatt")}</Pill>
                <button onClick={async () => {
                  const res = await adminUpdateUser(u.id, { approvalStatus: "approved" });
                  if (res?.error) toast(res.error, "error");
                  else { toast(L("Student approved — email sent ✉️", "Diák jóváhagyva — e-mail elküldve ✉️")); adminFetchUsers(); }
                }} style={{ fontFamily: B, fontWeight: 700, fontSize: 11, padding: "6px 14px", borderRadius: 99, border: `1.5px solid ${C.green}`, background: C.card, color: C.green, cursor: "pointer" }}>
                  ✓ Approve
                </button>
                <button onClick={async () => {
                  const res = await adminUpdateUser(u.id, { approvalStatus: "rejected" });
                  if (res?.error) toast(res.error, "error");
                  else { toast(L("Application rejected", "Jelentkezés elutasítva")); adminFetchUsers(); }
                }} style={{ fontFamily: B, fontWeight: 700, fontSize: 11, padding: "6px 14px", borderRadius: 99, border: `1.5px solid ${C.coral}`, background: C.card, color: C.coral, cursor: "pointer" }}>
                  ✕ Reject
                </button>
              </>
            )}
            {isCeo && !u.is_super && ["customer", "employee", "admin"].includes(u.role) && (
              <button onClick={async () => {
                const res = await adminUpdateUser(u.id, { makeAdmin: u.role !== "admin" });
                if (res?.error) toast(res.error, "error");
                else { toast(u.role !== "admin" ? "Admin access granted" : "Admin access removed"); adminFetchUsers(); }
              }} style={{ fontFamily: B, fontWeight: 700, fontSize: 11, padding: "6px 12px", borderRadius: 99, border: `1.5px solid ${u.role === "admin" ? C.coral : C.navySoft}`, background: C.card, color: u.role === "admin" ? C.coral : C.navySoft, cursor: "pointer" }}>
                {u.role === "admin" ? "🛡️ Remove admin" : "🛡️ Make admin"}
              </button>
            )}
            {(u.role !== "admin" || isCeo) && !u.is_super && <button onClick={async () => {
              const res = await adminUpdateUser(u.id, { is_active: !u.is_active });
              if (res?.error) toast(res.error, "error");
              else { toast(u.is_active === false ? "User activated" : "User deactivated"); adminFetchUsers(); }
            }} style={{ fontFamily: B, fontWeight: 700, fontSize: 11, padding: "6px 14px", borderRadius: 99, border: `1.5px solid ${u.is_active === false ? C.green : C.coral}`, background: C.card, color: u.is_active === false ? C.green : C.coral, cursor: "pointer" }}>
              {u.is_active === false ? "Activate" : "Deactivate"}
            </button>}
            {(u.role !== "admin" || isCeo) && !u.is_super && <button onClick={() => setConfirmDel(u)} style={{ fontFamily: B, fontWeight: 700, fontSize: 11, padding: "6px 12px", borderRadius: 99, border: `1.5px solid ${C.coral}`, background: C.coral + "12", color: C.coral, cursor: "pointer" }}>
              🗑️ Delete
            </button>}
          </div>
        </div>
      ))}
      {filtered.length === 0 && <div style={{ fontFamily: B, fontSize: 13, color: C.inkSoft, textAlign: "center", padding: 40 }}>{L("No users found.", "Nincs találat.")}</div>}
      {viewDocs && <DocViewer title={viewDocs.title} docs={viewDocs.docs} close={() => setViewDocs(null)} />}
      {detail && <AdminUserDetail userId={detail} close={() => setDetail(null)} onChanged={adminFetchUsers} />}
      {confirmDel && (
        <ConfirmDialog
          title={L("Delete this account?", "Fiók törlése?")}
          body={L(`${confirmDel.full_name || confirmDel.email} — personal data is permanently anonymised (booking history is kept for accounting). This cannot be undone.`, `${confirmDel.full_name || confirmDel.email} — a személyes adatok véglegesen anonimizálódnak (a foglalási előzmények megmaradnak). Ez nem vonható vissza.`)}
          confirmLabel={L("Delete forever", "Végleges törlés")}
          onConfirm={async () => { const res = await adminDeleteUser(confirmDel.id); if (res?.error) toast(res.error, "error"); else { toast(L("Account deleted", "Fiók törölve")); adminFetchUsers(); } setConfirmDel(null); }}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </div>
  );
}

function AdminBookings() {
  const { adminAllBookings, adminFetchAllBookings } = useStore();
  const [busy, setBusy] = useState(!adminAllBookings);
  const [filter, setFilter] = useState("all");
  const [openCust, setOpenCust] = useState(null);

  React.useEffect(() => {
    if (!adminAllBookings) adminFetchAllBookings().finally(() => setBusy(false));
  }, []);

  if (busy) return <div style={{ textAlign: "center", padding: 60, fontFamily: B, color: C.inkSoft }}>Loading…</div>;

  const all = adminAllBookings || [];
  const shown = filter === "all" ? all : filter === "active" ? all.filter((b) => b.status > 0 && b.status < 4) : filter === "done" ? all.filter((b) => b.status === 4) : all.filter((b) => b.status === 9 || b.status === 8);

  const groups = {};
  shown.forEach((b) => {
    const key = b.customer_id || b.customer_email || b.customer_name || "unknown";
    if (!groups[key]) groups[key] = { name: b.customer_full_name || b.customer_name || "Customer", email: b.customer_email || "", orders: [] };
    groups[key].orders.push(b);
  });
  const people = Object.entries(groups).sort((a, b) => b[1].orders.length - a[1].orders.length);

  return (
    <div className="cl-fade" style={{ padding: "calc(20px + env(safe-area-inset-top)) 20px 30px" }}>
      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 21, color: C.ink, margin: "8px 0 4px" }}>{L("Orders by customer", "Rendelések ügyfelenként")}</div>
      <div style={{ fontFamily: B, fontSize: 12, color: C.inkSoft, marginBottom: 14 }}>{shown.length} order{shown.length === 1 ? "" : "s"} across {people.length} {people.length === 1 ? "person" : "people"} — tap a person to see their orders.</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {[{ id: "all", label: "All" }, { id: "active", label: "Active" }, { id: "done", label: "Done" }, { id: "cancelled", label: "Cancelled / Declined" }].map((f) => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{ fontFamily: B, fontWeight: 700, fontSize: 11, padding: "6px 13px", borderRadius: 99, border: "none", cursor: "pointer", background: filter === f.id ? C.navy : C.card, color: filter === f.id ? "#fff" : C.navySoft, boxShadow: "0 1px 4px rgba(20,28,58,.07)" }}>{f.label}</button>
        ))}
      </div>
      {people.map(([key, p]) => {
        const total = p.orders.reduce((sum, b) => sum + (Number(b.total_huf) || 0), 0);
        const open = openCust === key;
        return (
          <div key={key} style={{ background: C.card, borderRadius: 16, marginBottom: 10, boxShadow: "0 1px 8px rgba(20,28,58,.05)", overflow: "hidden" }}>
            <button onClick={() => setOpenCust(open ? null : key)} style={{ width: "100%", border: "none", background: "none", cursor: "pointer", padding: "13px 15px", display: "flex", alignItems: "center", gap: 11, textAlign: "left" }}>
              <Avatar name={p.name} size={38} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13.5, color: C.ink }}>{p.name}</div>
                <div style={{ fontFamily: B, fontSize: 10.5, color: C.inkSoft, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.orders.length} order{p.orders.length === 1 ? "" : "s"} · {huf(total)}{p.email ? " · " + p.email : ""}</div>
              </div>
              <span style={{ color: C.inkFaint, fontSize: 17, transform: open ? "rotate(90deg)" : "none", transition: "transform .2s" }}>›</span>
            </button>
            {open && (
              <div style={{ padding: "0 12px 12px" }}>
                {p.orders.slice().sort((a, b) => (b.order_no || 0) - (a.order_no || 0)).map((b) => {
                  const svc = b.service_snapshot || {};
                  return (
                    <div key={b.id} style={{ background: C.bg, borderRadius: 12, padding: "10px 12px", marginBottom: 7, opacity: b.status === 9 ? .7 : 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12, color: C.ink }}>{b.order_no ? "#" + b.order_no + " · " : ""}{svc.icon} {svc.name || "Order"}</div>
                          <div style={{ fontFamily: B, fontSize: 10, color: C.inkSoft, marginTop: 3, lineHeight: 1.6 }}>
                            🏢 {b.company_name}<br />
                            📅 {dayLabel(b.scheduled_date)} {b.scheduled_slot} · 📍 {b.address || "—"}<br />
                            💳 {b.payment_status || "unpaid"}
                          </div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <StatusPill status={b.status} fulfilment={b.fulfilment} />
                          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12, color: C.navy, marginTop: 6 }}>{huf(b.total_huf)}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {people.length === 0 && <div style={{ fontFamily: B, fontSize: 13, color: C.inkSoft, textAlign: "center", padding: 40 }}>{L("No orders in this filter.", "Nincs rendelés ebben a szűrőben.")}</div>}
    </div>
  );
}

function AdminLog() {
  const { adminFetchLog, adminLog, isLive } = useStore();
  React.useEffect(() => { if (isLive) adminFetchLog(); }, []);
  const rows = adminLog || [];
  const fmt = (ts) => { try { return new Date(ts).toLocaleString(); } catch { return String(ts); } };
  const LBL = { company_approved: "✅ Approved company", company_rejected: "⛔ Rejected company", company_listed: "👁️ Listed company", company_unlisted: "🚫 Unlisted company", student_approved: "🎓 Approved student", student_rejected: "⛔ Rejected student", student_pending: "↩️ Reset student to pending", admin_granted: "🛡️ Granted admin access", admin_revoked: "🛡️ Revoked admin access", user_activated: "🔓 Reactivated account", user_deactivated: "🔒 Deactivated account", complaint_resolved: "🛟 Resolved complaint", complaint_in_progress: "🛟 Complaint in progress", complaint_open: "🛟 Reopened complaint", account_deleted: "🗑️ Deleted account" };
  return (
    <div style={{ padding: "16px 18px 40px" }}>
      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 15, color: C.ink, marginBottom: 4 }}>{L("Decision log", "Döntési napló")}</div>
      <div style={{ fontFamily: B, fontSize: 12, color: C.inkSoft, marginBottom: 14 }}>{L("Every admin decision, signed by who made it.", "Minden admin döntés, aláírva azzal, aki hozta.")}</div>
      {rows.length === 0 && <div style={{ fontFamily: B, fontSize: 12.5, color: C.inkSoft, textAlign: "center", padding: 24 }}>{L("No decisions logged yet.", "Még nincs naplózott döntés.")}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((e) => (
          <div key={e.id} style={{ background: C.card, borderRadius: 14, padding: "11px 14px", boxShadow: "0 1px 5px rgba(20,28,58,.05)" }}>
            <div style={{ fontFamily: B, fontWeight: 700, fontSize: 12.5, color: C.ink }}>{LBL[e.action] || e.action}{e.detail ? <span style={{ fontWeight: 500, color: C.inkSoft }}> · {e.detail}</span> : null}</div>
            <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft, marginTop: 3 }}>{e.admin_name || "?"} · {e.admin_email || "?"} · {fmt(e.created_at)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* What to invoice — CEO only.

   Cleano's commission is already collected: Stripe splits it before the
   partner's money lands. What is left is paperwork, and this screen exists to
   make that paperwork a copy-and-paste job rather than a reconciliation
   exercise across the bookings table and the Stripe dashboard.

   Everything an invoice needs is on the card: who to bill, their tax number and
   address, which jobs it covers, and the net/VAT/gross split. Record the number
   afterwards and the jobs move out of the list. */
function BillingList() {
  const { billingList, markInvoiced, unmarkInvoiced } = useStore();
  const toast = useToast();
  const [data, setData] = React.useState(null);
  const [settled, setSettled] = React.useState(false);
  const [openCo, setOpenCo] = React.useState(null);
  const [num, setNum] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const load = () => billingList(settled).then(setData);
  React.useEffect(() => { setData(null); load(); }, [settled]);
  if (!data) return null;

  const ft = (n) => `${Math.round(Number(n) || 0).toLocaleString("hu-HU")} Ft`;
  const money = (n) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("hu-HU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  /* Everything an invoice needs, as plain text. Faster than reading it off a
     screen and typing it into another one. */
  const asText = (c) => [
    `${L("Bill to", "Számlázási név")}: ${c.name}`,
    c.tradingName && c.tradingName !== c.name ? `${L("Trading name", "Cégnév")}: ${c.tradingName}` : null,
    `${L("Tax number", "Adószám")}: ${c.taxId || "—"}`,
    `${L("Address", "Cím")}: ${c.address || "—"}`,
    `${L("Email", "E-mail")}: ${c.email || "—"}`,
    "",
    `${L("Item", "Tétel")}: ${L("Cleano platform commission", "Cleano platform jutalék")}`,
    `${L("Jobs covered", "Érintett munkák")}: ${c.jobs.length}`,
    ...c.jobs.map((jb) => `  #${jb.orderNo} · ${jb.date} · ${ft(jb.keptHuf)}`),
    "",
    `${L("Net", "Nettó")}: ${money(c.net)} Ft`,
    `${L("VAT", "ÁFA")} ${data.vatPct}%: ${money(c.vat)} Ft`,
    `${L("Gross", "Bruttó")}: ${money(c.gross)} Ft`,
  ].filter(Boolean).join("\n");

  const copy = async (c) => {
    try { await navigator.clipboard.writeText(asText(c)); toast(L("Copied", "Kimásolva")); }
    catch { toast(L("Could not copy — select the text instead", "Nem sikerült másolni — jelöld ki a szöveget")); }
  };

  const doMark = async (c) => {
    if (!num.trim()) return toast(L("Enter the invoice number you issued", "Írd be a kiállított számla számát"));
    setBusy(true);
    const r = await markInvoiced(c.jobs.map((jb) => jb.id), num.trim(), new Date().toISOString().slice(0, 10));
    setBusy(false);
    if (r?.error) return toast(r.error);
    toast(L(`Recorded on ${r.marked} job(s)`, `${r.marked} munkán rögzítve`));
    setOpenCo(null); setNum(""); load();
  };

  const doUnmark = async (c) => {
    setBusy(true);
    const r = await unmarkInvoiced(c.jobs.map((jb) => jb.id));
    setBusy(false);
    if (r?.error) return toast(r.error);
    toast(L("Undone", "Visszavonva")); load();
  };

  /* A plain <a href> would arrive without the auth header and bounce off the
     endpoint, so fetch it with the token and hand the browser a blob. */
  const downloadCsv = async () => {
    try {
      const r = await fetch(`${API_BASE || ""}/api/invoices/admin/billing.csv${settled ? "?settled=1" : ""}`,
        { headers: { Authorization: "Bearer " + getToken() } });
      if (!r.ok) throw new Error(String(r.status));
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `cleano-billing-${settled ? "invoiced" : "to-invoice"}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch { toast(L("Could not build the export", "Az exportot nem sikerült elkészíteni")); }
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 14.5, color: C.ink }}>
        {settled ? L("Already invoiced", "Már kiszámlázva") : L("To invoice", "Kiszámlázandó")}
      </div>
      <div style={{ fontFamily: B, fontSize: 11.5, color: C.inkSoft, marginTop: 3, lineHeight: 1.55 }}>
        {settled
          ? L("Commission you have already billed.", "Az általad már kiszámlázott jutalék.")
          : L("Commission already collected through Stripe. Raise your invoice, then record the number here.",
              "A Stripe-on már beszedett jutalék. Állítsd ki a számlát, majd rögzítsd itt a számát.")}
      </div>

      <div style={{ display: "flex", gap: 6, margin: "10px 0 12px", flexWrap: "wrap" }}>
        {[{ id: false, label: L("To invoice", "Kiszámlázandó") }, { id: true, label: L("Done", "Kész") }].map((f) => (
          <button key={String(f.id)} onClick={() => setSettled(f.id)}
            style={{ fontFamily: B, fontWeight: 700, fontSize: 10.5, padding: "6px 11px", borderRadius: 99, border: "none", cursor: "pointer", background: settled === f.id ? C.navy : C.card, color: settled === f.id ? "#fff" : C.navySoft, boxShadow: "0 1px 4px rgba(20,28,58,.07)" }}>
            {f.label}
          </button>
        ))}
        {data.companies.length > 0 && (
          <button onClick={downloadCsv} style={{ fontFamily: B, fontWeight: 700, fontSize: 10.5, padding: "6px 11px", borderRadius: 99, border: "none", cursor: "pointer", background: C.card, color: C.navySoft, boxShadow: "0 1px 4px rgba(20,28,58,.07)" }}>
            ⬇ {L("Spreadsheet", "Táblázat")}
          </button>
        )}
      </div>

      {data.companies.length === 0 && (
        <div style={{ background: C.card, borderRadius: 18, padding: 28, textAlign: "center", fontFamily: B, fontSize: 12.5, color: C.inkSoft, boxShadow: "0 2px 10px rgba(20,28,58,.04)" }}>
          {settled ? L("Nothing recorded yet.", "Még nincs rögzítve semmi.") : L("Nothing to invoice. Finished, paid jobs appear here.", "Nincs kiszámlázandó. A befejezett, kifizetett munkák itt jelennek meg.")}
        </div>
      )}

      {data.companies.map((c) => (
        <div key={c.companyId} style={{ background: C.card, borderRadius: 18, padding: 15, marginBottom: 10, boxShadow: "0 2px 10px rgba(20,28,58,.05)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13.5, color: C.ink }}>{c.name}</div>
              <div style={{ fontFamily: B, fontSize: 10.5, color: C.inkSoft, marginTop: 3, lineHeight: 1.6 }}>
                {L("Tax number", "Adószám")}: {c.taxId || "—"}<br />
                {c.address || <span style={{ color: C.coral }}>{L("no billing address on file", "nincs számlázási cím")}</span>}<br />
                {c.email || "—"}
              </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontFamily: F, fontWeight: 700, fontSize: 15, color: C.navy }}>{money(c.gross)} Ft</div>
              <div style={{ fontFamily: B, fontSize: 10, color: C.inkFaint, marginTop: 2 }}>{c.jobs.length} {L("jobs", "munka")}</div>
            </div>
          </div>

          <div style={{ background: C.bg, borderRadius: 12, padding: "9px 11px", marginTop: 10, fontFamily: B, fontSize: 11.5, color: C.ink, lineHeight: 1.75 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>{L("Net", "Nettó")}</span><b>{money(c.net)} Ft</b></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>{L("VAT", "ÁFA")} {data.vatPct}%</span><b>{money(c.vat)} Ft</b></div>
            <div style={{ display: "flex", justifyContent: "space-between", borderTop: `1px solid ${C.line}`, marginTop: 4, paddingTop: 4 }}><span>{L("Gross", "Bruttó")}</span><b>{money(c.gross)} Ft</b></div>
            {c.absorbed > 0 && (
              <div style={{ fontSize: 10.5, color: C.inkFaint, marginTop: 5, lineHeight: 1.5 }}>
                {L("Headline commission was", "A jutalék névlegesen")} {ft(c.totalCommission)} — {ft(c.absorbed)} {L("of card costs were absorbed by Cleano and are not income.", "kártyaköltséget a Cleano vállalt, ez nem bevétel.")}
              </div>
            )}
          </div>

          <details style={{ marginTop: 9 }}>
            <summary style={{ fontFamily: B, fontWeight: 700, fontSize: 11, color: C.navySoft, cursor: "pointer" }}>
              {L("Jobs on this invoice", "A számla tételei")}
            </summary>
            <div style={{ marginTop: 6 }}>
              {c.jobs.map((jb) => (
                <div key={jb.id} style={{ display: "flex", justifyContent: "space-between", fontFamily: B, fontSize: 11, color: C.inkSoft, padding: "3px 0" }}>
                  <span>#{jb.orderNo} · {jb.date}</span>
                  <span>{ft(jb.keptHuf)}{jb.invoiceNo ? ` · ${jb.invoiceNo}` : ""}</span>
                </div>
              ))}
            </div>
          </details>

          {!c.billable && !settled && (
            <div style={{ background: C.coralSoft, borderRadius: 10, padding: "7px 10px", marginTop: 9, fontFamily: B, fontWeight: 700, fontSize: 10.5, color: C.coralText || C.coral }}>
              {L("Ask this partner for their billing address before invoicing.", "Kérd el a partner számlázási címét a számlázás előtt.")}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 11 }}>
            <Btn full ghost onClick={() => copy(c)}>{L("Copy details", "Adatok másolása")}</Btn>
            {settled
              ? <Btn full ghost disabled={busy} onClick={() => doUnmark(c)}>{L("Undo", "Visszavonás")}</Btn>
              : <Btn full onClick={() => { setOpenCo(c.companyId); setNum(""); }}>{L("Record invoice", "Számla rögzítése")}</Btn>}
          </div>

          {openCo === c.companyId && (
            <div style={{ marginTop: 10 }}>
              <input value={num} onChange={(e) => setNum(e.target.value)} placeholder={L("Invoice number you issued", "A kiállított számla száma")}
                style={{ width: "100%", padding: "10px 12px", borderRadius: 12, border: `1px solid ${C.line}`, fontFamily: B, fontSize: 12.5, background: C.bg, color: C.ink }} />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <Btn full ghost onClick={() => setOpenCo(null)}>{L("Cancel", "Mégse")}</Btn>
                <Btn full disabled={busy} onClick={() => doMark(c)}>{busy ? L("Saving...", "Mentés...") : L("Save", "Mentés")}</Btn>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function AdminPanel({ tab }) {
  const { logout, session } = useStore();
  const isCeo = session?.isSuper === true;
  return (
    <div className="cl-fade" style={{ display: "flex", flexDirection: "column", minHeight: "100%" }}>
      <div style={{ background: `radial-gradient(140% 100% at 20% 0%, ${C.navyMid}, ${C.navyDeep} 75%)`, padding: "calc(22px + env(safe-area-inset-top)) 20px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 46, height: 46, borderRadius: 14, background: "rgba(255,255,255,.12)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>🛡️</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: F, fontWeight: 700, fontSize: 18, color: "#fff" }}>{L("Admin panel", "Admin felület")}</div>
            <div style={{ fontFamily: B, fontSize: 11, color: "#9FB0E8", marginTop: 1 }}>{isCeo ? "CEO admin · Cleano Magyarország" : "Company review team"}</div>
          </div>
          <button onClick={logout} style={{ background: "rgba(255,255,255,.12)", border: "1px solid rgba(255,255,255,.2)", borderRadius: 99, padding: "7px 14px", fontFamily: B, fontWeight: 700, fontSize: 11, color: "#C9D2F5", cursor: "pointer" }}>
            🚪 Log out
          </button>
        </div>
      </div>
      <div style={{ flex: 1 }}>
        {(tab === "home" || tab === "dashboard") && <><AdminDashboard />{isCeo && <div style={{ padding: "0 20px" }}><BillingList /></div>}</>}
        {tab === "companies" && <AdminCompanies />}
        {tab === "users" && <AdminUsers />}
        {tab === "bookings" && <AdminBookings />}
        {tab === "complaints" && <><CustomerReportQueue /><ReviewReports /><AdminComplaints /></>}
        {tab === "log" && <AdminLog />}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   SHELL
════════════════════════════════════════════════════════════ */

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Quicksand:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap');
  * { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
  body.cl-modal-open .cl-nav { display: none !important; }
  .cl-nav::-webkit-scrollbar { display: none; }
  .cl-btn:active { transform: scale(.97); } .cl-btn { transition: transform .12s; }
  .cl-card { transition: transform .18s; } .cl-card:active { transform: scale(.985); }
  .cl-noscroll::-webkit-scrollbar { display: none; } .cl-noscroll { scrollbar-width: none; }
  button:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2.5px solid #5EE6A8; outline-offset: 2px; }
  input:focus, textarea:focus { border-color: #4A5BBF !important; }
  @keyframes clPop { 0% { transform: scale(.5); opacity: 0; } 70% { transform: scale(1.08); } 100% { transform: scale(1); opacity: 1; } }
  @keyframes clRise { from { transform: translateY(14px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  @keyframes clFade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes clSlideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
  @keyframes clBubble { from { transform: translateY(40vh); opacity: 0; } 20% { opacity: .5; } to { transform: translateY(-50vh); opacity: 0; } }
  .cl-pop { animation: clPop .55s cubic-bezier(.34,1.56,.64,1) both; }
  .cl-rise { animation: clRise .5s cubic-bezier(.2,.8,.3,1) both; }
  .cl-fade { animation: clFade .35s ease both; }
  .cl-slideup { animation: clSlideUp .38s cubic-bezier(.2,.9,.3,1) both; }
  .cl-bubble { position: absolute; bottom: 0; width: 10px; height: 10px; border-radius: 50%; background: rgba(94,230,168,.4); animation: clBubble 5s linear infinite; }
  @media (prefers-reduced-motion: reduce) { .cl-pop,.cl-rise,.cl-fade,.cl-slideup,.cl-bubble { animation: none !important; } }
`;

function Shell() {
  const store = useStore();
  const { session, loading, error, clearError, notices, logout, demoSwitchRole, t } = store;
  // 🌗 follow the phone's day/night mode live
  const [dark, setDark] = useState(() => typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  React.useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const fn = (e) => setDark(e.matches);
    mq.addEventListener ? mq.addEventListener("change", fn) : mq.addListener(fn);
    return () => { mq.removeEventListener ? mq.removeEventListener("change", fn) : mq.removeListener(fn); };
  }, []);
  applyTheme(dark);
  React.useEffect(() => { document.body.style.background = C.shell; }, [dark]);
  // Store errors go through the single toast channel (de-duplicated) — never a
  // banner *and* a toast for the same failure.
  const shellToast = useToast();
  React.useEffect(() => { if (error) { shellToast(error, "error"); clearError(); } }, [error]);
  // 🔄 Live refresh: pull fresh data every 20s and whenever the app returns to
  // the foreground, so actions taken elsewhere appear without restarting.
  React.useEffect(() => {
    if (!session || !store.isLive) return;
    const tick = () => { if (!document.hidden) store.refreshData?.(); };
    const iv = setInterval(tick, 20000);
    const onVis = () => { if (!document.hidden) store.refreshData?.(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", onVis); window.removeEventListener("focus", onVis); };
  }, [session?.userId, store.isLive]);
  // 🔔 register this device for real push notifications once logged in (native app only)
  React.useEffect(() => {
    const tok = getToken();
    if (session && tok) initPush(tok, session.userId);
  }, [session?.userId]);
  const [tab, setTab] = useState("home");
  const [bookingCo, setBookingCo] = useState(null);
  const [justBooked, setJustBooked] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  if (loading)
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.navyDeep }}>
        <style>{css}</style>
        <div className="cl-pop"><Octo size={72} /></div>
      </div>
    );

  if (!session)
    return (
      <div style={{ minHeight: "100vh", background: C.shell, display: "flex", justifyContent: "center" }}>
        <style>{css}</style>
        <div style={{ width: "100%", maxWidth: SHELL_W }}><Auth /></div>
      </div>
    );

  const { role } = session;
  const unread = notices.filter((n) => n.to_employee === session.userId && !n.is_read).length;
  const NAVS = {
    customer: [{ id: "home", label: t("nav.home"), icon: "home" }, { id: "bookings", label: t("nav.bookings"), icon: "calendar" }],
    employee: [{ id: "home", label: L("My jobs", "Munkáim"), icon: "sparkle" }, { id: "notices", label: L("Notices", "Üzenetek"), icon: "bell", badge: unread }],
    company: [{ id: "home", label: L("Jobs", "Munkák"), icon: "clipboard" }, { id: "schedule", label: L("Schedule", "Naptár"), icon: "calendar" }, { id: "clients", label: L("Clients", "Ügyfelek"), icon: "users" }, { id: "services", label: L("Services", "Szolgáltatások"), icon: "tag" }, { id: "team", label: L("Team", "Csapat"), icon: "briefcase" }, { id: "reviews", label: L("Reviews", "Értékelések"), icon: "sparkle" }, { id: "issues", label: L("Issues", "Bejelentések"), icon: "lifebuoy" }, { id: "settings", label: L("Settings", "Beállítások"), icon: "settings" }],
    admin: [{ id: "home", label: "Dashboard", icon: "grid" }, { id: "companies", label: "Companies", icon: "building" }, { id: "users", label: "Users", icon: "user" }, { id: "bookings", label: "Orders", icon: "calendar" }, { id: "complaints", label: "Complaints", icon: "lifebuoy" }, { id: "log", label: "Log", icon: "scroll" }],
  };

  return (
    <div style={{ minHeight: "100vh", background: C.shell, display: "flex", justifyContent: "center", fontFamily: B }}>
      <style>{css}</style>
      <div style={{ width: "100%", maxWidth: SHELL_W, background: C.bg, minHeight: "100vh", display: "flex", flexDirection: "column", boxShadow: NATIVE ? "none" : "0 0 50px rgba(20,28,58,.14)", position: "relative" }}>
        {demoSwitchRole && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 16px", background: C.navyDeep }}>
            <span style={{ fontFamily: B, fontSize: 10, fontWeight: 700, color: C.mint, letterSpacing: .8 }}>🧪 DEMO</span>
            <select value={role} onChange={(e) => { demoSwitchRole(e.target.value); setTab("home"); }}
              title="Demo — switch role"
              style={{ background: "rgba(94,230,168,.14)", color: C.mint, border: `1px solid ${C.mint}55`, borderRadius: 9, fontFamily: B, fontSize: 10.5, fontWeight: 700, padding: "4px 6px", cursor: "pointer", outline: "none" }}>
              <option value="customer" style={{ color: "#111" }}>⇄ Customer</option>
              <option value="employee" style={{ color: "#111" }}>⇄ Cleaner</option>
              <option value="company" style={{ color: "#111" }}>⇄ Company</option>
              <option value="admin" style={{ color: "#111" }}>⇄ Admin</option>
            </select>
          </div>
        )}


        <div style={{ flex: 1, overflowY: "auto", paddingBottom: "calc(112px + env(safe-area-inset-bottom))" }}>
          {role === "customer" && (tab === "home" ? <CustomerHome openBooking={setBookingCo} openProfile={() => setShowProfile(true)} /> : <CustomerBookings openBooking={(co) => { setTab("home"); setBookingCo(co); }} />)}
          {role === "employee" && (tab === "notices" ? <EmployeeNotices /> : <EmployeeJobs openProfile={() => setShowProfile(true)} />)}
          {role === "company" && (
            tab === "schedule" ? <CompanySchedule /> :
            tab === "clients" ? <CompanyClients /> :
            tab === "services" ? <CompanyServices /> :
            tab === "team" ? <CompanyTeam /> :
            tab === "reviews" ? <CompanyReviews /> :
            tab === "issues" ? <CompanyComplaints /> :
            tab === "settings" ? <CompanySettings /> :
            <CompanyJobs openProfile={() => setShowProfile(true)} />
          )}
          {role === "admin" && <AdminPanel tab={tab} />}
        </div>

        {bookingCo && role === "customer" && (
          <BookingFlow company={bookingCo} close={() => setBookingCo(null)} onBooked={(row) => { setBookingCo(null); setJustBooked(row || true); }} />
        )}

        {justBooked && (
          <div style={{ position: "fixed", inset: 0, zIndex: 70, background: `radial-gradient(120% 100% at 50% 0%, ${C.navyMid}, ${C.navyDeep} 75%)`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32, textAlign: "center" }}>
            <div className="cl-pop" style={{ width: 92, height: 92, borderRadius: "50%", background: C.mint, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40, boxShadow: `0 0 0 14px ${C.mint}26, 0 0 0 28px ${C.mint}12` }}>✓</div>
            <div className="cl-rise" style={{ fontFamily: F, fontWeight: 700, fontSize: 24, color: "#fff", marginTop: 26 }}>{justBooked?.pricing_type === "subscription" ? L("Subscription set! 🔁", "Előfizetés beállítva! 🔁") : L("You're booked!", "Lefoglalva!")}</div>
            <div className="cl-rise" style={{ fontFamily: B, fontSize: 13, color: "#9FB0E8", marginTop: 10, lineHeight: 1.7, animationDelay: ".15s" }}>
              {/* This used to branch on HUL(): a hand-written Hungarian version and an
                  English one. Every other language fell to the English branch, so a
                  German customer finishing a booking read one translated sentence
                  wrapped in two English ones. Wrapped properly, all twelve work. */}
              {justBooked?.pricing_type === "subscription"
                ? <>{L("Your plan is active", "Az előfizetésed aktív")} ({HUL() ? everyP(justBooked.period) : periodLabel(justBooked.period)}).<br />
                    {L("First visit", "Első alkalom")} {dayLabel(justBooked.scheduled_date)}, {L("then it repeats automatically.", "utána automatikusan ismétlődik.")}<br />
                    {L("Manage or cancel anytime under Bookings.", "Bármikor kezelheted vagy lemondhatod a Foglalásoknál.")}</>
                : <>{L("The company sees your request now and will assign a cleaner shortly.", "A cég most látja a kérésedet, és hamarosan kioszt egy takarítót.")}</>}
            </div>
            <div className="cl-rise" style={{ marginTop: 32, width: "100%", maxWidth: 300, animationDelay: ".3s" }}>
              <Btn full mint onClick={() => { setJustBooked(false); setTab("bookings"); }}>{L("Track my booking", "Foglalás követése")}</Btn>
            </div>
          </div>
        )}

        {showProfile && <ProfileSheet close={() => setShowProfile(false)} />}
        <PhoneVerifyGate />

        <NotificationBanner />
        <div className="cl-nav" style={{ position: "fixed", bottom: "calc(12px + env(safe-area-inset-bottom))", left: "50%", transform: "translateX(-50%)", width: "calc(100% - 28px)", maxWidth: 400, background: dark ? "rgba(23,30,58,.55)" : "rgba(255,255,255,.55)", backdropFilter: "blur(28px) saturate(1.8)", WebkitBackdropFilter: "blur(28px) saturate(1.8)", border: dark ? "1px solid rgba(255,255,255,.10)" : "1px solid rgba(255,255,255,.65)", borderRadius: 30, display: "flex", alignItems: "center", padding: 6, gap: 4, zIndex: 10, overflowX: "auto", WebkitOverflowScrolling: "touch", scrollbarWidth: "none", boxShadow: dark ? "0 18px 48px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.08)" : "0 18px 48px rgba(16,25,74,.18), inset 0 1px 0 rgba(255,255,255,.9)" }}>
          {NAVS[role].map((tb) => {
            const active = tab === tb.id;
            return (
              <button key={tb.id} onClick={(e) => { setTab(tb.id); setBookingCo(null); try { e.currentTarget.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" }); } catch {} }}
                style={{ flex: active ? "1.9 0 auto" : "1 0 auto", minWidth: active ? 86 : 44, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, border: "none", cursor: "pointer", borderRadius: 24, padding: "11px 8px", position: "relative", background: active ? `linear-gradient(135deg, ${C.navy}, ${C.navyMid})` : "transparent", boxShadow: active ? "0 8px 20px rgba(27,42,107,.38), inset 0 1px 0 rgba(255,255,255,.18)" : "none", transition: "all .3s cubic-bezier(.3,.9,.35,1)" }}>
                <Ic name={tb.icon} size={19} sw={active ? 2 : 1.7} color={active ? "#fff" : C.inkSoft} style={{ opacity: active ? 1 : .8 }} />
                {active && <span style={{ fontFamily: F, fontWeight: 700, fontSize: 12, color: "#fff", whiteSpace: "nowrap" }}>{tb.label}</span>}
                {tb.badge > 0 && <span style={{ position: "absolute", top: 4, right: active ? 8 : "50%", marginRight: active ? 0 : -18, width: 16, height: 16, borderRadius: "50%", background: C.coral, color: "#fff", fontSize: 9.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: B }}>{tb.badge}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function UpdateGate({ children }) {
  const [blocked, setBlocked] = useState(false);
  const urlsRef = React.useRef({});
  React.useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const r = await fetch((API_BASE || "") + "/api/app/version");
        const d = await r.json();
        if (alive && d) { urlsRef.current = d; if (d.min && verLt(APP_VERSION, d.min)) setBlocked(true); }
      } catch { /* offline or endpoint missing — never block on failure */ }
    };
    check();
    const t = setInterval(check, 6 * 3600e3);
    return () => { alive = false; clearInterval(t); };
  }, []);
  if (!blocked) return children;
  return (
    <div style={{ minHeight: "100vh", background: C.navyDeep, display: "flex", alignItems: "center", justifyContent: "center", padding: 28 }}>
      <div style={{ textAlign: "center", maxWidth: 340 }}>
        <Octo size={64} />
        <div style={{ fontFamily: F, fontWeight: 800, fontSize: 20, color: "#fff", marginTop: 18 }}>{L("Please update Cleano", "Kérjük, frissítsd a Cleanót")}</div>
        <div style={{ fontFamily: B, fontSize: 13.5, color: "#B9C0DF", marginTop: 10, lineHeight: 1.6 }}>
          {L("This version is too old to work safely with our servers. Update from the store and you're straight back in.", "Ez a verzió már túl régi a biztonságos működéshez. Frissíts az áruházból, és máris folytathatod.")}
        </div>
        <Btn full style={{ marginTop: 22 }} onClick={() => {
          const ua = navigator.userAgent || "";
          const ios = /iPhone|iPad|iPod/.test(ua);
          const u = ios
            ? (urlsRef.current.iosUrl || "itms-apps://search.itunes.apple.com/WebObjects/MZSearch.woa/wa/search?media=software&term=Cleano%20Cleaning")
            : (urlsRef.current.androidUrl || "https://play.google.com/store/apps/details?id=com.cleano.app");
          window.open(u, "_blank");
        }}>{L("Open the store", "Áruház megnyitása")}</Btn>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <ToastProvider>
        <UpdateGate>
          <Shell />
        </UpdateGate>
      </ToastProvider>
    </StoreProvider>
  );
}

