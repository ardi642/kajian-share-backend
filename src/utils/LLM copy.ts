import { lecturePosts, posts } from "../db/schema"
import OpenAI from "openai"

type PostInfo = typeof posts.$inferInsert

type ErrorResponse = {
  error: {
    code: number
    message: string
    metadata?: Record<string, unknown>
  }
}

export class LLMErrorResponse extends Error {
  error: ErrorResponse["error"]
  code: number
  constructor(message: string, error: ErrorResponse["error"], code: number) {
    super(message)
    this.name = "LLMErrorResponse"
    this.error = error
    this.code = code
  }
}

async function getBase64ImageFromUrl(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`failed download image from url for parsing data. status ${response.status}`)
  }

  const mimeType = response.headers.get("content-type")
  const arrayBuffer = await response.arrayBuffer()
  const base64 = Buffer.from(arrayBuffer).toString("base64")
  const prefix = `data:${mimeType};base64,`
  return `${prefix}${base64}`
}

export async function parseLecturePost(post: Partial<PostInfo>, apiKey: string) {
  const today = new Date()
  const daysOfWeek = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"]
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, "0")
  const day = String(today.getDate()).padStart(2, "0")

  const dayIndex = today.getDay()

  const dayName = daysOfWeek[dayIndex]

  const formattedDate = `${year}-${month}-${day}`

  const openai = new OpenAI({
    // baseURL: "https://openrouter.ai/api/v1",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    apiKey,
  })
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        "Anda adalah seorang asisten yang membantu. tolong bantu memparsing postingan yang akan diberikan untuk dimasukkan ke dalam database sqlite",
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `
saya akan memberikan informasi postingan instagram, dan saya ingin dari informasi postingan tersebut mengidentifikasikan apakah postingan menunjukkan terkait jadwal kajian ceramah atau bukan. respon yang saya inginkan adalah berupa JSON dengan format berikut jika informasi postingan berupa jadwal kajian ceramah 
{
    "theme": "apa nama tema kajiannya",
    "date": "perkirakan waktunya dalam format (yyyy-mm-dd), jika benar-benar sulit diperkirakan isi kan null",
    "venue": "misalkan jika ada keterangan nama tempat tulis nama tempat seperti di masjid misalkan atau nama tempatnya jika ada, jika tidak ada cukup null",
    "location": "masukkan info jika ada keterangan lokasi google maps jika tidak ada isikan null",
    "speaker": "keterangan nama pematerinya"
}
tetapi jika postingan tidak menunjukkan informasi mengenai jadwal kajian ceramah atau tidak terlalu detail membahas apakah informasi mengenai jadwal kajian ceramah maka menunjukkan bukan jadwal kajian ceramah sehingga hasil respon JSON nya tepat "null" . jika teks postingan menunjukkan informasi jadwal kajian lebih dari satu hari atau lebih dari satu tanggal buatkan response JSON untuk masing-masing hari sebagai jadwal sebagai element dari array dimana setiap harinya jadwal yang berbeda, sehingga response JSON nya berupa array 
{
  "theme": "apa nama tema kajiannya",
  "date": "perkirakan waktu dalam format (yyyy-mm-dd), jika benar-benar sulit diperkirakan isi kan null",
  "venue": "misalkan jika ada keterangan nama tempat tulis nama tempat seperti di masjid atau nama tempatnya jika ada, jika tidak ada cukup null",
  "location": "masukkan info jika ada keterangan lokasi google maps jika tidak ada isikan null",
  "speaker": "keterangan nama-nama pematerinya"
}[]
}. Jadi jika jadwalnya lebih dari satu hari, maka buatkan element untuk setiap harinya sebagai element arraynya juga. jika jadwalnya hanya keterangan nama hari maka perkirakan time nya sesuai format dengan informasi acuan hari sekarang ${dayName} dan tanggal sekarang ${formattedDate} . Teks postingannya yaitu '${post.description}'`,
        },
      ],
    },
  ]

  // if (post.imageUrls != null) {
  //   ;(messages[0].content as OpenAI.Chat.Completions.ChatCompletionContentPart[]).push({
  //     type: "image_url",
  //     image_url: {
  //       url: await getBase64ImageFromUrl(post.imageUrls[0]),
  //     },
  //   })
  // }

  const completion = await openai.chat.completions.create({
    // model: "google/gemini-2.0-pro-exp-02-05:free",
    model: "gemini-2.0-flash",
    messages,
    temperature: 0,
    response_format: {
      type: "json_object",
    },
  })

  if (completion.hasOwnProperty("error")) {
    const errorResponse: ErrorResponse = completion as any
    throw new LLMErrorResponse(errorResponse.error.message, errorResponse.error, errorResponse.error.code)
  }

  return completion?.choices?.[0]?.message.content
}
