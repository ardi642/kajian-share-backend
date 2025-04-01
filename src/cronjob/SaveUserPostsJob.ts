import { CronJob, timeout } from "cron"
import puppeteer, { Browser, HTTPRequest } from "puppeteer"
import FacebookUserExtraction from "./FacebookUserExtraction"
import InstagramUserExtraction from "./InstagramUserExtraction"
import UserExtraction from "./UserExtraction"
import Piscina from "piscina"
import { isMainThread } from "worker_threads"
import fs from "fs"
import AppConfig from "../interfaces/AppConfig"
import loadJSON from "../utils/loadJSON"
import { failedUsers } from "../db/schema"
import { eq, sql } from "drizzle-orm"
import { db } from "../utils/database"
import logger from "../logger/userLogger"
import QueryString from "qs"

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function captureInitialGraphqlRequest(graphqlHeaders: any, graphqlPostData: any) {
  let initialRequest = false
  return function (request: HTTPRequest) {
    const resourceType = request.resourceType()
    const url = request.url()
    if (url.includes("/ajax/bulk-route-definitions")) {
      request.abort
      return
    }

    if (url.includes("/ajax/bootloader-endpoint/")) {
      request.abort
      return
    }

    if (url.includes("fna.fbcdn.net/")) {
      request.abort()
      return
    }

    if (url.includes("/sound_iframe.php")) {
      request.abort()
      return
    }

    if (resourceType === "image" || resourceType === "media") {
      request.abort()
      return
    }

    if (resourceType == "websocket") {
      request.abort()
      return
    }

    if (initialRequest) {
      request.continue()
      return
    }

    if (request.url().includes("/api/graphql/")) {
      const rawPostData = request.postData()
      const postData = QueryString.parse(rawPostData!)
      if (postData?.["fb_api_req_friendly_name"] != "ProfileCometTimelineFeedRefetchQuery") {
        request.abort()
        return
      }

      Object.assign(graphqlHeaders, request.headers())
      Object.assign(graphqlPostData, postData)

      initialRequest = true
    }

    request.continue()
    return
  }
}

if (isMainThread) {
  const cronTime = "0 0/30 * * * *"
  const saveUserPostsJob = CronJob.from({
    cronTime,
    onTick: async function () {
      const piscina = new Piscina({ filename: __filename })
      let browser: Browser | null = null
      const appConfig: AppConfig = await loadJSON("./app.config.json")

      try {
        await db.delete(failedUsers).where(eq(failedUsers.serverId, appConfig.serverId))
        logger.info("clear last failed users tracks")
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
        browser.setCookie(...appConfig.cookies[".facebook.com"])
        appConfig.wsEndPoint = browser.wsEndpoint()
        fs.writeFileSync("./app.config.json", JSON.stringify(appConfig))
        logger.info("running browser in headless mode")

        const pages = await browser.pages()
        const page = pages[0]

        let graphqlHeaders: any = {}
        let graphqlPostData: any = {}
        await page.setRequestInterception(true)
        page.on("request", captureInitialGraphqlRequest(graphqlHeaders, graphqlPostData))
        let browserRetryCount = 1
        const maxBrowserRetryCount = appConfig.maxBrowserRetryCount

        while (true) {
          try {
            const postsContainerSelector = "div[data-pagelet='ProfileTimeline']"
            await page.goto("https://web.facebook.com/me")
            await page.waitForSelector(postsContainerSelector)

            const postsContainerElement = await page.$(postsContainerSelector)
            const lastPostCount = await postsContainerElement!.evaluate((el) => el.childElementCount)
            const lastPostElement = await postsContainerElement!.$(":last-child")
            await lastPostElement!.evaluate((el) => {
              el.scrollIntoView({ behavior: "smooth" })
            })

            await page.waitForFunction(
              (postContainerElement, lastPostCount) => {
                return postContainerElement!.childElementCount > lastPostCount
              },
              {},
              postsContainerElement,
              lastPostCount
            )
            break
          } catch (error: any) {
            if (browserRetryCount > maxBrowserRetryCount) {
              throw error
            }
            logger.error(error, {
              additionalMessage: `trying to connect to facebook in ${browserRetryCount} times`,
            })

            browserRetryCount++
          }
        }

        fs.writeFileSync(
          "requestData.json",
          JSON.stringify({
            graphqlHeaders,
            graphqlPostData,
          })
        )

        logger.info("successfully connected to facebook for extraction")

        await sleep(200)
        let userUrls = appConfig.userUrls
        while (userUrls.length > 0) {
          const chunkUserUrls = userUrls.splice(0, appConfig.maxUserWorkers)
          await Promise.allSettled(
            chunkUserUrls.map(async function (userUrl) {
              const error = await piscina.run({ userUrl })

              if (error == null) return

              await upsertFailedUserRetryCount(userUrl, appConfig)

              const failedUser = await db.query.failedUsers.findFirst({
                where: sql`${failedUsers.serverId} = ${appConfig.serverId} AND ${failedUsers.userUrl} = ${userUrl}`,
              })

              if (failedUser!.retryCount! <= appConfig.maxUserRetryCount) {
                userUrls.push(userUrl)
                const retryCount = failedUser!.retryCount
                logger.info(`adding failed ${userUrl} to queue ${retryCount} ${retryCount == 1 ? "time" : "times"}`)
              }
            })
          )
          await sleep(200)
        }
      } catch (error: any) {
        logger.error(error)
      } finally {
        if (browser != null) await browser.close()
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

async function upsertFailedUserRetryCount(userUrl: string, appConfig: AppConfig) {
  await db
    .insert(failedUsers)
    .values({
      retryCount: 1,
      userUrl: userUrl,
      serverId: appConfig.serverId,
    })
    .onConflictDoUpdate({
      target: [failedUsers.userUrl, failedUsers.serverId],
      set: {
        retryCount: sql`${failedUsers.retryCount} + 1`,
      },
    })
}

async function handleSavePosts({ userUrl }: { userUrl: string }) {
  const userExtractions: Record<string, UserExtraction> = {
    "facebook.com": new FacebookUserExtraction(),
    "instagram.com": new InstagramUserExtraction(),
  }
  const socialMediaUrls = Object.keys(userExtractions)
  for (const socialMediaUrl of socialMediaUrls) {
    if (userUrl.includes(socialMediaUrl)) {
      return userExtractions[socialMediaUrl].savePosts(userUrl)
    }
  }
}

export default handleSavePosts
