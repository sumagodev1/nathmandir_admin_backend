import 'dotenv/config'
import { prisma } from './src/lib/prisma.js'
const mine = await prisma.user.findMany({ select: { id: true, name: true, phone: true } })
console.log('in `users`:', JSON.stringify(mine))
const clash = await prisma.$queryRawUnsafe('SELECT id, name, mobile FROM `user` WHERE id IN (?)', mine[0].id)
console.log('legacy row with that same id:', JSON.stringify(clash, (k,v)=>typeof v==='bigint'?Number(v):v))
const max = await prisma.$queryRawUnsafe('SELECT MAX(id) AS m FROM `user`')
console.log('legacy max id:', Number(max[0].m))
const dupPhone = await prisma.$queryRawUnsafe('SELECT id, name, mobile FROM `user` WHERE mobile = ?', mine[0].phone)
console.log('legacy rows with Sakshi phone:', JSON.stringify(dupPhone, (k,v)=>typeof v==='bigint'?Number(v):v))
await prisma.$disconnect()
