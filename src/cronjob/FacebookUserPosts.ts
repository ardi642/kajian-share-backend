import puppeteer, { Browser, HTTPRequest, HTTPResponse, Page } from "puppeteer"
import qs from "qs"
import { posts } from "../db/schema"
import AppConfig from "../interface/AppConfig"
import UserPosts from "./UserPosts"
import loadJson from "../utils/loadJson"
import ImageMetadata from "../interface/ImageMetadata"
import _appConfig from "../../app.config.json"

type PostInfo = typeof posts.$inferInsert

function isValidPostRequest(request: HTTPRequest) {
  if (!request.url().includes("facebook.com/api/graphql")) {
    return false
  }

  const payload = qs.parse(request.postData()!)
  if (!payload.hasOwnProperty("variables")) {
    return false
  }

  const variables = JSON.parse(payload["variables"] as string)

  if (!variables.hasOwnProperty("afterTime") && !variables.hasOwnProperty("beforeTime")) {
    return false
  }
  return true
}

function extractPost(timelineListFeedUnit: any) {
  const postInfo: PostInfo = {
    id: `${timelineListFeedUnit?.post_id}`,
    userId: null,
    socialMediaType: null,
    description: null,
    creationTime: null,
    userUrl: null,
    username: null,
    userProfileName: null,
    contentUrl: null,
    images: null,
    isIslamicLecture: null,
  }

  const medias: any[] =
    timelineListFeedUnit?.comet_sections?.content?.story?.attachments[0]?.styles?.attachment?.all_subattachments?.nodes

  const hasMoreMedia = medias?.length > 0
  postInfo["socialMediaType"] = "facebook"
  postInfo["userId"] = `${timelineListFeedUnit?.comet_sections?.content?.story?.actors?.[0]?.id}`
  postInfo["userProfileName"] = timelineListFeedUnit?.comet_sections?.content?.story?.actors?.[0]?.name
  postInfo["creationTime"] =
    timelineListFeedUnit?.comet_sections?.context_layout?.story?.comet_sections?.metadata[0]?.story?.creation_time
  postInfo["contentUrl"] =
    timelineListFeedUnit?.comet_sections?.context_layout?.story?.comet_sections?.metadata[0]?.story?.url

  postInfo["description"] = timelineListFeedUnit?.comet_sections?.content?.story?.message?.text
  postInfo["userUrl"] = timelineListFeedUnit?.comet_sections?.content?.story?.actors?.[0]?.url
  const usernameMatch = postInfo["userUrl"]?.match(/\/([^/?#]+)\/?$/)
  postInfo["username"] = usernameMatch && usernameMatch[1] ? usernameMatch[1] : null
  if (hasMoreMedia) {
    const images: ImageMetadata[] = []
    for (const media of medias) {
      if (media?.media?.__typename != "Photo") continue
      else if (media?.media?.__typename == "Photo" && media?.media?.viewer_image != undefined) {
        const viewerImage = media?.media?.viewer_image
        const image: ImageMetadata = {
          url: viewerImage.uri,
          width: Number(viewerImage.width),
          height: Number(viewerImage.height),
        }
        images.push(image)
      }
    }
    postInfo["images"] = images.length > 0 ? images : null
  } else {
    const placeholder_image =
      timelineListFeedUnit?.comet_sections?.content?.story?.attachments[0]?.styles?.attachment?.media?.placeholder_image
        ?.uri ?? null
    if (placeholder_image != null) {
      const image: ImageMetadata = {
        url: placeholder_image.url,
        width: Number(placeholder_image.width),
        height: Number(placeholder_image.height),
      }
      postInfo["images"] = [image]
    }
  }
  return postInfo
}

async function filterCurrentYearPosts(page: Page) {
  const filterButton = await page.waitForSelector('div[aria-label="Filter"]')
  await filterButton!.scrollIntoView()
  await filterButton!.click()
  await page.waitForSelector("::-p-xpath(/html/body/div[1]/div/div[1]/div/div[4]/div/div/div[1]/div/div[2]/div)")
  await page
    .locator(
      "::-p-xpath(/html/body/div[1]/div/div[1]/div/div[4]/div/div/div[1]/div/div[2]/div/div/div/div[3]/div[1]/div/div[2]/div/div/div/div/div/div)"
    )
    .click()

  await page.waitForSelector(
    "::-p-xpath(/html/body/div[1]/div/div[1]/div/div[4]/div/div/div[1]/div/div[3]/div/div/div[1])"
  )

  await page
    .locator(
      "::-p-xpath(/html/body/div[1]/div/div[1]/div/div[4]/div/div/div[1]/div/div[3]/div/div/div[1]/div[1]/div/div/div/div/div[1]/div/div[2])"
    )
    .click()

  await page
    .locator(
      "::-p-xpath(/html/body/div[1]/div/div[1]/div/div[4]/div/div/div[1]/div/div[2]/div/div/div/div[3]/div[2]/div/div[2]/div[1])"
    )
    .click()
}

async function scrollPosts(loopRef: { current: boolean }, page: Page) {
  while (loopRef.current) {
    let lastPostCount = await page.evaluate(() => {
      return document.querySelector("div[data-pagelet='ProfileTimeline']")!.children.length
    })
    let lastPost = await page.evaluateHandle(() => {
      const lastPost = document.querySelector("div[data-pagelet] .x1xzczws")
      lastPost?.scrollIntoView({
        behavior: "smooth",
      })
      return lastPost
    })

    if (lastPost == null) break

    await page.waitForFunction(
      (lastPostCount) => {
        const currentPostCount = document.querySelector("div[data-pagelet='ProfileTimeline']")!.children.length
        return lastPostCount != currentPostCount
      },
      {},
      lastPostCount
    )
  }
}

function procesRequest(request: HTTPRequest) {
  const resourceType = request.resourceType()
  const url = request.url()
  if (url.includes("/ajax/bulk-route-definitions")) {
    request.abort
    return
  }

  if (url.includes("/ajax/bootloader-endpoint/")) {
    request.abort
    return
  }

  if (url.includes("fna.fbcdn.net/")) {
    request.abort()
    return
  }

  if (url.includes("/sound_iframe.php")) {
    request.abort()
    return
  }

  if (resourceType === "image" || resourceType === "media") {
    request.abort()
    return
  }

  if (url.includes("/api/graphql/")) {
    const rawPostData = request.postData()
    const postData = qs.parse(rawPostData!)
    if (postData?.["fb_api_req_friendly_name"] != "ProfileCometTimelineFeedRefetchQuery") {
      request.abort()
      return
    }
  }

  if (resourceType == "websocket") {
    request.abort()
    return
  }
  request.continue()
}

function createProcessResponse({
  loopRef,
  userPosts,
  stopContentId,
  stopCreationTime,
}: {
  loopRef: { current: boolean }
  userPosts: Map<string, PostInfo>
  stopContentId: string | null
  stopCreationTime: number
}) {
  return async (response: HTTPResponse) => {
    if (!loopRef.current) return
    const request = response.request()
    if (!isValidPostRequest(request)) return

    const resText = await response.text()
    const rawPostDatas = resText.split("\r\n")
    const postDatas = rawPostDatas.map((rawData) => JSON.parse(rawData))
    let timelineListFeedUnit: any | null
    let hasReachedStopCondition = false
    for (const postData of postDatas) {
      timelineListFeedUnit = null
      if (postData.hasOwnProperty("label") && (postData["label"] as string).endsWith("timeline_list_feed_units")) {
        timelineListFeedUnit = postData?.data?.node
      } else if (postData?.data?.node?.timeline_list_feed_units?.edges?.[0]?.node != null) {
        timelineListFeedUnit = postData?.data?.node?.timeline_list_feed_units?.edges?.[0]?.node
      }

      if (timelineListFeedUnit == null) continue
      if (userPosts.hasOwnProperty(`${timelineListFeedUnit.post_id}`)) continue

      const userPost = extractPost(timelineListFeedUnit)
      if (userPost["description"] == null && userPost["images"] == null) continue
      if (userPost["id"] === stopContentId || userPost["creationTime"]! < stopCreationTime) {
        hasReachedStopCondition = true
      }
      userPosts.set(`${timelineListFeedUnit.post_id}`, userPost)
    }
    if (hasReachedStopCondition) loopRef.current = false
  }
}

export default class FacebookUserPosts extends UserPosts {
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
    let browser: Browser | null = null
    let page: Page | null = null
    const userPosts = new Map<string, PostInfo>()
    const loopRef = { current: true }
    try {
      const appConfig: AppConfig = await loadJson("app.config.json")
      browser = await puppeteer.connect({ browserWSEndpoint: appConfig.wsEndPoint, defaultViewport: null })
      const context = await browser.createBrowserContext()
      context.setCookie(...appConfig.cookies[".facebook.com"])
      page = await context.newPage()

      page.setRequestInterception(true)
      page.on("request", procesRequest)
      page.on("response", createProcessResponse({ userPosts, loopRef, stopContentId: stopPostId, stopCreationTime }))

      await page.goto(userUrl)
      await filterCurrentYearPosts(page)
      await scrollPosts(loopRef, page)
    } catch (err: any) {
      error = err
    } finally {
      if (page != null) {
        page.removeAllListeners()
        await page.close()
      }
      if (browser != null) await browser.disconnect()
    }

    return [Array.from(userPosts.values()), error]
  }
}
