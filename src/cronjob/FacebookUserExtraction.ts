import { posts } from "../db/schema"
import _appConfig from "../../app.config.json"
import AppConfig from "../interfaces/AppConfig"
import UserExtraction from "./UserExtraction"
import loadJSON from "../utils/loadJSON"
import puppeteer, { Browser } from "puppeteer"
import ImageMetadata from "../interfaces/ImageMetadata"
import QueryString from "qs"
import logger from "../logger"

const appConfig = _appConfig as AppConfig

type PostInfo = typeof posts.$inferInsert

function parsingRawPosts(rawUserPosts: any[]) {
  const userPosts: PostInfo[] = []
  for (const rawUserPost of rawUserPosts) {
    let node: any
    const userPost: Partial<PostInfo> = {}
    if (!rawUserPost.hasOwnProperty("label")) {
      node = rawUserPost.data.node.timeline_list_feed_units.edges[0].node
    } else if (rawUserPost.label.endsWith("user_timeline_list_feed_units")) {
      node = rawUserPost.data.node
    } else continue

    userPost.socialMediaType = "facebook"
    const userId = node.comet_sections.content.story.actors[0].id
    userPost.userId = userId
    userPost.id = `${node.post_id}_${userId}`
    userPost.description = node.comet_sections.content.story.message?.text ?? null
    userPost.creationTime = node.comet_sections.context_layout.story.comet_sections.metadata[0].story.creation_time
    userPost.userUrl = `https://facebook.com/${userId}`
    userPost.userProfileName = node.comet_sections.content.story.actors[0].name ?? null
    userPost.postUrl = decodeURIComponent(node.comet_sections.context_layout.story.comet_sections.metadata[0].story.url)
    userPost.images = null
    userPost.isIslamicLecture = null

    userPost.profilePicture =
      node.comet_sections.context_layout.story.comet_sections.actor_photo.story.actors[0].profile_picture.uri

    const medias: any[] =
      node.comet_sections.content.story.attachments[0]?.styles?.attachment?.all_subattachments?.nodes ?? null

    const oneMedia = node.comet_sections.content.story.attachments[0]?.styles?.attachment?.media ?? null

    if (Array.isArray(medias) && medias.length > 0) {
      const images: ImageMetadata[] = []
      for (const media of medias) {
        if (media.media.__typename != "Photo") continue
        images.push({
          url: decodeURIComponent(media.media.image_uri),
          height: media.media.image.height,
          width: media.media.image.width,
          accessibilityCaption: media.media.accessibility_caption ?? null,
        })
        if (images.length > 0) userPost.images = images
      }
    } else if (oneMedia != null && oneMedia.__typename == "Photo") {
      const image: ImageMetadata = {
        url: decodeURIComponent(oneMedia.comet_photo_attachment_resolution_renderer.image.uri),
        height: oneMedia.comet_photo_attachment_resolution_renderer.image.height,
        width: oneMedia.comet_photo_attachment_resolution_renderer.image.width,
        accessibilityCaption: oneMedia.accessibility_caption ?? null,
      }
      userPost.images = [image]
    }
    if (userPost.description == null && userPost.images == null) continue
    userPosts.push(userPost as PostInfo)
  }

  return userPosts
}

function generatePayload({
  graphqlPostData,
  userId,
  cursor = null,
}: {
  graphqlPostData: any
  userId: string
  cursor?: string | null
}) {
  const variables = JSON.parse(graphqlPostData.variables)
  variables.cursor = cursor
  variables.id = userId
  graphqlPostData.variables = JSON.stringify(variables)
  return QueryString.stringify(graphqlPostData)
}

function getUserIdFromUserUrl(userUrl: string) {
  userUrl = userUrl.replace(/\/+$/, "")
  const urlPaths = userUrl.split("/")
  const userId = urlPaths[urlPaths.length - 1].replace(/^\/+|\/+$/g, "")
  return userId
}

function checkExtractPostStopCondition(posts: PostInfo[], stopPostId: string | null, stopCreationTime: number) {
  for (const post of posts) {
    if (post.id === stopPostId || post.creationTime < stopCreationTime) return true
  }
  return false
}

function getPageInfo(rawUserPosts: any[]) {
  return rawUserPosts[rawUserPosts.length - 1].data.page_info
}

export default class FacebookUserExtraction extends UserExtraction {
  async extractPosts({
    userUrl,
    stopPostId,
    stopCreationTime,
  }: {
    userUrl: string
    stopPostId: string | null
    stopCreationTime: number
  }): Promise<[PostInfo[], any]> {
    let error: any = null
    let userPosts: PostInfo[] = []
    let browser: Browser | undefined
    try {
      const userId = getUserIdFromUserUrl(userUrl)
      const { graphqlHeaders, graphqlPostData } = await loadJSON("requestData.json")
      let payload = generatePayload({ graphqlPostData, userId })

      browser = await puppeteer.connect({ browserWSEndpoint: appConfig.wsEndPoint, defaultViewport: null })
      const pages = await browser.pages()
      const page = pages[0]

      while (true) {
        const rawData = await page.evaluate(
          async function (headers: any, payload: any) {
            const res = await fetch("https://web.facebook.com/api/graphql/", {
              method: "POST",
              headers,
              body: payload,
            })
            if (!res.ok) throw new Error("error status code is not 2xx")
            return await res.text()
          },
          graphqlHeaders,
          payload
        )

        let currentRawUserPosts: any[], currentUserPosts: any[], pageInfo: any
        try {
          currentRawUserPosts = rawData.split("\r\n").map((rawData: any) => JSON.parse(rawData))
          pageInfo = getPageInfo(currentRawUserPosts)
          currentUserPosts = parsingRawPosts(currentRawUserPosts)
        } catch (error: any) {
          logger.error(`there is error when fetching or parsing ${userUrl} data`)
          throw error
        }

        userPosts = [...userPosts, ...currentUserPosts]
        if (!pageInfo.has_next_page) break
        else if (checkExtractPostStopCondition(currentUserPosts, stopPostId, stopCreationTime)) break
        payload = generatePayload({ graphqlPostData, userId, cursor: pageInfo.end_cursor })
      }
    } catch (err: any) {
      error = err
    } finally {
      if (browser != undefined) await browser.disconnect()
    }
    return [userPosts, error]
  }
}
