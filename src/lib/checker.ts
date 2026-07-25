import dns from "node:dns/promises";
import { Browser, chromium } from "playwright";
import { STATUS, Status } from "./status";
import { analyzeScreenshot } from "./ai";

export interface CheckOutcome {
  status: Status;
  detail: string | null;
  screenshot: Buffer | null;
  aiUsed: boolean;
  durationMs: number;
}

const NAV_TIMEOUT = Number(process.env.NAV_TIMEOUT_MS || 30000);

const UNAVAILABLE_MARKERS = [
  "this store is unavailable",
  "this shop is unavailable",
  "sorry, this shop is currently unavailable",
  "store is currently unavailable",
  "shop is currently unavailable",
];

const PASSWORD_MARKERS = ["opening soon", "password-page", 'action="/password"', "be the first to know when we launch"];

export async function launchBrowser(): Promise<Browser> {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
  return chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    proxy: proxyUrl ? { server: proxyUrl, bypass: "localhost,127.0.0.1" } : undefined,
  });
}

async function dnsResolves(domain: string): Promise<boolean> {
  try {
    await dns.lookup(domain);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check a single store domain:
 * 1. DNS lookup — fails fast with DNS_ERROR.
 * 2. Load page in Chromium, capture screenshot + final URL + status + content.
 * 3. Rule-based classification (raw shopify redirect, unavailable page, HTTP errors, password page).
 * 4. If ambiguous, ask the AI to classify the screenshot.
 */
export async function checkDomain(browser: Browser, rawDomain: string): Promise<CheckOutcome> {
  const started = Date.now();
  const domain = rawDomain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const host = domain.replace(/:\d+$/, "");
  const done = (o: Omit<CheckOutcome, "durationMs">): CheckOutcome => ({ ...o, durationMs: Date.now() - started });

  if (!(await dnsResolves(host))) {
    return done({ status: STATUS.DNS_ERROR, detail: "Domain does not resolve (DNS lookup failed)", screenshot: null, aiUsed: false });
  }

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 StoreChecksBot",
    ignoreHTTPSErrors: true,
  });

  try {
    let page = await context.newPage();
    let response;
    try {
      response = await page.goto(`https://${domain}`, { timeout: NAV_TIMEOUT, waitUntil: "domcontentloaded" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/Timeout/i.test(msg)) {
        const shot = await page.screenshot({ type: "png" }).catch(() => null);
        return done({ status: STATUS.TIMEOUT, detail: `Page did not load within ${NAV_TIMEOUT / 1000}s`, screenshot: shot, aiUsed: false });
      }
      if (/ERR_NAME_NOT_RESOLVED|ERR_DNS/i.test(msg)) {
        return done({ status: STATUS.DNS_ERROR, detail: "Domain does not resolve (browser DNS error)", screenshot: null, aiUsed: false });
      }
      // HTTPS unreachable — some sites only answer on plain HTTP.
      // Use a fresh page: the failed navigation leaves a pending error-page
      // navigation that would interrupt a retry on the same page.
      try {
        await page.close().catch(() => {});
        page = await context.newPage();
        response = await page.goto(`http://${domain}`, { timeout: NAV_TIMEOUT, waitUntil: "domcontentloaded" });
      } catch {
        return done({
          status: STATUS.SITE_ERROR,
          detail: `Could not connect: ${msg.split("\n")[0].slice(0, 140)}`,
          screenshot: null,
          aiUsed: false,
        });
      }
    }

    await page.waitForTimeout(2500); // let JS-rendered storefronts paint
    const screenshot = await page.screenshot({ type: "png" }).catch(() => null);
    const finalUrl = page.url();
    const httpStatus = response?.status() ?? 0;
    const bodyText = (await page.evaluate(() => document.body?.innerText || "").catch(() => "")).toLowerCase();
    const html = (await page.content().catch(() => "")).toLowerCase();

    let finalHost = "";
    try {
      finalHost = new URL(finalUrl).hostname;
    } catch {}

    // Rule 1: redirected to the raw *.myshopify.com domain (custom domain not set as primary)
    if (finalHost.endsWith(".myshopify.com") || domain.endsWith(".myshopify.com")) {
      if (UNAVAILABLE_MARKERS.some((m) => bodyText.includes(m) || html.includes(m))) {
        return done({ status: STATUS.STORE_UNAVAILABLE, detail: "Shopify store unavailable page", screenshot, aiUsed: false });
      }
      return done({
        status: STATUS.RAW_SHOPIFY_DOMAIN,
        detail: `Serving from raw Shopify domain (${finalHost || domain})`,
        screenshot,
        aiUsed: false,
      });
    }

    // Rule 2: Shopify "store unavailable" page
    if (UNAVAILABLE_MARKERS.some((m) => bodyText.includes(m) || html.includes(m))) {
      return done({ status: STATUS.STORE_UNAVAILABLE, detail: "Shopify store unavailable page", screenshot, aiUsed: false });
    }

    // Rule 3: password / opening soon page
    if (PASSWORD_MARKERS.some((m) => html.includes(m))) {
      return done({ status: STATUS.PASSWORD_PROTECTED, detail: "Store is behind a password page", screenshot, aiUsed: false });
    }

    // Rule 4: HTTP error status
    if (httpStatus >= 400) {
      return done({ status: STATUS.SITE_ERROR, detail: `HTTP ${httpStatus}`, screenshot, aiUsed: false });
    }

    // Rule 5: healthy-looking page with real content
    if (httpStatus >= 200 && httpStatus < 400 && bodyText.length > 200) {
      return done({ status: STATUS.UP, detail: null, screenshot, aiUsed: false });
    }

    // Ambiguous (blank page, tiny content) — ask the AI to look at the screenshot
    if (screenshot) {
      const verdict = await analyzeScreenshot(screenshot);
      const detail =
        verdict.status === STATUS.UP ? null : `AI (${verdict.provider}) classified the page (HTTP ${httpStatus}, sparse content)`;
      return done({ status: verdict.status, detail, screenshot, aiUsed: true });
    }

    return done({ status: STATUS.UNKNOWN, detail: `HTTP ${httpStatus}, page rendered no content`, screenshot: null, aiUsed: false });
  } finally {
    await context.close().catch(() => {});
  }
}
