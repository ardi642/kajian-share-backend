import qs from "qs"
import { posts } from "../db/schema"
import _appConfig from "../../app.config.json"
import AppConfig from "../interfaces/AppConfig"
import UserExtraction from "./UserExtraction"
import ImageMetadata from "../interfaces/ImageMetadata"
import { getStringCookies } from "../utils/cookie"
import logger from "../logger"

const appConfig: AppConfig = _appConfig as AppConfig

type PostInfo = typeof posts.$inferInsert
let tes = false
function parsingRawPosts(postDatas: any) {
  const dataEdges: any[] = postDatas.data.xdt_api__v1__feed__user_timeline_graphql_connection.edges

  return dataEdges.map((edge) => {
    const node = edge.node
    const postInfo: PostInfo = {
      id: `${node.id}`,
      userId: `${node.user.pk}`,
      socialMediaType: "instagram",
      description: node.caption.text ?? null,
      creationTime: node.taken_at,
      userUrl: `https://www.instagram.com/${node.user.username}`,
      username: node.user.username,
      userProfileName: node.user.full_name != "" ? node.user.full_name : null,
      profilePicture: decodeURIComponent(node.user.profile_pic_url),
      postUrl: `https://www.instagram.com/p/${node.code}`,
      images: null,
      isIslamicLecture: null,
    }

    let candidateImages: any[] | undefined = node?.image_versions2?.candidates
    const maxHeight = 640
    const carouselMediaCount = node?.carousel_media_count
    if (carouselMediaCount == null && Array.isArray(candidateImages) && candidateImages.length > 0) {
      candidateImages.sort((a: any, b: any) => {
        if (b.height === a.height) return b.width - a.width
        return b.height - a.height
      })

      const filterCandidateImages = candidateImages.filter((image: any) => image.height <= maxHeight)
      let candidateImage: any
      let selectedImage: ImageMetadata
      if (filterCandidateImages.length > 0) candidateImage = filterCandidateImages[0]
      else candidateImage = candidateImages[candidateImages.length - 1]

      selectedImage = {
        url: decodeURIComponent(candidateImage.url),
        height: candidateImage.height,
        width: candidateImage.width,
        accessibilityCaption: node.accessibility_caption ?? null,
      }
      postInfo.images = [selectedImage]
    } else if (typeof carouselMediaCount == "number") {
      const carouselMedia: any[] = node.carousel_media
      const carouselImages: ImageMetadata[] = carouselMedia.map((media) => {
        const candidateImages: any[] = media.image_versions2.candidates
        const sortCandidateImages = candidateImages.sort((a: any, b: any) => {
          if (b.height === a.height) return b.width - a.width
          return b.height - a.height
        })

        const filterCandidateImages = sortCandidateImages.filter((image: any) => image.height <= maxHeight)
        let candidateImage: any
        if (filterCandidateImages.length > 0) candidateImage = filterCandidateImages[0]
        else candidateImage = candidateImages[candidateImages.length - 1]

        return {
          url: decodeURIComponent(candidateImage.url),
          height: candidateImage.height,
          width: candidateImage.width,
          accessibilityCaption: media.accessibility_caption ?? null,
        }
      })
      postInfo.images = carouselImages
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
    if (post.id === stopPostId || post.creationTime < stopCreationTime) return true
  }
  return false
}

function getPageInfo(rawUserPosts: any) {
  return rawUserPosts.data.xdt_api__v1__feed__user_timeline_graphql_connection.page_info
}

export default class InstagramUserExtraction extends UserExtraction {
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
        let pageInfo: any
        let currentUserPosts: any[]
        try {
          if (currentRawUserPosts.hasOwnProperty("errors")) throw new Error(`Payload not correct`)

          pageInfo = getPageInfo(currentRawUserPosts)
          currentUserPosts = parsingRawPosts(currentRawUserPosts)
        } catch (error: any) {
          logger.error(`there is error when fetching or parsing ${userUrl} data`)
          throw error
        }

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
