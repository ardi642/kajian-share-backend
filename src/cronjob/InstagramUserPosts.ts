import qs from "qs"
import { posts } from "../db/schema"
import _appConfig from "../../app.config.json"
import AppConfig from "../interface/AppConfig"
import UserPosts from "./UserPosts"
import loadJson from "../utils/loadJson"
import ImageMetadata from "../interface/ImageMetadata"
import { getStringCookies } from "../utils/cookie"

type PostInfo = typeof posts.$inferInsert

function parsingRawPosts(postDatas: any) {
  const dataEdges: any[] = postDatas.data.xdt_api__v1__feed__user_timeline_graphql_connection.edges

  return dataEdges.map((edge) => {
    const node = edge.node
    const postInfo: PostInfo = {
      id: `${node.id}`,
      userId: `${node.user.pk}`,
      socialMediaType: "instagram",
      description: node?.caption?.text ?? null,
      creationTime: node.taken_at,
      userUrl: `https://www.instagram.com/${node.user.username}`,
      username: node.user.username,
      userProfileName: node.user.full_name != "" ? node.user.full_name : null,
      contentUrl: `https://www.instagram.com/p/${node.code}`,
      images: null,
      isIslamicLecture: null,
    }

    let images: any[] | undefined = node?.image_versions2?.candidates
    if (images != undefined && (images.length as number) > 0) {
      images.sort((a, b) => {
        if (a.height === b.height) return a.width - b.width
        return a.height - b.height
      })

      const maxHeight = 640

      const filterImages = images.filter((image) => image.height <= maxHeight)
      if (filterImages.length > 0) {
        const lastFilterImage = filterImages[filterImages.length - 1]
        const image: ImageMetadata = {
          url: lastFilterImage.url,
          width: lastFilterImage.width,
          height: lastFilterImage.height,
        }
        postInfo.images = [image]
      } else {
        const lastImage = images[images.length - 1]
        const image: ImageMetadata = {
          url: lastImage.url,
          width: lastImage.width,
          height: lastImage.height,
        }
        postInfo.images = [image]
      }
    }
    return postInfo
  })
}

function generatePayload({
  username,
  after = null,
  before = null,
}: {
  username: string
  after?: string | null
  before?: string | null
}) {
  const payload: any = {
    variables: {
      after,
      before,
      data: {
        count: 12,
        include_relationship_info: true,
        latest_besties_reel_media: true,
        latest_reel_media: true,
      },
      username,
      __relay_internal__pv__PolarisIsLoggedInrelayprovider: true,
      __relay_internal__pv__PolarisShareSheetV3relayprovider: true,
    },
    doc_id: "28584433827869438",
    server_timestamps: true,
  }
  payload["variables"] = JSON.stringify(payload["variables"])
  return qs.stringify(payload)
}

function getUsernameFromUserUrl(userUrl: string) {
  userUrl = userUrl.replace(/\/+$/, "")
  const urlPaths = userUrl.split("/")
  const username = urlPaths[urlPaths.length - 1].replace(/^\/+|\/+$/g, "")
  return username
}

function checkExtractPostStopCondition(posts: PostInfo[], stopPostId: string | null, stopCreationTime: number) {
  for (const post of posts) {
    if (post.id === stopPostId || post.creationTime! < stopCreationTime) return true
  }
  return false
}

function getPageInfo(rawUserPosts: any) {
  return rawUserPosts.data.xdt_api__v1__feed__user_timeline_graphql_connection.page_info
}

export default class InstagramUserPosts extends UserPosts {
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

    const username = getUsernameFromUserUrl(userUrl)
    let payload = generatePayload({ username })
    try {
      const appConfig: AppConfig = await loadJson("app.config.json")
      const instagramCookie = getStringCookies(appConfig.cookies[".instagram.com"])
      while (true) {
        const response = await fetch("https://www.instagram.com/graphql/query", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Cookie: instagramCookie,
          },
          body: payload,
        })
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status} - ${response.statusText}`)
        const currentRawUserPosts = await response.json()
        if (currentRawUserPosts.hasOwnProperty("errors")) throw new Error(`Payload not correct`)

        const pageInfo = getPageInfo(currentRawUserPosts)
        const currentUserPosts = parsingRawPosts(currentRawUserPosts)

        userPosts = [...userPosts, ...currentUserPosts]
        if (!pageInfo.has_next_page) break
        else if (checkExtractPostStopCondition(currentUserPosts, stopPostId, stopCreationTime)) break

        payload = generatePayload({ username, after: pageInfo.end_cursor })
      }
    } catch (err: any) {
      error = err
    }
    return [userPosts, error]
  }
}
