// ─────────────────────────────────────────────────────────────
// Seed script — fills the database with the admin panel's demo data.
// Mirrors src/data/adminData.js so the API returns the same content
// the UI already knows. Safe to re-run: it clears tables first.
//
// Run with:  npm run see
// ─────────────────────────────────────────────────────────────
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

// ── Source data (kept in sync with the frontend mock) ─────────
const PRODUCTS = [
  { id: 'gita1', name: 'Gitanjali Part 1', shortName: 'Part 1', price: 251 },
  { id: 'gita2', name: 'Gitanjali Part 2', shortName: 'Part 2', price: 251 },
  { id: 'upasana', name: 'Upasana Part', shortName: 'Upasana', price: 151 },
  { id: 'nithya', name: 'Nityaniyam Part', shortName: 'Nityaniyam', price: 251 },
]

const USERS = [
  { key: 'U1001', name: 'Ramesh Kulkarni', phone: '+91 93702 02211', city: 'Nashik', registeredOn: '2025-11-02', lastLogin: '2026-06-20', status: 'active', access: ['gita1', 'gita2'] },
  { key: 'U1002', name: 'Sunita Deshpande', phone: '+91 95454 54443', city: 'Pune', registeredOn: '2025-11-14', lastLogin: '2026-06-19', status: 'active', access: ['gita1'] },
  { key: 'U1003', name: 'Anil Joshi', phone: '+91 98220 11234', city: 'Mumbai', registeredOn: '2025-12-01', lastLogin: '2026-06-15', status: 'active', access: ['gita1', 'gita2'] },
  { key: 'U1004', name: 'Meena Pawar', phone: '+91 90110 55678', city: 'Nashik', registeredOn: '2025-12-09', lastLogin: '2026-05-30', status: 'active', access: ['upasana'] },
  { key: 'U1005', name: 'Vijay Patil', phone: '+91 97654 33210', city: 'Nagpur', registeredOn: '2026-01-05', lastLogin: '2026-06-21', status: 'active', access: ['gita1', 'gita2', 'upasana', 'nithya'] },
  { key: 'U1006', name: 'Shubhangi Rao', phone: '+91 99876 12345', city: 'Aurangabad', registeredOn: '2026-01-18', lastLogin: '2026-04-12', status: 'disabled', access: [] },
  { key: 'U1007', name: 'Prakash Shinde', phone: '+91 93456 78901', city: 'Thane', registeredOn: '2026-02-02', lastLogin: '2026-06-18', status: 'active', access: ['gita1'] },
  { key: 'U1008', name: 'Lata Gokhale', phone: '+91 91234 56780', city: 'Pune', registeredOn: '2026-02-21', lastLogin: '2026-06-11', status: 'active', access: ['gita2', 'upasana'] },
  { key: 'U1009', name: 'Dattatray More', phone: '+91 90909 80808', city: 'Nashik', registeredOn: '2026-03-10', lastLogin: '2026-06-20', status: 'active', access: ['gita1', 'upasana'] },
  { key: 'U1010', name: 'Kavita Bhosale', phone: '+91 98989 70707', city: 'Mumbai', registeredOn: '2026-03-27', lastLogin: '2026-06-09', status: 'active', access: ['gita1'] },
  { key: 'U1011', name: 'Sanjay Kale', phone: '+91 97777 60606', city: 'Nagpur', registeredOn: '2026-04-14', lastLogin: '2026-06-17', status: 'active', access: [] },
  { key: 'U1012', name: 'Asha Naik', phone: '+91 96666 50505', city: 'Nashik', registeredOn: '2026-05-03', lastLogin: '2026-06-21', status: 'active', access: ['gita1', 'gita2', 'upasana', 'nithya'] },
  { key: 'U1013', name: 'Girish Apte', phone: '+91 95555 40404', city: 'Thane', registeredOn: '2026-05-22', lastLogin: '2026-06-08', status: 'active', access: ['upasana', 'nithya'] },
  { key: 'U1014', name: 'Rohini Sawant', phone: '+91 94444 30303', city: 'Pune', registeredOn: '2026-06-10', lastLogin: '2026-06-21', status: 'active', access: ['gita2'] },
]

const CONTENT = [
  { product: 'gita1', type: 'audio', title: 'Mangalacharan', duration: 312, plays: 1840, listeners: 920, published: true, sortOrder: 1 },
  { product: 'gita1', type: 'audio', title: 'Aarti — Sukhkarta Dukhharta', duration: 248, plays: 2615, listeners: 1240, published: true, sortOrder: 2 },
  { product: 'gita1', type: 'text', title: 'Gitanjali Part 1 — Lyrics', duration: 0, plays: 980, listeners: 610, published: true, sortOrder: 3 },
  { product: 'gita1', type: 'audio', title: 'Bhajan — Naam Smaran', duration: 405, plays: 1320, listeners: 740, published: false, sortOrder: 4 },
  { product: 'gita2', type: 'audio', title: 'Pratah Smaran', duration: 290, plays: 1105, listeners: 560, published: true, sortOrder: 1 },
  { product: 'gita2', type: 'audio', title: 'Abhang — Vitthal Naam', duration: 372, plays: 1990, listeners: 880, published: true, sortOrder: 2 },
  { product: 'gita2', type: 'text', title: 'Gitanjali Part 2 — Lyrics', duration: 0, plays: 720, listeners: 430, published: true, sortOrder: 3 },
  { product: 'upasana', type: 'audio', title: 'Upasana — Morning Chant', duration: 540, plays: 860, listeners: 470, published: true, sortOrder: 1 },
  { product: 'upasana', type: 'audio', title: 'Upasana — Evening Aarti', duration: 318, plays: 1430, listeners: 690, published: true, sortOrder: 2 },
  { product: 'upasana', type: 'text', title: 'Upasana — Path & Meaning', duration: 0, plays: 540, listeners: 300, published: true, sortOrder: 3 },
  { product: 'nithya', type: 'audio', title: 'Nityaniyam — Kakad Aarti', duration: 366, plays: 990, listeners: 520, published: true, sortOrder: 1 },
  { product: 'nithya', type: 'audio', title: 'Nityaniyam — Dhoop Aarti', duration: 284, plays: 760, listeners: 410, published: true, sortOrder: 2 },
  { product: 'nithya', type: 'text', title: 'Nityaniyam — Daily Path & Niyam', duration: 0, plays: 430, listeners: 250, published: true, sortOrder: 3 },
]

const SALES = [
  { txnId: 'TXN90001', user: 'U1001', product: 'gita1', amount: 251, date: '2026-03-15', ref: 'pay_Rx20sAqB7' },
  { txnId: 'TXN90002', user: 'U1001', product: 'gita2', amount: 251, date: '2026-04-03', ref: 'pay_Rx33wEoD9' },
  { txnId: 'TXN90003', user: 'U1002', product: 'gita1', amount: 251, date: '2026-04-22', ref: 'pay_Rx41kJlP5' },
  { txnId: 'TXN90004', user: 'U1004', product: 'upasana', amount: 151, date: '2026-05-09', ref: 'pay_Rx49cFhM2' },
  { txnId: 'TXN90005', user: 'U1007', product: 'gita1', amount: 251, date: '2026-05-20', ref: 'pay_Rx55tUbN6' },
  { txnId: 'TXN90006', user: 'U1003', product: 'gita2', amount: 251, date: '2026-05-28', ref: 'pay_Rx60pYxV3' },
  { txnId: 'TXN90007', user: 'U1008', product: 'upasana', amount: 151, date: '2026-06-05', ref: 'pay_Rx66nDsK8' },
  { txnId: 'TXN90008', user: 'U1010', product: 'gita1', amount: 251, date: '2026-06-12', ref: 'pay_Rx70mQrT1' },
  { txnId: 'TXN90009', user: 'U1005', product: 'gita2', amount: 251, date: '2026-06-16', ref: 'pay_Rx77aWpL9' },
  { txnId: 'TXN90010', user: 'U1009', product: 'upasana', amount: 151, date: '2026-06-18', ref: 'pay_Rx80hGtZ4' },
  { txnId: 'TXN90011', user: 'U1014', product: 'gita2', amount: 251, date: '2026-06-20', ref: 'pay_Rx88vBnQ7' },
  { txnId: 'TXN90012', user: 'U1012', product: 'gita1', amount: 251, date: '2026-06-21', ref: 'pay_Rx91kLmA2' },
  { txnId: 'TXN90013', user: 'U1013', product: 'nithya', amount: 251, date: '2026-06-11', ref: 'pay_Rx85kWqN2' },
  { txnId: 'TXN90014', user: 'U1012', product: 'nithya', amount: 251, date: '2026-06-19', ref: 'pay_Rx93bTmL8' },
  { txnId: 'TXN90015', user: 'U1005', product: 'nithya', amount: 251, date: '2026-06-22', ref: 'pay_Rx95nHkP3' },
]

const NOTIFICATIONS = [
  { title: 'Welcome to Shreenath Gitanjali', message: 'Thank you for joining our devotional family.', audience: 'all', sentOn: '2026-04-10' },
  { title: 'App Update Available', message: 'Please update for a smoother experience.', audience: 'all', sentOn: '2026-05-01' },
  { title: 'Upasana — Evening Aarti added', message: 'New content available in Upasana Part.', audience: 'upasana', sentOn: '2026-05-19' },
  { title: 'New Audio: Abhang — Vitthal Naam', message: 'A new bhajan has been added to Gitanjali Part 2.', audience: 'gita2', sentOn: '2026-06-02' },
  { title: 'Datta Jayanti Greetings', message: 'Wishing all devotees a blessed Datta Jayanti.', audience: 'all', sentOn: '2026-06-14' },
]

const BOOKS = [
  {
    title: 'गीतांजली', author: 'श्री माधवनाथ महाराज', category: 'granth', published: true,
    description: 'श्री माधवनाथ महाराजांचा भक्तीपर काव्यसंग्रह.',
    chapters: [
      { title: 'प्रकरण १ — मंगलाचरण', content: 'मंगलाचरणाचा मजकूर येथे लिहा…' },
      { title: 'प्रकरण २ — स्तुती', content: 'स्तुतीपर रचना येथे लिहा…' },
    ],
  },
  {
    title: 'दीपप्रकाश ग्रंथ', author: '', category: 'granth', published: true,
    description: 'दीपप्रकाश ग्रंथाची माहिती व मजकूर.',
    chapters: [{ title: 'अध्याय १', content: 'अध्याय १ चा मजकूर येथे लिहा…' }],
  },
  {
    title: 'नाथ संजीवनी', author: '', category: 'granth', published: false,
    description: 'नाथ संजीवनी ग्रंथ.',
    chapters: [],
  },
]

const ALBUMS = [
  {
    title: 'श्री माधवनाथ महाराज', category: 'maharaj', date: '2025-12-01', published: true,
    cover: 'https://images.unsplash.com/photo-1604881991720-f91add269bed?w=800&q=70',
    photos: [
      { url: 'https://images.unsplash.com/photo-1604881991720-f91add269bed?w=800&q=70', caption: 'महाराजांची मूर्ती' },
      { url: 'https://images.unsplash.com/photo-1567427017947-545c5f8d16ad?w=800&q=70', caption: 'गाभारा दर्शन' },
    ],
  },
  {
    title: 'दत्तजयंती उत्सव', category: 'events', date: '2025-12-14', published: true,
    cover: 'https://images.unsplash.com/photo-1542810634-71277d95dcbb?w=800&q=70',
    photos: [
      { url: 'https://images.unsplash.com/photo-1542810634-71277d95dcbb?w=800&q=70', caption: 'महाआरती' },
      { url: 'https://images.unsplash.com/photo-1530021232320-687d8e3dba54?w=800&q=70', caption: 'भक्तगण' },
      { url: 'https://images.unsplash.com/photo-1514222134-b57cbb8ce073?w=800&q=70', caption: 'दीपोत्सव' },
    ],
  },
]

const PAGES = [
  { title: 'नाथांबद्दल', published: true, body: 'श्री माधवनाथ महाराज यांचे जीवनकार्य, अधिकार व शिकवण याबद्दलची माहिती येथे लिहा.\n\n(हा मजकूर संपादित करा आणि Save दाबा — तो अ‍ॅपमध्ये भक्तांना दिसेल.)' },
  { title: 'मंदिराचा इतिहास व बांधकाम', published: true, body: 'मंदिराची स्थापना, इतिहास आणि बांधकामाची माहिती येथे लिहा.\n\nस्थळ: श्री माधवनाथ मंदिर, विहितगाव, नाशिक रोड, नाशिक.' },
  { title: 'मूर्तीचे स्वरूप, वर्णन, वैशिष्ट्ये', published: true, body: 'मूर्तीचे स्वरूप, वर्णन व वैशिष्ट्ये याबद्दलची माहिती येथे लिहा.' },
  { title: 'नूतनीकरण', published: false, body: 'मंदिर नूतनीकरणाची माहिती, टप्पे व योगदान याबद्दल येथे लिहा.' },
]

const SETTINGS = [
  { key: 'doc.about', value: '' },
  { key: 'doc.terms', value: '' },
  { key: 'doc.privacy', value: '' },
  { key: 'pref.alert.newUser', value: 'true' },
  { key: 'pref.alert.newSale', value: 'true' },
  { key: 'pref.alert.userToggle', value: 'false' },
  { key: 'pref.alert.contentToggle', value: 'false' },
]

// ── Seed routine ──────────────────────────────────────────────
async function main() {
  console.log('🌱 Seeding shreenath_admin …')

  // 1. Clear existing rows (children first to respect FKs)
  await prisma.userAccess.deleteMany()
  await prisma.sale.deleteMany()
  await prisma.content.deleteMany()
  await prisma.photo.deleteMany()
  await prisma.album.deleteMany()
  await prisma.chapter.deleteMany()
  await prisma.book.deleteMany()
  await prisma.notification.deleteMany()
  await prisma.page.deleteMany()
  await prisma.setting.deleteMany()
  await prisma.user.deleteMany()
  await prisma.product.deleteMany()
  await prisma.admin.deleteMany()

  // 2. Products
  for (const p of PRODUCTS) {
    await prisma.product.create({ data: p })
  }
  console.log(`  ✓ ${PRODUCTS.length} products`)

  // 3. Admin login (hashed password)
  const passwordHash = await bcrypt.hash('admin123', 10)
  await prisma.admin.create({
    data: { name: 'Super Admin', email: 'admin@gitanjali.app', passwordHash, role: 'super_admin' },
  })
  console.log('  ✓ 1 admin (admin@gitanjali.app / admin123)')

  // 4. Users — keep a map of demo key → real DB id
  const userId = {}
  for (const u of USERS) {
    const created = await prisma.user.create({
      data: {
        name: u.name, phone: u.phone, city: u.city, status: u.status,
        registeredOn: new Date(u.registeredOn), lastLogin: new Date(u.lastLogin),
      },
    })
    userId[u.key] = created.id
  }
  console.log(`  ✓ ${USERS.length} users`)

  // 5. Content
  for (const c of CONTENT) {
    await prisma.content.create({
      data: {
        productId: c.product, type: c.type, title: c.title, duration: c.duration,
        plays: c.plays, listeners: c.listeners, published: c.published, sortOrder: c.sortOrder,
      },
    })
  }
  console.log(`  ✓ ${CONTENT.length} content items`)

  // 6. Sales
  const purchased = new Set() // "userKey:product" pairs that have a real purchase
  for (const s of SALES) {
    await prisma.sale.create({
      data: {
        txnId: s.txnId, userId: userId[s.user], productId: s.product,
        amount: s.amount, ref: s.ref, status: 'success', gateway: 'razorpay',
        createdAt: new Date(s.date),
      },
    })
    purchased.add(`${s.user}:${s.product}`)
  }
  console.log(`  ✓ ${SALES.length} sales`)

  // 7. User access — purchased if a sale exists, otherwise a manual grant
  let accessCount = 0
  for (const u of USERS) {
    for (const pid of u.access) {
      const isPurchased = purchased.has(`${u.key}:${pid}`)
      await prisma.userAccess.create({
        data: {
          userId: userId[u.key], productId: pid,
          source: isPurchased ? 'purchased' : 'granted',
          duration: isPurchased ? null : 'perm',
          expiresOn: null,
        },
      })
      accessCount++
    }
  }
  console.log(`  ✓ ${accessCount} access records`)

  // 8. Notifications
  for (const n of NOTIFICATIONS) {
    await prisma.notification.create({
      data: { title: n.title, message: n.message, audience: n.audience, sentOn: new Date(n.sentOn) },
    })
  }
  console.log(`  ✓ ${NOTIFICATIONS.length} notifications`)

  // 9. Books + chapters
  for (const b of BOOKS) {
    await prisma.book.create({
      data: {
        title: b.title, author: b.author, category: b.category,
        description: b.description, published: b.published,
        chapters: {
          create: b.chapters.map((ch, i) => ({ title: ch.title, content: ch.content, sortOrder: i + 1 })),
        },
      },
    })
  }
  console.log(`  ✓ ${BOOKS.length} books`)

  // 10. Albums + photos
  for (const a of ALBUMS) {
    await prisma.album.create({
      data: {
        title: a.title, category: a.category, cover: a.cover,
        date: new Date(a.date), published: a.published,
        photos: {
          create: a.photos.map((p, i) => ({ url: p.url, caption: p.caption, sortOrder: i + 1 })),
        },
      },
    })
  }
  console.log(`  ✓ ${ALBUMS.length} albums`)

  // 11. Pages
  for (const pg of PAGES) {
    await prisma.page.create({
      data: { title: pg.title, body: pg.body, published: pg.published },
    })
  }
  console.log(`  ✓ ${PAGES.length} pages`)

  // 12. Settings
  for (const s of SETTINGS) {
    await prisma.setting.create({ data: s })
  }
  console.log(`  ✓ ${SETTINGS.length} settings`)

  console.log('✅ Seeding complete!')
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
