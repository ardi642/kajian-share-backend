import puppeteer, { Cookie } from "puppeteer"
import fs from "fs"
import loadJSON from "../utils/loadJSON"
import AppConfig from "../interfaces/AppConfig"

async function extractPupeteerCookies() {
  const appConfig: AppConfig = await loadJSON("./app.config.json")
  const browser = await puppeteer.launch({
    executablePath: `C:/Program Files/Google/Chrome/Application/chrome.exe`,
    headless: true,
    defaultViewport: null,
    userDataDir: "C:/Users/62852/AppData/Local/Google/Chrome/User Data",
  })
  const browserPupeteerCookies = await browser.cookies()
  const pupeteerCookiesMap: Record<string, Cookie[]> = {}
  for (const pupeteerCookie of browserPupeteerCookies) {
    const domain = pupeteerCookie.domain
    if (domain != ".instagram.com" && domain != ".facebook.com") continue
    if (!pupeteerCookiesMap.hasOwnProperty(domain)) pupeteerCookiesMap[domain] = []
    pupeteerCookiesMap[domain].push(pupeteerCookie)
  }

  appConfig.cookies = pupeteerCookiesMap
  fs.writeFileSync("./app.config.json", JSON.stringify(appConfig))
  await browser.close()
}

extractPupeteerCookies()
