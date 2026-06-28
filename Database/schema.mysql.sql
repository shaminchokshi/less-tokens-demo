-- =============================================================================
-- less-tokens — database schema  (MySQL 8.0+)
-- =============================================================================
-- Run once against a fresh database:
--     mysql -u USER -p DBNAME < schema.mysql.sql
--
-- Requires MySQL 8.0.16+ (CHECK constraints, window functions, EVENT scheduler).
--
-- Price lives in ONE place: the `pricing` table. Each price change is a new
-- effective-dated row, so you get history. Billing charges whatever price is
-- effective on the run date; already-written sales keep their original amount.
-- To raise the price to 2.00, you INSERT one row (see the bottom of this file) --
-- no code edit, and every upcoming month reflects the new price.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- pricing  (single source of truth for the subscription price)
-- -----------------------------------------------------------------------------
-- One row per price, per product, with the moment it takes effect. The "current"
-- price for a date is the latest row whose effective_from <= that date.

CREATE TABLE IF NOT EXISTS pricing (
    id              BIGINT        NOT NULL AUTO_INCREMENT,
    product_code    VARCHAR(40)   NOT NULL DEFAULT 'extension',
    amount          DECIMAL(10,2) NOT NULL,
    effective_from  DATETIME      NOT NULL,
    created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY pricing_lookup_idx (product_code, effective_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Seed the starting price once (idempotent -- safe to re-run this script).
INSERT INTO pricing (product_code, amount, effective_from)
SELECT 'extension', 1.49, '2026-01-01 00:00:00' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM pricing WHERE product_code = 'extension');

-- Convenience view: the price effective right now, per product. The app reads
-- this for display and for the first charge at subscribe time.
CREATE OR REPLACE VIEW current_pricing AS
SELECT product_code, pricing_id, amount, effective_from
FROM (
    SELECT id AS pricing_id, product_code, amount, effective_from,
           ROW_NUMBER() OVER (
               PARTITION BY product_code
               ORDER BY effective_from DESC, id DESC
           ) AS rn
    FROM pricing
    WHERE effective_from <= NOW()
) t
WHERE rn = 1;

-- -----------------------------------------------------------------------------
-- users
-- -----------------------------------------------------------------------------
-- One row per account. Anyone can sign up; extension access is gated by
-- extension_access_flag, which only flips to 1 while a subscription is live.
--
-- "Password" is stored as a bcrypt HASH (column password_hash), never plaintext.
-- email is UNIQUE and case-insensitive (utf8mb4_0900_ai_ci is a CI collation),
-- so Bob@x.com and bob@x.com collide as intended.
CREATE TABLE IF NOT EXISTS users (
    id                          BIGINT       NOT NULL AUTO_INCREMENT,

    first_name                  VARCHAR(120) NOT NULL,
    last_name                   VARCHAR(120) NOT NULL,
    email                       VARCHAR(255) NOT NULL,
    phone                       VARCHAR(32)  NULL,
    password_hash               VARCHAR(255) NOT NULL,   -- bcrypt, never plaintext

    user_create_date            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- extension access / subscription state ----------------------------------
    extension_access_flag       TINYINT      NOT NULL DEFAULT 0,
    -- The anchor day for recurring billing. NULL whenever the flag is 0.
    extension_subscription_date DATE         NULL,

    -- email verification ------------------------------------------------------
    is_email_verified           BOOLEAN      NOT NULL DEFAULT FALSE,

    PRIMARY KEY (id),
    UNIQUE KEY users_email_key (email),

    CONSTRAINT users_flag_chk CHECK (extension_access_flag IN (0, 1)),

    -- Keep flag and date consistent: subscribed (1) needs a date; unsubscribed
    -- (0) must have none.
    CONSTRAINT users_subscription_consistent CHECK (
        (extension_access_flag = 1 AND extension_subscription_date IS NOT NULL)
     OR (extension_access_flag = 0 AND extension_subscription_date IS NULL)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- email_verification_tokens
-- -----------------------------------------------------------------------------
-- One row per verification link sent. Re-sending adds another row; old ones
-- expire. Verifying marks the user verified and stamps used_at.
CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id          BIGINT       NOT NULL AUTO_INCREMENT,
    user_id     BIGINT       NOT NULL,
    token       VARCHAR(255) NOT NULL,
    expires_at  DATETIME     NOT NULL,
    used_at     DATETIME     NULL,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY evt_token_key (token),
    KEY evt_user_idx (user_id),
    CONSTRAINT evt_user_fk FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- sales
-- -----------------------------------------------------------------------------
-- One row per charge. A row lands on the subscription anniversary each month
-- while the flag is 1. (user_id, billing_period) is UNIQUE, so the daily job is
-- safe to run repeatedly and can never double-charge within a month.
--
-- amount is captured at charge time (never a hardcoded literal); pricing_id
-- records exactly which price row produced it, for a clean audit trail.
CREATE TABLE IF NOT EXISTS sales (
    id              BIGINT        NOT NULL AUTO_INCREMENT,
    user_id         BIGINT        NOT NULL,
    amount          DECIMAL(10,2) NOT NULL,
    pricing_id      BIGINT        NULL,
    sale_date       DATE          NOT NULL,
    billing_period  VARCHAR(7)    NOT NULL,         -- e.g. '2026-06'
    created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY sales_one_per_month (user_id, billing_period),
    KEY sales_user_idx (user_id),
    KEY sales_date_idx (sale_date),
    CONSTRAINT sales_user_fk FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT sales_pricing_fk FOREIGN KEY (pricing_id)
        REFERENCES pricing (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================================
-- Recurring billing
-- =============================================================================
-- process_monthly_billing(run_date) inserts a sale for every subscribed user
-- whose billing day falls on run_date and who hasn't been charged this month.
-- Pass NULL to bill for today. SELECTs the number of sales created.
--
-- The charged amount is the price effective ON run_date (looked up from
-- pricing), so a price change flows to all upcoming charges automatically.
--
-- Month-end clamping: someone who subscribed on the 31st is billed on the last
-- day of any shorter month (28th Feb, 30th Apr, ...). LAST_DAY() does the work.
-- INSERT IGNORE skips rows that already exist for (user_id, billing_period).
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS process_monthly_billing;

CREATE PROCEDURE process_monthly_billing()
INSERT IGNORE INTO sales (user_id, amount, pricing_id, sale_date, billing_period)
SELECT u.id, p.amount, p.pricing_id, CURDATE(), DATE_FORMAT(CURDATE(), '%Y-%m')
FROM users u
JOIN current_pricing p ON p.product_code = 'extension'
WHERE u.extension_access_flag = 1
  AND u.extension_subscription_date IS NOT NULL
  AND CURDATE() >= u.extension_subscription_date
  AND (
        DAY(CURDATE()) = DAY(u.extension_subscription_date)
        OR (
             DAY(u.extension_subscription_date) > DAY(LAST_DAY(CURDATE()))
             AND DAY(CURDATE()) = DAY(LAST_DAY(CURDATE()))
           )
      );
-- =============================================================================
-- Scheduling the daily run
-- =============================================================================
-- Option A -- MySQL EVENT scheduler (native). Turn the scheduler on, then create
-- a daily event. (event_scheduler can also be set in my.cnf.)
--
--     SET GLOBAL event_scheduler = ON;
--
--     DROP EVENT IF EXISTS daily_billing;
--     CREATE EVENT daily_billing
--         ON SCHEDULE EVERY 1 DAY
--         STARTS (CURRENT_DATE + INTERVAL 1 DAY + INTERVAL 5 MINUTE)
--         DO CALL process_monthly_billing(NULL);
--
-- Option B -- external cron (Railway cron, GitHub Actions, etc.):
--     CALL process_monthly_billing(NULL);
-- once per day, e.g. via your app's POST /billing/run.

-- =============================================================================
-- Changing the price
-- =============================================================================
-- Insert a new effective-dated row. From effective_from onward, every monthly
-- charge uses it; past sales are untouched. Example -- go to $2.00 starting
-- 1 Jul 2026:
--
--     INSERT INTO pricing (product_code, amount, effective_from)
--     VALUES ('extension', 2.00, '2026-07-01 00:00:00');
--
-- Read the live price in your app with:  SELECT amount FROM current_pricing
--                                         WHERE product_code = 'extension';
-- (Point the backend's first-charge-at-subscribe at this view too, so the table
--  is the only place the price is ever defined.)
-- =============================================================================