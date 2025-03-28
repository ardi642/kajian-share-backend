import { db } from "../utils/database"
import { failedParsingUsers, posts, userPostTrackers } from "../db/schema"
import { and, eq, sql } from "drizzle-orm"
import _appConfig from "../../app.config.json"
import AppConfig from "../interface/AppConfig"
import logger from "../logger"

type PostInfo = typeof posts.$inferInsert

const appConfig: AppConfig = _appConfig

function getDayTimestamp(year: number, month: number, day: number) {
  const date = new Date(year, month - 1, day)

  const startOfDay = new Date(date.getFullYear(), date.getMonth() + 1, date.getDate(), 0, 0, 0, 0)
  return startOfDay.getTime() / 1000
}

function getNewCreationTimePost(userPosts: PostInfo[]) {
  let newPost: PostInfo | null = null
  for (const currentPost of userPosts) {
    if (newPost == null) newPost = currentPost

    if (currentPost.creationTime! > newPost.creationTime!) {
      newPost = currentPost
    }
  }
  return newPost!
}

export default abstract class UserPosts {
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
    let currentUserPostTracker = (
      await db.select().from(userPostTrackers).where(eq(userPostTrackers.userUrl, userUrl)).limit(1)
    )?.[0] ?? {
      userUrl,
      lastPostId: null,
      lastSuccessfulPostId: null,
    }

    const stopPostId = currentUserPostTracker.lastSuccessfulPostId
    const now = new Date()
    const stopCreationTime = getDayTimestamp(now.getFullYear(), now.getMonth() + 1, now.getDate() - 3)
    const [userPosts, error] = await this.extractPosts({
      userUrl,
      stopCreationTime,
      stopPostId,
    })

    let newPost: PostInfo | undefined
    if (userPosts.length > 0) {
      await db.insert(posts).values(userPosts).onConflictDoNothing()
      newPost = getNewCreationTimePost(userPosts)
    }

    if (error == null) {
      console.log(`success extract ${userUrl} new posts`)

      await db
        .delete(failedParsingUsers)
        .where(and(eq(failedParsingUsers.serverId, appConfig.serverId), eq(failedParsingUsers.userUrl, userUrl)))

      if (userPosts.length > 0) {
        currentUserPostTracker.lastPostId = newPost!.id
        currentUserPostTracker.lastSuccessfulPostId = newPost!.id
        await db.insert(userPostTrackers).values(currentUserPostTracker).onConflictDoUpdate({
          target: userPostTrackers.userUrl,
          set: currentUserPostTracker,
        })
      }
      return
    } else if (error != null) {
      await db
        .insert(failedParsingUsers)
        .values({
          retryCount: 1,
          userUrl: currentUserPostTracker.userUrl,
          serverId: appConfig.serverId,
        })
        .onConflictDoUpdate({
          target: [failedParsingUsers.userUrl, failedParsingUsers.serverId],
          set: {
            retryCount: sql`${failedParsingUsers.retryCount} + 1`,
          },
        })
      if (userPosts.length > 0) logger.error(error, { additionalMessage: `success save some ${userUrl} new posts` })
      else logger.error(error, { additionalMessage: `not success save all ${userUrl} new posts` })
    }
  }
}
