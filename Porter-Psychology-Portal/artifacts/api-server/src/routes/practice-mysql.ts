import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import {
  CancelClientAppointmentParams,
  CreateAppointmentBody,
  CreateBlockedTimeBody,
  CreateClientNoteBody,
  CreateClientNoteParams,
  CreateWaitlistEntryBody,
  GetAdminAppointmentsQueryParams,
  GetAdminCalendarQueryParams,
  GetAdminClientParams,
  GetAdminClientsQueryParams,
  GetCurrentUserResponse,
  GetPublicSlotsQueryParams,
  LoginBody,
  RegisterBody,
  UpdateAdminAppointmentBody,
  UpdateAdminAppointmentParams,
  UpdateAvailabilityBody,
  UpdateClientProfileBody,
} from "@workspace/api-zod";
import {
  ADMIN_TIMEZONE,
  appointmentResponse,
  execute,
  getAppointment,
  getUserById,
  one,
  pool,
  query,
  transaction,
  userResponse,
  type DbAppointment,
  type Executor,
} from "../lib/mysql";
import {
  attachUser,
  clearSession,
  createSession,
  requireAuth,
  requireRole,
  type AuthenticatedRequest,
} from "../lib/auth";
import {
  assertTimeZone,
  localDayBounds,
  timeWindowForInstant,
  weekdayForDate,
  zonedDateKey,
  zonedDateTimeToUtc,
} from "../lib/timezone";

const router: IRouter = Router();
const adminOnly = requireRole("admin");
const clientOnly = requireRole("client");
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    error: "Too many authentication attempts. Please try again later.",
  },
});

const appointmentSelect = `
  SELECT a.*, u.name AS client_name, u.email AS client_email
  FROM appointments a JOIN users u ON u.id = a.client_id
`;

async function appointmentList(
  where = "",
  params: readonly unknown[] = [],
  executor: Executor = pool,
) {
  return query<DbAppointment[]>(
    `${appointmentSelect} ${where} ORDER BY a.start_time ASC`,
    params,
    executor,
  );
}

function asAppointments(rows: DbAppointment[]) {
  return rows.map(appointmentResponse);
}

type WaitlistRow = RowDataPacket & {
  id: number;
  client_id: number;
  client_name: string;
  service_type: string;
  preferred_day: number;
  preferred_time_window: string;
  status: string;
  created_at: string;
};

function waitlistResponse(row: WaitlistRow) {
  return {
    id: Number(row.id),
    clientId: Number(row.client_id),
    clientName: row.client_name,
    serviceType: row.service_type,
    preferredDay: Number(row.preferred_day),
    preferredTimeWindow: row.preferred_time_window,
    status: row.status,
    createdAt: row.created_at,
  };
}

function formatSlotLabel(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ADMIN_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

async function getBufferMin(executor: Executor = pool) {
  const setting = await one<RowDataPacket & { value: string }>(
    "SELECT `value` FROM practice_settings WHERE `key` = 'buffer_min'",
    [],
    executor,
  );
  return Number(setting?.value ?? 0);
}

async function buildSlots(
  date: string,
  duration: number,
  executor: Executor = pool,
) {
  const bufferMin = await getBufferMin(executor);
  const bounds = localDayBounds(date, ADMIN_TIMEZONE);
  const availability = await query<
    Array<RowDataPacket & { start_time: string; end_time: string }>
  >(
    `SELECT start_time, end_time FROM availability
     WHERE day_of_week = ? AND is_active = TRUE ORDER BY start_time`,
    [weekdayForDate(date)],
    executor,
  );
  const appointments = await query<
    Array<RowDataPacket & { start_time: string; end_time: string }>
  >(
    `SELECT start_time, end_time FROM appointments
     WHERE status != 'cancelled' AND start_time < ? AND end_time > ?`,
    [bounds.end.toISOString(), bounds.start.toISOString()],
    executor,
  );
  const blocked = await query<
    Array<RowDataPacket & { start_time: string; end_time: string }>
  >(
    "SELECT start_time, end_time FROM blocked_times WHERE start_time < ? AND end_time > ?",
    [bounds.end.toISOString(), bounds.start.toISOString()],
    executor,
  );
  const groups = {
    morning: [] as Array<{ startTime: string; endTime: string; label: string }>,
    afternoon: [] as Array<{
      startTime: string;
      endTime: string;
      label: string;
    }>,
    evening: [] as Array<{ startTime: string; endTime: string; label: string }>,
  };
  const now = Date.now();
  for (const window of availability) {
    const start = zonedDateTimeToUtc(date, window.start_time, ADMIN_TIMEZONE);
    const end = zonedDateTimeToUtc(date, window.end_time, ADMIN_TIMEZONE);
    for (
      let cursor = start.getTime();
      cursor + duration * 60_000 <= end.getTime();
      cursor += 30 * 60_000
    ) {
      const slotStart = new Date(cursor);
      const slotEnd = new Date(cursor + duration * 60_000);
      const conflicts = [...appointments, ...blocked].some((item, index) => {
        const padding = index < appointments.length ? bufferMin * 60_000 : 0;
        return (
          new Date(item.start_time).getTime() - padding < slotEnd.getTime() &&
          new Date(item.end_time).getTime() + padding > slotStart.getTime()
        );
      });
      if (slotStart.getTime() <= now || conflicts) continue;
      const slot = {
        startTime: slotStart.toISOString(),
        endTime: slotEnd.toISOString(),
        label: formatSlotLabel(slotStart),
      };
      groups[timeWindowForInstant(slotStart, ADMIN_TIMEZONE)].push(slot);
    }
  }
  return { timezone: ADMIN_TIMEZONE, ...groups };
}

async function hasSchedulingConflict(
  start: Date,
  end: Date,
  excludeAppointmentId?: number,
  executor: Executor = pool,
) {
  const bufferMin = await getBufferMin(executor);
  const appointment = await one<RowDataPacket & { id: number }>(
    `SELECT id FROM appointments
     WHERE status != 'cancelled' AND start_time < ? AND end_time > ?
       AND (? IS NULL OR id != ?) LIMIT 1`,
    [
      new Date(end.getTime() + bufferMin * 60_000).toISOString(),
      new Date(start.getTime() - bufferMin * 60_000).toISOString(),
      excludeAppointmentId ?? null,
      excludeAppointmentId ?? null,
    ],
    executor,
  );
  const blocked = await one<RowDataPacket & { id: number }>(
    "SELECT id FROM blocked_times WHERE start_time < ? AND end_time > ? LIMIT 1",
    [end.toISOString(), start.toISOString()],
    executor,
  );
  return Boolean(appointment || blocked);
}

function validateDateRange(start: Date, end: Date, durationMin: number) {
  return (
    Number.isFinite(start.getTime()) &&
    Number.isFinite(end.getTime()) &&
    end.getTime() > start.getTime() &&
    end.getTime() - start.getTime() === durationMin * 60_000
  );
}

async function withCalendarLock<T>(
  work: (connection: PoolConnection) => Promise<T>,
) {
  const connection = await pool.getConnection();
  let lockHeld = false;
  try {
    const lock = await one<RowDataPacket & { acquired: number }>(
      "SELECT GET_LOCK('porter_practitioner_calendar', 15) AS acquired",
      [],
      connection,
    );
    if (Number(lock?.acquired) !== 1) {
      throw new CalendarBusyError();
    }
    lockHeld = true;
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve the original failure.
    }
    throw error;
  } finally {
    try {
      if (lockHeld) {
        await connection.query(
          "SELECT RELEASE_LOCK('porter_practitioner_calendar')",
        );
      }
    } finally {
      connection.release();
    }
  }
}

class CalendarConflictError extends Error {}
class CalendarBusyError extends Error {}

function isDuplicate(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ER_DUP_ENTRY"
  );
}

router.post("/auth/login", authLimiter, async (request, response) => {
  const input = LoginBody.parse(request.body);
  const user = await one<
    RowDataPacket & {
      id: number;
      email: string;
      name: string;
      role: "client" | "admin";
      timezone: string;
      password_hash: string;
    }
  >("SELECT * FROM users WHERE email = ?", [input.email.trim().toLowerCase()]);
  if (!user || !(await bcrypt.compare(input.password, user.password_hash))) {
    response.status(401).json({ error: "Email or password is incorrect" });
    return;
  }
  await createSession(user.id, response);
  response.json({
    id: Number(user.id),
    email: user.email,
    name: user.name,
    role: user.role,
    timezone: user.timezone,
  });
});

router.post("/auth/register", authLimiter, async (request, response) => {
  const input = RegisterBody.parse(request.body);
  const email = input.email.trim().toLowerCase();
  let timezone: string;
  try {
    timezone = assertTimeZone(input.timezone ?? ADMIN_TIMEZONE);
  } catch {
    response.status(400).json({ error: "Timezone is not valid" });
    return;
  }
  try {
    const result = await execute(
      `INSERT INTO users (email, password_hash, role, name, phone, timezone)
       VALUES (?, ?, 'client', ?, ?, ?)`,
      [
        email,
        await bcrypt.hash(input.password, 12),
        input.name.trim(),
        input.phone ?? null,
        timezone,
      ],
    );
    await createSession(result.insertId, response);
    response.status(201).json({
      id: Number(result.insertId),
      email,
      name: input.name.trim(),
      role: "client",
      timezone,
    });
  } catch (error) {
    if (isDuplicate(error)) {
      response
        .status(409)
        .json({ error: "An account with that email already exists" });
      return;
    }
    throw error;
  }
});

router.post("/auth/logout", async (request, response) => {
  await clearSession(request, response);
  response.status(204).send();
});

router.get("/auth/me", async (request, response) => {
  const user = await attachUser(request as AuthenticatedRequest);
  if (!user) {
    response.status(401).json({ error: "Authentication required" });
    return;
  }
  response.json(
    GetCurrentUserResponse.parse({
      id: Number(user.id),
      email: user.email,
      name: user.name,
      role: user.role,
      timezone: user.timezone,
    }),
  );
});

router.get("/public/slots", async (request, response) => {
  const input = GetPublicSlotsQueryParams.parse({
    date: new Date(`${String(request.query.date)}T00:00:00Z`),
    duration: Number(request.query.duration),
  });
  response.json(
    await buildSlots(input.date.toISOString().slice(0, 10), input.duration),
  );
});

router.get("/public/practice", async (_request, response) => {
  const rows = await query<
    Array<RowDataPacket & { key: string; value: string }>
  >("SELECT `key`, `value` FROM practice_settings");
  response.json({
    timezone: ADMIN_TIMEZONE,
    settings: Object.fromEntries(
      rows.map(({ key, value }) => [key, Number(value)]),
    ),
  });
});

router.get("/client/dashboard", clientOnly, async (request, response) => {
  const user = (request as AuthenticatedRequest).user!;
  const now = new Date().toISOString();
  const [upcoming, past, waitlist] = await Promise.all([
    appointmentList(
      "WHERE a.client_id = ? AND a.start_time >= ? AND a.status != 'cancelled'",
      [user.id, now],
    ),
    appointmentList(
      "WHERE a.client_id = ? AND (a.start_time < ? OR a.status IN ('completed', 'cancelled', 'no_show'))",
      [user.id, now],
    ),
    query<WaitlistRow[]>(
      `SELECT w.*, u.name AS client_name FROM waitlist w
       JOIN users u ON u.id = w.client_id WHERE w.client_id = ? ORDER BY w.created_at DESC`,
      [user.id],
    ),
  ]);
  response.json({
    upcoming: asAppointments(upcoming),
    past: asAppointments(past),
    waitlist: waitlist.map(waitlistResponse),
  });
});

router.get("/client/profile", clientOnly, async (request, response) => {
  const user = await getUserById((request as AuthenticatedRequest).user!.id);
  response.json(userResponse(user!));
});

router.patch("/client/profile", clientOnly, async (request, response) => {
  const input = UpdateClientProfileBody.parse(request.body);
  const userId = (request as AuthenticatedRequest).user!.id;
  const current = (await getUserById(userId))!;
  await execute(
    `UPDATE users SET name = COALESCE(?, name), phone = ?,
     timezone = COALESCE(?, timezone), notes = ? WHERE id = ?`,
    [
      input.name ?? null,
      input.phone === undefined ? current.phone : input.phone,
      input.timezone ?? null,
      input.notes === undefined ? current.notes : input.notes,
      userId,
    ],
  );
  response.json(userResponse((await getUserById(userId))!));
});

router.get("/client/appointments", clientOnly, async (request, response) => {
  response.json(
    asAppointments(
      await appointmentList("WHERE a.client_id = ?", [
        (request as AuthenticatedRequest).user!.id,
      ]),
    ),
  );
});

router.post(
  "/client/appointments/:id/cancel",
  clientOnly,
  async (request, response) => {
    const { id } = CancelClientAppointmentParams.parse(request.params);
    const userId = (request as AuthenticatedRequest).user!.id;
    const appointment = await withCalendarLock(async (connection) => {
      const current = await getAppointment(id, connection);
      if (!current || Number(current.client_id) !== Number(userId))
        return undefined;
      await execute(
        "UPDATE appointments SET status = 'cancelled' WHERE id = ?",
        [id],
        connection,
      );
      await execute(
        `UPDATE waitlist SET status = 'slot_available'
         WHERE id = (
           SELECT id FROM (
             SELECT id FROM waitlist
             WHERE status = 'waiting' AND preferred_day = ?
               AND preferred_time_window = ? AND service_type = ?
             ORDER BY created_at ASC LIMIT 1
           ) AS candidate
         )`,
        [
          weekdayForDate(zonedDateKey(current.start_time, ADMIN_TIMEZONE)),
          timeWindowForInstant(current.start_time, ADMIN_TIMEZONE),
          current.service_type,
        ],
        connection,
      );
      return getAppointment(id, connection);
    });
    if (!appointment) {
      response.status(404).json({ error: "Appointment not found" });
      return;
    }
    response.json(appointmentResponse(appointment));
  },
);

router.post("/client/waitlist", clientOnly, async (request, response) => {
  const input = CreateWaitlistEntryBody.parse(request.body);
  const userId = (request as AuthenticatedRequest).user!.id;
  const result = await execute(
    `INSERT INTO waitlist
      (client_id, service_type, preferred_day, preferred_time_window, status)
     VALUES (?, ?, ?, ?, 'waiting')`,
    [userId, input.serviceType, input.preferredDay, input.preferredTimeWindow],
  );
  const entry = await one<WaitlistRow>(
    `SELECT w.*, u.name AS client_name FROM waitlist w
     JOIN users u ON u.id = w.client_id WHERE w.id = ?`,
    [result.insertId],
  );
  response.status(201).json(waitlistResponse(entry!));
});

router.post("/appointments", requireAuth, async (request, response) => {
  const input = CreateAppointmentBody.parse(request.body);
  const requester = (request as AuthenticatedRequest).user!;
  const clientId = requester.role === "admin" ? input.clientId : requester.id;
  const start = new Date(input.startTime);
  const end = new Date(input.endTime);
  if (!validateDateRange(start, end, input.durationMin)) {
    response
      .status(400)
      .json({ error: "Appointment times and duration do not match" });
    return;
  }
  if (start.getTime() <= Date.now()) {
    response
      .status(400)
      .json({ error: "Appointments must be scheduled in the future" });
    return;
  }
  try {
    const appointment = await withCalendarLock(async (connection) => {
      if (requester.role === "client") {
        const slots = await buildSlots(
          zonedDateKey(start, ADMIN_TIMEZONE),
          input.durationMin,
          connection,
        );
        if (
          ![...slots.morning, ...slots.afternoon, ...slots.evening].some(
            (slot) => slot.startTime === start.toISOString(),
          )
        ) {
          throw new CalendarConflictError("outside");
        }
      }
      if (await hasSchedulingConflict(start, end, undefined, connection)) {
        throw new CalendarConflictError("conflict");
      }
      const result = await execute(
        `INSERT INTO appointments
          (client_id, start_time, end_time, service_type, duration_min, status, notes)
         VALUES (?, ?, ?, ?, ?, 'confirmed', ?)`,
        [
          clientId,
          start.toISOString(),
          end.toISOString(),
          input.serviceType,
          input.durationMin,
          input.notes ?? null,
        ],
        connection,
      );
      return getAppointment(result.insertId, connection);
    });
    response.status(201).json(appointmentResponse(appointment!));
  } catch (error) {
    if (error instanceof CalendarConflictError) {
      response.status(409).json({
        error:
          error.message === "outside"
            ? "That time is outside current availability"
            : "That time is no longer available",
      });
      return;
    }
    if (error instanceof CalendarBusyError) {
      response
        .status(503)
        .json({ error: "Calendar is busy; please try again" });
      return;
    }
    throw error;
  }
});

router.get("/admin/summary", adminOnly, async (_request, response) => {
  const todayKey = zonedDateKey(new Date(), ADMIN_TIMEZONE);
  const todayBounds = localDayBounds(todayKey, ADMIN_TIMEZONE);
  const localNoon = new Date(`${todayKey}T12:00:00Z`);
  localNoon.setUTCDate(
    localNoon.getUTCDate() - ((localNoon.getUTCDay() + 6) % 7),
  );
  const weekStart = zonedDateTimeToUtc(
    localNoon.toISOString().slice(0, 10),
    "00:00",
    ADMIN_TIMEZONE,
  );
  localNoon.setUTCDate(localNoon.getUTCDate() + 7);
  const weekEnd = zonedDateTimeToUtc(
    localNoon.toISOString().slice(0, 10),
    "00:00",
    ADMIN_TIMEZONE,
  );
  const [todayCount, weekCount, pendingWaitlist, nextRows] = await Promise.all([
    one<RowDataPacket & { count: number }>(
      "SELECT COUNT(*) AS count FROM appointments WHERE start_time >= ? AND start_time < ? AND status != 'cancelled'",
      [todayBounds.start.toISOString(), todayBounds.end.toISOString()],
    ),
    one<RowDataPacket & { count: number }>(
      "SELECT COUNT(*) AS count FROM appointments WHERE start_time >= ? AND start_time < ? AND status != 'cancelled'",
      [weekStart.toISOString(), weekEnd.toISOString()],
    ),
    one<RowDataPacket & { count: number }>(
      "SELECT COUNT(*) AS count FROM waitlist WHERE status IN ('waiting', 'slot_available')",
    ),
    appointmentList("WHERE a.start_time >= ? AND a.status != 'cancelled'", [
      new Date().toISOString(),
    ]),
  ]);
  response.json({
    todayCount: Number(todayCount?.count ?? 0),
    weekCount: Number(weekCount?.count ?? 0),
    pendingWaitlist: Number(pendingWaitlist?.count ?? 0),
    ...(nextRows[0]
      ? { nextAppointment: appointmentResponse(nextRows[0]) }
      : {}),
  });
});

router.get("/admin/calendar", adminOnly, async (request, response) => {
  const input = GetAdminCalendarQueryParams.parse({
    start: request.query.start
      ? new Date(String(request.query.start))
      : undefined,
    end: request.query.end ? new Date(String(request.query.end)) : undefined,
  });
  const start = input.start?.toISOString() ?? new Date().toISOString();
  const end =
    input.end?.toISOString() ??
    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const [appointments, blockedTimes] = await Promise.all([
    appointmentList("WHERE a.start_time < ? AND a.end_time > ?", [end, start]),
    query(
      `SELECT id, start_time AS startTime, end_time AS endTime, reason,
       created_at AS createdAt FROM blocked_times
       WHERE start_time < ? AND end_time > ? ORDER BY start_time`,
      [end, start],
    ),
  ]);
  response.json({
    timezone: ADMIN_TIMEZONE,
    appointments: asAppointments(appointments),
    blockedTimes,
  });
});

router.get("/admin/appointments", adminOnly, async (request, response) => {
  const input = GetAdminAppointmentsQueryParams.parse({
    ...request.query,
    clientId: request.query.clientId
      ? Number(request.query.clientId)
      : undefined,
    start: request.query.start
      ? new Date(String(request.query.start))
      : undefined,
    end: request.query.end ? new Date(String(request.query.end)) : undefined,
  });
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (input.status) {
    clauses.push("a.status = ?");
    params.push(input.status);
  }
  if (input.clientId) {
    clauses.push("a.client_id = ?");
    params.push(input.clientId);
  }
  if (input.start) {
    clauses.push("a.start_time >= ?");
    params.push(input.start.toISOString());
  }
  if (input.end) {
    clauses.push("a.start_time < ?");
    params.push(input.end.toISOString());
  }
  response.json(
    asAppointments(
      await appointmentList(
        clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
        params,
      ),
    ),
  );
});

router.patch(
  "/admin/appointments/:id",
  adminOnly,
  async (request, response) => {
    const { id } = UpdateAdminAppointmentParams.parse(request.params);
    const input = UpdateAdminAppointmentBody.parse(request.body);
    try {
      const appointment = await withCalendarLock(async (connection) => {
        const current = await getAppointment(id, connection);
        if (!current) return undefined;
        const nextStart = input.startTime ?? current.start_time;
        const nextEnd = input.endTime ?? current.end_time;
        const nextDuration = input.durationMin ?? current.duration_min;
        const scheduleChanged =
          input.startTime !== undefined ||
          input.endTime !== undefined ||
          input.durationMin !== undefined;
        const start = new Date(nextStart);
        const end = new Date(nextEnd);
        if (scheduleChanged && !validateDateRange(start, end, nextDuration)) {
          throw new CalendarConflictError("invalid");
        }
        if (
          scheduleChanged &&
          (await hasSchedulingConflict(start, end, id, connection))
        ) {
          throw new CalendarConflictError("conflict");
        }
        await execute(
          `UPDATE appointments SET start_time = ?, end_time = ?,
         status = COALESCE(?, status), notes = ?,
         service_type = COALESCE(?, service_type), duration_min = ?
         WHERE id = ?`,
          [
            nextStart,
            nextEnd,
            input.status ?? null,
            input.notes === undefined ? current.notes : input.notes,
            input.serviceType ?? null,
            nextDuration,
            id,
          ],
          connection,
        );
        return getAppointment(id, connection);
      });
      if (!appointment) {
        response.status(404).json({ error: "Appointment not found" });
        return;
      }
      response.json(appointmentResponse(appointment));
    } catch (error) {
      if (error instanceof CalendarConflictError) {
        response.status(error.message === "invalid" ? 400 : 409).json({
          error:
            error.message === "invalid"
              ? "Appointment times and duration do not match"
              : "That time conflicts with the calendar",
        });
        return;
      }
      throw error;
    }
  },
);

router.patch("/admin/appointments", adminOnly, async (request, response) => {
  const input = z
    .object({
      ids: z.array(z.number().int().positive()).min(1),
      status: z.enum([
        "pending",
        "confirmed",
        "completed",
        "cancelled",
        "no_show",
      ]),
    })
    .parse(request.body);
  const placeholders = input.ids.map(() => "?").join(",");
  await execute(
    `UPDATE appointments SET status = ? WHERE id IN (${placeholders})`,
    [input.status, ...input.ids],
  );
  response.json(
    asAppointments(
      await appointmentList(`WHERE a.id IN (${placeholders})`, input.ids),
    ),
  );
});

router.get("/admin/clients", adminOnly, async (request, response) => {
  const input = GetAdminClientsQueryParams.parse(request.query);
  const search = input.search ? `%${input.search}%` : "%";
  const order =
    input.sort === "newest"
      ? "u.created_at DESC"
      : input.sort === "appointments"
        ? "appointment_count DESC"
        : "u.name ASC";
  const clients = await query<
    Array<
      RowDataPacket & {
        id: number;
        name: string;
        email: string;
        phone: string | null;
        appointment_count: number;
        last_appointment: string | null;
      }
    >
  >(
    `SELECT u.id, u.name, u.email, u.phone, COUNT(a.id) AS appointment_count,
     MAX(a.start_time) AS last_appointment
     FROM users u LEFT JOIN appointments a ON a.client_id = u.id
     WHERE u.role = 'client' AND (u.name LIKE ? OR u.email LIKE ?)
     GROUP BY u.id, u.name, u.email, u.phone, u.created_at ORDER BY ${order}`,
    [search, search],
  );
  response.json(
    clients.map((row) => ({
      id: Number(row.id),
      name: row.name,
      email: row.email,
      phone: row.phone,
      appointmentCount: Number(row.appointment_count),
      lastAppointment: row.last_appointment,
    })),
  );
});

router.get("/admin/clients/:id", adminOnly, async (request, response) => {
  const { id } = GetAdminClientParams.parse(request.params);
  const client = await getUserById(id);
  if (!client || client.role !== "client") {
    response.status(404).json({ error: "Client not found" });
    return;
  }
  const [notes, appointments] = await Promise.all([
    query(
      `SELECT id, client_id AS clientId, admin_id AS adminId, content,
       created_at AS createdAt FROM client_notes
       WHERE client_id = ? ORDER BY created_at DESC`,
      [id],
    ),
    appointmentList("WHERE a.client_id = ?", [id]),
  ]);
  response.json({
    profile: userResponse(client),
    appointments: asAppointments(appointments),
    notes,
  });
});

router.post(
  "/admin/clients/:id/notes",
  adminOnly,
  async (request, response) => {
    const { id } = CreateClientNoteParams.parse(request.params);
    const input = CreateClientNoteBody.parse(request.body);
    const adminId = (request as AuthenticatedRequest).user!.id;
    const result = await execute(
      "INSERT INTO client_notes (client_id, admin_id, content) VALUES (?, ?, ?)",
      [id, adminId, input.content],
    );
    response.status(201).json(
      await one(
        `SELECT id, client_id AS clientId, admin_id AS adminId, content,
       created_at AS createdAt FROM client_notes WHERE id = ?`,
        [result.insertId],
      ),
    );
  },
);

router.get("/admin/waitlist", adminOnly, async (_request, response) => {
  const entries = await query<WaitlistRow[]>(
    `SELECT w.*, u.name AS client_name FROM waitlist w
     JOIN users u ON u.id = w.client_id ORDER BY w.created_at ASC`,
  );
  response.json(entries.map(waitlistResponse));
});

router.post(
  "/admin/waitlist/:id/convert",
  adminOnly,
  async (request, response) => {
    const id = Number(request.params.id);
    const input = CreateAppointmentBody.parse(request.body);
    const start = new Date(input.startTime);
    const end = new Date(input.endTime);
    if (
      !validateDateRange(start, end, input.durationMin) ||
      start.getTime() <= Date.now()
    ) {
      response
        .status(400)
        .json({ error: "Choose a valid future appointment time" });
      return;
    }
    try {
      const appointment = await withCalendarLock(async (connection) => {
        const entry = await one<
          RowDataPacket & { client_id: number; status: string }
        >(
          "SELECT client_id, status FROM waitlist WHERE id = ? FOR UPDATE",
          [id],
          connection,
        );
        if (!entry) return undefined;
        if (entry.status === "converted") {
          throw new CalendarConflictError("converted");
        }
        if (await hasSchedulingConflict(start, end, undefined, connection)) {
          throw new CalendarConflictError("conflict");
        }
        const result = await execute(
          `INSERT INTO appointments
            (client_id, start_time, end_time, service_type, duration_min, status, notes)
           VALUES (?, ?, ?, ?, ?, 'confirmed', ?)`,
          [
            entry.client_id,
            start.toISOString(),
            end.toISOString(),
            input.serviceType,
            input.durationMin,
            input.notes ?? null,
          ],
          connection,
        );
        await execute(
          "UPDATE waitlist SET status = 'converted' WHERE id = ?",
          [id],
          connection,
        );
        return getAppointment(result.insertId, connection);
      });
      if (!appointment) {
        response.status(404).json({ error: "Waitlist entry not found" });
        return;
      }
      response.status(201).json(appointmentResponse(appointment));
    } catch (error) {
      if (error instanceof CalendarConflictError) {
        response.status(409).json({
          error:
            error.message === "converted"
              ? "Waitlist entry is already converted"
              : "That time conflicts with the calendar",
        });
        return;
      }
      throw error;
    }
  },
);

async function availabilityRows(executor: Executor = pool) {
  const rows = await query<
    Array<
      RowDataPacket & {
        id: number;
        dayOfWeek: number;
        startTime: string;
        endTime: string;
        isActive: number;
      }
    >
  >(
    `SELECT id, day_of_week AS dayOfWeek, start_time AS startTime,
     end_time AS endTime, is_active AS isActive
     FROM availability ORDER BY day_of_week, start_time`,
    [],
    executor,
  );
  return rows.map((row) => ({ ...row, isActive: Boolean(row.isActive) }));
}

router.get("/admin/availability", adminOnly, async (_request, response) => {
  response.json(await availabilityRows());
});

router.patch("/admin/availability", adminOnly, async (request, response) => {
  const input = UpdateAvailabilityBody.parse(request.body);
  const rows = await transaction(async (connection) => {
    await execute("DELETE FROM availability", [], connection);
    for (const item of input) {
      await execute(
        `INSERT INTO availability
          (day_of_week, start_time, end_time, is_active) VALUES (?, ?, ?, ?)`,
        [item.dayOfWeek, item.startTime, item.endTime, item.isActive],
        connection,
      );
    }
    return availabilityRows(connection);
  });
  response.json(rows);
});

async function settingValues(executor: Executor = pool) {
  const rows = await query<
    Array<RowDataPacket & { key: string; value: string }>
  >("SELECT `key`, `value` FROM practice_settings", [], executor);
  return Object.fromEntries(rows.map(({ key, value }) => [key, Number(value)]));
}

router.get("/admin/settings", adminOnly, async (_request, response) => {
  const values = await settingValues();
  response.json({
    bufferMin: values.buffer_min ?? 0,
    defaultDurations: {
      couples: values.default_couples_duration ?? 60,
      individual: values.default_individual_duration ?? 50,
      child_teen: values.default_child_teen_duration ?? 50,
      christian_counseling: values.default_christian_counseling_duration ?? 50,
    },
  });
});

router.patch("/admin/settings", adminOnly, async (request, response) => {
  const input = z
    .object({
      bufferMin: z.number().int().min(0).max(120),
      defaultDurations: z.object({
        couples: z
          .enum(["30", "45", "50", "60", "80", "90", "120"])
          .or(z.number()),
        individual: z
          .enum(["30", "45", "50", "60", "80", "90", "120"])
          .or(z.number()),
        child_teen: z
          .enum(["30", "45", "50", "60", "80", "90", "120"])
          .or(z.number()),
        christian_counseling: z
          .enum(["30", "45", "50", "60", "80", "90", "120"])
          .or(z.number()),
      }),
    })
    .parse(request.body);
  const durations = Object.fromEntries(
    Object.entries(input.defaultDurations).map(([key, value]) => [
      key,
      Number(value),
    ]),
  );
  const allowed = new Set([30, 45, 50, 60, 80, 90, 120]);
  if (Object.values(durations).some((value) => !allowed.has(value))) {
    response.status(400).json({ error: "Unsupported default duration" });
    return;
  }
  await transaction(async (connection) => {
    const save = async (key: string, value: number) =>
      execute(
        `INSERT INTO practice_settings (\`key\`, \`value\`) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`)`,
        [key, String(value)],
        connection,
      );
    await save("buffer_min", input.bufferMin);
    for (const [service, value] of Object.entries(durations)) {
      await save(`default_${service}_duration`, value);
    }
  });
  response.json({ bufferMin: input.bufferMin, defaultDurations: durations });
});

async function blockedTimes(executor: Executor = pool) {
  return query(
    `SELECT id, start_time AS startTime, end_time AS endTime, reason,
     created_at AS createdAt FROM blocked_times ORDER BY start_time`,
    [],
    executor,
  );
}

router.get("/admin/blocked-times", adminOnly, async (_request, response) => {
  response.json(await blockedTimes());
});

router.post("/admin/blocked-times", adminOnly, async (request, response) => {
  const input = CreateBlockedTimeBody.parse(request.body);
  const start = new Date(input.startTime);
  const end = new Date(input.endTime);
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    end <= start
  ) {
    response.status(400).json({ error: "Choose a valid blocked-time range" });
    return;
  }
  const row = await withCalendarLock(async (connection) => {
    const result = await execute(
      "INSERT INTO blocked_times (start_time, end_time, reason) VALUES (?, ?, ?)",
      [start.toISOString(), end.toISOString(), input.reason],
      connection,
    );
    return one(
      `SELECT id, start_time AS startTime, end_time AS endTime, reason,
       created_at AS createdAt FROM blocked_times WHERE id = ?`,
      [result.insertId],
      connection,
    );
  });
  response.status(201).json(row);
});

router.patch(
  "/admin/blocked-times/:id",
  adminOnly,
  async (request, response) => {
    const id = Number(request.params.id);
    const input = CreateBlockedTimeBody.parse(request.body);
    const row = await withCalendarLock(async (connection) => {
      const result = await execute(
        "UPDATE blocked_times SET start_time = ?, end_time = ?, reason = ? WHERE id = ?",
        [
          new Date(input.startTime).toISOString(),
          new Date(input.endTime).toISOString(),
          input.reason,
          id,
        ],
        connection,
      );
      if (result.affectedRows === 0) return undefined;
      return one(
        `SELECT id, start_time AS startTime, end_time AS endTime, reason,
       created_at AS createdAt FROM blocked_times WHERE id = ?`,
        [id],
        connection,
      );
    });
    if (!row) {
      response.status(404).json({ error: "Blocked time not found" });
      return;
    }
    response.json(row);
  },
);

router.delete(
  "/admin/blocked-times/:id",
  adminOnly,
  async (request, response) => {
    await withCalendarLock((connection) =>
      execute(
        "DELETE FROM blocked_times WHERE id = ?",
        [Number(request.params.id)],
        connection,
      ),
    );
    response.status(204).send();
  },
);

export default router;
