import { db } from "../utils/database"
import { posts, userTrackers } from "../db/schema"
import { sql } from "drizzle-orm"
import _appConfig from "../../app.config.json"
import AppConfig from "../interfaces/AppConfig"
import logger from "../logger"

type PostInfo = typeof posts.$inferInsert

const appConfig = _appConfig as AppConfig

function getDayTimestamp(year: number, month: number, day: number) {
  const date = new Date(year, month - 1, day)

  const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
  return startOfDay.getTime() / 1000
}

export default abstract class UserExtraction {
  abstract extractPosts({
    userUrl,
    stopPostId,
    stopCreationTime,
  }: {
    userUrl: string
    stopPostId: string | null
    stopCreationTime: number
  }): Promise<[PostInfo[], any]>

  public async savePosts(userUrl: string) {
    let currentUserTracker = await db.query.userTrackers.findFirst({
      where: sql`${userTrackers.userUrl} = ${userUrl}`,
    })
    if (!currentUserTracker) {
      currentUserTracker = {
        userUrl,
        lastSuccessfulPostId: null,
        lastPostId: null,
        lastSuccessfulCreationTime: null,
        lastCreationTime: null,
      }
    }

    const stopPostId = currentUserTracker.lastSuccessfulPostId
    const now = new Date()
    const stopCreationTime = getDayTimestamp(now.getFullYear(), now.getMonth() + 1, now.getDate())
    let [userPosts, error] = await this.extractPosts({
      userUrl,
      stopCreationTime,
      stopPostId,
    })

    let newPost: PostInfo | undefined
    if (userPosts.length > 0) {
      try {
        await db.insert(posts).values(userPosts).onConflictDoNothing()
        newPost = userPosts[0]
      } catch (err: any) {
        logger.error(err, { additionalMessage: `Database error. Not success save ${userUrl} new posts` })
        return err
      }
    }

    if (error == null) {
      console.log(`success extract ${userUrl} new posts`)

      if (userPosts.length > 0) {
        currentUserTracker.lastSuccessfulPostId = newPost!.id
        currentUserTracker.lastPostId = newPost!.id
        currentUserTracker.lastSuccessfulCreationTime = newPost!.creationTime
        currentUserTracker.lastCreationTime = newPost!.creationTime
        await db.insert(userTrackers).values(currentUserTracker).onConflictDoUpdate({
          target: userTrackers.userUrl,
          set: currentUserTracker,
        })
      }
      return null
    }

    if (userPosts.length > 0) logger.error(error, { additionalMessage: `success save some ${userUrl} new posts` })
    else logger.error(error, { additionalMessage: `not success save ${userUrl} new posts` })

    return error
  }
}
