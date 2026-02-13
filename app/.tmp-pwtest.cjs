const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto("http://localhost:5173/", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(900);

  async function clickAndMain(sel, label) {
    await page.locator(sel).first().click({ timeout: 5000 });
    await page.waitForTimeout(700);
    const main = await page.locator("main").innerText();
    console.log(label, main.slice(0, 150).replace(/\n/g, " | "));
  }

  await clickAndMain("text=Device / Bluetooth", "DEVICE");
  await clickAndMain("text=Internet & WLAN", "INTERNET");
  await clickAndMain("[aria-label=Summary]", "TAB_SUMMARY");
  await clickAndMain("[aria-label=Map]", "TAB_MAP");
  await clickAndMain("[aria-label=Radar]", "TAB_RADAR");
  await clickAndMain("[aria-label=Config]", "TAB_CONFIG");
  await browser.close();
})();
