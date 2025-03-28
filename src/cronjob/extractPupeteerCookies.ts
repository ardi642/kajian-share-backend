import puppeteer, { Browser, Cookie } from "puppeteer"

function getStringCookies(puppeteerCookies: Cookie[]) {
  const cookiesObject: Record<string, string> = {}
  for (const cookie of puppeteerCookies) {
    cookiesObject[cookie.name] = cookie.value
  }
  return Object.entries(cookiesObject)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("; ")
}

export async function extractPupeteerCookies(domainIncludes: string, browser: Browser) {
  const browserPupeteerCookies = await browser.cookies()
  const filterPupeteerCookies = browserPupeteerCookies.filter((pupeteerCookie) =>
    pupeteerCookie.domain.includes(domainIncludes)
  )
  return getStringCookies(filterPupeteerCookies)
}
