/* Scope check only — the class of bug behind five of the six client crashes
   we shipped: a name used where it isn't defined. Bundlers compile those
   happily; the error only appears when the line runs, which for a click
   handler can be months after release.

   Flat config, deliberately: the old .eslintrc-style JSON stopped loading
   under ESLint 10 ("needs an import attribute of type: json"), which made this
   check fail silently open — the worst possible failure for a checker.

   no-use-before-define was tried and removed: at module scope it fires on
   every shared constant used inside a component, which is legal and safe.
   Twelve false alarms to one real bug is a rule people switch off. The
   temporal-dead-zone case that actually bit us (a const read above its own
   declaration inside the SAME component body) is caught empirically by
   test/render.mjs, which opens the booking flow and would have thrown.

   Run: npx eslint -c scripts/eslint-undef.mjs src/App.jsx src/store.jsx      */
export default [
  {
    files: ["**/*.js", "**/*.jsx"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      /* Declared by hand rather than pulled from the `globals` package: this
         check must not add a dependency that every Codemagic build installs. */
      globals: Object.fromEntries([
        "window","document","navigator","location","history","screen","fetch","Headers","Request","Response",
        "FormData","Blob","File","FileReader","URL","URLSearchParams","AbortController","AbortSignal",
        "localStorage","sessionStorage","console","alert","confirm","prompt","atob","btoa","crypto",
        "setTimeout","clearTimeout","setInterval","clearInterval","requestAnimationFrame","cancelAnimationFrame",
        "Image","Audio","Intl","WebSocket","MutationObserver","IntersectionObserver","ResizeObserver",
        "CustomEvent","Event","Notification","matchMedia","getComputedStyle","structuredClone","queueMicrotask",
        "TextEncoder","TextDecoder","performance","process","globalThis",
      ].map((g) => [g, "readonly"])),
    },
    rules: { "no-undef": "error" },
  },
];
