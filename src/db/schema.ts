import { relations, sql } from "drizzle-orm"
import { sqliteTable, integer, text, unique, primaryKey } from "drizzle-orm/sqlite-core"
import RequestRateLimit from "../interface/RequestRateLimit"
import ImageMetadata from "../interface/ImageMetadata"

export const lecturePosts = sqliteTable("lecturePosts", {
  id: integer({ mode: "number" }).primaryKey({ autoIncrement: true }),
  theme: text().default(sql`null`),
  date: text().default(sql`null`),
  time: integer().default(sql`null`),
  creationTime: integer().default(sql`null`),
  venue: text().default(sql`null`),
  location: text().default(sql`null`),
  speaker: text().default(sql`null`),
  postId: text()
    .references(() => posts.id, { onDelete: "cascade" })
    .notNull(),
})

export const posts = sqliteTable("posts", {
  id: text().primaryKey(),
  userId: text(),
  socialMediaType: text({ enum: ["facebook", "instagram"] }),
  description: text().default(sql`null`),
  creationTime: integer().default(sql`null`),
  userUrl: text().default(sql`null`),
  username: text().default(sql`NULL`),
  userProfileName: text().default(sql`null`),
  contentUrl: text().default(sql`null`),
  isIslamicLecture: integer({ mode: "boolean" }).default(sql`null`),
  images: text({ mode: "json" })
    .$type<ImageMetadata[]>()
    .default(sql`null`),
})

export const userPostTrackers = sqliteTable("userPostTrackers", {
  userUrl: text().primaryKey(),
  lastSuccessfulPostId: text(),
  lastPostId: text(),
})

export const APIKeyRequestRateLimits = sqliteTable("APIKeyRequestRateLimits", {
  APIKey: text().primaryKey(),
  requestRateLimit: text({
    mode: "json",
  })
    .$type<RequestRateLimit>()
    .default(sql`null`),
})

export const failedParsingPosts = sqliteTable(
  "failedParsingPosts",
  {
    serverId: text(),
    postId: text()
      .references(() => posts.id, { onDelete: "cascade" })
      .notNull(),
    retryCount: integer(),
  },
  (t) => [primaryKey({ columns: [t.serverId, t.postId] })]
)

export const failedParsingUsers = sqliteTable(
  "failedParsingUsers",
  {
    userUrl: text(),
    serverId: text(),
    retryCount: integer(),
  },
  (t) => [primaryKey({ columns: [t.userUrl, t.serverId] })]
)

export const failedParsingPostsRelations = relations(failedParsingPosts, ({ one }) => ({
  post: one(posts, {
    fields: [failedParsingPosts.postId],
    references: [posts.id],
  }),
}))

export const postsRelations = relations(posts, ({ many }) => ({
  lecturePosts: many(lecturePosts),
}))

export const lecturePostsRelations = relations(lecturePosts, ({ one, many }) => ({
  posts: one(posts, {
    fields: [lecturePosts.postId],
    references: [posts.id],
  }),
  failedParsingPosts: one(failedParsingPosts),
}))
