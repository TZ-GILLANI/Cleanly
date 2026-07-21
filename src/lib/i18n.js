/* Cleano — lightweight i18n (English + Hungarian) */

import { xl } from "./translations.js";

export const LANGS = [
  { id: "en", label: "EN", name: "English" },
  { id: "hu", label: "HU", name: "Magyar" },
  { id: "de", label: "DE", name: "Deutsch" },
  { id: "ro", label: "RO", name: "Rom\u00e2n\u0103" },
  { id: "sk", label: "SK", name: "Sloven\u010dina" },
  { id: "pl", label: "PL", name: "Polski" },
  { id: "uk", label: "UA", name: "\u0423\u043a\u0440\u0430\u0457\u043d\u0441\u044c\u043a\u0430" },
  { id: "fr", label: "FR", name: "Fran\u00e7ais" },
  { id: "es", label: "ES", name: "Espa\u00f1ol" },
  { id: "it", label: "IT", name: "Italiano" },
];

export const LOCALES = { en: "en-GB", hu: "hu-HU", de: "de-DE", ro: "ro-RO", sk: "sk-SK", pl: "pl-PL", uk: "uk-UA", fr: "fr-FR", es: "es-ES", it: "it-IT" };

const DICT = {
  en: {
    // common
    "common.save": "Save",
    "common.cancel": "Cancel",
    "common.continue": "Continue",
    "common.back": "Back",
    "common.done": "Done",
    "common.from": "from",
    "common.logout": "Log out",
    "common.saving": "Saving…",
    "common.oneMoment": "One moment…",
    // nav
    "nav.home": "Home",
    "nav.bookings": "Bookings",
    // roles
    "role.customer": "CUSTOMER",
    // auth
    "auth.tagline": "One platform. Three ways in.",
    "auth.haveAccount": "Already have an account? Log in →",
    "auth.r.customer.title": "I need cleaning",
    "auth.r.customer.sub": "Book verified companies. Students save up to 20%.",
    "auth.r.employee.title": "I'm a cleaner",
    "auth.r.employee.sub": "Sign in with your company's invite code to see your jobs.",
    "auth.r.company.title": "I run a company",
    "auth.r.company.sub": "List services, manage your team, get bookings.",
    "auth.footer": "Hungary · Eight arms, zero dust 🐙",
    "auth.peekAdmin": "🛡️ Peek at the platform admin panel →",
    // customer home
    "home.hi": "Hi",
    "home.setAddress": "Set your home address",
    "home.whatSparkle": "What needs a sparkle?",
    "home.search": "Search companies…",
    "home.companiesNearYou": "Companies near you",
    "home.sort.rating": "★ Rating",
    "home.sort.price": "💰 Price",
    "home.sort.discount": "🎓 Discount",
    "home.student": "🎓 Student",
    "home.resident": "🏡 Resident",
    "home.noMatch": "No companies match. Try another search.",
    "home.hourly": "⏱ Hourly",
    "home.plans": "🔁 Plans",
    // profile
    "profile.title": "My profile",
    "profile.fullName": "Full name",
    "profile.accountType": "Account type",
    "profile.homeAddress": "Home address",
    "profile.addressPh": "Street, building, floor / door, city",
    "profile.phone": "Phone number",
    "profile.paymentMethod": "Payment method",
    "profile.cash": "💵 Cash",
    "profile.cashSub": "Pay on completion",
    "profile.card": "💳 Card",
    "profile.cardSub": "Pay online by card",
    "profile.language": "Language",
    "profile.saveProfile": "Save profile",
    "profile.updated": "Profile updated",
  },
  hu: {
    // common
    "common.save": "Mentés",
    "common.cancel": "Mégse",
    "common.continue": "Tovább",
    "common.back": "Vissza",
    "common.done": "Kész",
    "common.from": "ettől",
    "common.logout": "Kijelentkezés",
    "common.saving": "Mentés…",
    "common.oneMoment": "Egy pillanat…",
    // nav
    "nav.home": "Főoldal",
    "nav.bookings": "Foglalások",
    // roles
    "role.customer": "ÜGYFÉL",
    // auth
    "auth.tagline": "Egy platform. Három belépési mód.",
    "auth.haveAccount": "Már van fiókod? Jelentkezz be →",
    "auth.r.customer.title": "Takarításra van szükségem",
    "auth.r.customer.sub": "Foglalj ellenőrzött cégeket. A diákok akár 20%-ot spórolnak.",
    "auth.r.employee.title": "Takarító vagyok",
    "auth.r.employee.sub": "Lépj be a céged meghívókódjával, és lásd a munkáidat.",
    "auth.r.company.title": "Céget vezetek",
    "auth.r.company.sub": "Hirdess szolgáltatásokat, kezeld a csapatod, kapj foglalásokat.",
    "auth.footer": "Magyarország · Nyolc kar, nulla por 🐙",
    "auth.peekAdmin": "🛡️ Nézz be az admin felületre →",
    // customer home
    "home.hi": "Szia",
    "home.setAddress": "Add meg az otthoni címed",
    "home.whatSparkle": "Mit csillogtassunk fel?",
    "home.search": "Cégek keresése…",
    "home.companiesNearYou": "Közeli cégek",
    "home.sort.rating": "★ Értékelés",
    "home.sort.price": "💰 Ár",
    "home.sort.discount": "🎓 Kedvezmény",
    "home.student": "🎓 Diák",
    "home.resident": "🏡 Lakos",
    "home.noMatch": "Nincs találat. Próbálj másik keresést.",
    "home.hourly": "⏱ Óradíjas",
    "home.plans": "🔁 Bérletek",
    // profile
    "profile.title": "Profilom",
    "profile.fullName": "Teljes név",
    "profile.accountType": "Fióktípus",
    "profile.homeAddress": "Otthoni cím",
    "profile.addressPh": "Utca, épület, emelet / ajtó, város",
    "profile.phone": "Telefonszám",
    "profile.paymentMethod": "Fizetési mód",
    "profile.cash": "💵 Készpénz",
    "profile.cashSub": "Fizetés a végén",
    "profile.card": "💳 Kártya",
    "profile.cardSub": "Online bankkártyás fizetés",
    "profile.language": "Nyelv",
    "profile.saveProfile": "Profil mentése",
    "profile.updated": "Profil frissítve",
  },
};

export const getLang = () => {
  try { return localStorage.getItem("cleanly-lang") || "en"; } catch { return "en"; }
};
export const saveLang = (l) => { try { localStorage.setItem("cleanly-lang", l); } catch {} };

// t("key", { name: "Musa" }) → string, with {placeholder} interpolation; falls back to EN then the key.
export const translate = (lang, key, vars) => {
  let s = (DICT[lang] && DICT[lang][key]) ?? xl(lang, DICT.en[key] ?? key);
  if (vars) for (const k in vars) s = s.replace(new RegExp(`\\{${k}\\}`, "g"), vars[k]);
  return s;
};
