-- ─────────────────────────────────────────────────────────────
-- Legacy production tables (from the original nathmand_db PHP app)
-- These are queried with raw SQL ($queryRawUnsafe) and are NOT part
-- of the Prisma schema, so `prisma migrate` never creates them.
--
-- Run this once against the local dev database to make the admin
-- backend work locally:
--
--   mysql -u root shreenath_admin < prisma/legacy-tables.sql
--
-- Column shapes mirror exactly what the controllers SELECT/INSERT.
-- ─────────────────────────────────────────────────────────────

-- ── contact (contacts.controller.js) ─────────────────────────
CREATE TABLE IF NOT EXISTS contact (
  id      INT AUTO_INCREMENT PRIMARY KEY,
  name    VARCHAR(255) DEFAULT NULL,
  email   VARCHAR(255) DEFAULT NULL,
  mobile  VARCHAR(50)  DEFAULT NULL,
  message TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── user_donation (donations.controller.js) ──────────────────
-- userID is CAST(... AS UNSIGNED) in the JOIN, so it is stored as text
-- like the source table.
CREATE TABLE IF NOT EXISTS user_donation (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  userID              VARCHAR(50)   DEFAULT NULL,
  mobile              VARCHAR(50)   DEFAULT NULL,
  donation_normal_amt VARCHAR(50)   DEFAULT NULL,
  createdAt           DATETIME      DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── user_payment — Razorpay (payments + mobile controller) ────
CREATE TABLE IF NOT EXISTS user_payment (
  id                      INT AUTO_INCREMENT PRIMARY KEY,
  user_id                 INT           DEFAULT NULL,
  package_id              INT           DEFAULT NULL,
  amount                  VARCHAR(50)   DEFAULT NULL,
  razorpay_order_id       VARCHAR(255)  DEFAULT NULL,
  razorpay_payment_id     VARCHAR(255)  DEFAULT NULL,
  razorpay_stageOfPayment VARCHAR(100)  DEFAULT NULL,
  payment_type            VARCHAR(100)  DEFAULT NULL,
  status                  VARCHAR(10)   DEFAULT '0',
  created_at              DATETIME      DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME      DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── userpayment — legacy Instamojo (payments + mobile) ────────
CREATE TABLE IF NOT EXISTS userpayment (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  userId             VARCHAR(50)   DEFAULT NULL,
  name               VARCHAR(255)  DEFAULT NULL,
  mobile             VARCHAR(50)   DEFAULT NULL,
  donation_for       VARCHAR(10)   DEFAULT '0',
  amt                VARCHAR(50)   DEFAULT NULL,
  order_id           VARCHAR(255)  DEFAULT NULL,
  payment_request_id VARCHAR(255)  DEFAULT NULL,
  transaction_id     VARCHAR(255)  DEFAULT NULL,
  payment_status     VARCHAR(100)  DEFAULT NULL,
  createAt           DATETIME      DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── login_user (logins + mobile controller) ──────────────────
-- Original table is latin1 charset. The logins controller CASTs mobile to
-- CHAR to avoid a cross-charset JOIN with the utf8mb4 users table.
CREATE TABLE IF NOT EXISTS login_user (
  login_user_id INT AUTO_INCREMENT PRIMARY KEY,
  mobile        VARCHAR(50)  DEFAULT NULL,
  device_id     VARCHAR(255) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1;
