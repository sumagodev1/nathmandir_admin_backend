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
    app.listen(PORT, () => {
      console.log(`🚀 Backend running at http://localhost:${PORT}`)
      console.log(`   API base: http://localhost:${PORT}/api`)
    })
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
