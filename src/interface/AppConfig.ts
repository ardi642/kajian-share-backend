import { Cookie } from "puppeteer"

export default interface AppConfig {
  userUrls: string[]
  wsEndPoint: string
  apiKey: string
  serverId: string
  port?: number
  cookies: Record<string, Cookie[]>
}
