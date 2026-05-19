"use strict";
const puppeteer = require("puppeteer-core");
const chromium  = require("@sparticuz/chromium");
const path      = require("path");
const fs        = require("fs-extra");

const SCREENSHOT_DIR = path.join(__dirname, "../../data/screenshots");
fs.ensureDirSync(SCREENSHOT_DIR);

async function buildPuppeteerCookies(appState) {
  if (!Array.isArray(appState) || !appState.length) return [];
  return appState.map(c => ({
    name:     c.key   || c.name,
    value:    String(c.value ?? ""),
    domain:   (c.domain || "facebook.com").replace(/^\./, ""),
    path:     c.path  || "/",
    httpOnly: c.httpOnly ?? false,
    secure:   c.secure   ?? true,
    sameSite: "None",
  })).filter(c => c.name && c.value);
}

async function screenshotProfile(targetID, appState) {
  const execPath = await chromium.executablePath();
  const browser  = await puppeteer.launch({
    executablePath: execPath,
    headless:       chromium.headless,
    args:           [
      ...chromium.args,
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1280,900",
    ],
    defaultViewport: { width: 1280, height: 900 },
    ignoreHTTPSErrors: true,
  });

  const results = { profile: null, timeline: null, error: null };

  try {
    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    if (appState && appState.length) {
      const cookies = await buildPuppeteerCookies(appState);
      await page.setCookie(...cookies);
    }

    const profileUrl = `https://www.facebook.com/profile.php?id=${targetID}`;
    await page.goto(profileUrl, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise(r => setTimeout(r, 2500));

    const stamp = Date.now();

    const profilePath = path.join(SCREENSHOT_DIR, `profile_${targetID}_${stamp}.png`);
    await page.screenshot({ path: profilePath, fullPage: false });
    results.profile = profilePath;

    await page.evaluate(() => window.scrollBy(0, 600));
    await new Promise(r => setTimeout(r, 1500));

    const timelinePath = path.join(SCREENSHOT_DIR, `timeline_${targetID}_${stamp}.png`);
    await page.screenshot({ path: timelinePath, fullPage: false });
    results.timeline = timelinePath;

  } catch (err) {
    results.error = err.message;
  } finally {
    await browser.close();
  }

  return results;
}

module.exports = { screenshotProfile };
