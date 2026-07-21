import React, { useState, useMemo, useContext, createContext, useCallback } from "react";
import { StoreProvider, useStore, isLive } from "./store.jsx";
import { LANGS, getLang, LOCALES } from "./lib/i18n.js";
import { xl } from "./lib/translations.js";
import { API_BASE } from "./lib/api.js";

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
const getCity = () => {
  try { const c = localStorage.getItem("cleanly_city"); if (c && ALL_CITIES.includes(c)) return c; } catch {}
  return "Debrecen";
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
const stageList = () => (HUL() ? ["Új", "Kiosztva", "Úton", "Takarítás", "Kész ✨"] : ["New", "Assigned", "On the way", "Cleaning", "Done ✨"]);
const SLOTS = ["08:00", "09:30", "11:00", "13:00", "15:00", "17:00", "18:30"];
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
    files.forEach((file) => {
      if (file.size > 2 * 1024 * 1024) return alert(`${file.name}: max 2 MB per file`);
      if (docs.length >= 6) return;
      const reader = new FileReader();
      reader.onload = () => onChange([...docs, { name: file.name, type: file.type, data: reader.result }].slice(0, 6));
      reader.readAsDataURL(file);
    });
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
function DocViewer({ docs, title, close }) {
  const { session } = useStore();
  const canDownload = true; // all admins have full file access; decisions are recorded in the admin log
  return (
    <Sheet title={title} close={close}>
      {(!docs || docs.length === 0) && <div style={{ fontFamily: B, fontSize: 12.5, color: C.inkSoft, textAlign: "center", padding: 24 }}>No documents uploaded.</div>}
      {(docs || []).map((doc, i) => (
        <div key={i} style={{ marginBottom: 14 }}>
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12, color: C.ink, marginBottom: 6 }}>{doc.name}</div>
          {doc.type?.startsWith("image/")
            ? <img src={doc.data} alt={doc.name} onContextMenu={(e) => { if (!canDownload) e.preventDefault(); }} draggable={canDownload}
                style={{ width: "100%", borderRadius: 14, boxShadow: "0 2px 10px rgba(20,28,58,.1)", pointerEvents: canDownload ? "auto" : "none" }} />
            : canDownload
              ? <a href={doc.data} download={doc.name} style={{ display: "block", fontFamily: B, fontSize: 12.5, color: C.navySoft, background: C.card, borderRadius: 13, padding: "12px 14px", textDecoration: "none", boxShadow: "0 1px 5px rgba(20,28,58,.05)" }}>📄 Download {doc.name}</a>
              : <div style={{ fontFamily: B, fontSize: 12, color: C.inkFaint, background: C.bg, borderRadius: 13, padding: "12px 14px" }}>📄 {doc.name} — view only (CEO can download)</div>}
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
const localISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const nextDays = () => {
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(); d.setDate(d.getDate() + i);
    out.push({
      iso: localISO(d),
      d: d.toLocaleDateString(LOC(), { weekday: "short" }),
      n: d.getDate(),
      label: i === 0 ? "Today" : i === 1 ? "Tomorrow" : null,
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
  const toast = useCallback((msg, type = "success") => {
    const id = Date.now() + Math.random();
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
const StatusPill = ({ status }) => {
  const ended = status === 8 || status === 9; // 8 declined · 9 cancelled
  return (
    <Pill
      bg={ended ? C.coralSoft : status >= 4 ? C.mintSoft : status === 0 ? C.amberSoft : C.navyChip}
      color={ended ? C.coral : status >= 4 ? C.green : status === 0 ? C.amber : C.navySoft}
    >{status === 9 ? L("Cancelled", "Lemondva") : status === 8 ? L("Declined", "Elutasítva") : stageList()[status]}</Pill>
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
function LiveMap({ lat, lng }) {
  const ref = React.useRef(null);
  const mapRef = React.useRef(null);
  const markerRef = React.useRef(null);
  React.useEffect(() => {
    if (!window.L || !ref.current) return;
    if (!mapRef.current) {
      mapRef.current = window.L.map(ref.current).setView([lat || 47.53, lng || 21.63], 14);
      window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(mapRef.current);
    }
    if (lat && lng) {
      if (!markerRef.current) markerRef.current = window.L.marker([lat, lng]).addTo(mapRef.current);
      else markerRef.current.setLatLng([lat, lng]);
      mapRef.current.setView([lat, lng], mapRef.current.getZoom());
    }
  }, [lat, lng]);
  React.useEffect(() => () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } }, []);
  if (!window.L) return <div style={{ fontFamily: B, fontSize: 12, color: C.inkSoft, textAlign: "center", padding: 20 }}>Map unavailable offline.</div>;
  return <div ref={ref} style={{ width: "100%", height: 300, borderRadius: 16, overflow: "hidden", zIndex: 0 }} />;
}

function TrackSheet({ bookingId, close }) {
  const { fetchLocation } = useStore();
  const [loc, setLoc] = React.useState(null);
  React.useEffect(() => {
    let alive = true;
    const load = () => fetchLocation(bookingId).then((d) => { if (alive) setLoc(d); });
    load();
    const t = setInterval(load, 15000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const ago = (at) => { if (!at) return ""; const s = Math.round((Date.now() - new Date(at).getTime()) / 1000); return s < 60 ? "just now" : Math.round(s / 60) + " min ago"; };
  return (
    <Sheet title={L("Track your cleaner", "Takarító követése")} close={close}>
      {loc && loc.lat ? (
        <>
          <LiveMap lat={loc.lat} lng={loc.lng} />
          <div style={{ fontFamily: B, fontSize: 12, color: C.inkSoft, textAlign: "center", marginTop: 10 }}>{L("Location updated", "Pozíció frissítve")} {ago(loc.at)}</div>
        </>
      ) : (
        <div style={{ fontFamily: B, fontSize: 13, color: C.inkSoft, textAlign: "center", padding: 30, lineHeight: 1.6 }}>{L("Waiting for the cleaner to start sharing their location. This appears once they are on the way.", "Várakozás a takarító pozíciójára. Akkor jelenik meg, amikor úton van.")}</div>
      )}
    </Sheet>
  );
}

function LocationShare({ bookingId }) {
  const { postLocation } = useStore();
  const [on, setOn] = React.useState(false);
  React.useEffect(() => {
    if (!navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => { setOn(true); postLocation(bookingId, pos.coords.latitude, pos.coords.longitude); },
      () => setOn(false),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(id);
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
  React.useEffect(() => {
    const fresh = (notifications || []).find((n) => !n.is_read && !seenRef.current.has(n.id));
    if (fresh) {
      seenRef.current.add(fresh.id);
      setShow(fresh);
      const t = setTimeout(() => setShow(null), 6000);
      return () => clearTimeout(t);
    }
  }, [notifications]);
  React.useEffect(() => { if (unreadNotif > 0) { const t = setTimeout(markNotificationsRead, 8000); return () => clearTimeout(t); } }, [unreadNotif]);
  if (!show) return null;
  return (
    <div className="cl-rise" onClick={() => setShow(null)}
      style={{ position: "fixed", top: "calc(env(safe-area-inset-top) + 10px)", left: "50%", transform: "translateX(-50%)", width: "calc(100% - 28px)", maxWidth: 400, zIndex: 60, background: C.navBg, backdropFilter: "blur(18px)", border: `1px solid ${C.line}`, borderRadius: 18, padding: "13px 16px", boxShadow: "0 14px 40px rgba(16,25,74,.28)", cursor: "pointer" }}>
      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13.5, color: C.ink }}>{show.title}</div>
      {show.body && <div style={{ fontFamily: B, fontSize: 12, color: C.inkSoft, marginTop: 3, lineHeight: 1.5 }}>{show.body}</div>}
    </div>
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
  return ALL_CITIES.find((c) => low.includes(c.toLowerCase())) || null;
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
        onChange(label); applyCityFrom(label);
        setAdding(false);
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
            const full = `${st} ${houseNo.trim()}${floor.trim() ? ", " + floor.trim() : ""}, ${cty}`;
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

/* ── Card payment wait overlay (Barion gateway opened in browser) ── */
function PaymentWait({ url, check, onPaid, onLater }) {
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
          {L("Finish paying in the secure Barion window that just opened. This screen updates automatically.", "Fejezd be a fizetést a most megnyílt biztonságos Barion ablakban. Ez a képernyő automatikusan frissül.")}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 20 }}>
          <Btn full onClick={() => window.open(url, "_blank")}>{L("Reopen payment page", "Fizetési oldal újranyitása")}</Btn>
          <Btn ghost full onClick={onLater}>{L("Pay later from My bookings", "Fizetés később a Foglalásaimból")}</Btn>
        </div>
      </div>
    </div>
  );
}

/* ── Profile sheet (all roles) ────────────────────────────── */

function ProfileSheet({ close }) {
  const { session, updateProfile, deleteAccount, logout, t, lang, setLang } = useStore();
  const toast = useToast();
  const [f, setF] = useState({ name: session.name || "", phone: session.phone || "", custType: session.custType || "student", address: session.address || "", paymentMethod: session.paymentMethod || "cash", documents: session.documents || [] });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const res = await updateProfile({ full_name: f.name, phone: f.phone, ...(session.role === "customer" ? { customer_type: f.custType, address: f.address, payment_method: f.paymentMethod } : {}), ...(session.role === "employee" ? { documents: f.documents } : {}) });
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

      <Field label={t("profile.fullName")} placeholder="Your name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />

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
        </div>
      )}

      {session.role === "customer" && (
        <>
          <div style={{ marginBottom: 4 }}>
            <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink, marginBottom: 7 }}>{t("profile.homeAddress")}</div>
            <AddressPicker value={f.address} onChange={(v) => setF({ ...f, address: v })} />
          </div>
          <Field label={t("profile.phone")} placeholder="+36 30 …" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
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
          <Field label="Phone number" placeholder="+36 30 …" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          <DocUpload
            label="Identity documents"
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
      <ChangePasswordBox />
      <div style={{ display: "flex", justifyContent: "center", gap: 14, marginTop: 14, fontFamily: B, fontSize: 11 }}>
        <a href={session.role === "company" ? "/partner-terms" : "/terms"} target="_blank" rel="noreferrer" style={{ color: C.inkFaint }}>{L("Terms", "ÁSZF")}</a>
        <a href="/privacy" target="_blank" rel="noreferrer" style={{ color: C.inkFaint }}>{L("Privacy", "Adatkezelés")}</a>
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
  const [f, setF] = useState({ name: "", email: "", password: "", code: "", companyName: "", taxId: "", regNumber: "", contactPhone: "", custType: "student", address: "", city: "Debrecen", phone: "", documents: [], terms: false });
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
              <b>Demo mode</b> — no email needed. Run the backend (see README) and set VITE_USE_API=true for real accounts.
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
              <Field label="Company invite code" placeholder="e.g. SPARK-7K4D" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
              {isLive && <Field label="Your name" placeholder="Full name" value={f.name} onChange={set("name")} />}
              <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink, marginBottom: 7 }}>{L("Residence address *", "Lakcím *")}</div>
              <AddressPicker value={f.address} onChange={(v) => setF({ ...f, address: v })} />
              <Field label={L("Phone number", "Telefonszám")} hint={L("One number = one account.", "Egy szám = egy fiók.")} value={f.phone} onChange={set("phone")} />
              <DocUpload
                label="Identity document"
                hint="ID card or residence card (lakcímkártya / tartózkodási engedély) — required before your first job."
                docs={f.documents}
                onChange={(docs) => setF({ ...f, documents: docs })}
              />
            </>
          )}
          {mode === "signup" && role === "company" && (
            <>
              <Field label="Company name *" placeholder="e.g. SparkClean Kft." value={f.companyName} onChange={set("companyName")} />
              <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink, marginBottom: 7 }}>{L("City you serve *", "Melyik városban dolgoztok? *")}</div>
              <select value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })}
                style={{ width: "100%", boxSizing: "border-box", padding: "13px 15px", borderRadius: 15, border: `1.5px solid ${C.line}`, fontFamily: B, fontSize: 14, background: C.card, color: C.ink, marginBottom: 14, outline: "none" }}>
                {ALL_CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <Field label={L("Tax number (adószám) *", "Adószám *")} placeholder="12345678-1-42"
                hint={f.taxId.trim() ? (huTaxIdValid(f.taxId) ? "✅ " + L("Valid tax number", "Érvényes adószám") : "❌ " + L("Invalid — check the digits (format: 12345678-1-42)", "Hibás — ellenőrizd a számokat (formátum: 12345678-1-42)")) : L("We verify this against the official checksum.", "A hivatalos ellenőrzőszám alapján ellenőrizzük.")}
                value={f.taxId} onChange={set("taxId")} />
              <Field label="Company registration no." placeholder="e.g. 09-09-123456" value={f.regNumber} onChange={set("regNumber")} />
              <Field label="Contact phone" placeholder="+36 …" value={f.contactPhone} onChange={set("contactPhone")} />
              <DocUpload
                label="Verification documents"
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
                <a href={role === "company" ? "/partner-terms" : "/terms"} target="_blank" rel="noreferrer" style={{ color: C.navySoft, fontWeight: 700 }}>{role === "company" ? L("Partner Terms", "Partneri ÁSZF-et") : L("Terms of Service", "ÁSZF-et")}</a>
                {L(" and the ", " és az ")}
                <a href="/privacy" target="_blank" rel="noreferrer" style={{ color: C.navySoft, fontWeight: 700 }}>{L("Privacy Policy", "Adatkezelési tájékoztatót")}</a>.
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
      .filter((c) => (c.city || "Debrecen") === city)
      .filter((c) => c.is_approved !== false && c.is_listed !== false)
      .filter((c) => c.name.toLowerCase().includes(q.toLowerCase()) || (c.tagline || "").toLowerCase().includes(q.toLowerCase()));
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
        <Sparkle size={18} style={{ position: "absolute", top: 24, right: 24 }} cls="cl-twinkle" />
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={openProfile} aria-label="Edit profile"
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
          return (
            <div key={co.id} onClick={() => openBooking(co)} className="cl-card cl-rise" style={{ background: C.card, borderRadius: 22, marginBottom: 14, overflow: "hidden", cursor: "pointer", boxShadow: "0 4px 18px rgba(20,28,58,.07)", animationDelay: `${i * .07}s` }}>
              <div style={{ height: 70, background: coverOf(co), display: "flex", alignItems: "center", padding: "0 16px" }}>
                <CompanyLogo co={co} size={46} radius={14} />
              </div>
              <div style={{ padding: "13px 16px 15px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontFamily: F, fontWeight: 700, fontSize: 15.5, color: C.ink, display: "flex", alignItems: "center", gap: 5 }}>
                    {co.name}
                    {co.is_approved !== false && <span title="Documents verified by Cleano" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 15, height: 15, borderRadius: "50%", background: C.mint, color: C.navyDeep, fontSize: 9.5, fontWeight: 900, flexShrink: 0 }}>✓</span>}
                  </div>
                  {promoOf(co) && <Pill bg={C.mintSoft} color={C.green}>−{promoOf(co).pct}%{promoOf(co).label ? ` ${promoOf(co).label}` : ""}</Pill>}
                  {isStudent && !promoOf(co) && <Pill bg={C.mintSoft} color={C.green}>−{co.student_discount}% 🎓</Pill>}
                </div>
                {co.tagline && <div style={{ fontFamily: B, fontSize: 11.5, color: C.inkSoft, marginTop: 3 }}>{co.tagline}</div>}
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10, fontFamily: B, fontSize: 11.5, color: C.inkSoft }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Star size={12} /> <b style={{ color: C.ink }}>{co.rating}</b> ({co.review_count})</span>
                  <><span>·</span><span>📍 {co.city || "Debrecen"}{co.area ? ` · ${co.area}` : ""}</span></>
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
  const { session, services, reviews, createBooking, startPayment, getPaymentStatus, feePct } = useStore();
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
  const isSub = svc?.pricing_type === "subscription";
  const promo = promoOf(company);
  const discPct = Math.max(promo ? promo.pct : 0, isStudent ? company.student_discount || 0 : 0);
  const stud = (n) => Math.round((n || 0) * discPct / 100);
  const gross = !svc ? 0 : isHourly ? (svc.hourly_rate_huf || 0) * hours : (svc.price_huf || 0);
  const discount = stud(gross);
  const companyShare = gross - discount;
  const serviceFee = Math.round(companyShare * (feePct ?? 10) / 100);
  const total = companyShare + serviceFee;
  const youPay = (s) => {
    const g = s.pricing_type === "hourly" ? s.hourly_rate_huf : s.price_huf;
    const d = g - stud(g);
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
                  <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13, color: C.ink, margin: "6px 0 10px" }}>{L("Day", "Nap")}</div>
                  <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 6 }} className="cl-noscroll">
                    {DAYS.map((d) => (
                      <button key={d.iso} onClick={() => setDay(d)} style={{ minWidth: 58, padding: "11px 0", borderRadius: 16, border: "none", cursor: "pointer", background: day?.iso === d.iso ? C.navy : C.card, boxShadow: day?.iso === d.iso ? "0 4px 14px rgba(27,42,107,.3)" : "0 1px 5px rgba(20,28,58,.06)" }}>
                        <div style={{ fontFamily: B, fontSize: 10, fontWeight: 700, color: day?.iso === d.iso ? "#9FB0E8" : C.inkFaint }}>{d.d}</div>
                        <div style={{ fontFamily: F, fontSize: 16, fontWeight: 700, color: day?.iso === d.iso ? "#fff" : C.ink, marginTop: 2 }}>{d.n}</div>
                        {d.label && <div style={{ fontFamily: B, fontSize: 8.5, fontWeight: 700, color: day?.iso === d.iso ? C.mint : C.navySoft, marginTop: 2 }}>{d.label}</div>}
                      </button>
                    ))}
                  </div>
                </>
              )}

              <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13, color: C.ink, margin: "16px 0 10px" }}>{L("Time", "Időpont")}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                {SLOTS.map((s) => (
                  <button key={s} onClick={() => setSlot(s)} style={{ padding: "12px 0", borderRadius: 14, border: "none", cursor: "pointer", fontFamily: F, fontWeight: 700, fontSize: 13.5, background: slot === s ? C.mint : C.card, color: slot === s ? "#10194A" : C.ink, boxShadow: slot === s ? "0 4px 14px rgba(94,230,168,.45)" : "0 1px 5px rgba(20,28,58,.06)" }}>{s}</button>
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
              <div style={{ background: C.card, borderRadius: 18, padding: 16, boxShadow: "0 2px 10px rgba(20,28,58,.05)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontFamily: B, fontSize: 12.5, color: C.inkSoft }}>
                  <span>{svc.name}{isHourly ? ` · ${hours} ${L("h", "óra")} × ${huf(svc.hourly_rate_huf)}` : isSub ? ` · ${everyP(svc.period)}` : ""}</span><span>{huf(gross)}</span>
                </div>
                {discPct > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", fontFamily: B, fontSize: 12.5, color: C.green, fontWeight: 700, marginTop: 7 }}>
                    <span>{promo && promo.pct >= (isStudent ? company.student_discount || 0 : 0) ? `${promo.label || L("Offer", "Akció")} (−${discPct}%)` : `${L("Student discount", "Diákkedvezmény")} (−${discPct}%)`}</span><span>−{huf(discount)}</span>
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
            onLater={() => { toast(L("No problem — pay on completion", "Rendben — fizetés a szolgáltatás után")); onBooked(payWait.row); }}
          />
        )}
        <div style={{ padding: "12px 22px calc(22px + env(safe-area-inset-bottom))", borderTop: `1px solid ${C.line}`, display: "flex", gap: 10 }}>
          {step > 0 && <Btn ghost onClick={() => setStep(step - 1)}>←</Btn>}
          <Btn full disabled={!canNext || busy} onClick={async () => {
            if (step < 3) { setStep(step + 1); return; }
            setBusy(true);
            const row = await createBooking({ companyId: company.id, service: svc, date: day.iso, slot, address: addr, note, total, pricingType: svc.pricing_type, hours: isHourly ? hours : null, period: isSub ? svc.period : null });
            setBusy(false);
            if (!row) { toast(L("Booking failed — try again", "A foglalás nem sikerült — próbáld újra"), "error"); return; }
            // Card + live backend + one-off booking → Barion checkout in the browser
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
  const { session, bookings, allEmployees, companies, reviews, cancelBooking, addReview, submitComplaint, startPayment } = useStore();
  const toast = useToast();
  const mine = bookings.filter((b) => b.customer_id === session.userId || b.customer_name === session.name);
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
      {trackId && <TrackSheet bookingId={trackId} close={() => setTrackId(null)} />}
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
              <>{b.payment_status === "paid" && <Pill bg={C.mintSoft} color={C.green}>💳 Paid</Pill>} <StatusPill status={b.status} /></>
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
            {b.status === 2 && (
              <Btn small ghost style={{ width: "100%", marginBottom: 10 }} onClick={() => setTrackId(b.id)}>{L("Track cleaner on map", "Takarító követése a térképen")}</Btn>
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

            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              {b.status <= 1 && (
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
  const avgRating = myReviews.length ? (myReviews.reduce((a, r) => a + r.stars, 0) / myReviews.length).toFixed(1) : null;

  return (
    <div className="cl-fade">
      <div style={{ background: `radial-gradient(140% 120% at 20% 0%, ${C.navyMid}, ${C.navyDeep} 75%)`, padding: "calc(24px + env(safe-area-inset-top)) 20px 40px", position: "relative", overflow: "hidden" }}>
        <Sparkle size={16} style={{ position: "absolute", top: 22, right: 22 }} cls="cl-twinkle" />
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={openProfile} style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }} aria-label="Profile">
            <Avatar name={session.name} color="#fff" size={44} />
          </button>
          <div>
            <div style={{ fontFamily: F, fontWeight: 700, fontSize: 18, color: "#fff" }}>{session.name}</div>
            <div style={{ fontFamily: B, fontSize: 11, color: "#9FB0E8", marginTop: 2 }}>{co ? `${co.emoji} ${co.name}` : "Cleaner"}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          {[
            { k: "Open jobs", v: open.length },
            { k: "Completed", v: done.length },
            { k: "Rating", v: avgRating ? `${avgRating} ★` : "—" },
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
        <div style={{ fontFamily: F, fontWeight: 700, fontSize: 16, color: C.ink, margin: "8px 0 12px" }}>My jobs</div>
        {open.length === 0 && (
          <div style={{ textAlign: "center", padding: "44px 30px", background: C.card, borderRadius: 20, boxShadow: "0 2px 12px rgba(20,28,58,.05)" }}>
            <div style={{ fontSize: 36 }}>🛋️</div>
            <div style={{ fontFamily: F, fontWeight: 700, fontSize: 14.5, color: C.ink, marginTop: 12 }}>No jobs assigned</div>
            <div style={{ fontFamily: B, fontSize: 12, color: C.inkSoft, marginTop: 6 }}>New assignments appear here automatically.</div>
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
                <StatusPill status={b.status} />
              </div>

              {b.note && (
                <div style={{ background: "#FFF8EA", border: `1px solid ${C.gold}55`, borderRadius: 13, padding: "10px 13px", marginTop: 12, fontFamily: B, fontSize: 11.5, color: "#8A6A1F", lineHeight: 1.55 }}>
                  📝 <b>Customer note:</b> {b.note}
                </div>
              )}

              {tasks.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 9 }}>
                    <span style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink }}>Task checklist</span>
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
                {b.status === 1 && <Btn small full onClick={() => { setStatus(b.id, 2); toast("Status updated — on the way!"); }}>🚗 I'm on the way</Btn>}
                {b.status === 2 && <Btn small full onClick={() => { setStatus(b.id, 3); toast("Cleaning started"); }}>🧽 Start cleaning</Btn>}
                {b.status === 2 && <LocationShare bookingId={b.id} />}
                {b.status === 3 && (
                  <Btn small full mint disabled={!allDone && tasks.length > 0} onClick={() => { setStatus(b.id, 4); toast("Job completed ✓"); }}>
                    {allDone || tasks.length === 0 ? "✓ Complete job" : `Finish all tasks (${b.tasks_done.length}/${tasks.length})`}
                  </Btn>
                )}
              </div>
            </div>
          );
        })}

        {done.length > 0 && (
          <>
            <div style={{ fontFamily: F, fontWeight: 700, fontSize: 14, color: C.inkSoft, margin: "16px 0 10px" }}>Completed</div>
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
        <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Message your company…" style={{ flex: 1, border: `1.5px solid ${C.line}`, borderRadius: 14, padding: "11px 14px", fontFamily: B, fontSize: 13, color: C.ink, background: C.card, outline: "none" }} />
        <Btn small mint disabled={!reply.trim()} onClick={async () => { const r = await sendCompanyMessage(reply.trim()); if (r?.error) toast(r.error, "error"); else { toast("Message sent to your company"); setReply(""); } }}>Send</Btn>
      </div>
      {mine.length === 0 && <div style={{ fontFamily: B, fontSize: 13, color: C.inkSoft, textAlign: "center", padding: 50 }}>No messages from your company yet.</div>}
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
  const { session, bookings, employees, assignBooking, declineBooking, companies, uploadInvoice, archiveBooking } = useStore();
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
  const shownOpen = open.filter((b) =>
    filter === "new" ? b.status === 0 :
    filter === "unassigned" ? !b.assigned_to :
    filter === "today" ? isToday(b) :
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
        <button onClick={openProfile} style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }} aria-label="Profile">
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

      {unassigned > 0 && (
        <div style={{ background: C.amberSoft, border: `1.5px solid ${C.coral}44`, borderRadius: 14, padding: "10px 14px", marginBottom: 14, fontFamily: B, fontSize: 12, color: C.amber, lineHeight: 1.55 }}>
          ⚠️ <b>{unassigned} booking{unassigned > 1 ? "s" : ""}</b> need{unassigned === 1 ? "s" : ""} a cleaner assigned. Go to Team tab to add staff.
        </div>
      )}

      {subs.length > 0 && (
        <div style={{ background: "linear-gradient(135deg,#EAFBF2,#E7F0FF)", borderRadius: 16, padding: "12px 15px", marginBottom: 14 }}>
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink }}>🔁 {subs.length} active subscription{subs.length > 1 ? "s" : ""} — recurring revenue {huf(subs.reduce((a, b) => a + (b.total_huf || 0), 0))} / cycle</div>
          <div style={{ fontFamily: B, fontSize: 10.5, color: C.inkSoft, marginTop: 3 }}>Each completed visit automatically schedules the next one with the same cleaner.</div>
        </div>
      )}

      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 15.5, color: C.ink, marginBottom: 10 }}>Incoming & active jobs</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {[{ id: "all", label: `All (${open.length})` }, { id: "new", label: `🆕 New (${open.filter(b => b.status === 0).length})` }, { id: "unassigned", label: `⚠️ Unassigned (${unassigned})` }, { id: "today", label: `📅 Today (${open.filter(isToday).length})` }, { id: "subs", label: `🔁 Plans (${subs.length})` }].map((f) => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{ fontFamily: B, fontWeight: 700, fontSize: 10.5, padding: "6px 11px", borderRadius: 99, border: "none", cursor: "pointer", background: filter === f.id ? C.navy : C.card, color: filter === f.id ? "#fff" : C.navySoft, boxShadow: "0 1px 4px rgba(20,28,58,.07)" }}>{f.label}</button>
        ))}
      </div>
      {shownOpen.length === 0 && <div style={{ fontFamily: B, fontSize: 12.5, color: C.inkSoft, textAlign: "center", padding: 36, background: C.card, borderRadius: 18, boxShadow: "0 2px 10px rgba(20,28,58,.04)" }}>{open.length === 0 ? "No open jobs right now. New customer bookings will appear here." : "Nothing matches this filter."}</div>}
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
                <StatusPill status={b.status} />
                <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13.5, color: C.navy, marginTop: 7 }}>{huf(b.total_huf)}</div>
              </div>
            </div>

            {b.status >= 2 && tasks.length > 0 && (
              <div style={{ marginTop: 11 }}>
                <Progress done={b.tasks_done.length} total={tasks.length} />
                <div style={{ fontFamily: B, fontSize: 10, color: C.inkFaint, fontWeight: 700, marginTop: 5 }}>
                  {b.tasks_done.length}/{tasks.length} tasks done on site
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontFamily: B, fontSize: 10, fontWeight: 700, color: C.inkFaint }}>ASSIGN:</span>
              {employees.filter((e) => e.is_active !== false).map((m) => (
                <button key={m.id} onClick={() => { assignBooking(b.id, m.id); toast(`Assigned to ${m.full_name.split(" ")[0]}`); }} style={{ fontFamily: B, fontSize: 11, fontWeight: 700, padding: "6px 12px", borderRadius: 99, border: "none", cursor: "pointer", background: b.assigned_to === m.id ? C.navy : C.bg, color: b.assigned_to === m.id ? "#fff" : C.navySoft }}>
                  {b.assigned_to === m.id ? "✓ " : ""}{m.full_name.split(" ")[0]}
                </button>
              ))}
              {employees.length === 0 && <span style={{ fontFamily: B, fontSize: 11, color: C.coral }}>Add employees in Team tab first.</span>}
            </div>
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

      {done.length > 0 && (
        <>
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 14, color: C.inkSoft, margin: "20px 0 10px" }}>Completed jobs</div>
          {done.map((b) => (
            <div key={b.id} style={{ background: C.card, borderRadius: 16, padding: "13px 16px", marginBottom: 9, boxShadow: "0 1px 6px rgba(20,28,58,.04)", opacity: .9 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13, color: C.ink }}>{(b.service_snapshot || {}).name} · {b.customer_name}</div>
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
                      if (file.size > 2 * 1024 * 1024) { toast("Max 2 MB", "error"); return; }
                      const reader = new FileReader();
                      reader.onload = async () => {
                        const r = await uploadInvoice(b.id, { name: file.name, type: file.type, data: reader.result });
                        if (r?.error) toast(r.error, "error"); else toast("Invoice attached — customer can download it");
                      };
                      reader.readAsDataURL(file);
                    }} />
                  </label>
                )}
                <button onClick={async () => { const r = await archiveBooking(b.id); if (r?.error) toast(r.error, "error"); else toast("Moved to history (Settings)"); }}
                  style={{ marginLeft: "auto", border: "none", background: C.bg, color: C.inkFaint, borderRadius: 9, padding: "6px 11px", fontFamily: B, fontWeight: 700, fontSize: 11, cursor: "pointer" }}>Clear</button>
              </div>
            </div>
          ))}
        </>
      )}
      {cancelled.length > 0 && (
        <div style={{ fontFamily: B, fontSize: 11, color: C.inkFaint, marginTop: 14 }}>{cancelled.length} cancelled / declined booking(s) hidden.</div>
      )}

      {declining && (
        <Sheet title="Decline this booking?" close={() => setDeclining(null)}>
          <div style={{ fontFamily: B, fontSize: 12.5, color: C.inkSoft, lineHeight: 1.6, marginBottom: 14 }}>
            Tell {declining.customer_name || "the customer"} why you can't take <b style={{ color: C.ink }}>{(declining.service_snapshot || {}).name}</b> on {dayLabel(declining.scheduled_date)} at {declining.scheduled_slot}.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            {["Not available at this time", "Fully booked that day", "Outside our service area", "Team off that day"].map((q) => (
              <button key={q} onClick={() => setReason(q)} style={{ fontFamily: B, fontSize: 11.5, fontWeight: 600, padding: "8px 12px", borderRadius: 99, border: `1.5px solid ${C.line}`, background: reason === q ? C.coralSoft : C.card, color: reason === q ? C.coral : C.navySoft, cursor: "pointer" }}>{q}</button>
            ))}
          </div>
          <Field area placeholder="Add a note (optional)…" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Btn full danger onClick={() => { declineBooking(declining.id, reason || "Not available for this time"); toast("Booking declined"); setDeclining(null); }}>
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
          <div style={{ fontFamily: B, fontSize: 10.5, color: C.inkSoft }}>lifetime revenue</div>
        </div>
        <div style={{ flex: 1, background: C.card, borderRadius: 14, padding: "12px 14px", boxShadow: "0 1px 6px rgba(20,28,58,.05)" }}>
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 17, color: C.ink }}>{clients.filter((c) => c.hasSub).length}</div>
          <div style={{ fontFamily: B, fontSize: 10.5, color: C.inkSoft }}>active subscribers</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.card, borderRadius: 14, padding: "11px 14px", marginBottom: 14, boxShadow: "0 1px 6px rgba(20,28,58,.05)" }}>
        <span style={{ opacity: .45 }}>🔍</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients…" style={{ flex: 1, border: "none", outline: "none", fontFamily: B, fontSize: 13.5, color: C.ink, background: "transparent" }} />
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
      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 21, color: C.ink, margin: "8px 0 6px" }}>Schedule</div>
      <div style={{ fontFamily: B, fontSize: 11.5, color: C.inkSoft, marginBottom: 14 }}>Your whole pipeline on a calendar — dots mark days with jobs.</div>
      <Calendar selected={selDay} onSelect={setSelDay} marks={marks} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "16px 0 10px" }}>
        <div style={{ fontFamily: F, fontWeight: 700, fontSize: 14.5, color: C.ink }}>{dayLabel(selDay)} · {dayJobs.length} job{dayJobs.length === 1 ? "" : "s"}</div>
        {dayJobs.length > 0 && <Pill bg={C.mintSoft} color={C.green}>{huf(dayRevenue)}</Pill>}
      </div>
      {dayJobs.length === 0 && (
        <div style={{ fontFamily: B, fontSize: 12.5, color: C.inkSoft, textAlign: "center", padding: 30, background: C.card, borderRadius: 18, boxShadow: "0 2px 10px rgba(20,28,58,.04)" }}>Nothing scheduled this day.</div>
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
                <StatusPill status={b.status} />
                <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.navy, marginTop: 6 }}>{huf(b.total_huf)}</div>
              </div>
            </div>
            {b.status === 2 && <Btn small ghost style={{ width: "100%", marginTop: 10 }} onClick={() => setTrackId(b.id)}>{L("Track cleaner on map", "Takarító követése")}</Btn>}
          </div>
        );
      })}
      {trackId && <TrackSheet bookingId={trackId} close={() => setTrackId(null)} />}
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
    setF(svc ? { ...svc, tasksText: (svc.tasks || []).join("\n") } : { name: "", description: "", icon: "🏠", price_huf: "", minutes: 120, tasksText: "", pricing_type: "flat", hourly_rate_huf: "", min_hours: 2, max_hours: 8, period: "weekly" });
    setEditing(svc ? "edit" : "new");
  };

  return (
    <div className="cl-fade" style={{ padding: "calc(20px + env(safe-area-inset-top)) 20px 30px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "8px 0 16px" }}>
        <div style={{ fontFamily: F, fontWeight: 700, fontSize: 21, color: C.ink }}>Services & prices</div>
        <Btn small onClick={() => openEditor(null)}>+ New service</Btn>
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
                <Pill bg={C.navyChip} color={C.navySoft}>{s.pricing_type === "hourly" ? "⏱ Hourly" : s.pricing_type === "subscription" ? `🔁 ${periodLabel(s.period)}` : "💰 Flat"}</Pill>
              </div>
              <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft, marginTop: 5, lineHeight: 1.5 }}>{s.description} · ⏱ {s.minutes} min · {(s.tasks || []).length} tasks</div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <Btn small ghost onClick={() => openEditor(s)}>✏️ Edit</Btn>
                <Btn small ghost onClick={() => { upsertService({ ...s, is_active: !s.is_active }); toast(s.is_active ? "Service hidden" : "Service re-listed"); }} style={{ color: s.is_active ? C.coral : C.green }}>
                  {s.is_active ? "Hide" : "Re-list"}
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
              <Field label="Icon" placeholder="🏠" value={f.icon} onChange={(e) => setF({ ...f, icon: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <Field label="Name" placeholder="e.g. Deep clean" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </div>
          </div>
          <Field label="Description" placeholder="What's included, in one line" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink, marginBottom: 8 }}>Pricing model</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            {[{ id: "flat", t: "Flat", icon: "💰" }, { id: "hourly", t: "Hourly", icon: "⏱️" }, { id: "subscription", t: "Plan", icon: "🔁" }].map((o) => (
              <button key={o.id} onClick={() => setF({ ...f, pricing_type: o.id })} style={{ flex: 1, padding: "10px 4px", borderRadius: 13, cursor: "pointer", border: (f.pricing_type || "flat") === o.id ? `2px solid ${C.navy}` : "2px solid transparent", background: C.card, boxShadow: "0 1px 6px rgba(20,28,58,.06)", textAlign: "center" }}>
                <div style={{ fontSize: 18 }}>{o.icon}</div>
                <div style={{ fontFamily: F, fontWeight: 700, fontSize: 11.5, color: C.ink, marginTop: 3 }}>{o.t}</div>
              </button>
            ))}
          </div>

          {(f.pricing_type || "flat") === "flat" && (
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}><Field label="Price (HUF)" type="number" placeholder="15900" value={f.price_huf} onChange={(e) => setF({ ...f, price_huf: e.target.value })} /></div>
              <div style={{ flex: 1 }}><Field label="Duration (min)" type="number" value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })} /></div>
            </div>
          )}
          {f.pricing_type === "hourly" && (
            <>
              <Field label="Hourly rate (HUF / hour)" type="number" placeholder="4500" value={f.hourly_rate_huf} onChange={(e) => setF({ ...f, hourly_rate_huf: e.target.value })} />
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}><Field label="Min hours" type="number" value={f.min_hours ?? 2} onChange={(e) => setF({ ...f, min_hours: e.target.value })} /></div>
                <div style={{ flex: 1 }}><Field label="Max hours" type="number" value={f.max_hours ?? 8} onChange={(e) => setF({ ...f, max_hours: e.target.value })} /></div>
              </div>
            </>
          )}
          {f.pricing_type === "subscription" && (
            <>
              <Field label="Price per period (HUF)" type="number" placeholder="13900" value={f.price_huf} onChange={(e) => setF({ ...f, price_huf: e.target.value })} />
              <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink, marginBottom: 8 }}>Billing period</div>
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                {["weekly", "biweekly", "monthly"].map((p) => (
                  <button key={p} onClick={() => setF({ ...f, period: p })} style={{ flex: 1, padding: "10px 4px", borderRadius: 13, cursor: "pointer", border: (f.period || "weekly") === p ? `2px solid ${C.navy}` : "2px solid transparent", background: C.card, boxShadow: "0 1px 6px rgba(20,28,58,.06)", fontFamily: F, fontWeight: 700, fontSize: 11, color: C.ink, textTransform: "capitalize" }}>{p}</button>
                ))}
              </div>
            </>
          )}

          <Field area rows={5} label="Cleaner task checklist (one per line)" placeholder={"Kitchen surfaces & sink\nBathroom full clean\nVacuum & mop"} value={f.tasksText} onChange={(e) => setF({ ...f, tasksText: e.target.value })} />
          <Btn full disabled={!f.name || (f.pricing_type === "hourly" ? !f.hourly_rate_huf : !f.price_huf)} onClick={() => {
            upsertService({ id: editing === "edit" ? f.id : undefined, name: f.name, description: f.description, icon: f.icon || "🏠", price_huf: parseInt(f.price_huf, 10) || 0, minutes: parseInt(f.minutes, 10) || 120, tasks: f.tasksText.split("\n").map((t) => t.trim()).filter(Boolean), is_active: f.is_active !== false, pricing_type: f.pricing_type || "flat", hourly_rate_huf: f.pricing_type === "hourly" ? (parseInt(f.hourly_rate_huf, 10) || 0) : null, min_hours: parseInt(f.min_hours, 10) || 2, max_hours: parseInt(f.max_hours, 10) || 8, period: f.pricing_type === "subscription" ? (f.period || "weekly") : null });
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
  const { employees, invites, bookings, createInvite, deleteInvite, sendNotice, notices, session, deleteNotice } = useStore();
  const toast = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [showMsg, setShowMsg] = useState(null);
  const [label, setLabel] = useState("");
  const [msg, setMsg] = useState("");
  const [newCode, setNewCode] = useState(null);

  const copyCode = (code) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(code).then(() => toast("Code copied to clipboard!")).catch(() => toast("Copy failed", "error"));
    } else {
      toast("Code: " + code);
    }
  };

  return (
    <div className="cl-fade" style={{ padding: "calc(20px + env(safe-area-inset-top)) 20px 30px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "8px 0 16px" }}>
        <div style={{ fontFamily: F, fontWeight: 700, fontSize: 21, color: C.ink }}>Team</div>
        <Btn small onClick={() => { setShowAdd(true); setNewCode(null); setLabel(""); }}>+ Invite employee</Btn>
      </div>

      {employees.length === 0 && !invites.length && (
        <div style={{ textAlign: "center", padding: "44px 24px", background: C.card, borderRadius: 20, boxShadow: "0 2px 10px rgba(20,28,58,.05)", marginBottom: 16 }}>
          <div style={{ fontSize: 34 }}>👥</div>
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 15, color: C.ink, marginTop: 12 }}>No team members yet</div>
          <div style={{ fontFamily: B, fontSize: 12, color: C.inkSoft, marginTop: 6, lineHeight: 1.55 }}>Invite your first cleaner. They sign up with the code and are instantly linked to your company.</div>
        </div>
      )}

      {employees.map((m) => (
        <div key={m.id} style={{ background: C.card, borderRadius: 20, padding: 16, marginBottom: 12, boxShadow: "0 2px 12px rgba(20,28,58,.06)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Avatar name={m.full_name} size={42} />
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: F, fontWeight: 700, fontSize: 14.5, color: C.ink }}>{m.full_name}</div>
              <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft, marginTop: 2 }}>{m.title || "Cleaner"}{m.phone ? ` · ${m.phone}` : ""}</div>
            </div>
            <Pill bg={C.mintSoft} color={C.green}>Active</Pill>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 13 }}>
            <Btn small ghost style={{ flex: 1 }} onClick={() => { setShowMsg(m); setMsg(""); }}>💬 Send notice</Btn>
            <Btn small ghost style={{ flex: 1 }}>📋 {bookings.filter((b) => b.assigned_to === m.id && b.status < 4).length} open</Btn>
          </div>
        </div>
      ))}

      {invites.filter((i) => !i.used_by).length > 0 && (
        <>
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 14, color: C.inkSoft, margin: "16px 0 10px" }}>Pending invites</div>
          {invites.filter((i) => !i.used_by).map((i) => (
            <div key={i.code} style={{ background: C.card, borderRadius: 16, padding: "13px 16px", marginBottom: 9, boxShadow: "0 1px 6px rgba(20,28,58,.04)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 14, color: C.navy, letterSpacing: 1.5 }}>{i.code}</div>
                  {i.label && <div style={{ fontFamily: B, fontSize: 10.5, color: C.inkFaint, marginTop: 2 }}>for {i.label}</div>}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <Pill bg={C.amberSoft} color={C.amber}>Waiting</Pill>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <Btn small ghost style={{ flex: 1 }} onClick={() => copyCode(i.code)}>📋 Copy code</Btn>
                <Btn small ghost style={{ flex: 1, color: C.coral }} onClick={() => { deleteInvite(i.code); toast("Invite deleted"); }}>✕ Revoke</Btn>
              </div>
            </div>
          ))}
        </>
      )}

      {showAdd && (
        <Sheet title="Invite an employee" close={() => setShowAdd(false)}>
          {!newCode ? (
            <>
              <Field label="Who is this invite for? (optional)" placeholder="e.g. Zoltán Farkas" value={label} onChange={(e) => setLabel(e.target.value)} />
              <div style={{ fontFamily: B, fontSize: 11.5, color: C.inkSoft, lineHeight: 1.6, background: C.mintSoft, borderRadius: 13, padding: "11px 14px", marginBottom: 16 }}>
                A one-time <b>invite code</b> is generated. They open Cleano, choose "I'm a cleaner", and sign up with the code — they're instantly linked to your company.
              </div>
              <Btn full onClick={async () => { const code = await createInvite(label); if (code) setNewCode(code); else toast("Failed to generate code", "error"); }}>Generate invite code</Btn>
            </>
          ) : (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontFamily: B, fontSize: 12, color: C.inkSoft, marginBottom: 12 }}>Share this code with {label || "your employee"}:</div>
              <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 26, color: C.navy, letterSpacing: 3, background: C.card, borderRadius: 16, padding: "18px 0", boxShadow: "0 2px 12px rgba(20,28,58,.07)", marginBottom: 14 }}>{newCode}</div>
              <Btn ghost full onClick={() => copyCode(newCode)} style={{ marginBottom: 10 }}>📋 Copy to clipboard</Btn>
              <Btn full mint onClick={() => setShowAdd(false)}>Done</Btn>
            </div>
          )}
        </Sheet>
      )}

      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 16, color: C.ink, margin: "22px 0 12px" }}>Sent notices</div>
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
                : <Pill bg={C.amberSoft} color={C.amber}>✓ Not seen yet</Pill>}
              <button onClick={() => { deleteNotice(n.id); }}
                title="Clear from my list"
                style={{ border: "none", background: C.bg, color: C.inkFaint, width: 26, height: 26, borderRadius: 9, cursor: "pointer", fontSize: 12, flexShrink: 0 }}>✕</button>
            </div>
          </div>
        );
      })}

      {showMsg && (
        <Sheet title={`Notice to ${showMsg.full_name.split(" ")[0]}`} close={() => setShowMsg(null)}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            {["Bring HEPA vacuum 🌬️", "Call me when free 📞", "Schedule change tomorrow 🗓️", "Check the job notes carefully 📋"].map((q) => (
              <button key={q} onClick={() => setMsg(q)} style={{ fontFamily: B, fontSize: 11.5, fontWeight: 600, padding: "8px 12px", borderRadius: 99, border: `1.5px solid ${C.line}`, background: msg === q ? C.mintSoft : C.card, color: C.navySoft, cursor: "pointer" }}>{q}</button>
            ))}
          </div>
          <Field area placeholder="Write your message…" value={msg} onChange={(e) => setMsg(e.target.value)} />
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
          <span style={{ display: "block", fontFamily: F, fontWeight: 700, fontSize: 14, color: C.ink }}>Completed jobs history</span>
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
      {open && done.length === 0 && <div style={{ fontFamily: B, fontSize: 12, color: C.inkFaint, marginTop: 10 }}>Nothing completed yet.</div>}
    </div>
  );
}

/* ── Company payout onboarding (Stripe Connect) ── */
function PayoutSetup() {
  const { connectStatus, connectOnboard, isLive } = useStore();
  const toast = useToast();
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  React.useEffect(() => { if (isLive) connectStatus().then(setSt); }, [isLive]);
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
      </div>
    </div>
  );
}

function CompanySettings() {
  const { session, companies, updateCompany } = useStore();
  const toast = useToast();
  const co = companies.find((c) => c.id === session.companyId);
  const [f, setF] = useState({
    name: co?.name || "", tagline: co?.tagline || "", area: co?.area || "", city: co?.city || "Debrecen",
    emoji: co?.emoji || "🫧", student_discount: co?.student_discount ?? 10,
    promo_on: !!promoOf(co), promo_pct: promoOf(co)?.pct ?? 10, promo_label: promoOf(co)?.label || "", promo_until: promoOf(co)?.until || "",
    cover: co?.cover || COVER_PRESETS[0], logo_url: co?.logo_url || null,
    tax_id: co?.tax_id || "", reg_number: co?.reg_number || "", contact_phone: co?.contact_phone || "", google_place_id: co?.google_place_id || "",
    documents: co?.documents || [],
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const onLogoFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast("Please choose a PNG image", "error");
    if (file.size > 1.5 * 1024 * 1024) return toast("Logo too large — max 1.5 MB", "error");
    const reader = new FileReader();
    reader.onload = () => setF((p) => ({ ...p, logo_url: reader.result }));
    reader.readAsDataURL(file);
  };

  const save = async () => {
    if (!f.name.trim()) return toast("Company name is required", "error");
    const disc = parseInt(f.student_discount, 10);
    if (isNaN(disc) || disc < 0 || disc > 50) return toast("Discount must be 0–50%", "error");
    setBusy(true);
    const res = await updateCompany({ name: f.name.trim(), tagline: f.tagline, area: f.area, emoji: f.emoji || "🫧", student_discount: disc, promo: f.promo_on ? { pct: parseInt(f.promo_pct, 10) || 10, label: f.promo_label, until: f.promo_until || null } : null, cover: f.cover, logo_url: f.logo_url, tax_id: f.tax_id, reg_number: f.reg_number, contact_phone: f.contact_phone, google_place_id: f.google_place_id, documents: f.documents });
    setBusy(false);
    if (res?.error) toast(res.error, "error");
    else toast("Company profile updated ✓");
  };

  return (
    <div className="cl-fade" style={{ padding: "calc(20px + env(safe-area-inset-top)) 20px 30px" }}>
      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 21, color: C.ink, margin: "8px 0 18px" }}>Company settings</div>

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
        {f.logo_url && <Btn small ghost onClick={() => setF({ ...f, logo_url: null })} style={{ color: C.coral }}>Remove</Btn>}
      </div>

      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12, color: C.ink, marginBottom: 8 }}>Cover colour</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
        {COVER_PRESETS.map((p) => (
          <button key={p} onClick={() => setF({ ...f, cover: p })} style={{ width: 38, height: 38, borderRadius: 11, background: p, border: f.cover === p ? `3px solid ${C.navy}` : "3px solid transparent", cursor: "pointer", outline: f.cover === p ? `2px solid #fff` : "none", outlineOffset: -4 }} />
        ))}
      </div>

      <Field label="Emoji (shown if no logo uploaded)" placeholder="🫧" value={f.emoji} onChange={set("emoji")} />
      <Field label="Company name *" placeholder="SparkClean Kft." value={f.name} onChange={set("name")} />
      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink, marginBottom: 7 }}>City served</div>
      <select value={f.city || "Debrecen"} onChange={(e) => setF({ ...f, city: e.target.value })}
        style={{ width: "100%", boxSizing: "border-box", padding: "13px 15px", borderRadius: 15, border: `1.5px solid ${C.line}`, fontFamily: B, fontSize: 14, background: C.card, color: C.ink, marginBottom: 14, outline: "none" }}>
        {ALL_CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <Field label="Tagline" placeholder="What makes you different?" value={f.tagline} onChange={set("tagline")} />
      <Field label="Service area" placeholder="e.g. Belváros · Nagyerdő" value={f.area} onChange={set("area")} />

      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink, margin: "4px 0 8px" }}>Business details (for verification & invoicing)</div>
      <Field label="Tax number (adószám)" placeholder="12345678-1-42"
        hint={f.tax_id?.trim() ? (huTaxIdValid(f.tax_id) ? "✅ Valid" : "❌ Invalid format — 12345678-1-42") : undefined}
        value={f.tax_id} onChange={set("tax_id")} />
      <Field label="Company registration no." placeholder="09-09-123456" value={f.reg_number} onChange={set("reg_number")} />
      <Field label="Contact phone" placeholder="+36 …" value={f.contact_phone} onChange={set("contact_phone")} />
      <JobHistory />
      <PayoutSetup />
      <Field label="Google Place ID (optional)" hint={L("Happy customers get a one-tap 'Review on Google' button. Search 'Google Place ID finder' to get yours.", "Az elégedett ügyfelek egy gombbal értékelhetnek Google-ön. Keresd: 'Google Place ID finder'.")} placeholder="ChIJ…" value={f.google_place_id || ""} onChange={set("google_place_id")} />
      <DocUpload
        label="Verification documents"
        hint="Cégkivonat, tax certificate, insurance — reviewed by the Cleano admin."
        docs={f.documents || []}
        onChange={(docs) => setF({ ...f, documents: docs })}
      />

      <div style={{ marginBottom: 13 }}>
        <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12.5, color: C.ink, marginBottom: 7 }}>Student discount %</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <input type="range" min={0} max={50} step={5} value={f.student_discount} onChange={set("student_discount")} style={{ flex: 1, accentColor: C.navy }} />
          <span style={{ fontFamily: F, fontWeight: 700, fontSize: 15, color: C.navy, minWidth: 44 }}>{f.student_discount}%</span>
        </div>
        <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft, marginTop: 5 }}>Students see this as a discount at checkout.</div>
      </div>

      <div style={{ background: C.card, borderRadius: 18, padding: 16, marginBottom: 16, boxShadow: "0 2px 10px rgba(20,28,58,.05)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13.5, color: C.ink }}>Special offer</div>
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
            <Field label="Offer name (optional)" placeholder="e.g. Spring cleaning week" value={f.promo_label} onChange={set("promo_label")} />
            <Field label="Ends on (optional — empty = until you turn it off)" type="date" value={f.promo_until} onChange={set("promo_until")} />
            <div style={{ fontFamily: B, fontSize: 11, color: C.inkSoft }}>If a student's discount is higher, they get the better one — never both.</div>
          </div>
        )}
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
  const { adminBroadcast } = useStore();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [aud, setAud] = useState("all");
  const [busy, setBusy] = useState(false);
  const AUDS = [["all", "Everyone"], ["customer", "Customers"], ["company", "Companies"], ["employee", "Cleaners"]];
  const send = async () => {
    if (!title.trim()) return;
    setBusy(true);
    const res = await adminBroadcast(title.trim(), body.trim(), aud);
    setBusy(false);
    if (res?.error) { toast(res.error); return; }
    toast(`Announcement sent to ${res.sent} user${res.sent === 1 ? "" : "s"}`);
    setTitle(""); setBody(""); setOpen(false);
  };
  return (
    <div className="cl-card" style={{ background: C.card, borderRadius: 20, padding: 18, marginBottom: 14 }}>
      <button onClick={() => setOpen(!open)} style={{ background: "none", border: "none", padding: 0, width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
        <div style={{ textAlign: "left" }}>
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 14.5, color: C.ink }}>Send announcement</div>
          <div style={{ fontFamily: B, fontSize: 11.5, color: C.inkSoft, marginTop: 2 }}>Marketing or news — lands as a banner in every user's app. Push to phones activates with Firebase.</div>
        </div>
        <span style={{ color: C.inkFaint, fontSize: 15 }}>{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
            {AUDS.map(([id, label]) => (
              <button key={id} onClick={() => setAud(id)} style={{ border: "none", cursor: "pointer", fontFamily: B, fontWeight: 700, fontSize: 11.5, padding: "7px 13px", borderRadius: 99, background: aud === id ? C.navy : C.bg, color: aud === id ? "#fff" : C.inkSoft }}>{label}</button>
            ))}
          </div>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Title — e.g. 20% off your first clean this week"
            style={{ width: "100%", boxSizing: "border-box", background: C.bg, border: "none", borderRadius: 13, padding: "12px 14px", fontFamily: B, fontSize: 13, color: C.ink, outline: "none", marginBottom: 8 }} />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={500} rows={3} placeholder="Message (optional)"
            style={{ width: "100%", boxSizing: "border-box", background: C.bg, border: "none", borderRadius: 13, padding: "12px 14px", fontFamily: B, fontSize: 13, color: C.ink, outline: "none", resize: "vertical", marginBottom: 10 }} />
          <Btn full onClick={send} disabled={busy || !title.trim()}>{busy ? "Sending…" : "Send announcement"}</Btn>
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
        <div style={{ fontFamily: B, fontSize: 13, color: C.inkSoft, marginBottom: 14 }}>Couldn't load platform stats.</div>
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
      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 21, color: C.ink, margin: "8px 0 18px" }}>Platform dashboard</div>
      <AnnouncementComposer />

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
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 14, color: C.ink, margin: "18px 0 10px" }}>Bookings by status</div>
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
  const { adminAllCompanies, adminFetchAllCompanies, adminUpdateCompany } = useStore();
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
            <button onClick={() => setViewDocs({ title: `${co.name} — documents`, docs: co.documents || [] })} style={{ fontFamily: B, fontWeight: 700, fontSize: 11, padding: "6px 12px", borderRadius: 99, border: `1.5px solid ${C.line}`, background: C.card, color: C.navySoft, cursor: "pointer" }}>
              📄 Docs ({(co.documents || []).length})
            </button>
          </div>
        </div>
      ))}
      {viewDocs && <DocViewer title={viewDocs.title} docs={viewDocs.docs} close={() => setViewDocs(null)} />}
    </div>
  );
}

function ComplaintThread({ complaint, role, close, onChange }) {
  const { fetchComplaintThread, sendComplaintMessage, adminUpdateComplaint, assignComplaint, adminAllCompanies, adminFetchAllCompanies } = useStore();
  const toast = useToast();
  const [msgs, setMsgs] = React.useState([]);
  const [text, setText] = React.useState("");
  const [note, setNote] = React.useState("");
  const [assignTo, setAssignTo] = React.useState("");
  const [status, setStatus] = React.useState(complaint.status);
  const [assigned, setAssigned] = React.useState(complaint.assigned_company_name || "");
  const load = () => fetchComplaintThread(complaint.id).then((m) => setMsgs(m || []));
  React.useEffect(() => { load(); if (role === "admin" && (!adminAllCompanies || adminAllCompanies.length === 0)) adminFetchAllCompanies(); }, []);
  const send = async () => { if (!text.trim()) return; const r = await sendComplaintMessage(complaint.id, text.trim()); if (r?.error) toast(r.error, "error"); else { setText(""); load(); } };
  const doResolve = async () => { const r = await adminUpdateComplaint(complaint.id, { status: "resolved", resolution: note }); if (r?.error) toast(r.error, "error"); else { setStatus("resolved"); toast("Marked resolved"); onChange && onChange(); } };
  const doAssign = async () => { if (!assignTo) return; const r = await assignComplaint(complaint.id, assignTo); if (r?.error) toast(r.error, "error"); else { const co = (adminAllCompanies || []).find((c) => c.id === assignTo); setAssigned(co?.name || "company"); setStatus("in_progress"); toast("Assigned to " + (co?.name || "company")); onChange && onChange(); } };
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
        {msgs.length === 0 && <div style={{ fontFamily: B, fontSize: 11.5, color: C.inkFaint, textAlign: "center", padding: 10 }}>No replies yet.</div>}
      </div>
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
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12, color: C.ink, marginBottom: 8 }}>Move to a company to resolve</div>
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
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Resolution note…" style={{ flex: 1, border: `1.5px solid ${C.line}`, borderRadius: 12, padding: "9px 11px", fontFamily: B, fontSize: 12.5, background: C.card, color: C.ink, outline: "none" }} />
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
      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 21, color: C.ink, margin: "8px 0 4px" }}>Issues to resolve</div>
      <div style={{ fontFamily: B, fontSize: 12, color: C.inkSoft, marginBottom: 14 }}>Complaints Cleano assigned to your company.</div>
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
    <Sheet title="🛟 My reports" close={close}>
      {list.length === 0 && <div style={{ fontFamily: B, fontSize: 13, color: C.inkSoft, textAlign: "center", padding: 24 }}>You haven't filed any reports.</div>}
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

function AdminUsers() {
  const { adminAllUsers, adminFetchUsers, adminUpdateUser, adminDeleteUser } = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState(!adminAllUsers);
  const [q, setQ] = useState("");
  const [viewDocs, setViewDocs] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);

  React.useEffect(() => {
    if (!adminAllUsers) adminFetchUsers().finally(() => setBusy(false));
  }, []);

  if (busy) return <div style={{ textAlign: "center", padding: 60, fontFamily: B, color: C.inkSoft }}>Loading…</div>;

  const filtered = (adminAllUsers || []).filter((u) =>
    (u.full_name || "").toLowerCase().includes(q.toLowerCase()) ||
    (u.email || "").toLowerCase().includes(q.toLowerCase())
  );

  const roleColor = { customer: C.navySoft, employee: C.green, company: "#7B4DE0" };

  return (
    <div className="cl-fade" style={{ padding: "calc(20px + env(safe-area-inset-top)) 20px 30px" }}>
      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 21, color: C.ink, margin: "8px 0 12px" }}>Users ({(adminAllUsers || []).length})</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.card, borderRadius: 14, padding: "11px 14px", marginBottom: 16, boxShadow: "0 1px 6px rgba(20,28,58,.05)" }}>
        <span style={{ opacity: .45 }}>🔍</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email…" style={{ flex: 1, border: "none", outline: "none", fontFamily: B, fontSize: 13.5, color: C.ink, background: "transparent" }} />
        {q && <button onClick={() => setQ("")} style={{ border: "none", background: "none", color: C.inkFaint, cursor: "pointer" }}>✕</button>}
      </div>
      {filtered.map((u) => (
        <div key={u.id} style={{ background: C.card, borderRadius: 16, padding: "13px 15px", marginBottom: 10, boxShadow: "0 1px 8px rgba(20,28,58,.05)", opacity: u.is_active === false ? .6 : 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Avatar name={u.full_name || "?"} size={38} color={roleColor[u.role] || C.navySoft} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13.5, color: C.ink }}>{u.full_name || "—"}</div>
              <div style={{ fontFamily: B, fontSize: 10.5, color: C.inkSoft, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.email}</div>
            </div>
            <Pill color={roleColor[u.role] || C.navySoft} bg={roleColor[u.role] + "18" || C.navyChip} style={{ textTransform: "capitalize" }}>{u.role}</Pill>
          </div>
          {u.company_name && <div style={{ fontFamily: B, fontSize: 10.5, color: C.inkFaint, marginTop: 6, marginLeft: 48 }}>🏢 {u.company_name}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
            {(u.documents || []).length > 0 && (
              <button onClick={() => setViewDocs({ title: `${u.full_name} — documents`, docs: u.documents })} style={{ fontFamily: B, fontWeight: 700, fontSize: 11, padding: "6px 12px", borderRadius: 99, border: `1.5px solid ${C.line}`, background: C.card, color: C.navySoft, cursor: "pointer" }}>
                🪪 Docs ({u.documents.length})
              </button>
            )}
            {u.approval_status === "pending" && (
              <>
                <Pill bg={C.amberSoft} color={C.amber}>🎓 Pending review</Pill>
                <button onClick={async () => {
                  const res = await adminUpdateUser(u.id, { approvalStatus: "approved" });
                  if (res?.error) toast(res.error, "error");
                  else { toast("Student approved — email sent ✉️"); adminFetchUsers(); }
                }} style={{ fontFamily: B, fontWeight: 700, fontSize: 11, padding: "6px 14px", borderRadius: 99, border: `1.5px solid ${C.green}`, background: C.card, color: C.green, cursor: "pointer" }}>
                  ✓ Approve
                </button>
                <button onClick={async () => {
                  const res = await adminUpdateUser(u.id, { approvalStatus: "rejected" });
                  if (res?.error) toast(res.error, "error");
                  else { toast("Application rejected"); adminFetchUsers(); }
                }} style={{ fontFamily: B, fontWeight: 700, fontSize: 11, padding: "6px 14px", borderRadius: 99, border: `1.5px solid ${C.coral}`, background: C.card, color: C.coral, cursor: "pointer" }}>
                  ✕ Reject
                </button>
              </>
            )}
            {["customer", "employee", "admin"].includes(u.role) && (
              <button onClick={async () => {
                const res = await adminUpdateUser(u.id, { makeAdmin: u.role !== "admin" });
                if (res?.error) toast(res.error, "error");
                else { toast(u.role !== "admin" ? "Admin access granted" : "Admin access removed"); adminFetchUsers(); }
              }} style={{ fontFamily: B, fontWeight: 700, fontSize: 11, padding: "6px 12px", borderRadius: 99, border: `1.5px solid ${u.role === "admin" ? C.coral : C.navySoft}`, background: C.card, color: u.role === "admin" ? C.coral : C.navySoft, cursor: "pointer" }}>
                {u.role === "admin" ? "🛡️ Remove admin" : "🛡️ Make admin"}
              </button>
            )}
            <button onClick={async () => {
              const res = await adminUpdateUser(u.id, { is_active: !u.is_active });
              if (res?.error) toast(res.error, "error");
              else { toast(u.is_active === false ? "User activated" : "User deactivated"); adminFetchUsers(); }
            }} style={{ fontFamily: B, fontWeight: 700, fontSize: 11, padding: "6px 14px", borderRadius: 99, border: `1.5px solid ${u.is_active === false ? C.green : C.coral}`, background: C.card, color: u.is_active === false ? C.green : C.coral, cursor: "pointer" }}>
              {u.is_active === false ? "Activate" : "Deactivate"}
            </button>
            <button onClick={() => setConfirmDel(u)} style={{ fontFamily: B, fontWeight: 700, fontSize: 11, padding: "6px 12px", borderRadius: 99, border: `1.5px solid ${C.coral}`, background: C.coral + "12", color: C.coral, cursor: "pointer" }}>
              🗑️ Delete
            </button>
          </div>
        </div>
      ))}
      {filtered.length === 0 && <div style={{ fontFamily: B, fontSize: 13, color: C.inkSoft, textAlign: "center", padding: 40 }}>No users found.</div>}
      {viewDocs && <DocViewer title={viewDocs.title} docs={viewDocs.docs} close={() => setViewDocs(null)} />}
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
      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 21, color: C.ink, margin: "8px 0 4px" }}>Orders by customer</div>
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
                          <StatusPill status={b.status} />
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
      {people.length === 0 && <div style={{ fontFamily: B, fontSize: 13, color: C.inkSoft, textAlign: "center", padding: 40 }}>No orders in this filter.</div>}
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
      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 15, color: C.ink, marginBottom: 4 }}>Decision log</div>
      <div style={{ fontFamily: B, fontSize: 12, color: C.inkSoft, marginBottom: 14 }}>Every admin decision, signed by who made it.</div>
      {rows.length === 0 && <div style={{ fontFamily: B, fontSize: 12.5, color: C.inkSoft, textAlign: "center", padding: 24 }}>No decisions logged yet.</div>}
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

function AdminPanel({ tab }) {
  const { logout, session } = useStore();
  const isCeo = session?.isSuper === true;
  return (
    <div className="cl-fade" style={{ display: "flex", flexDirection: "column", minHeight: "100%" }}>
      <div style={{ background: `radial-gradient(140% 100% at 20% 0%, ${C.navyMid}, ${C.navyDeep} 75%)`, padding: "calc(22px + env(safe-area-inset-top)) 20px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 46, height: 46, borderRadius: 14, background: "rgba(255,255,255,.12)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>🛡️</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: F, fontWeight: 700, fontSize: 18, color: "#fff" }}>Admin panel</div>
            <div style={{ fontFamily: B, fontSize: 11, color: "#9FB0E8", marginTop: 1 }}>{isCeo ? "CEO admin · Cleano Magyarország" : "Company review team"}</div>
          </div>
          <button onClick={logout} style={{ background: "rgba(255,255,255,.12)", border: "1px solid rgba(255,255,255,.2)", borderRadius: 99, padding: "7px 14px", fontFamily: B, fontWeight: 700, fontSize: 11, color: "#C9D2F5", cursor: "pointer" }}>
            🚪 Log out
          </button>
        </div>
      </div>
      <div style={{ flex: 1 }}>
        {(tab === "home" || tab === "dashboard") && <AdminDashboard />}
        {tab === "companies" && <AdminCompanies />}
        {tab === "users" && <AdminUsers />}
        {tab === "bookings" && <AdminBookings />}
        {tab === "complaints" && <AdminComplaints />}
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
  .cl-btn:active { transform: scale(.97); } .cl-btn { transition: transform .12s; }
  .cl-card { transition: transform .18s; } .cl-card:active { transform: scale(.985); }
  .cl-noscroll::-webkit-scrollbar { display: none; } .cl-noscroll { scrollbar-width: none; }
  button:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2.5px solid #5EE6A8; outline-offset: 2px; }
  input:focus, textarea:focus { border-color: #4A5BBF !important; }
  @keyframes clPop { 0% { transform: scale(.5); opacity: 0; } 70% { transform: scale(1.08); } 100% { transform: scale(1); opacity: 1; } }
  @keyframes clRise { from { transform: translateY(14px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  @keyframes clFade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes clSlideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
  @keyframes clTwinkle { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(.65); opacity: .55; } }
  @keyframes clBubble { from { transform: translateY(40vh); opacity: 0; } 20% { opacity: .5; } to { transform: translateY(-50vh); opacity: 0; } }
  .cl-pop { animation: clPop .55s cubic-bezier(.34,1.56,.64,1) both; }
  .cl-rise { animation: clRise .5s cubic-bezier(.2,.8,.3,1) both; }
  .cl-fade { animation: clFade .35s ease both; }
  .cl-slideup { animation: clSlideUp .38s cubic-bezier(.2,.9,.3,1) both; }
  .cl-twinkle { animation: clTwinkle 2.2s ease-in-out infinite; }
  .cl-bubble { position: absolute; bottom: 0; width: 10px; height: 10px; border-radius: 50%; background: rgba(94,230,168,.4); animation: clBubble 5s linear infinite; }
  @media (prefers-reduced-motion: reduce) { .cl-pop,.cl-rise,.cl-fade,.cl-slideup,.cl-twinkle,.cl-bubble { animation: none !important; } }
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
        <div style={{ width: "100%", maxWidth: 430 }}><Auth /></div>
      </div>
    );

  const { role } = session;
  const unread = notices.filter((n) => n.to_employee === session.userId && !n.is_read).length;
  const NAVS = {
    customer: [{ id: "home", label: t("nav.home"), icon: "home" }, { id: "bookings", label: t("nav.bookings"), icon: "calendar" }],
    employee: [{ id: "home", label: "My jobs", icon: "sparkle" }, { id: "notices", label: "Notices", icon: "bell", badge: unread }],
    company: [{ id: "home", label: "Jobs", icon: "clipboard" }, { id: "schedule", label: "Schedule", icon: "calendar" }, { id: "clients", label: "Clients", icon: "users" }, { id: "services", label: "Services", icon: "tag" }, { id: "team", label: "Team", icon: "briefcase" }, { id: "issues", label: "Issues", icon: "lifebuoy" }, { id: "settings", label: "Settings", icon: "settings" }],
    admin: [{ id: "home", label: "Dashboard", icon: "grid" }, { id: "companies", label: "Companies", icon: "building" }, { id: "users", label: "Users", icon: "user" }, { id: "bookings", label: "Orders", icon: "calendar" }, { id: "complaints", label: "Complaints", icon: "lifebuoy" }, { id: "log", label: "Log", icon: "scroll" }],
  };

  return (
    <div style={{ minHeight: "100vh", background: C.shell, display: "flex", justifyContent: "center", fontFamily: B }}>
      <style>{css}</style>
      <div style={{ width: "100%", maxWidth: 430, background: C.bg, minHeight: "100vh", display: "flex", flexDirection: "column", boxShadow: "0 0 50px rgba(20,28,58,.14)", position: "relative" }}>
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

        {error && (
          <div style={{ background: C.coralSoft, padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontFamily: B, fontSize: 12, color: C.coralText }}>{error}</span>
            <button onClick={clearError} style={{ border: "none", background: "none", color: C.coralText, cursor: "pointer", fontWeight: 700 }}>✕</button>
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
              {justBooked?.pricing_type === "subscription"
                ? (HUL()
                    ? <>Az előfizetésed aktív ({everyP(justBooked.period)}).<br />Első alkalom: {dayLabel(justBooked.scheduled_date)}, utána automatikusan ismétlődik.<br />A Foglalások fül alatt bármikor módosíthatod.</>
                    : <>Your {periodLabel(justBooked.period)} plan is active.<br />First visit {dayLabel(justBooked.scheduled_date)}, then it repeats automatically.<br />Manage or cancel anytime under Bookings.</>)
                : (HUL()
                    ? <>A cég már látja a kérésedet,<br />hamarosan takarítót jelöl ki.</>
                    : <>The company sees your request now and<br />will assign a cleaner shortly.</>)}
            </div>
            <div className="cl-rise" style={{ marginTop: 32, width: "100%", maxWidth: 300, animationDelay: ".3s" }}>
              <Btn full mint onClick={() => { setJustBooked(false); setTab("bookings"); }}>{L("Track my booking", "Foglalás követése")}</Btn>
            </div>
          </div>
        )}

        {showProfile && <ProfileSheet close={() => setShowProfile(false)} />}
        <PhoneVerifyGate />

        <NotificationBanner />
        <div className="cl-nav" style={{ position: "fixed", bottom: "calc(12px + env(safe-area-inset-bottom))", left: "50%", transform: "translateX(-50%)", width: "calc(100% - 28px)", maxWidth: 400, background: dark ? "rgba(23,30,58,.55)" : "rgba(255,255,255,.55)", backdropFilter: "blur(28px) saturate(1.8)", WebkitBackdropFilter: "blur(28px) saturate(1.8)", border: dark ? "1px solid rgba(255,255,255,.10)" : "1px solid rgba(255,255,255,.65)", borderRadius: 30, display: "flex", alignItems: "center", padding: 6, gap: 4, zIndex: 10, boxShadow: dark ? "0 18px 48px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.08)" : "0 18px 48px rgba(16,25,74,.18), inset 0 1px 0 rgba(255,255,255,.9)" }}>
          {NAVS[role].map((tb) => {
            const active = tab === tb.id;
            return (
              <button key={tb.id} onClick={() => { setTab(tb.id); setBookingCo(null); }}
                style={{ flex: active ? 1.9 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, border: "none", cursor: "pointer", borderRadius: 24, padding: "11px 0", position: "relative", background: active ? `linear-gradient(135deg, ${C.navy}, ${C.navyMid})` : "transparent", boxShadow: active ? "0 8px 20px rgba(27,42,107,.38), inset 0 1px 0 rgba(255,255,255,.18)" : "none", transition: "all .3s cubic-bezier(.3,.9,.35,1)" }}>
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

export default function App() {
  return (
    <StoreProvider>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </StoreProvider>
  );
}

