// ─────────────────────────────────────────────────────────────
// Shreenath Gitanjali — Admin Backend (entry point)
// Loads env, connects to MySQL, then starts the Express app (src/app.js).
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import { app } from './src/app.js'
import { prisma } from './src/lib/prisma.js'

const PORT = process.env.PORT || 5000

async function start() {
  try {
    await prisma.$connect()
    console.log('✅ Connected to MySQL database: shreenath_admin')
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
    server.keepAliveTimeout = 65_000
    server.headersTimeout = 66_000 // must exceed keepAliveTimeout
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
