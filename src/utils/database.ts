import { drizzle } from "drizzle-orm/better-sqlite3"
import * as schema from "../db/schema"
import Database from "better-sqlite3"

const sqlite = new Database("sqlite.db")
export const db = drizzle({ client: sqlite, schema })
