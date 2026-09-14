import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import bcrypt from "bcryptjs";

export const ADMIN_TIMEZONE =
  process.env.ADMIN_TIMEZONE ?? "America/Vancouver";
const databasePath = resolve(
  process.env.SQLITE_PATH ?? "./data/porter-psychology.sqlite",
);

mkdirSync(dirname(databasePath), { recursive: true });

export const sqlite = new Database(databasePath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('client', 'admin')),
    name TEXT NOT NULL,
    phone TEXT,
    timezone TEXT NOT NULL DEFAULT '${ADMIN_TIMEZONE}',
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    service_type TEXT NOT NULL,
    duration_min INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'confirmed',
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS availability (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day_of_week INTEGER NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS blocked_times (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS client_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS waitlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    service_type TEXT NOT NULL,
    preferred_day INTEGER NOT NULL,
    preferred_time_window TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'waiting',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const count = sqlite
  .prepare("SELECT COUNT(*) AS count FROM users")
  .get() as { count: number };

if (count.count === 0) {
  const seed = sqlite.transaction(() => {
    const passwordHash = bcrypt.hashSync("admin123", 10);
    const addUser = sqlite.prepare(`
      INSERT INTO users (email, password_hash, role, name, phone, timezone, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const admin = addUser.run(
      "admin@porterpsychology.com",
      passwordHash,
      "admin",
      "Lara Akinpelu",
      "(604) 555-0184",
      ADMIN_TIMEZONE,
      "Registered Provisional Psychologist",
    );
    const clientIds = [
      addUser.run(
        "maya.chen@example.com",
        bcrypt.hashSync("client123", 10),
        "client",
        "Maya Chen",
        "(604) 555-0101",
        "America/Vancouver",
        "Prefers afternoon sessions.",
      ).lastInsertRowid,
      addUser.run(
        "jordan.rivera@example.com",
        bcrypt.hashSync("client123", 10),
        "client",
        "Jordan Rivera",
        "(778) 555-0102",
        "America/Vancouver",
        "Individual therapy client.",
      ).lastInsertRowid,
      addUser.run(
        "samira.patel@example.com",
        bcrypt.hashSync("client123", 10),
        "client",
        "Samira Patel",
        "(604) 555-0103",
        "America/Vancouver",
        "Couples therapy client.",
      ).lastInsertRowid,
      addUser.run(
        "noah.williams@example.com",
        bcrypt.hashSync("client123", 10),
        "client",
        "Noah Williams",
        "(236) 555-0104",
        "America/Vancouver",
        "Parenting support client.",
      ).lastInsertRowid,
    ];

    const toLocalIso = (dayOffset: number, hour: number, minute = 0) => {
      const date = new Date();
      date.setDate(date.getDate() + dayOffset);
      date.setHours(hour, minute, 0, 0);
      return date.toISOString();
    };
    const addAppointment = sqlite.prepare(`
      INSERT INTO appointments
        (client_id, start_time, end_time, service_type, duration_min, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    addAppointment.run(
      clientIds[0],
      toLocalIso(1, 10),
      toLocalIso(1, 11),
      "couples",
      60,
      "confirmed",
      "Initial couples consultation.",
    );
    addAppointment.run(
      clientIds[1],
      toLocalIso(2, 13, 30),
      toLocalIso(2, 14, 20),
      "individual",
      50,
      "confirmed",
      null,
    );
    addAppointment.run(
      clientIds[2],
      toLocalIso(3, 9),
      toLocalIso(3, 10, 20),
      "couples",
      80,
      "pending",
      null,
    );
    addAppointment.run(
      clientIds[3],
      toLocalIso(-2, 15),
      toLocalIso(-2, 16),
      "child_teen",
      60,
      "completed",
      "Follow-up session.",
    );

    const addAvailability = sqlite.prepare(`
      INSERT INTO availability (day_of_week, start_time, end_time, is_active)
      VALUES (?, ?, ?, 1)
    `);
    for (let day = 1; day <= 5; day += 1) {
      addAvailability.run(day, "09:00", "17:00");
    }

    const addWaitlist = sqlite.prepare(`
      INSERT INTO waitlist
        (client_id, service_type, preferred_day, preferred_time_window, status)
      VALUES (?, ?, ?, ?, 'waiting')
    `);
    addWaitlist.run(clientIds[0], "couples", 2, "afternoon");
    addWaitlist.run(clientIds[3], "individual", 4, "morning");

    sqlite
      .prepare(
        "INSERT INTO client_notes (client_id, admin_id, content) VALUES (?, ?, ?)",
      )
      .run(clientIds[0], admin.lastInsertRowid, "Review preferred check-in format.");
  });
  seed();
}

export type DbUser = {
  id: number;
  email: string;
  role: "client" | "admin";
  name: string;
  phone: string | null;
  timezone: string;
  notes: string | null;
};

export type DbAppointment = {
  id: number;
  client_id: number;
  client_name: string;
  client_email: string;
  start_time: string;
  end_time: string;
  service_type:
    | "couples"
    | "individual"
    | "child_teen"
    | "christian_counseling";
  duration_min: number;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
  notes: string | null;
};

export function getUserById(id: number) {
  return sqlite
    .prepare(
      "SELECT id, email, role, name, phone, timezone, notes FROM users WHERE id = ?",
    )
    .get(id) as DbUser | undefined;
}

export function getAppointment(id: number) {
  return sqlite
    .prepare(
      `SELECT a.*, u.name AS client_name, u.email AS client_email
       FROM appointments a JOIN users u ON u.id = a.client_id WHERE a.id = ?`,
    )
    .get(id) as DbAppointment | undefined;
}

export function appointmentResponse(row: DbAppointment) {
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.client_name,
    clientEmail: row.client_email,
    startTime: row.start_time,
    endTime: row.end_time,
    serviceType: row.service_type,
    durationMin: row.duration_min,
    status: row.status,
    notes: row.notes,
  };
}

export function userResponse(row: DbUser) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone,
    timezone: row.timezone,
    notes: row.notes,
  };
}