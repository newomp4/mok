// Headless visual QA: renders the running dev server (http://localhost:3000) and saves a PNG.
// One-time setup: npm i -g playwright && npx playwright install chromium
// usage: node shot.mjs out.png "<js to run before shot>" [wait ms] [width] [height]
import { chromium } from "playwright";
const [,, out = "shot.png", js = "", wait = "2500", w = "1500", h = "900"] = process.argv;
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
page.on("pageerror", (e) => errors.push("PAGEERROR " + String(e).slice(0, 300)));
await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
if (js) { await page.evaluate(js); }
await page.waitForTimeout(+wait);
await page.screenshot({ path: out });
console.log(JSON.stringify({ out, errors: errors.slice(0, 8) }));
await browser.close();
