export default interface AppConfig {
  // format user url ( https://[domain media sosial]/[id unik user] ) id unik user digunakan untuk
  // fetch data user tertentu sehingga data posts user dapat difetching, misalkan facebook menggunakan
  // user id sedangkan instagram menggunakan username)  )
  userUrls: string[]
  maxBrowserRetryCount: number
  maxLectureRetryCount: number
  maxLectureWorkers: number
  maxUserRetryCount: number
  maxUserWorkers: number
  environment: "development" | "production"
  wsEndPoint: string
  apiKey: string
  serverId: string
  browserProxyUrl?: string
  cookies: Record<string, any[]>
}
