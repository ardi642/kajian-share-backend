import * as path from "path"
import * as fs from "fs"

export default async function loadJson(filePath: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const fullPath = path.resolve(filePath) // Resolve path absolut
    fs.readFile(fullPath, "utf8", (err, data) => {
      if (err) {
        reject(err)
      } else {
        try {
          const parsedData = JSON.parse(data) // Parsing JSON
          resolve(parsedData)
        } catch (parseError) {
          reject(parseError)
        }
      }
    })
  })
}
