import winston from "winston"
const { combine, json, errors } = winston.format
import AppConfig from "../interfaces/AppConfig"
import _appConfig from "../../app.config.json"

const appConfig = _appConfig as AppConfig

function getISOGMT8Datetime(timestamp: number): string {
  const offset = 8 * 60
  const adjustedTime = new Date(timestamp + offset * 60 * 1000)

  const year = adjustedTime.getUTCFullYear()
  const month = String(adjustedTime.getUTCMonth() + 1).padStart(2, "0")
  const day = String(adjustedTime.getUTCDate()).padStart(2, "0")
  const hours = String(adjustedTime.getUTCHours()).padStart(2, "0")
  const minutes = String(adjustedTime.getUTCMinutes()).padStart(2, "0")
  const seconds = String(adjustedTime.getUTCSeconds()).padStart(2, "0")

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+08:00`
}

const fileTransport = new winston.transports.DailyRotateFile({
  filename: "logs/lecture-%DATE%.log",
  datePattern: "YYYY-MM-DD",
  maxFiles: "7d",
})

const GMT8Timestamp = winston.format((info) => {
  info.timestamp = getISOGMT8Datetime(Date.now())
  return info
})

winston.loggers.add("developmentLogger", {
  level: "info",
  format: combine(errors(), GMT8Timestamp(), json()),
  transports: [new winston.transports.Console()],
})

winston.loggers.add("productionLogger", {
  level: "error",
  format: combine(errors({ cause: true, stack: true }), GMT8Timestamp(), json()),
  transports: [fileTransport],
})

let logger: winston.Logger
const environment = appConfig.environment || "development"

if (environment == "production") logger = winston.loggers.get("productionLogger")
else if (environment == "development") logger = winston.loggers.get("developmentLogger")

export default logger!
