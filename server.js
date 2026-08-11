// ─────────────────────────────────────────────────────────────
// Shreenath Gitanjali — Admin Backend (entry point)
// Loads env, connects to MySQL, then starts the Express app (src/app.js).
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import { app } from './src/app.js'
import { prisma } from './src/lib/prisma.js'

const PORT = process.env.PORT || 5000

// The log line below used to hard-code a database name, which drifted from
// whatever DATABASE_URL actually pointed at. Read it back from the URL instead.
function dbNameFromUrl(url) {
  try {
    return new URL(url).pathname.replace(/^\//, '') || 'unknown'
  } catch {
    return 'unknown'
  }
}

async function start() {
  try {
    await prisma.$connect()
    console.log(`✅ Connected to MySQL database: ${dbNameFromUrl(process.env.DATABASE_URL)}`)
    const server = app.listen(PORT, () => {
      console.log(`🚀 Backend running at http://localhost:${PORT}`)
      console.log(`   API base: http://localhost:${PORT}/api`)
    })

    // Node closes an idle keep-alive socket after 5s; browsers pool the same
    // socket for minutes and ignore the advertised timeout. If the panel sends
    // a request into that gap — e.g. the admin opens "Edit Part", types, and
    // clicks Save more than 5s after the last fetch — the socket is already
    // closing. The server can still read and run the request (the DB write
    // lands) while the response is lost, and the browser will not silently
    // retry a non-idempotent PATCH/POST/DELETE the way it retries a GET. The
    // panel then reports a failure for an edit that actually saved.
    // Keeping the server's idle window well above the client's closes the race.
    // 65s was NOT above the client's window — browsers pool an idle socket for
    // several minutes. Anything idle past 65s was already closed here while
    // Chrome still considered it usable, so the next write hit a dead socket and
    // surfaced in DevTools as a bogus "CORS error" on a request the server never
    // saw. Staying above the browser's pooling window closes the race for real.
    server.keepAliveTimeout = 310_000
    server.headersTimeout = 320_000 // must exceed keepAliveTimeout
  } catch (err) {
    console.error('❌ Failed to connect to the database.')
    console.error('   Check that XAMPP MySQL is running and DATABASE_URL is correct.')
    console.error('   Detail:', err.message)
    process.exit(1)
  }
}

start()

// Clean shutdown
process.on('SIGINT', async () => {
  await prisma.$disconnect()
  process.exit(0)
})
