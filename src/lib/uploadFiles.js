// ─────────────────────────────────────────────────────────────
// Deleting an upload when the row that used it is gone.
//
// Replacing a song's audio or removing a photo only ever changed the database
// row; the file stayed in uploads/ forever. Every re-upload left the old file
// behind, and nothing ever pointed at it again.
//
// The rule here is "delete only what nothing references". The same path can be
// stored in more than one row — an album cover is usually also one of its
// photos — so a blind unlink would break a page that is still using the file.
// ─────────────────────────────────────────────────────────────
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { prisma } from './prisma.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const UPLOADS = path.join(ROOT, 'uploads')

// Is this a file we manage? A pasted external URL is somebody else's, and
// anything outside uploads/ is not ours to delete.
function localPath(ref) {
  if (!ref || typeof ref !== 'string') return null
  if (/^https?:\/\//i.test(ref)) return null

  // Stored paths are percent-encoded ("01%20JAY.mp3"), the same form
  // express.static decodes when serving them.
  let rel
  try {
    rel = decodeURIComponent(ref.replace(/^\/+/, ''))
  } catch {
    return null
  }
  if (!rel.startsWith('uploads/')) return null

  const full = path.resolve(ROOT, rel)
  // Refuse anything that escapes uploads/ — a stored "../../server.js" must
  // never be deletable through this.
  if (full !== UPLOADS && !full.startsWith(UPLOADS + path.sep)) return null
  return full
}

// How many rows still point at this path, ignoring the one being replaced.
async function referenceCount(ref, ignore = {}) {
  const [albums, photos, content, books, pages] = await Promise.all([
    prisma.album.count({ where: { cover: ref, ...(ignore.albumId ? { NOT: { id: ignore.albumId } } : {}) } }),
    prisma.photo.count({ where: { url: ref, ...(ignore.photoId ? { NOT: { id: ignore.photoId } } : {}) } }),
    prisma.content.count({ where: { audioUrl: ref, ...(ignore.contentId ? { NOT: { id: ignore.contentId } } : {}) } }),
    prisma.book.count({ where: { cover: ref, ...(ignore.bookId ? { NOT: { id: ignore.bookId } } : {}) } }),
    prisma.page.count({ where: { heroImage: ref, ...(ignore.pageId ? { NOT: { id: ignore.pageId } } : {}) } }),
  ])
  return albums + photos + content + books + pages
}

/**
 * Delete an uploaded file, but only when nothing references it any more.
 *
 * Call it AFTER the row has been updated or deleted, so the database already
 * reflects the new state. `ignore` lets a caller discount a row it is about to
 * change, for the case where the update has not been written yet.
 *
 * Never throws: a failed cleanup must not fail the request the admin made.
 * Returns true when a file was actually removed.
 */
export async function removeUploadIfUnused(ref, ignore = {}) {
  const full = localPath(ref)
  if (!full) return false

  try {
    if (await referenceCount(ref, ignore)) return false
    await fs.unlink(full)
    return true
  } catch (err) {
    // ENOENT is the normal case for a path that was already gone.
    if (err.code !== 'ENOENT') {
      console.error(`⚠️  could not delete ${ref}: ${err.message}`)
    }
    return false
  }
}

/** The same, for a list — used when a row that held several files is deleted. */
export async function removeUploadsIfUnused(refs = [], ignore = {}) {
  let removed = 0
  for (const ref of refs) if (await removeUploadIfUnused(ref, ignore)) removed++
  return removed
}
