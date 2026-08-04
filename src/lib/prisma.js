// A single shared PrismaClient instance for the whole app.
// The client is generated into src/generated/prisma and committed to the repo,
// so deploys never need to run `prisma generate` on the (memory-limited) host.
import pkg from '../generated/prisma/index.js'
const { PrismaClient } = pkg

export const prisma = new PrismaClient()
