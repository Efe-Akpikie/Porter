import bcrypt from "bcryptjs";
import type { PoolConnection as CorePoolConnection } from "mysql2";
import mysql, {
  type PoolConnection,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import {
  assertTimeZone,
  weekdayForDate,
  zonedDateKey,
  zonedDateTimeToUtc,
} from "./timezone";

export const ADMIN_TIMEZONE = assertTimeZone(
  process.env.ADMIN_TIMEZONE ?? "America/Vancouver",
);

function databaseConfig() {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    throw new Error(
      "DATABASE_URL is required. Expected a MySQL URL such as mysql://user:password@host:3306/database.",
    );
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL.");
  }
  if (url.protocol !== "mysql:" && url.protocol !== "mysql2:") {
    throw new Error("DATABASE_URL must use the mysql:// protocol.");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!url.hostname || !url.username || !database) {
    throw new Error(
      "DATABASE_URL must include a host, username, and database.",
    );
  }

  const rawLimit = process.env.DB_CONNECTION_LIMIT ?? "5";
  const connectionLimit = Number(rawLimit);
  if (!Number.isInteger(connectionLimit) || connectionLimit < 1) {
    throw new Error(
      `DB_CONNECTION_LIMIT must be a positive integer, got "${rawLimit}".`,
    );
  }

  const rawCa = process.env.MYSQL_CA_CERT;
  const ca = rawCa?.replace(/\\n/g, "\n");

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    connectionLimit,
    waitForConnections: true,
    queueLimit: 0,
    timezone: "Z",
    charset: "utf8mb4",
    ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: true },
    typeCast(
      field: { type: string; string(): string | null },
      next: () => unknown,
    ) {
      if (field.type === "DATETIME" || field.type === "TIMESTAMP") {
        const value = field.string();
        return value
          ? new Date(`${value.replace(" ", "T")}Z`).toISOString()
          : null;
      }
      return next();
    },
  };
}

export const pool = mysql.createPool(databaseConfig());
pool.on("connection", (connection) => {
  const coreConnection = connection as unknown as CorePoolConnection;
  // Queue this before the connection can serve application work so SQL
  // functions and TIMESTAMP values consistently use UTC.
  void coreConnection
    .promise()
    .query("SET time_zone = '+00:00'")
    .catch(() => coreConnection.destroy());
});

const isoDate = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
function sqlParams(params: readonly unknown[]) {
  return params.map((value) =>
    typeof value === "string" && isoDate.test(value)
      ? value.replace("T", " ").replace("Z", "")
      : value,
  );
}

export type Executor = Pick<PoolConnection, "execute" | "query">;

export async function query<T extends RowDataPacket[]>(
  sql: string,
  params: readonly unknown[] = [],
  executor: Executor = pool,
) {
  const [rows] = await executor.execute<T>(sql, sqlParams(params) as never[]);
  return rows;
}

export async function one<T extends RowDataPacket>(
  sql: string,
  params: readonly unknown[] = [],
  executor: Executor = pool,
) {
  const rows = await query<T[]>(sql, params, executor);
  return rows[0];
}

export async function execute(
  sql: string,
  params: readonly unknown[] = [],
  executor: Executor = pool,
) {
  const [result] = await executor.execute<ResultSetHeader>(
    sql,
    sqlParams(params) as never[],
  );
  return result;
}

export async function transaction<T>(
  work: (connection: PoolConnection) => Promise<T>,
) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

const migrations = [
  `CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(320) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('client', 'admin') NOT NULL,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NULL,
    timezone VARCHAR(100) NOT NULL,
    notes TEXT NULL,
    email_verified_at DATETIME(3) NULL,
    pending_email VARCHAR(320) NULL,
    consultation_used_at DATETIME(3) NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_users_role_name (role, name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    token CHAR(36) NOT NULL UNIQUE,
    user_id BIGINT UNSIGNED NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    last_activity_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_sessions_expiry (expires_at),
    INDEX idx_sessions_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS appointments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    client_id BIGINT UNSIGNED NOT NULL,
    start_time DATETIME(3) NOT NULL,
    end_time DATETIME(3) NOT NULL,
    service_type ENUM('consultation', 'couples', 'individual', 'child_teen', 'christian_counseling') NOT NULL,
    duration_min SMALLINT UNSIGNED NOT NULL,
    status ENUM('pending_payment', 'pending', 'confirmed', 'completed', 'cancelled', 'no_show') NOT NULL DEFAULT 'confirmed',
    notes TEXT NULL,
    amount_cents INT UNSIGNED NULL,
    currency CHAR(3) NOT NULL DEFAULT 'CAD',
    payment_status ENUM('not_required', 'pending', 'paid', 'refunded', 'failed') NOT NULL DEFAULT 'not_required',
    payment_expires_at DATETIME(3) NULL,
    stripe_checkout_session_id VARCHAR(255) NULL,
    stripe_payment_intent_id VARCHAR(255) NULL,
    reminder_sent_at DATETIME(3) NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_appointments_client FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_appointments_calendar (start_time, end_time, status),
    INDEX idx_appointments_client_time (client_id, start_time),
    UNIQUE INDEX idx_appointments_stripe_session (stripe_checkout_session_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS availability (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    day_of_week TINYINT UNSIGNED NOT NULL,
    start_time CHAR(5) NOT NULL,
    end_time CHAR(5) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    INDEX idx_availability_day (day_of_week, is_active, start_time)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS blocked_times (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    start_time DATETIME(3) NOT NULL,
    end_time DATETIME(3) NOT NULL,
    reason TEXT NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_blocked_times_range (start_time, end_time)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS client_notes (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    client_id BIGINT UNSIGNED NOT NULL,
    admin_id BIGINT UNSIGNED NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_client_notes_client FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_client_notes_admin FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_client_notes_client_created (client_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS waitlist (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    client_id BIGINT UNSIGNED NOT NULL,
    service_type ENUM('couples', 'individual', 'child_teen', 'christian_counseling') NOT NULL,
    preferred_day TINYINT UNSIGNED NOT NULL,
    preferred_time_window ENUM('morning', 'afternoon', 'evening') NOT NULL,
    status ENUM('waiting', 'offered', 'converted', 'expired', 'slot_available') NOT NULL DEFAULT 'waiting',
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_waitlist_client FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_waitlist_match (status, preferred_day, preferred_time_window, service_type, created_at),
    INDEX idx_waitlist_client (client_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS practice_settings (
    \`key\` VARCHAR(100) NOT NULL PRIMARY KEY,
    \`value\` VARCHAR(255) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS schema_metadata (
    \`key\` VARCHAR(100) NOT NULL PRIMARY KEY,
    \`value\` VARCHAR(255) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS auth_tokens (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE,
    purpose ENUM('verify_email', 'reset_password', 'change_email') NOT NULL,
    new_email VARCHAR(320) NULL,
    expires_at DATETIME(3) NOT NULL,
    consumed_at DATETIME(3) NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_auth_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_auth_tokens_user_purpose (user_id, purpose, expires_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS service_prices (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    service_type ENUM('couples', 'individual', 'child_teen', 'christian_counseling') NOT NULL,
    duration_min SMALLINT UNSIGNED NOT NULL,
    amount_cents INT UNSIGNED NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE KEY uq_service_prices_service_duration (service_type, duration_min)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS stripe_webhook_events (
    event_id VARCHAR(255) NOT NULL PRIMARY KEY,
    status ENUM('processing', 'processed') NOT NULL DEFAULT 'processing',
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_stripe_webhook_events_updated (status, updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at DATETIME(3) NULL`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_email VARCHAR(320) NULL`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS consultation_used_at DATETIME(3) NULL`,
  `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_activity_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)`,
  `ALTER TABLE appointments MODIFY COLUMN service_type ENUM('consultation', 'couples', 'individual', 'child_teen', 'christian_counseling') NOT NULL`,
  `ALTER TABLE appointments MODIFY COLUMN status ENUM('pending_payment', 'pending', 'confirmed', 'completed', 'cancelled', 'no_show') NOT NULL DEFAULT 'confirmed'`,
  `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS amount_cents INT UNSIGNED NULL`,
  `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS currency CHAR(3) NOT NULL DEFAULT 'CAD'`,
  `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_status ENUM('not_required', 'pending', 'paid', 'refunded', 'failed') NOT NULL DEFAULT 'not_required'`,
  `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_expires_at DATETIME(3) NULL`,
  `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS stripe_checkout_session_id VARCHAR(255) NULL`,
  `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS stripe_payment_intent_id VARCHAR(255) NULL`,
  `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reminder_sent_at DATETIME(3) NULL`,
];

const defaultSettings = [
  ["buffer_min", "0"],
  ["default_couples_duration", "60"],
  ["default_individual_duration", "50"],
  ["default_child_teen_duration", "50"],
  ["default_christian_counseling_duration", "50"],
] as const;

async function seedDemoData(connection: PoolConnection) {
  const [{ count }] = await query<Array<RowDataPacket & { count: number }>>(
    "SELECT COUNT(*) AS count FROM users",
    [],
    connection,
  );
  if (Number(count) !== 0) return;

  const passwordHash = await bcrypt.hash("admin123", 10);
  const admin = await execute(
    `INSERT INTO users (email, password_hash, role, name, phone, timezone, notes, email_verified_at)
     VALUES (?, ?, 'admin', ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
    [
      "admin@porterpsychology.com",
      passwordHash,
      "Lara Akinpelu",
      "(604) 555-0184",
      ADMIN_TIMEZONE,
      "Registered Provisional Psychologist",
    ],
    connection,
  );
  const client = await execute(
    `INSERT INTO users (email, password_hash, role, name, phone, timezone, notes, email_verified_at)
     VALUES (?, ?, 'client', ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
    [
      "maya.chen@example.com",
      await bcrypt.hash("client123", 10),
      "Maya Chen",
      "(604) 555-0101",
      ADMIN_TIMEZONE,
      "Prefers afternoon sessions.",
    ],
    connection,
  );

  const today = zonedDateKey(new Date(), ADMIN_TIMEZONE);
  const noon = new Date(`${today}T12:00:00Z`);
  noon.setUTCDate(noon.getUTCDate() - ((weekdayForDate(today) + 6) % 7));
  const monday = noon.toISOString().slice(0, 10);
  const start = zonedDateTimeToUtc(monday, "10:00", ADMIN_TIMEZONE);
  const end = zonedDateTimeToUtc(monday, "11:00", ADMIN_TIMEZONE);
  await execute(
    `INSERT INTO appointments
      (client_id, start_time, end_time, service_type, duration_min, status, notes)
     VALUES (?, ?, ?, 'individual', 60, 'confirmed', ?)`,
    [
      client.insertId,
      start.toISOString(),
      end.toISOString(),
      "Demo appointment",
    ],
    connection,
  );
  await execute(
    `INSERT INTO client_notes (client_id, admin_id, content) VALUES (?, ?, ?)`,
    [client.insertId, admin.insertId, "Demo client note."],
    connection,
  );
}

async function ensureBootstrapAdmin(connection: PoolConnection) {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim() || "Lara Akinpelu";

  if (!email && !password) {
    if (process.env.NODE_ENV === "production") {
      const admin = await one<RowDataPacket & { id: number }>(
        "SELECT id FROM users WHERE role = 'admin' LIMIT 1",
        [],
        connection,
      );
      if (!admin) {
        throw new Error(
          "ADMIN_EMAIL and ADMIN_PASSWORD are required for the initial production administrator.",
        );
      }
    }
    return;
  }
  if (!email || !password) {
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must be set together.");
  }
  if (password.length < 12) {
    throw new Error("ADMIN_PASSWORD must contain at least 12 characters.");
  }

  const existing = await one<RowDataPacket & { role: string }>(
    "SELECT role FROM users WHERE email = ?",
    [email],
    connection,
  );
  if (existing) {
    if (existing.role !== "admin") {
      throw new Error(
        `ADMIN_EMAIL ${email} belongs to a client account and cannot be bootstrapped as an administrator.`,
      );
    }
    return;
  }

  await execute(
    `INSERT INTO users (email, password_hash, role, name, timezone, email_verified_at)
     VALUES (?, ?, 'admin', ?, ?, UTC_TIMESTAMP(3))`,
    [email, await bcrypt.hash(password, 12), name, ADMIN_TIMEZONE],
    connection,
  );
}

export async function initializeDatabase() {
  const connection = await pool.getConnection();
  let lockHeld = false;
  try {
    await connection.query("SET time_zone = '+00:00'");
    const lock = await one<RowDataPacket & { acquired: number }>(
      "SELECT GET_LOCK('porter_schema_migrations', 30) AS acquired",
      [],
      connection,
    );
    if (Number(lock?.acquired) !== 1) {
      throw new Error("Timed out waiting for the database migration lock.");
    }
    lockHeld = true;

    for (const migration of migrations) {
      await connection.query(migration);
    }
    for (const [key, value] of defaultSettings) {
      await execute(
        "INSERT INTO practice_settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `key` = VALUES(`key`)",
        [key, value],
        connection,
      );
    }
    await ensureBootstrapAdmin(connection);
    const verificationMigrated = await one<RowDataPacket & { value: string }>(
      "SELECT `value` FROM schema_metadata WHERE `key` = 'existing_users_email_verified'",
      [],
      connection,
    );
    if (!verificationMigrated) {
      await execute(
        "UPDATE users SET email_verified_at = COALESCE(email_verified_at, created_at)",
        [],
        connection,
      );
      await execute(
        "INSERT INTO schema_metadata (`key`, `value`) VALUES ('existing_users_email_verified', '1')",
        [],
        connection,
      );
    }
    await execute(
      `DELETE FROM auth_tokens
       WHERE expires_at < UTC_TIMESTAMP(3)
          OR consumed_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 7 DAY)`,
      [],
      connection,
    );
    await execute(
      `DELETE FROM stripe_webhook_events
       WHERE status = 'processed'
         AND updated_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 90 DAY)`,
      [],
      connection,
    );

    // Weekly availability is operational configuration, not demo identity/data.
    // Initialize it only for a brand-new empty calendar and never overwrite edits.
    const availabilityInitialized = await one<
      RowDataPacket & { value: string }
    >(
      "SELECT `value` FROM schema_metadata WHERE `key` = 'default_availability_initialized'",
      [],
      connection,
    );
    if (!availabilityInitialized) {
      await connection.beginTransaction();
      try {
        const availability = await one<RowDataPacket & { count: number }>(
          "SELECT COUNT(*) AS count FROM availability",
          [],
          connection,
        );
        if (Number(availability?.count) === 0) {
          for (let day = 1; day <= 5; day += 1) {
            await execute(
              "INSERT INTO availability (day_of_week, start_time, end_time, is_active) VALUES (?, '09:00', '17:00', TRUE)",
              [day],
              connection,
            );
          }
        }
        await execute(
          "INSERT INTO schema_metadata (`key`, `value`) VALUES ('default_availability_initialized', '1')",
          [],
          connection,
        );
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    }

    // Demo identities and clinical-looking records are opt-in for non-production
    // environments and are categorically disabled in production.
    if (
      process.env.SEED_DEMO_DATA === "true" &&
      process.env.NODE_ENV !== "production"
    ) {
      await connection.beginTransaction();
      try {
        await seedDemoData(connection);
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    }
  } catch (error) {
    throw new Error("MySQL database initialization failed.", { cause: error });
  } finally {
    try {
      if (lockHeld) {
        await connection.query(
          "SELECT RELEASE_LOCK('porter_schema_migrations')",
        );
      }
    } finally {
      connection.release();
    }
  }
}

export type DbUser = RowDataPacket & {
  id: number;
  email: string;
  role: "client" | "admin";
  name: string;
  phone: string | null;
  timezone: string;
  notes: string | null;
  email_verified_at: string | null;
  pending_email: string | null;
  consultation_used_at: string | null;
};

export type DbAppointment = RowDataPacket & {
  id: number;
  client_id: number;
  client_name: string;
  client_email: string;
  start_time: string;
  end_time: string;
  service_type:
    | "consultation"
    | "couples"
    | "individual"
    | "child_teen"
    | "christian_counseling";
  duration_min: number;
  status:
    | "pending_payment"
    | "pending"
    | "confirmed"
    | "completed"
    | "cancelled"
    | "no_show";
  notes: string | null;
  amount_cents: number | null;
  currency: string;
  payment_status: "not_required" | "pending" | "paid" | "refunded" | "failed";
  payment_expires_at: string | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  reminder_sent_at: string | null;
};

export function getUserById(id: number, executor: Executor = pool) {
  return one<DbUser>(
    `SELECT id, email, role, name, phone, timezone, notes, email_verified_at,
       pending_email, consultation_used_at FROM users WHERE id = ?`,
    [id],
    executor,
  );
}

export function getAppointment(id: number, executor: Executor = pool) {
  return one<DbAppointment>(
    `SELECT a.*, u.name AS client_name, u.email AS client_email
     FROM appointments a JOIN users u ON u.id = a.client_id WHERE a.id = ?`,
    [id],
    executor,
  );
}

export function appointmentResponse(row: DbAppointment) {
  return {
    id: Number(row.id),
    clientId: Number(row.client_id),
    clientName: row.client_name,
    clientEmail: row.client_email,
    startTime: row.start_time,
    endTime: row.end_time,
    serviceType: row.service_type,
    durationMin: Number(row.duration_min),
    status: row.status,
    notes: row.notes,
    amountCents: row.amount_cents === null ? null : Number(row.amount_cents),
    currency: row.currency,
    paymentStatus: row.payment_status,
    paymentExpiresAt: row.payment_expires_at,
  };
}

export function userResponse(row: DbUser) {
  return {
    id: Number(row.id),
    email: row.email,
    name: row.name,
    phone: row.phone,
    timezone: row.timezone,
    notes: null,
    emailVerified: Boolean(row.email_verified_at),
    pendingEmail: row.pending_email,
    consultationAvailable: row.consultation_used_at === null,
  };
}
