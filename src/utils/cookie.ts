import { Cookie } from "puppeteer"

export function getStringCookies(puppeteerCookies: Cookie[]) {
  const cookiesObject: { [key: string]: string } = {}
  for (const cookie of puppeteerCookies) {
    cookiesObject[cookie.name] = cookie.value
  }
  return Object.entries(cookiesObject)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("; ")
}
