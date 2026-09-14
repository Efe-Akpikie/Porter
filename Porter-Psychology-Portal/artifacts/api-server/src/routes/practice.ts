import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import {
  CancelClientAppointmentParams,
  CreateAppointmentBody,
  CreateBlockedTimeBody,
  CreateClientNoteBody,
  CreateClientNoteParams,
  CreateWaitlistEntryBody,
  GetAdminCalendarQueryParams,
  GetAdminClientParams,
  GetAdminClientsQueryParams,
  GetAdminAppointmentsQueryParams,
  GetCurrentUserResponse,
  GetPublicSlotsQueryParams,
  LoginBody,
  UpdateAdminAppointmentBody,
  UpdateAdminAppointmentParams,
  UpdateAvailabilityBody,
  UpdateClientProfileBody,
} from "@workspace/api-zod";
import {
  ADMIN_TIMEZONE,
  appointmentResponse,
  getAppointment,
  getUserById,
  sqlite,
  userResponse,
  type DbAppointment,
} from "../lib/sqlite";
import {
  attachUser,
  clearSession,
  createSession,
  requireAuth,
  requireRole,
  type AuthenticatedRequest,
} from "../lib/auth";
import {
  getZonedParts,
  localDayBounds,
  timeWindowForInstant,
  weekdayForDate,
  zonedDateKey,
  zonedDateTimeToUtc,
} from "../lib/timezone";

const router: IRouter = Router();
const adminOnly = requireRole("admin");
const clientOnly = requireRole("client");

const appointmentSelect = `
  SELECT a.*, u.name AS client_name, u.email AS client_email
  FROM appointments a JOIN users u ON u.id = a.client_id
`;

function appointmentList(where = "", params: unknown[] = []) {
  return sqlite
    .prepare(`${appointmentSelect} ${where} ORDER BY a.start_time ASC`)
    .all(...params) as DbAppointment[];
}

function asAppointments(rows: DbAppointment[]) {
  return rows.map(appointmentResponse);
}

function waitlistResponse(row: {
  id: number;
  client_id: number;
  client_name: string;
  service_type: string;
  preferred_day: number;
  preferred_time_window: string;
  status: string;
  created_at: string;
}) {
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.client_name,
    serviceType: row.service_type,
    preferredDay: row.preferred_day,
    preferredTimeWindow: row.preferred_time_window,
    status: row.status,
    createdAt: row.created_at,
  };
}

function getDayOfWeek(date: string) {
  return weekdayForDate(date);
}

function formatSlotLabel(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ADMIN_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function buildSlots(date: string, duration: number) {
  const bufferMin = Number(
    (
      sqlite
        .prepare("SELECT value FROM practice_settings WHERE key = 'buffer_min'")
        .get() as { value?: string } | undefined
    )?.value ?? 0,
  );
  const bounds = localDayBounds(date, ADMIN_TIMEZONE);
  const availability = sqlite
    .prepare(
      "SELECT * FROM availability WHERE day_of_week = ? AND is_active = 1 ORDER BY start_time",
    )
    .all(getDayOfWeek(date)) as Array<{
    start_time: string;
    end_time: string;
  }>;
  const appointments = sqlite
    .prepare(
      `SELECT start_time, end_time FROM appointments
       WHERE status NOT IN ('cancelled') AND start_time < ? AND end_time > ?`,
    )
    .all(bounds.end.toISOString(), bounds.start.toISOString()) as Array<{
    start_time: string;
    end_time: string;
  }>;
  const blocked = sqlite
    .prepare(
      "SELECT start_time, end_time FROM blocked_times WHERE start_time < ? AND end_time > ?",
    )
    .all(bounds.end.toISOString(), bounds.start.toISOString()) as Array<{
    start_time: string;
    end_time: string;
  }>;
  const groups = {
    morning: [] as Array<{ startTime: string; endTime: string; label: string }>,
    afternoon: [] as Array<{
      startTime: string;
      endTime: string;
      label: string;
    }>,
    evening: [] as Array<{
      startTime: string;
      endTime: string;
      label: string;
    }>,
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
        const isAppointment = index < appointments.length;
        const padding = isAppointment ? bufferMin * 60_000 : 0;
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

function hasSchedulingConflict(
  start: Date,
  end: Date,
  excludeAppointmentId?: number,
) {
  const bufferMin = Number(
    (
      sqlite
        .prepare("SELECT value FROM practice_settings WHERE key = 'buffer_min'")
        .get() as { value?: string } | undefined
    )?.value ?? 0,
  );
  const paddedStart = new Date(
    start.getTime() - bufferMin * 60_000,
  ).toISOString();
  const paddedEnd = new Date(end.getTime() + bufferMin * 60_000).toISOString();
  const appointment = sqlite
    .prepare(
      `SELECT id FROM appointments
       WHERE status != 'cancelled' AND start_time < ? AND end_time > ?
       AND (? IS NULL OR id != ?)`,
    )
    .get(
      paddedEnd,
      paddedStart,
      excludeAppointmentId ?? null,
      excludeAppointmentId ?? null,
    );
  const blocked = sqlite
    .prepare(
      "SELECT id FROM blocked_times WHERE start_time < ? AND end_time > ?",
    )
    .get(end.toISOString(), start.toISOString());
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

router.post("/auth/login", (request, response) => {
  const input = LoginBody.parse(request.body);
  const user = sqlite
    .prepare("SELECT * FROM users WHERE lower(email) = lower(?)")
    .get(input.email) as
    (ReturnType<typeof getUserById> & { password_hash: string }) | undefined;
  if (!user || !bcrypt.compareSync(input.password, user.password_hash)) {
    response.status(401).json({ error: "Email or password is incorrect" });
    return;
  }
  createSession(user.id, response);
  response.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    timezone: user.timezone,
  });
});

router.post("/auth/logout", (request, response) => {
  clearSession(request, response);
  response.status(204).send();
});

router.get("/auth/me", (request, response) => {
  const user = attachUser(request as AuthenticatedRequest);
  if (!user) {
    response.status(401).json({ error: "Authentication required" });
    return;
  }
  response.json(
    GetCurrentUserResponse.parse({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      timezone: user.timezone,
    }),
  );
});

router.get("/public/slots", (request, response) => {
  const input = GetPublicSlotsQueryParams.parse({
    date: new Date(`${String(request.query.date)}T00:00:00Z`),
    duration: Number(request.query.duration),
  });
  response.json(
    buildSlots(input.date.toISOString().slice(0, 10), input.duration),
  );
});

router.get("/public/practice", (_request, response) => {
  const settings = Object.fromEntries(
    (
      sqlite
        .prepare("SELECT key, value FROM practice_settings")
        .all() as Array<{ key: string; value: string }>
    ).map(({ key, value }) => [key, Number(value)]),
  );
  response.json({ timezone: ADMIN_TIMEZONE, settings });
});

router.get("/client/dashboard", clientOnly, (request, response) => {
  const user = (request as AuthenticatedRequest).user!;
  const upcoming = appointmentList(
    "WHERE a.client_id = ? AND a.start_time >= ? AND a.status NOT IN ('cancelled')",
    [user.id, new Date().toISOString()],
  );
  const past = appointmentList(
    "WHERE a.client_id = ? AND (a.start_time < ? OR a.status IN ('completed', 'cancelled', 'no_show'))",
    [user.id, new Date().toISOString()],
  );
  const waitlist = sqlite
    .prepare(
      `SELECT w.*, u.name AS client_name FROM waitlist w
       JOIN users u ON u.id = w.client_id WHERE w.client_id = ? ORDER BY w.created_at DESC`,
    )
    .all(user.id);
  response.json({
    upcoming: asAppointments(upcoming),
    past: asAppointments(past),
    waitlist: waitlist.map(waitlistResponse),
  });
});

router.get("/client/profile", clientOnly, (request, response) => {
  const user = getUserById((request as AuthenticatedRequest).user!.id)!;
  response.json(userResponse(user));
});

router.patch("/client/profile", clientOnly, (request, response) => {
  const input = UpdateClientProfileBody.parse(request.body);
  const userId = (request as AuthenticatedRequest).user!.id;
  const current = getUserById(userId)!;
  sqlite
    .prepare(
      "UPDATE users SET name = COALESCE(?, name), phone = ?, timezone = COALESCE(?, timezone), notes = ? WHERE id = ?",
    )
    .run(
      input.name ?? null,
      input.phone === undefined ? current.phone : input.phone,
      input.timezone ?? null,
      input.notes === undefined ? current.notes : input.notes,
      userId,
    );
  response.json(userResponse(getUserById(userId)!));
});

router.get("/client/appointments", clientOnly, (request, response) => {
  response.json(
    asAppointments(
      appointmentList("WHERE a.client_id = ?", [
        (request as AuthenticatedRequest).user!.id,
      ]),
    ),
  );
});

router.post(
  "/client/appointments/:id/cancel",
  clientOnly,
  (request, response) => {
    const { id } = CancelClientAppointmentParams.parse(request.params);
    const userId = (request as AuthenticatedRequest).user!.id;
    const appointment = getAppointment(id);
    if (!appointment || appointment.client_id !== userId) {
      response.status(404).json({ error: "Appointment not found" });
      return;
    }
    sqlite
      .prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ?")
      .run(id);
    const localDate = zonedDateKey(appointment.start_time, ADMIN_TIMEZONE);
    const day = getDayOfWeek(localDate);
    const timeWindow = timeWindowForInstant(
      appointment.start_time,
      ADMIN_TIMEZONE,
    );
    sqlite
      .prepare(
        `UPDATE waitlist SET status = 'slot_available'
         WHERE id = (
           SELECT id FROM waitlist
           WHERE status = 'waiting' AND preferred_day = ?
             AND preferred_time_window = ? AND service_type = ?
           ORDER BY created_at ASC LIMIT 1
         )`,
      )
      .run(day, timeWindow, appointment.service_type);
    // TODO: integrate email service for cancellation and waitlist availability.
    response.json(appointmentResponse(getAppointment(id)!));
  },
);

router.post("/client/waitlist", clientOnly, (request, response) => {
  const input = CreateWaitlistEntryBody.parse(request.body);
  const userId = (request as AuthenticatedRequest).user!.id;
  const result = sqlite
    .prepare(
      `INSERT INTO waitlist
       (client_id, service_type, preferred_day, preferred_time_window, status)
       VALUES (?, ?, ?, ?, 'waiting')`,
    )
    .run(
      userId,
      input.serviceType,
      input.preferredDay,
      input.preferredTimeWindow,
    );
  const entry = sqlite
    .prepare(
      `SELECT w.*, u.name AS client_name FROM waitlist w JOIN users u ON u.id = w.client_id WHERE w.id = ?`,
    )
    .get(result.lastInsertRowid);
  response
    .status(201)
    .json(waitlistResponse(entry as Parameters<typeof waitlistResponse>[0]));
});

router.post("/appointments", requireAuth, (request, response) => {
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
  if (requester.role === "client") {
    const localDate = zonedDateKey(start, ADMIN_TIMEZONE);
    const slots = buildSlots(localDate, input.durationMin);
    const available = [
      ...slots.morning,
      ...slots.afternoon,
      ...slots.evening,
    ].some((slot) => slot.startTime === start.toISOString());
    if (!available) {
      response
        .status(409)
        .json({ error: "That time is outside current availability" });
      return;
    }
  }
  if (hasSchedulingConflict(start, end)) {
    response.status(409).json({ error: "That time is no longer available" });
    return;
  }
  const result = sqlite
    .prepare(
      `INSERT INTO appointments
       (client_id, start_time, end_time, service_type, duration_min, status, notes)
       VALUES (?, ?, ?, ?, ?, 'confirmed', ?)`,
    )
    .run(
      clientId,
      start.toISOString(),
      end.toISOString(),
      input.serviceType,
      input.durationMin,
      input.notes ?? null,
    );
  // TODO: integrate email service for booking confirmation.
  response
    .status(201)
    .json(appointmentResponse(getAppointment(Number(result.lastInsertRowid))!));
});

router.get("/admin/summary", adminOnly, (_request, response) => {
  const today = new Date();
  const todayKey = zonedDateKey(today, ADMIN_TIMEZONE);
  const todayBounds = localDayBounds(todayKey, ADMIN_TIMEZONE);
  const localNoon = new Date(`${todayKey}T12:00:00Z`);
  localNoon.setUTCDate(
    localNoon.getUTCDate() - ((localNoon.getUTCDay() + 6) % 7),
  );
  const weekStartKey = localNoon.toISOString().slice(0, 10);
  const weekStart = zonedDateTimeToUtc(weekStartKey, "00:00", ADMIN_TIMEZONE);
  localNoon.setUTCDate(localNoon.getUTCDate() + 7);
  const weekEnd = zonedDateTimeToUtc(
    localNoon.toISOString().slice(0, 10),
    "00:00",
    ADMIN_TIMEZONE,
  );
  const todayCount = sqlite
    .prepare(
      "SELECT COUNT(*) AS count FROM appointments WHERE start_time >= ? AND start_time < ? AND status NOT IN ('cancelled')",
    )
    .get(todayBounds.start.toISOString(), todayBounds.end.toISOString()) as {
    count: number;
  };
  const weekCount = sqlite
    .prepare(
      "SELECT COUNT(*) AS count FROM appointments WHERE start_time >= ? AND start_time < ? AND status NOT IN ('cancelled')",
    )
    .get(weekStart.toISOString(), weekEnd.toISOString()) as { count: number };
  const pendingWaitlist = sqlite
    .prepare(
      "SELECT COUNT(*) AS count FROM waitlist WHERE status IN ('waiting', 'slot_available')",
    )
    .get() as { count: number };
  const next = appointmentList(
    "WHERE a.start_time >= ? AND a.status NOT IN ('cancelled')",
    [new Date().toISOString()],
  )[0];
  response.json({
    todayCount: todayCount.count,
    weekCount: weekCount.count,
    pendingWaitlist: pendingWaitlist.count,
    ...(next ? { nextAppointment: appointmentResponse(next) } : {}),
  });
});

router.get("/admin/calendar", adminOnly, (request, response) => {
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
  const appointments = appointmentList(
    "WHERE a.start_time < ? AND a.end_time > ?",
    [end, start],
  );
  const blockedTimes = sqlite
    .prepare(
      "SELECT id, start_time AS startTime, end_time AS endTime, reason, created_at AS createdAt FROM blocked_times WHERE start_time < ? AND end_time > ? ORDER BY start_time",
    )
    .all(end, start);
  response.json({
    timezone: ADMIN_TIMEZONE,
    appointments: asAppointments(appointments),
    blockedTimes,
  });
});

router.get("/admin/appointments", adminOnly, (request, response) => {
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
      appointmentList(
        clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
        params,
      ),
    ),
  );
});

router.patch("/admin/appointments/:id", adminOnly, (request, response) => {
  const { id } = UpdateAdminAppointmentParams.parse(request.params);
  const input = UpdateAdminAppointmentBody.parse(request.body);
  const current = getAppointment(id);
  if (!current) {
    response.status(404).json({ error: "Appointment not found" });
    return;
  }
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
    response
      .status(400)
      .json({ error: "Appointment times and duration do not match" });
    return;
  }
  if (scheduleChanged && hasSchedulingConflict(start, end, id)) {
    response
      .status(409)
      .json({ error: "That time conflicts with the calendar" });
    return;
  }
  sqlite
    .prepare(
      `UPDATE appointments SET start_time = ?, end_time = ?, status = COALESCE(?, status),
       notes = ?, service_type = COALESCE(?, service_type), duration_min = COALESCE(?, duration_min)
       WHERE id = ?`,
    )
    .run(
      nextStart,
      nextEnd,
      input.status ?? null,
      input.notes === undefined ? current.notes : input.notes,
      input.serviceType ?? null,
      nextDuration,
      id,
    );
  response.json(appointmentResponse(getAppointment(id)!));
});

router.patch("/admin/appointments", adminOnly, (request, response) => {
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
  sqlite
    .prepare(`UPDATE appointments SET status = ? WHERE id IN (${placeholders})`)
    .run(input.status, ...input.ids);
  response.json(
    asAppointments(
      appointmentList(`WHERE a.id IN (${placeholders})`, input.ids),
    ),
  );
});

router.get("/admin/clients", adminOnly, (request, response) => {
  const input = GetAdminClientsQueryParams.parse(request.query);
  const search = input.search ? `%${input.search}%` : "%";
  const order =
    input.sort === "newest"
      ? "u.created_at DESC"
      : input.sort === "appointments"
        ? "appointment_count DESC"
        : "u.name COLLATE NOCASE ASC";
  const clients = sqlite
    .prepare(
      `SELECT u.id, u.name, u.email, u.phone, COUNT(a.id) AS appointment_count,
       MAX(a.start_time) AS last_appointment
       FROM users u LEFT JOIN appointments a ON a.client_id = u.id
       WHERE u.role = 'client' AND (u.name LIKE ? OR u.email LIKE ?)
       GROUP BY u.id ORDER BY ${order}`,
    )
    .all(search, search)
    .map((row) => ({
      id: (row as { id: number }).id,
      name: (row as { name: string }).name,
      email: (row as { email: string }).email,
      phone: (row as { phone: string | null }).phone,
      appointmentCount: Number(
        (row as { appointment_count: number }).appointment_count,
      ),
      lastAppointment: (row as { last_appointment: string | null })
        .last_appointment,
    }));
  response.json(clients);
});

router.get("/admin/clients/:id", adminOnly, (request, response) => {
  const { id } = GetAdminClientParams.parse(request.params);
  const client = getUserById(id);
  if (!client || client.role !== "client") {
    response.status(404).json({ error: "Client not found" });
    return;
  }
  const notes = sqlite
    .prepare(
      "SELECT id, client_id AS clientId, admin_id AS adminId, content, created_at AS createdAt FROM client_notes WHERE client_id = ? ORDER BY created_at DESC",
    )
    .all(id);
  response.json({
    profile: userResponse(client),
    appointments: asAppointments(
      appointmentList("WHERE a.client_id = ?", [id]),
    ),
    notes,
  });
});

router.post("/admin/clients/:id/notes", adminOnly, (request, response) => {
  const { id } = CreateClientNoteParams.parse(request.params);
  const input = CreateClientNoteBody.parse(request.body);
  const adminId = (request as AuthenticatedRequest).user!.id;
  const result = sqlite
    .prepare(
      "INSERT INTO client_notes (client_id, admin_id, content) VALUES (?, ?, ?)",
    )
    .run(id, adminId, input.content);
  response
    .status(201)
    .json(
      sqlite
        .prepare(
          "SELECT id, client_id AS clientId, admin_id AS adminId, content, created_at AS createdAt FROM client_notes WHERE id = ?",
        )
        .get(result.lastInsertRowid),
    );
});

router.get("/admin/waitlist", adminOnly, (_request, response) => {
  response.json(
    sqlite
      .prepare(
        `SELECT w.*, u.name AS client_name FROM waitlist w
         JOIN users u ON u.id = w.client_id ORDER BY w.created_at ASC`,
      )
      .all()
      .map((entry) =>
        waitlistResponse(entry as Parameters<typeof waitlistResponse>[0]),
      ),
  );
});

router.post("/admin/waitlist/:id/convert", adminOnly, (request, response) => {
  const id = Number(request.params.id);
  const input = CreateAppointmentBody.parse(request.body);
  const entry = sqlite
    .prepare("SELECT client_id, status FROM waitlist WHERE id = ?")
    .get(id) as { client_id: number; status: string } | undefined;
  if (!entry) {
    response.status(404).json({ error: "Waitlist entry not found" });
    return;
  }
  if (entry.status === "converted") {
    response.status(409).json({ error: "Waitlist entry is already converted" });
    return;
  }
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
  if (hasSchedulingConflict(start, end)) {
    response
      .status(409)
      .json({ error: "That time conflicts with the calendar" });
    return;
  }
  const result = sqlite
    .prepare(
      `INSERT INTO appointments
       (client_id, start_time, end_time, service_type, duration_min, status, notes)
       VALUES (?, ?, ?, ?, ?, 'confirmed', ?)`,
    )
    .run(
      entry.client_id,
      start.toISOString(),
      end.toISOString(),
      input.serviceType,
      input.durationMin,
      input.notes ?? null,
    );
  sqlite
    .prepare("UPDATE waitlist SET status = 'converted' WHERE id = ?")
    .run(id);
  response
    .status(201)
    .json(appointmentResponse(getAppointment(Number(result.lastInsertRowid))!));
});

router.get("/admin/availability", adminOnly, (_request, response) => {
  response.json(
    sqlite
      .prepare(
        "SELECT id, day_of_week AS dayOfWeek, start_time AS startTime, end_time AS endTime, is_active AS isActive FROM availability ORDER BY day_of_week, start_time",
      )
      .all()
      .map((row) => ({
        ...(row as object),
        isActive: Boolean((row as { isActive: number }).isActive),
      })),
  );
});

router.patch("/admin/availability", adminOnly, (request, response) => {
  const input = UpdateAvailabilityBody.parse(request.body);
  const update = sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM availability").run();
    const insert = sqlite.prepare(
      "INSERT INTO availability (day_of_week, start_time, end_time, is_active) VALUES (?, ?, ?, ?)",
    );
    input.forEach((item) =>
      insert.run(
        item.dayOfWeek,
        item.startTime,
        item.endTime,
        item.isActive ? 1 : 0,
      ),
    );
  });
  update();
  response.json(
    sqlite
      .prepare(
        "SELECT id, day_of_week AS dayOfWeek, start_time AS startTime, end_time AS endTime, is_active AS isActive FROM availability ORDER BY day_of_week, start_time",
      )
      .all()
      .map((row) => ({
        ...(row as object),
        isActive: Boolean((row as { isActive: number }).isActive),
      })),
  );
});

router.get("/admin/settings", adminOnly, (_request, response) => {
  const values = Object.fromEntries(
    (
      sqlite
        .prepare("SELECT key, value FROM practice_settings")
        .all() as Array<{ key: string; value: string }>
    ).map(({ key, value }) => [key, Number(value)]),
  );
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

router.patch("/admin/settings", adminOnly, (request, response) => {
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
  const allowed = new Set([30, 45, 50, 60, 80, 90, 120]);
  const durations = Object.fromEntries(
    Object.entries(input.defaultDurations).map(([key, value]) => [
      key,
      Number(value),
    ]),
  );
  if (Object.values(durations).some((value) => !allowed.has(value))) {
    response.status(400).json({ error: "Unsupported default duration" });
    return;
  }
  const save = sqlite.prepare(
    `INSERT INTO practice_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );
  const transaction = sqlite.transaction(() => {
    save.run("buffer_min", String(input.bufferMin));
    Object.entries(durations).forEach(([service, value]) =>
      save.run(`default_${service}_duration`, String(value)),
    );
  });
  transaction();
  response.json({ bufferMin: input.bufferMin, defaultDurations: durations });
});

router.get("/admin/blocked-times", adminOnly, (_request, response) => {
  response.json(
    sqlite
      .prepare(
        "SELECT id, start_time AS startTime, end_time AS endTime, reason, created_at AS createdAt FROM blocked_times ORDER BY start_time",
      )
      .all(),
  );
});

router.post("/admin/blocked-times", adminOnly, (request, response) => {
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
  const result = sqlite
    .prepare(
      "INSERT INTO blocked_times (start_time, end_time, reason) VALUES (?, ?, ?)",
    )
    .run(start.toISOString(), end.toISOString(), input.reason);
  response
    .status(201)
    .json(
      sqlite
        .prepare(
          "SELECT id, start_time AS startTime, end_time AS endTime, reason, created_at AS createdAt FROM blocked_times WHERE id = ?",
        )
        .get(result.lastInsertRowid),
    );
});

router.patch("/admin/blocked-times/:id", adminOnly, (request, response) => {
  const id = Number(request.params.id);
  const input = CreateBlockedTimeBody.parse(request.body);
  const result = sqlite
    .prepare(
      "UPDATE blocked_times SET start_time = ?, end_time = ?, reason = ? WHERE id = ?",
    )
    .run(
      new Date(input.startTime).toISOString(),
      new Date(input.endTime).toISOString(),
      input.reason,
      id,
    );
  if (result.changes === 0) {
    response.status(404).json({ error: "Blocked time not found" });
    return;
  }
  response.json(
    sqlite
      .prepare(
        "SELECT id, start_time AS startTime, end_time AS endTime, reason, created_at AS createdAt FROM blocked_times WHERE id = ?",
      )
      .get(id),
  );
});

router.delete("/admin/blocked-times/:id", adminOnly, (request, response) => {
  sqlite
    .prepare("DELETE FROM blocked_times WHERE id = ?")
    .run(Number(request.params.id));
  response.status(204).send();
});

export default router;
