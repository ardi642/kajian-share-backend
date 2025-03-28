type RequestRateLimit = {
  "X-RateLimit-Limit"?: string
  "X-RateLimit-Remaining"?: string
  "X-RateLimit-Reset"?: string
}

export default RequestRateLimit
