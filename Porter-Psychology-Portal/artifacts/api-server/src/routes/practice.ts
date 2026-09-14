import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
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
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function localDateTime(date: string, time: string) {
  const offset = date >= "2026-03-08" && date < "2026-11-01" ? "-07:00" : "-08:00";
  return new Date(`${date}T${time}:00${offset}`);
}

function formatSlotLabel(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ADMIN_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function buildSlots(date: string, duration: number) {
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
    .all(
      new Date(`${date}T23:59:59Z`).toISOString(),
      new Date(`${date}T00:00:00Z`).toISOString(),
    ) as Array<{ start_time: string; end_time: string }>;
  const blocked = sqlite
    .prepare(
      "SELECT start_time, end_time FROM blocked_times WHERE start_time < ? AND end_time > ?",
    )
    .all(
      new Date(`${date}T23:59:59Z`).toISOString(),
      new Date(`${date}T00:00:00Z`).toISOString(),
    ) as Array<{ start_time: string; end_time: string }>;
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
    const start = localDateTime(date, window.start_time);
    const end = localDateTime(date, window.end_time);
    for (
      let cursor = start.getTime();
      cursor + duration * 60_000 <= end.getTime();
      cursor += 30 * 60_000
    ) {
      const slotStart = new Date(cursor);
      const slotEnd = new Date(cursor + duration * 60_000);
      const conflicts = [...appointments, ...blocked].some(
        (item) =>
          new Date(item.start_time).getTime() < slotEnd.getTime() &&
          new Date(item.end_time).getTime() > slotStart.getTime(),
      );
      if (slotStart.getTime() <= now || conflicts) continue;
      const slot = {
        startTime: slotStart.toISOString(),
        endTime: slotEnd.toISOString(),
        label: formatSlotLabel(slotStart),
      };
      const hour = slotStart.getHours();
      if (hour < 12) groups.morning.push(slot);
      else if (hour < 17) groups.afternoon.push(slot);
      else groups.evening.push(slot);
    }
  }
  return { timezone: ADMIN_TIMEZONE, ...groups };
}

router.post("/auth/login", (request, response) => {
  const input = LoginBody.parse(request.body);
  const user = sqlite
    .prepare("SELECT * FROM users WHERE lower(email) = lower(?)")
    .get(input.email) as
    | (ReturnType<typeof getUserById> & { password_hash: string })
    | undefined;
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
  response.json(GetCurrentUserResponse.parse({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    timezone: user.timezone,
  }));
});

router.get("/public/slots", (request, response) => {
  const input = GetPublicSlotsQueryParams.parse({
    date: new Date(`${String(request.query.date)}T00:00:00Z`),
    duration: Number(request.query.duration),
  });
  response.json(buildSlots(input.date.toISOString().slice(0, 10), input.duration));
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
  response.json({ upcoming: asAppointments(upcoming), past: asAppointments(past), waitlist: waitlist.map(waitlistResponse) });
});

router.get("/client/profile", clientOnly, (request, response) => {
  const user = getUserById((request as AuthenticatedRequest).user!.id)!;
  response.json(userResponse(user));
});

router.patch("/client/profile", clientOnly, (request, response) => {
  const input = UpdateClientProfileBody.parse(request.body);
  const userId = (request as AuthenticatedRequest).user!.id;
  sqlite
    .prepare(
      "UPDATE users SET name = COALESCE(?, name), phone = ?, timezone = COALESCE(?, timezone), notes = ? WHERE id = ?",
    )
    .run(input.name ?? null, input.phone ?? null, input.timezone ?? null, input.notes ?? null, userId);
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
    const day = getDayOfWeek(appointment.start_time.slice(0, 10));
    sqlite
      .prepare(
        `UPDATE waitlist SET status = 'slot_available'
         WHERE id = (
           SELECT id FROM waitlist
           WHERE status = 'waiting' AND preferred_day = ?
           ORDER BY created_at ASC LIMIT 1
         )`,
      )
      .run(day);
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
    .run(userId, input.serviceType, input.preferredDay, input.preferredTimeWindow);
  const entry = sqlite
    .prepare(
      `SELECT w.*, u.name AS client_name FROM waitlist w JOIN users u ON u.id = w.client_id WHERE w.id = ?`,
    )
    .get(result.lastInsertRowid);
  response.status(201).json(waitlistResponse(entry as Parameters<typeof waitlistResponse>[0]));
});

router.post("/appointments", requireAuth, (request, response) => {
  const input = CreateAppointmentBody.parse(request.body);
  const requester = (request as AuthenticatedRequest).user!;
  const clientId = requester.role === "admin" ? input.clientId : requester.id;
  const start = new Date(input.startTime);
  const end = new Date(input.endTime);
  const conflict = sqlite
    .prepare(
      `SELECT id FROM appointments
       WHERE status NOT IN ('cancelled') AND start_time < ? AND end_time > ?`,
    )
    .get(end.toISOString(), start.toISOString());
  if (conflict) {
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
  response.status(201).json(appointmentResponse(getAppointment(Number(result.lastInsertRowid))!));
});

router.get("/admin/summary", adminOnly, (_request, response) => {
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay() + 1);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);
  const todayCount = sqlite
    .prepare(
      "SELECT COUNT(*) AS count FROM appointments WHERE date(start_time) = ? AND status NOT IN ('cancelled')",
    )
    .get(todayKey) as { count: number };
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
  const input = GetAdminCalendarQueryParams.parse(request.query);
  const start = input.start ?? new Date().toISOString();
  const end =
    input.end ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
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
  const input = GetAdminAppointmentsQueryParams.parse(request.query);
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
    params.push(input.start);
  }
  if (input.end) {
    clauses.push("a.start_time < ?");
    params.push(input.end);
  }
  response.json(asAppointments(appointmentList(clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params)));
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
      input.notes ?? null,
      input.serviceType ?? null,
      input.durationMin ?? null,
      id,
    );
  response.json(appointmentResponse(getAppointment(id)!));
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
      appointmentCount: Number((row as { appointment_count: number }).appointment_count),
      lastAppointment: (row as { last_appointment: string | null }).last_appointment,
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
    appointments: asAppointments(appointmentList("WHERE a.client_id = ?", [id])),
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
  response.status(201).json(
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
      .map((entry) => waitlistResponse(entry as Parameters<typeof waitlistResponse>[0])),
  );
});

router.post("/admin/waitlist/:id/convert", adminOnly, (request, response) => {
  const id = Number(request.params.id);
  const input = CreateAppointmentBody.parse(request.body);
  const result = sqlite
    .prepare(
      `INSERT INTO appointments
       (client_id, start_time, end_time, service_type, duration_min, status, notes)
       VALUES (?, ?, ?, ?, ?, 'confirmed', ?)`,
    )
    .run(
      input.clientId,
      input.startTime,
      input.endTime,
      input.serviceType,
      input.durationMin,
      input.notes ?? null,
    );
  sqlite.prepare("UPDATE waitlist SET status = 'converted' WHERE id = ?").run(id);
  response.status(201).json(appointmentResponse(getAppointment(Number(result.lastInsertRowid))!));
});

router.get("/admin/availability", adminOnly, (_request, response) => {
  response.json(
    sqlite
      .prepare(
        "SELECT id, day_of_week AS dayOfWeek, start_time AS startTime, end_time AS endTime, is_active AS isActive FROM availability ORDER BY day_of_week, start_time",
      )
      .all()
      .map((row) => ({ ...row as object, isActive: Boolean((row as { isActive: number }).isActive) })),
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
      insert.run(item.dayOfWeek, item.startTime, item.endTime, item.isActive ? 1 : 0),
    );
  });
  update();
  response.json(
    sqlite
      .prepare(
        "SELECT id, day_of_week AS dayOfWeek, start_time AS startTime, end_time AS endTime, is_active AS isActive FROM availability ORDER BY day_of_week, start_time",
      )
      .all()
      .map((row) => ({ ...row as object, isActive: Boolean((row as { isActive: number }).isActive) })),
  );
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
  const result = sqlite
    .prepare(
      "INSERT INTO blocked_times (start_time, end_time, reason) VALUES (?, ?, ?)",
    )
    .run(input.startTime, input.endTime, input.reason);
  response.status(201).json(
    sqlite
      .prepare(
        "SELECT id, start_time AS startTime, end_time AS endTime, reason, created_at AS createdAt FROM blocked_times WHERE id = ?",
      )
      .get(result.lastInsertRowid),
  );
});

router.delete("/admin/blocked-times/:id", adminOnly, (request, response) => {
  sqlite.prepare("DELETE FROM blocked_times WHERE id = ?").run(Number(request.params.id));
  response.status(204).send();
});

export default router;