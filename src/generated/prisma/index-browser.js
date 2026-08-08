
Object.defineProperty(exports, "__esModule", { value: true });

const {
  Decimal,
  objectEnumValues,
  makeStrictEnum,
  Public,
  getRuntime,
  skip
} = require('./runtime/index-browser.js')


const Prisma = {}

exports.Prisma = Prisma
exports.$Enums = {}

/**
 * Prisma Client JS version: 5.22.0
 * Query Engine version: 605197351a3c8bdd595af2d2a9bc3025bca48ea2
 */
Prisma.prismaVersion = {
  client: "5.22.0",
  engine: "605197351a3c8bdd595af2d2a9bc3025bca48ea2"
}

Prisma.PrismaClientKnownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientKnownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)};
Prisma.PrismaClientUnknownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientUnknownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientRustPanicError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientRustPanicError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientInitializationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientInitializationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientValidationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientValidationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.NotFoundError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`NotFoundError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.Decimal = Decimal

/**
 * Re-export of sql-template-tag
 */
Prisma.sql = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`sqltag is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.empty = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`empty is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.join = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`join is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.raw = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`raw is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.validator = Public.validator

/**
* Extensions
*/
Prisma.getExtensionContext = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.getExtensionContext is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.defineExtension = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.defineExtension is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}

/**
 * Shorthand utilities for JSON filtering
 */
Prisma.DbNull = objectEnumValues.instances.DbNull
Prisma.JsonNull = objectEnumValues.instances.JsonNull
Prisma.AnyNull = objectEnumValues.instances.AnyNull

Prisma.NullTypes = {
  DbNull: objectEnumValues.classes.DbNull,
  JsonNull: objectEnumValues.classes.JsonNull,
  AnyNull: objectEnumValues.classes.AnyNull
}



/**
 * Enums
 */

exports.Prisma.TransactionIsolationLevel = makeStrictEnum({
  ReadUncommitted: 'ReadUncommitted',
  ReadCommitted: 'ReadCommitted',
  RepeatableRead: 'RepeatableRead',
  Serializable: 'Serializable'
});

exports.Prisma.AdminScalarFieldEnum = {
  id: 'id',
  name: 'name',
  email: 'email',
  passwordHash: 'passwordHash',
  role: 'role',
  createdAt: 'createdAt'
};

exports.Prisma.ProductScalarFieldEnum = {
  id: 'id',
  code: 'code',
  name: 'name',
  shortName: 'shortName',
  price: 'price',
  active: 'active'
};

exports.Prisma.UserScalarFieldEnum = {
  id: 'id',
  name: 'name',
  phone: 'phone',
  city: 'city',
  status: 'status',
  registeredOn: 'registeredOn',
  lastLogin: 'lastLogin',
  createdAt: 'createdAt',
  email: 'email',
  address: 'address',
  otp: 'otp',
  isPaid: 'isPaid',
  donation: 'donation',
  donationAudio: 'donationAudio',
  amount: 'amount',
  part1: 'part1',
  part2: 'part2',
  upasanaPaid: 'upasanaPaid',
  nityaniyamPaid: 'nityaniyamPaid',
  updatedAt: 'updatedAt',
  updatedAt2: 'updatedAt2',
  token: 'token'
};

exports.Prisma.ContentScalarFieldEnum = {
  id: 'id',
  productId: 'productId',
  type: 'type',
  title: 'title',
  duration: 'duration',
  audioUrl: 'audioUrl',
  lyrics: 'lyrics',
  plays: 'plays',
  listeners: 'listeners',
  published: 'published',
  sortOrder: 'sortOrder'
};

exports.Prisma.UserAccessScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  productId: 'productId',
  source: 'source',
  duration: 'duration',
  grantedOn: 'grantedOn',
  expiresOn: 'expiresOn'
};

exports.Prisma.SaleScalarFieldEnum = {
  id: 'id',
  txnId: 'txnId',
  userId: 'userId',
  productId: 'productId',
  amount: 'amount',
  status: 'status',
  ref: 'ref',
  gateway: 'gateway',
  createdAt: 'createdAt'
};

exports.Prisma.NotificationScalarFieldEnum = {
  id: 'id',
  title: 'title',
  message: 'message',
  audience: 'audience',
  reach: 'reach',
  sentOn: 'sentOn'
};

exports.Prisma.BookScalarFieldEnum = {
  id: 'id',
  title: 'title',
  author: 'author',
  category: 'category',
  cover: 'cover',
  description: 'description',
  published: 'published',
  sortOrder: 'sortOrder'
};

exports.Prisma.ChapterScalarFieldEnum = {
  id: 'id',
  bookId: 'bookId',
  title: 'title',
  content: 'content',
  sortOrder: 'sortOrder'
};

exports.Prisma.AlbumScalarFieldEnum = {
  id: 'id',
  title: 'title',
  category: 'category',
  cover: 'cover',
  date: 'date',
  published: 'published'
};

exports.Prisma.PhotoScalarFieldEnum = {
  id: 'id',
  albumId: 'albumId',
  url: 'url',
  caption: 'caption',
  sortOrder: 'sortOrder'
};

exports.Prisma.PageScalarFieldEnum = {
  id: 'id',
  title: 'title',
  body: 'body',
  heroImage: 'heroImage',
  published: 'published',
  updatedOn: 'updatedOn'
};

exports.Prisma.SettingScalarFieldEnum = {
  key: 'key',
  value: 'value'
};

exports.Prisma.SiteSectionScalarFieldEnum = {
  key: 'key',
  data: 'data',
  updatedOn: 'updatedOn'
};

exports.Prisma.OtpChallengeScalarFieldEnum = {
  id: 'id',
  phone: 'phone',
  otp: 'otp',
  expiresAt: 'expiresAt',
  verifiedAt: 'verifiedAt',
  attempts: 'attempts',
  createdAt: 'createdAt'
};

exports.Prisma.SortOrder = {
  asc: 'asc',
  desc: 'desc'
};

exports.Prisma.NullsOrder = {
  first: 'first',
  last: 'last'
};
exports.UserStatus = exports.$Enums.UserStatus = {
  active: 'active',
  disabled: 'disabled'
};

exports.ContentType = exports.$Enums.ContentType = {
  audio: 'audio',
  text: 'text'
};

exports.AccessSource = exports.$Enums.AccessSource = {
  purchased: 'purchased',
  granted: 'granted'
};

exports.GrantDuration = exports.$Enums.GrantDuration = {
  d7: 'd7',
  d15: 'd15',
  perm: 'perm'
};

exports.SaleStatus = exports.$Enums.SaleStatus = {
  success: 'success',
  pending: 'pending',
  failed: 'failed'
};

exports.Prisma.ModelName = {
  Admin: 'Admin',
  Product: 'Product',
  User: 'User',
  Content: 'Content',
  UserAccess: 'UserAccess',
  Sale: 'Sale',
  Notification: 'Notification',
  Book: 'Book',
  Chapter: 'Chapter',
  Album: 'Album',
  Photo: 'Photo',
  Page: 'Page',
  Setting: 'Setting',
  SiteSection: 'SiteSection',
  OtpChallenge: 'OtpChallenge'
};

/**
 * This is a stub Prisma Client that will error at runtime if called.
 */
class PrismaClient {
  constructor() {
    return new Proxy(this, {
      get(target, prop) {
        let message
        const runtime = getRuntime()
        if (runtime.isEdge) {
          message = `PrismaClient is not configured to run in ${runtime.prettyName}. In order to run Prisma Client on edge runtime, either:
- Use Prisma Accelerate: https://pris.ly/d/accelerate
- Use Driver Adapters: https://pris.ly/d/driver-adapters
`;
        } else {
          message = 'PrismaClient is unable to run in this browser environment, or has been bundled for the browser (running in `' + runtime.prettyName + '`).'
        }
        
        message += `
If this is unexpected, please open an issue: https://pris.ly/prisma-prisma-bug-report`

        throw new Error(message)
      }
    })
  }
}

exports.PrismaClient = PrismaClient

Object.assign(exports, Prisma)
