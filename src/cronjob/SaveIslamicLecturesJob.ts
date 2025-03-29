import { CronJob, timeout } from "cron"
import { db } from "../utils/database"
import { APIKeyRequestRateLimits, failedParsingPosts, lecturePosts, posts } from "../db/schema"
import { eq, isNull, sql } from "drizzle-orm"
import _appConfig from "../../app.config.json"
import AppConfig from "../interface/AppConfig"
import { parseLecturePost } from "../utils/LLM"
import { isMainThread } from "worker_threads"
import Piscina from "piscina"
import RequestRateLimit from "../interface/RequestRateLimit"
import logger from "../logger"

type PostInfo = typeof posts.$inferInsert
type LecturePostInfo = typeof lecturePosts.$inferInsert

const appConfig: AppConfig = _appConfig

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function formatTimestampToGMT8Date(timestamp: number): string {
  const date = new Date(timestamp) // Ubah timestamp ke Date object
  const gmt8Offset = 8 * 60 * 60 * 1000 // Offset GMT+8 dalam milidetik
  const gmt8Time = new Date(date.getTime() + gmt8Offset)

  // Format waktu ke string yang deskriptif
  const year = gmt8Time.getUTCFullYear()
  const month = String(gmt8Time.getUTCMonth() + 1).padStart(2, "0") // Bulan dimulai dari 0
  const day = String(gmt8Time.getUTCDate()).padStart(2, "0")
  const hours = String(gmt8Time.getUTCHours()).padStart(2, "0")
  const minutes = String(gmt8Time.getUTCMinutes()).padStart(2, "0")
  const seconds = String(gmt8Time.getUTCSeconds()).padStart(2, "0")

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

function getDayTimestamp(dateStringOrYear: number | string, month?: number, day?: number): number {
  if (typeof dateStringOrYear === "string") {
    const [year, month, day] = dateStringOrYear.split("-").map(Number)
    const date = new Date(year, month - 1, day, 0, 0, 0, 0)
    return date.getTime() / 1000
  } else {
    const date = new Date(dateStringOrYear, (month as number) - 1, day as number, 0, 0, 0, 0)
    return date.getTime() / 1000
  }
}

async function getLecturePostInfos(postInfo: PostInfo, APIKey: string): Promise<Partial<LecturePostInfo>[] | null> {
  const now = new Date()
  let rawLecturePost: string | null
  try {
    rawLecturePost = await parseLecturePost(postInfo, APIKey)
  } catch (error: unknown) {
    throw error
  }

  let lecturePostInfos: Partial<LecturePostInfo> | Partial<LecturePostInfo>[] | null = JSON.parse(rawLecturePost!)

  if (lecturePostInfos == null) {
    return null
  }

  if (!Array.isArray(lecturePostInfos)) lecturePostInfos = [lecturePostInfos]
  lecturePostInfos = lecturePostInfos.map((lecturePostInfo) => {
    const newLecturePostInfo: Partial<LecturePostInfo> = {
      ...lecturePostInfo,
      postId: postInfo.id,
      creationTime: Date.now() / 1000,
    }
    if (newLecturePostInfo.date != null) newLecturePostInfo.time = getDayTimestamp(newLecturePostInfo.date)
    return newLecturePostInfo
  })
  return lecturePostInfos
}

async function saveIslamicLecture({ postInfo, APIKey }: { postInfo: PostInfo; APIKey: string }) {
  let lecturePostInfos: Partial<LecturePostInfo>[] | null
  try {
    lecturePostInfos = await getLecturePostInfos(postInfo, APIKey)
  } catch (error: any) {
    let rateLimitResetInfo: string | undefined
    try {
      if (error?.status == 429) {
        const rateLimitReset = Date.now() + 200 + 1000 * 60
        const requestRateLimit: RequestRateLimit = {
          "X-RateLimit-Reset": String(rateLimitReset),
        }
        await db.insert(APIKeyRequestRateLimits).values({ APIKey, requestRateLimit }).onConflictDoUpdate({
          target: APIKeyRequestRateLimits.APIKey,
          set: { requestRateLimit },
        })
        rateLimitResetInfo = `API key request rate limit will be renewed at ${formatTimestampToGMT8Date(
          rateLimitReset
        )}`
      }

      await db.transaction(async (tx) => {
        await tx
          .insert(failedParsingPosts)
          .values({ serverId: appConfig.serverId, postId: postInfo.id, retryCount: 1 })
          .onConflictDoUpdate({
            target: [failedParsingPosts.serverId, failedParsingPosts.postId],
            set: {
              retryCount: sql`${failedParsingPosts.retryCount} + 1`,
            },
          })
      })
    } catch (error: any) {
      logger.error(error, { additionalMessage: "error sync handling rate limit renewed and/or retry failed" })
    }
    logger.error(error, { additionalMessage: `failed parsing ${postInfo.contentUrl}` })
    return
  }

  try {
    if (lecturePostInfos == null) {
      await db.update(posts).set({ isIslamicLecture: false }).where(eq(posts.id, postInfo.id))
      logger.info(`success parsing ${postInfo.contentUrl}. This is not a lecture post`)
      return
    }

    await db.transaction(async (tx) => {
      await tx.insert(lecturePosts).values(lecturePostInfos as LecturePostInfo[])
      await tx.update(posts).set({ isIslamicLecture: true }).where(eq(posts.id, postInfo.id))
    })
  } catch (error: any) {
    logger.error(error, { additionalMessage: `failed parsing ${postInfo.contentUrl}` })
    return
  }

  await db
    .delete(failedParsingPosts)
    .where(
      sql`${failedParsingPosts.postId} = ${postInfo.id} AND ${failedParsingPosts.serverId} = ${appConfig.serverId}`
    )
  logger.info(`success parsing ${postInfo.contentUrl}. This is a lecture post`)
}

if (isMainThread) {
  const cronTime = "0 0/30 * * * *"
  const saveIslamicLecturesJob = CronJob.from({
    cronTime,
    onTick: async function () {
      const piscina = new Piscina({ filename: __filename })
      let postInfos = await db.select().from(posts).where(isNull(posts.isIslamicLecture))
      const maxRetryCount = 3
      try {
        while (postInfos.length > 0) {
          const chunkData = postInfos.splice(0, 2).map((postInfo) => {
            return {
              postInfo,
              APIKey: appConfig.apiKey,
            }
          })
          let requestRateLimit = (
            await db.select().from(APIKeyRequestRateLimits).where(eq(APIKeyRequestRateLimits.APIKey, appConfig.apiKey))
          )?.[0]?.requestRateLimit
          if (requestRateLimit) {
            const now = Date.now()
            const rateLimitReset = Number(requestRateLimit?.["X-RateLimit-Reset"])
            if (now <= rateLimitReset) {
              const waitingTimems = rateLimitReset - now + (rateLimitReset - now) * 0.25
              logger.info(`waiting request rate limit reset renewed in ${waitingTimems / 1000 / 60} minutes`)
              await sleep(waitingTimems)
              logger.info(`request rate limit reset has been renewed`)
            }
            await db.delete(APIKeyRequestRateLimits).where(eq(APIKeyRequestRateLimits.APIKey, appConfig.apiKey))
          }

          await Promise.allSettled(
            chunkData.map(async ({ postInfo, APIKey }) => {
              await piscina.run({ postInfo, APIKey })

              const successPost = await db.query.lecturePosts.findFirst({
                where: sql`${lecturePosts.postId} = ${postInfo.id}`,
              })
              if (successPost) return

              const failedPost = await db.query.failedParsingPosts.findFirst({
                where: sql`${failedParsingPosts.postId} = ${postInfo.id} AND ${failedParsingPosts.serverId} = ${appConfig.serverId}`,
              })

              if (failedPost && failedPost.retryCount! <= maxRetryCount) {
                postInfos.push(postInfo)
                const retryCount = failedPost.retryCount
                logger.info(
                  `adding failed user post ${postInfo.contentUrl} to queue ${retryCount} ${
                    retryCount == 1 ? "time" : "times"
                  }`
                )
              }
            })
          )
          await sleep(200)
        }
      } catch (error: any) {
        logger.error(error)
      }

      await db.delete(failedParsingPosts).where(eq(failedParsingPosts.serverId, appConfig.serverId))
      logger.info(
        `waiting next schedule for Parsing Islamic Lecture Posts in ${
          timeout(cronTime) / 1000 / 60
        } minutes if there is no running schedule`
      )
    },
    start: true,
    waitForCompletion: true,
  })

  async function main() {
    await saveIslamicLecturesJob.fireOnTick()
  }
  main()
}

export default saveIslamicLecture
