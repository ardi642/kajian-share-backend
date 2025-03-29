import { CronJob, timeout } from "cron"
import puppeteer, { Browser } from "puppeteer"
import FacebookUserPosts from "./FacebookUserPosts"
import InstagramUserPosts from "./InstagramUserPosts"
import UserPosts from "./UserPosts"
import Piscina from "piscina"
import { isMainThread } from "worker_threads"
import fs from "fs"
import AppConfig from "../interface/AppConfig"
import loadJson from "../utils/loadJson"
import { failedParsingUsers } from "../db/schema"
import { eq, sql } from "drizzle-orm"
import { db } from "../utils/database"
import logger from "../logger"

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

if (isMainThread) {
  const cronTime = "0 0/30 * * * *"
  const saveUserPostsJob = CronJob.from({
    cronTime,
    onTick: async function () {
      const piscina = new Piscina({ filename: __filename })
      let browser: Browser | null = null
      const maxRetryCount = 3
      const maxWorkers = 1
      const appConfig: AppConfig = await loadJson("./app.config.json")
      try {
        browser = await puppeteer.launch({
          headless: true,
          defaultViewport: null,
          args: [
            "--remote-debugging-port=9222",
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-gpu",
            "--mute-audio",
            "--disable-background-timer-throttling",
            "--force-device-scale-factor=1",
          ],
        })
        appConfig.wsEndPoint = browser.wsEndpoint()
        fs.writeFileSync("./app.config.json", JSON.stringify(appConfig))

        logger.info("running browser in headless mode")
        await sleep(1000)
        let userUrls = appConfig.userUrls
        while (userUrls.length > 0) {
          const chunkUserUrls = userUrls.splice(0, maxWorkers)
          await Promise.allSettled(
            chunkUserUrls.map(async function (userUrl) {
              const error = await piscina.run({ userUrl })

              // there is no error
              if (error == null) return

              const failedUser = await db.query.failedParsingUsers.findFirst({
                where: sql`${failedParsingUsers.serverId} = ${appConfig.serverId} AND ${failedParsingUsers.userUrl} = ${userUrl}`,
              })

              if (failedUser && failedUser.retryCount! <= maxRetryCount) {
                userUrls.push(userUrl)
                const retryCount = failedUser!.retryCount
                logger.info(
                  `adding failed user url ${userUrl} to queue ${retryCount} ${retryCount == 1 ? "time" : "times"}`
                )
              }
            })
          )

          await sleep(200)
        }
      } catch (error: any) {
        logger.error(error)
      } finally {
        if (browser != null) await browser.close()
        await db.delete(failedParsingUsers).where(eq(failedParsingUsers.serverId, appConfig.serverId))
        logger.info("close headless browser")
        logger.info(
          `waiting next schedule for Saving User Posts in ${
            timeout(cronTime) / 1000 / 60
          } minutes if there is no running schedule`
        )
      }
    },
    start: true,
    waitForCompletion: true,
  })

  async function main() {
    await saveUserPostsJob.fireOnTick()
  }
  main()
}

async function handleSavePosts({ userUrl }: { userUrl: string }) {
  const userPosts: Record<string, UserPosts> = {
    "facebook.com": new FacebookUserPosts(),
    "instagram.com": new InstagramUserPosts(),
  }
  const socialMediaUrls = Object.keys(userPosts)
  for (const socialMediaUrl of socialMediaUrls) {
    if (userUrl.includes(socialMediaUrl)) {
      return userPosts[socialMediaUrl].savePosts(userUrl)
    }
  }
}

export default handleSavePosts
