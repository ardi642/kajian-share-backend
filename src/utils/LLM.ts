import { posts } from "../db/schema"
import { GoogleGenerativeAI, SchemaType, Part, Schema } from "@google/generative-ai"
import moment from "moment-hijri"

type PostInfo = typeof posts.$inferInsert

async function getImageGenerativePart(url: string) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`failed download image from url for parsing data. status ${response.status}`)
  }

  const mimeType = response.headers.get("content-type")
  const arrayBuffer = await response.arrayBuffer()
  return {
    inlineData: {
      data: Buffer.from(arrayBuffer).toString("base64"),
      mimeType: mimeType!,
    },
  }
}

function convertToHijri(dateString: string): string {
  const gregorianDate = moment(dateString, "YYYY-MM-DD")
  const hijriMonthsIndonesian = [
    "Muharram",
    "Safar",
    "Rabi'ul Awal",
    "Rabi'ul Akhir",
    "Jumadil Awal",
    "Jumadil Akhir",
    "Rajab",
    "Syaban",
    "Ramadhan",
    "Syawal",
    "Dzulqaidah",
    "Dzulhijjah",
  ]

  const hijriYear = gregorianDate.iYear()
  const hijriMonthIndex = gregorianDate.iMonth()
  const hijriDay = gregorianDate.iDate()

  const hijriMonthName = hijriMonthsIndonesian[hijriMonthIndex]

  return `${hijriDay} ${hijriMonthName} ${hijriYear}`
}

export async function parseLecturePost(post: Partial<PostInfo>, apiKey: string) {
  const today = new Date()
  const daysOfWeek = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"]
  const monthsIndonesian = [
    "Januari",
    "februari",
    "maret",
    "April",
    "Mei",
    "Juni",
    "Juli",
    "Agustus",
    "September",
    "Oktober",
    "November",
    "Desember",
  ]
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, "0")
  const day = String(today.getDate()).padStart(2, "0")

  const dayIndex = today.getDay()
  const monthIndex = today.getMonth()

  const dayName = daysOfWeek[dayIndex]
  const monthName = monthsIndonesian[monthIndex]

  const formattedDate = `${dayName}, ${day} ${monthName} ${year}`
  const date = `${year}-${month}-${day}`

  const prompt = `
saya akan memberikan informasi postingan dari media dakwah di sosial media, dan saya ingin dari informasi postingan tersebut mengidentifikasikan apakah postingan menunjukkan terkait jadwal kajian ceramah islam atau bukan. respon jika postingannya mengenai waktu jadwal kajian ceramah islam berupa JSON dengan format berikut jika informasi postingan berupa jadwal kajian ceramah 
{
    "theme": "apa nama tema kajiannya",
    "date": "tentukan waktu masehi dalam format tanggal (yyyy-mm-dd), jika benar-benar sulit diperkirakan isi kan null",
    "venue": "misalkan jika ada keterangan nama tempat tulis nama tempat seperti di masjid misalkan atau nama tempatnya jika ada, jika tidak ada cukup null",
    "location": "masukkan info jika ada keterangan lokasi google maps jika tidak ada isikan null",
    "speaker": "keterangan nama ustad yang membawakan kajian ceramah sebagai string"
}

sedangkan Jika postingan bukan mengenai jadwal ceramah kajian islam seperti jadwal sholat tarawih & witir, atau jadwal I'tikaf, atau jadwal-jadwal lain yang bukan mengenai jadwal kajian ceramah islam maka hasilkan respon JSON berupa "null". Jika teks postingan menunjukkan informasi jadwal kajian lebih dari satu hari atau lebih dari satu tanggal buatkan response JSON untuk masing-masingnya sebagai element dari array dimana setiap harinya menunjukkan jadwal yang berbeda, sehingga response JSON nya berupa array 
{
  "theme": "apa nama tema kajiannya",
  "date": "perkirakan waktu masehi dalam format string tanggal (yyyy-mm-dd)",
  "venue": "misalkan jika ada keterangan nama tempat tulis nama tempat seperti di masjid atau nama tempatnya jika ada, jika tidak ada cukup null",
  "location": "masukkan info jika ada keterangan lokasi google maps jika tidak ada isikan null",
  "speaker": "keterangan nama ustad yang membawakan kajian ceramah sebagai string"
}[]
}. jika jadwalnya hanya keterangan nama hari maka perkirakan tanggalnya berdasarkan informasi acuan tanggal masehi sekarang ${formattedDate} dan tanggal hijriah sekarang ${convertToHijri(
    date
  )} . Teks postingannya yaitu '${
    post.description
  }'. kemudian jika postingannya tidak ada keterangan waktu maka hasilkan saja response JSON berupa "null" yang menganggap informasi postingan bukan mengenai waktu jadwal kajian ceramah islam sehingga response JSON yang dihasilkan "null"`

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: {
      responseMimeType: "application/json",
    },
  })
  const imageParts: Part[] = []
  if (post.imageUrls) imageParts.push(await getImageGenerativePart(post.imageUrls[0]))

  const result = await model.generateContent([prompt, ...imageParts])
  return result.response.text()
}
