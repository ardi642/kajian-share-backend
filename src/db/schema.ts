import { relations, sql } from "drizzle-orm"
import { sqliteTable, integer, text, unique, primaryKey } from "drizzle-orm/sqlite-core"
import ImageMetadata from "../interfaces/ImageMetadata"

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
  userId: text().notNull(),
  socialMediaType: text({ enum: ["facebook", "instagram"] }).notNull(),
  description: text().default(sql`null`),
  creationTime: integer().notNull(),
  userUrl: text().notNull(),
  username: text().default(sql`NULL`),
  userProfileName: text().notNull(),
  postUrl: text().notNull(),
  profilePicture: text(),
  isIslamicLecture: integer({ mode: "boolean" }).default(sql`null`),
  images: text({ mode: "json" })
    .$type<ImageMetadata[]>()
    .default(sql`null`),
})

export const userTrackers = sqliteTable("userPostTrackers", {
  userUrl: text().primaryKey(),
  lastSuccessfulPostId: text(),
  lastPostId: text(),
  lastSuccessfulCreationTime: integer(),
  lastCreationTime: integer(),
})

export const APIKeyRequestRateLimits = sqliteTable("APIKeyRequestRateLimits", {
  APIKey: text().primaryKey(),
  limit: integer().default(sql`null`),
  remaining: integer().default(sql`null`),
  reset: integer().default(sql`null`),
})

export const failedPosts = sqliteTable(
  "failedPosts",
  {
    serverId: text(),
    postId: text()
      .references(() => posts.id, { onDelete: "cascade" })
      .notNull(),
    retryCount: integer(),
  },
  (t) => [primaryKey({ columns: [t.serverId, t.postId] })]
)

export const failedUsers = sqliteTable(
  "failedUsers",
  {
    userUrl: text(),
    serverId: text(),
    retryCount: integer(),
  },
  (t) => [primaryKey({ columns: [t.userUrl, t.serverId] })]
)

export const failedParsingPostsRelations = relations(failedPosts, ({ one }) => ({
  post: one(posts, {
    fields: [failedPosts.postId],
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
  failedParsingPosts: one(failedPosts),
}))
