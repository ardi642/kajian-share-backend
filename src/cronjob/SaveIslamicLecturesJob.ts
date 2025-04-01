import { CronJob, timeout } from "cron"
import { db } from "../utils/database"
import { APIKeyRequestRateLimits, failedPosts, lecturePosts, posts } from "../db/schema"
import { eq, isNull, sql } from "drizzle-orm"
import _appConfig from "../../app.config.json"
import AppConfig from "../interfaces/AppConfig"
import { parseLecturePost } from "../utils/LLM"
import { isMainThread } from "worker_threads"
import Piscina from "piscina"
import logger from "../logger"

type PostInfo = typeof posts.$inferInsert
type LecturePostInfo = typeof lecturePosts.$inferInsert

const appConfig = _appConfig as AppConfig

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
    logger.error(error, { additionalMessage: `failed parsing ${postInfo.postUrl}` })
    return error
  }

  try {
    if (lecturePostInfos == null) {
      await db.update(posts).set({ isIslamicLecture: false }).where(eq(posts.id, postInfo.id))
      logger.info(`success parsing ${postInfo.postUrl}. This is not a lecture post`)
      return null
    }

    await db.transaction(async (tx) => {
      await tx.insert(lecturePosts).values(lecturePostInfos as LecturePostInfo[])
      await tx.update(posts).set({ isIslamicLecture: true }).where(eq(posts.id, postInfo.id))
    })
  } catch (error: any) {
    logger.error(error, { additionalMessage: `failed parsing ${postInfo.postUrl}` })
    return error
  }

  logger.info(`success parsing ${postInfo.postUrl}. This is a lecture post`)
  return null
}

async function waitRateLimitRenewed(rateLimitReset: number) {
  const now = Date.now()
  if (now <= rateLimitReset) {
    const waitingTimems = rateLimitReset - now + (rateLimitReset - now) * 0.25
    logger.info(`waiting request rate limit reset renewed in ${waitingTimems / 1000 / 60} minutes`)
    await sleep(waitingTimems)
    logger.info(`request rate limit reset has been renewed`)
  }
  await db.delete(APIKeyRequestRateLimits).where(eq(APIKeyRequestRateLimits.APIKey, appConfig.apiKey))
}

async function updateRateLimitTime(APIKey: string) {
  const requestRateLimit = {
    reset: Date.now() + 200 + 1000 * 60,
    limit: null,
    remaining: null,
  }
  await db
    .insert(APIKeyRequestRateLimits)
    .values({ APIKey, ...requestRateLimit })
    .onConflictDoUpdate({
      target: APIKeyRequestRateLimits.APIKey,
      set: { ...requestRateLimit },
    })
  logger.error(`API key request rate limit will be renewed at ${formatTimestampToGMT8Date(requestRateLimit.reset)}`)
}

async function upsertFailedPostRetryCount(postInfo: PostInfo) {
  await db
    .insert(failedPosts)
    .values({ serverId: appConfig.serverId, postId: postInfo.id, retryCount: 1 })
    .onConflictDoUpdate({
      target: [failedPosts.serverId, failedPosts.postId],
      set: {
        retryCount: sql`${failedPosts.retryCount} + 1`,
      },
    })
}

if (isMainThread) {
  const cronTime = "0 0/30 * * * *"
  const saveIslamicLecturesJob = CronJob.from({
    cronTime,
    onTick: async function () {
      const piscina = new Piscina({ filename: __filename })
      let postInfos = await db.select().from(posts).where(isNull(posts.isIslamicLecture))

      await db.delete(failedPosts).where(eq(failedPosts.serverId, appConfig.serverId))
      logger.info("clear last failed posts tracks")
      try {
        while (postInfos.length > 0) {
          const chunkData = postInfos.splice(0, appConfig.maxLectureWorkers).map((postInfo) => {
            return {
              postInfo,
              APIKey: appConfig.apiKey,
            }
          })
          let requestRateLimit = await db.query.APIKeyRequestRateLimits.findFirst({
            where: sql`${APIKeyRequestRateLimits.APIKey} = ${appConfig.apiKey}`,
          })
          if (requestRateLimit) await waitRateLimitRenewed(requestRateLimit.reset!)

          await Promise.allSettled(
            chunkData.map(async ({ postInfo, APIKey }) => {
              const error = await piscina.run({ postInfo, APIKey })

              if (error == null) return

              if (error.status == 429) {
                await updateRateLimitTime(APIKey)
              }

              await upsertFailedPostRetryCount(postInfo)

              const failedPost = await db.query.failedPosts.findFirst({
                where: sql`${failedPosts.postId} = ${postInfo.id} AND ${failedPosts.serverId} = ${appConfig.serverId}`,
              })

              if (failedPost!.retryCount! <= appConfig.maxLectureRetryCount) {
                postInfos.push(postInfo)
                const retryCount = failedPost!.retryCount
                logger.info(
                  `adding failed user post ${postInfo.postUrl} to queue ${retryCount} ${
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
