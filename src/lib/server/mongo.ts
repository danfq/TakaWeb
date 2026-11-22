import { MongoClient, type Collection, type Document } from "mongodb"
import { MONGO_URI } from "astro:env/server"

/**
 * takatime always writes here, regardless of the uri path
 */
const DATABASE = "takatime"
const COLLECTION = "logs"

// reuse the client across dev reloads
const globals = globalThis as typeof globalThis & {
  __takawebMongo?: MongoClient
}

/**
 * whether a takatime mongo is configured
 *
 * @returns {boolean} whether MONGO_URI is set
 */
export const hasMongo = (): boolean => !!MONGO_URI

/**
 * get the shared mongo client, connecting lazily on first use
 *
 * @returns {MongoClient} client
 */
function client(): MongoClient {
  if (!MONGO_URI) throw new Error("MONGO_URI is not set")

  return (globals.__takawebMongo ??= new MongoClient(MONGO_URI, {
    appName: "takaweb",
    serverSelectionTimeoutMS: 5000,
  }))
}

/**
 * get the takatime logs collection
 *
 * @returns {Collection<Document>} logs
 */
export const logs = (): Collection<Document> => client().db(DATABASE).collection(COLLECTION)
