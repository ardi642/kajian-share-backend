import puppeteer, { Cookie } from "puppeteer"
import fs from "fs"
import loadJson from "../utils/loadJson"
import AppConfig from "../interface/AppConfig"

async function extractPupeteerCookies() {
  const appConfig: AppConfig = await loadJson("./app.config.json")
  const browser = await puppeteer.launch({
    executablePath: `C:/Program Files/Google/Chrome/Application/chrome.exe`,
    headless: true,
    defaultViewport: null,
    userDataDir: "C:/Users/62852/AppData/Local/Google/Chrome/User Data",
  })
  const browserPupeteerCookies = await browser.cookies()
  const pupeteerCookiesMap: Record<string, Cookie[]> = {}
  const cookiesMap: Record<string, string> = {}
  for (const pupeteerCookie of browserPupeteerCookies) {
    const domain = pupeteerCookie.domain
    if (domain != ".instagram.com" && domain != ".facebook.com") continue
    if (!pupeteerCookiesMap.hasOwnProperty(domain)) pupeteerCookiesMap[domain] = []
    pupeteerCookiesMap[domain].push(pupeteerCookie)
  }

  // for (const [domain, cookies] of pupeteerCookiesMap) {
  //   cookiesMap[domain] = getStringCookies(cookies)
  // }
  appConfig.cookies = pupeteerCookiesMap
  fs.writeFileSync("./app.config.json", JSON.stringify(appConfig))
  await browser.close()
}

extractPupeteerCookies()
