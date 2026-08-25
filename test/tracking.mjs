/* WATCHING A CLEANER ARRIVE, WITH THE PHONE IN A POCKET.

   Live location already worked — while the app was in front. A cleaner puts
   the phone away the moment they start driving, iOS freezes the JavaScript,
   and the customer's map stopped at the kerb.

   The native watcher keeps reporting with the app backgrounded or closed. The
   thing that matters most here is not that it STARTS but that it STOPS: it is
   mounted only between "on the way" and "job done", so unmounting is the off
   switch. Anything else is following someone around after work, which is both
   indecent and the version Apple rejects.

   Run: node test/tracking.mjs                                                */
import fs from "fs";

let pass = 0, fail = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, e); } };
const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const decomment = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));

const app = decomment(read("src/App.jsx"));
const pkg = JSON.parse(read("package.json"));
const manifest = read("android/app/src/main/AndroidManifest.xml");
const cm = read("codemagic.yaml");

console.log("\n── it only runs while a job is actually under way ──");
{
  /* Lifted straight out of the source so the test cannot drift from the rule. */
  const m = /const canTrack = \(b\) => \{[\s\S]*?\n\};/.exec(app);
  ok("canTrack is findable", !!m);
  const canTrack = eval("(" + m[0].replace("const canTrack = ", "").replace(/;$/, "") + ")");
  const on = (st, ful) => canTrack({ status: st, fulfilment: ful });

  ok("on-site: tracked on the way", on(2, "onsite"));
  ok("on-site: tracked while working", on(3, "onsite"));
  ok("on-site: NOT before anyone accepted", !on(0, "onsite") && !on(1, "onsite"));
  ok("on-site: NOT once the job is done", !on(4, "onsite"));
  ok("collection: tracked on the way out", on(2, "collection"));
  ok("collection: tracked on the way back", on(6, "collection"));
  ok("collection: NOT while the items are away being cleaned", !on(5, "collection"));
  ok("collection: NOT once returned", !on(4, "collection"));
  ok("never on a declined or cancelled job", !on(8, "onsite") && !on(9, "onsite"));
  ok("the tracker is mounted on that rule and nothing else",
     /\{canTrack\(b\) && <LocationShare bookingId=\{b\.id\} \/>\}/.test(app));
}

console.log("\n── stopping is wired, not assumed ──");
ok("the watcher is removed when the component goes away",
   /removeWatcher\(\{ id: watcherId \}\)/.test(app));
ok("the web fallback is cleared too",
   /clearWatch\(webWatch\)/.test(app) && /clearInterval\(webTimer\)/.test(app));
ok("a late callback after teardown is ignored", /if \(stopped\) return;/.test(app));

console.log("\n── the plugin is reached the way this one has to be ──");
ok("the dependency is declared", !!pkg.dependencies["@capacitor-community/background-geolocation"]);
ok("it is registered, not imported",
   /registerPlugin\("BackgroundGeolocation"\)/.test(app));
/* The package ships no JS entry at all — only native code and a .d.ts — so
   importing it directly fails the build with "failed to resolve entry". */
ok("nothing imports the package directly",
   !/from "@capacitor-community\/background-geolocation"/.test(app)
   && !/import\("@capacitor-community\/background-geolocation"\)/.test(app));
ok("the web build is left alone", /Capacitor\?\.isNativePlatform\?\.\(\)/.test(app));
ok("there is still a browser fallback", /navigator\.geolocation\.watchPosition/.test(app));

console.log("\n── Android ──");
for (const perm of ["ACCESS_BACKGROUND_LOCATION", "FOREGROUND_SERVICE", "FOREGROUND_SERVICE_LOCATION"])
  ok(`  ${perm} is declared`, manifest.includes(perm));
ok("the cleaner can see it is on, in the notification shade",
   /backgroundTitle: L\(/.test(app) && /backgroundMessage: L\(/.test(app));
ok("and that message says when it stops", /stops when you finish the job|befejez/.test(read("src/App.jsx")));

console.log("\n── iOS ──");
ok("the Always usage string is set", /NSLocationAlwaysAndWhenInUseUsageDescription/.test(cm));
ok("it explains what the user gets, not what we take",
   /so they can see you approaching/.test(cm));
ok("it says when tracking stops — reviewers look for this",
   /stops as soon as you finish the job/.test(cm));
/* The push step runs AFTER the permissions step and REPLACES the whole array.
   Listing only remote-notification there silently deletes "location". */
const modes = [...cm.matchAll(/UIBackgroundModes -json '(\[[^\]]*\])'/g)].map((m) => m[1]);
ok("every UIBackgroundModes write is accounted for", modes.length >= 2, `${modes.length} found`);
ok("and every one of them keeps BOTH modes",
   modes.every((m) => m.includes("location") && m.includes("remote-notification")),
   modes.join(" | "));

console.log("\n── the privacy policy has to say so ──");
{
  /* THE PRIVACY POLICY ITSELF — not "somewhere in the codebase". My first
     version of this check also searched App.jsx, which mentions location for
     other reasons, so it passed while the published policy said nothing about
     location at all. Apple reads the policy you link from App Store Connect
     and rejects a background-location app that does not disclose it. */
  const policy = read("server/privacy.html");
  ok("the published policy has a location section", /Helymeghat|>Location</.test(policy));
  ok("it says what the cleaner's location is used for", /see you approaching|mikor érkezel/.test(policy));
  ok("it says when tracking starts", /On the way|Úton vagyok/.test(policy));
  ok("it says when it stops", /stops when you mark the job finished|befejezettnek jel/.test(policy));
  ok("it states we do not track between jobs", /never track you between jobs|Két munka között soha/.test(policy));
  ok("it discloses that it continues in the background",
     /continues in the background|háttérben is folytatódik/.test(policy));
  ok("and that only the latest point is kept", /most recent point|legutolsó ismert pontot/.test(policy));
}

console.log("\n── the watcher can never outlive the job ──");
{
  /* addWatcher is awaited. A cleaner who taps "Complete job" while that await
     is still in flight unmounts the component, so the cleanup runs with
     watcherId still null — and the watcher that arrives a moment later has
     nothing left to switch it off. It would then follow them for the rest of
     the day. */
  const app = read("src/App.jsx");
  ok("the id is captured locally before it is handed over", /const id = await BG\.addWatcher\(/.test(app));
  ok("a watcher that arrives after the job ended is stopped immediately",
     /if \(stopped\) \{ try \{ await BG\.removeWatcher\(\{ id \}\); \} catch \{\} return true; \}/.test(app));
  ok("otherwise the cleanup gets it", /watcherId = id;/.test(app));
  ok("and the cleanup still removes it", /removeWatcher\(\{ id: watcherId \}\)/.test(app));
}

console.log("\n── one refresh loop, not two ──");
{
  /* The store polls, listens for focus, visibilitychange and Capacitor's
     appStateChange, and guards against overlapping fetches. A second copy of
     all of that used to sit in Shell(), unguarded, on its own timer — so
     coming back to the app fetched everything twice and slow requests piled
     up behind each other. */
  const app = read("src/App.jsx");
  const store = read("src/store.jsx");
  ok("only the store listens for visibilitychange",
     (app.match(/addEventListener\("visibilitychange"/g) || []).length === 0
     && (store.match(/addEventListener\("visibilitychange"/g) || []).length === 1);
  ok("only the store owns the poll timer",
     (store.match(/setInterval\(safeRefresh/g) || []).length === 1
     && !/setInterval\(tick, 20000\)/.test(app));
  ok("the loop refuses to stack requests", /if \(refreshingRef\.current\) return;/.test(store));
  ok("and it skips entirely while the app is hidden",
     /document\.visibilityState === "hidden"\) return;/.test(store));
}

console.log(`\n════ BACKGROUND TRACKING: ${pass} passed, ${fail} failed ════\n`);
process.exit(fail ? 1 : 0);
