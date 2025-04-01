import express from "express"
import { db } from "../utils/database"
import { eq, or, SQL, sql } from "drizzle-orm"
import { lecturePosts, posts } from "../db/schema"
import AppConfig from "../interfaces/AppConfig"
import _appConfig from "../../app.config.json"

const appConfig = _appConfig as AppConfig
const app = express()
const port = appConfig.port || 3000

function getISOGMT8Datetime(timestamp: number): string {
  const offset = 8 * 60
  const adjustedTime = new Date(timestamp + offset * 60 * 1000)

  const year = adjustedTime.getUTCFullYear()
  const month = String(adjustedTime.getUTCMonth() + 1).padStart(2, "0")
  const day = String(adjustedTime.getUTCDate()).padStart(2, "0")
  const hours = String(adjustedTime.getUTCHours()).padStart(2, "0")
  const minutes = String(adjustedTime.getUTCMinutes()).padStart(2, "0")
  const seconds = String(adjustedTime.getUTCSeconds()).padStart(2, "0")

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+08:00`
}

function encodeCursor({
  date,
  userProfileName,
  creationTime,
}: {
  date: string
  userProfileName: string
  creationTime: string
}) {
  return Buffer.from(`${date}\X1F${userProfileName}\X1F${creationTime}`).toString("base64")
}

function decodeCursor(cursor: string) {
  const decoded = Buffer.from(cursor, "base64").toString("utf-8")
  const [date, userProfileName, creationTime] = decoded.split("X1F")
  return { date, userProfileName, creationTime }
}

const apiRouter = express.Router()

apiRouter.use([express.json()])

apiRouter.get("/lecture-posts", async (req, res) => {
  let date: string | undefined, userProfileName: string | undefined, creationTime: string | undefined
  if (req.query.cursor) {
    ;({ date, userProfileName, creationTime } = decodeCursor(req.query.cursor as string))
    if (!date || !userProfileName || !creationTime) {
      res.status(400).json({
        message: "Invalid cursor: The provided cursor could not be decoded",
        timestamp: getISOGMT8Datetime(Date.now()),
      })
      return
    }
  }
  let limit = 12
  if (!isNaN(Number(req.query.limit))) limit = Number(req.query.limit)

  // cursor pagination filters
  const filters: SQL[] = []
  if (date && userProfileName && creationTime) {
    filters.push(sql`(${lecturePosts.date} > ${date})`)
    filters.push(sql`(${lecturePosts.date} = ${date}) AND (${posts.userProfileName} > ${userProfileName})`)
    filters.push(
      sql`(${lecturePosts.date} = ${date}) AND (${posts.userProfileName} = ${userProfileName}) 
      AND (${posts.creationTime} > ${creationTime})`
    )
  }
  let lecturePostsData: any[]

  try {
    lecturePostsData = await db
      .select()
      .from(lecturePosts)
      .innerJoin(posts, eq(lecturePosts.postId, posts.id))
      .where(or(...filters))
      .orderBy(sql`${lecturePosts.date} ASC, LOWER(${posts.userProfileName}) ASC, ${posts.creationTime} ASC`)
      .limit(limit)
  } catch (error: any) {
    delete error.stack
    res.status(500).json({
      ...error,
      message: error?.message ?? "An unexpected error occurred while processing your request",
      timestamp: getISOGMT8Datetime(Date.now()),
    })
    return
  }
  const lastLecturePost = lecturePostsData[lecturePostsData.length - 1]
  let nextCursor: string | null
  let hasMore = true
  if (limit > lecturePostsData.length || lecturePostsData.length == 0) {
    nextCursor = null
    hasMore = false
  } else {
    const date = lastLecturePost.lecturePosts.date
    const { userProfileName, creationTime } = lastLecturePost.posts

    nextCursor = encodeCursor({ date, userProfileName, creationTime })
  }
  res.json({
    data: lecturePostsData,
    pagination: {
      nextCursor,
      hasMore,
    },
  })
})

app.use("/api", apiRouter)

app.listen(port, () => {
  console.log(`server listening on  http://localhost:${port}`)
})
