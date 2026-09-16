import {
  type ReactNode,
  type ButtonHTMLAttributes,
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link, Route, Switch, useLocation, useParams } from "wouter";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type {
  DateSelectArg,
  EventClickArg,
  EventDropArg,
} from "@fullcalendar/core";
import type { EventResizeDoneArg } from "@fullcalendar/interaction";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  Clock3,
  CloudSun,
  HeartHandshake,
  Home,
  KeyRound,
  LogOut,
  Menu,
  MoreHorizontal,
  PanelLeft,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Users,
  X,
} from "lucide-react";
import {
  getGetAdminAppointmentsQueryKey,
  getGetAdminCalendarQueryKey,
  getGetAdminClientQueryKey,
  getGetAdminClientsQueryKey,
  getGetAdminSummaryQueryKey,
  getGetAdminSettingsQueryKey,
  getGetAdminPricesQueryKey,
  getGetAdminWaitlistQueryKey,
  getGetAvailabilityQueryKey,
  getGetBlockedTimesQueryKey,
  getGetClientAppointmentsQueryKey,
  getGetClientDashboardQueryKey,
  getGetClientProfileQueryKey,
  getGetCurrentUserQueryKey,
  getGetAppointmentMeetingQueryKey,
  getGetPublicSlotsQueryKey,
  getGetPublicPracticeQueryKey,
  useCancelClientAppointment,
  useBulkUpdateAdminAppointments,
  useConvertWaitlistEntry,
  useCreateAppointment,
  useCreateAppointmentCheckout,
  useCreateBlockedTime,
  useCreateClientNote,
  useCreateWaitlistEntry,
  useDeleteBlockedTime,
  useGetAdminAppointments,
  useGetAdminCalendar,
  useGetAdminClient,
  useGetAdminClients,
  useGetAdminSummary,
  useGetAdminSettings,
  useGetAdminPrices,
  useGetAdminWaitlist,
  useGetAvailability,
  useGetBlockedTimes,
  useGetClientAppointments,
  useGetClientDashboard,
  useGetClientProfile,
  useGetCurrentUser,
  useGetAppointmentMeeting,
  useGetPublicSlots,
  useGetPublicPractice,
  useHealthCheck,
  useLogin,
  useLogout,
  useRegister,
  useResendVerification,
  useVerifyEmail,
  useVerifyEmailChange,
  useForgotPassword,
  useResetPassword,
  useChangePassword,
  useChangeEmail,
  useRefundAdminAppointment,
  useRestoreClientConsultation,
  useUpdateAdminAppointment,
  useUpdateAdminSettings,
  useUpdateAdminPrices,
  useUpdateAvailability,
  useUpdateBlockedTime,
  useUpdateClientProfile,
} from "@workspace/api-client-react";
import type {
  Appointment,
  AppointmentStatus,
  BlockedTime,
  PracticeSettings,
  ServicePrice,
  ServiceType,
  WaitlistEntry,
} from "@workspace/api-client-react";
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Calendar } from "@/components/ui/calendar";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();
const durationOptions = [15, 30, 45, 50, 60, 80, 90, 120] as const;
const paidDurationOptions = [30, 45, 50, 60, 80, 90, 120] as const;
const paidServiceTypes = [
  "couples",
  "individual",
  "child_teen",
  "christian_counseling",
] as const;
const serviceColors: Record<ServiceType, string> = {
  consultation: "#4f7f72",
  couples: "#6b8cae",
  individual: "#8ba888",
  child_teen: "#c4956a",
  christian_counseling: "#8b78a6",
};
const serviceNames: Record<string, string> = {
  consultation: "Free introductory consultation",
  couples: "Couples therapy",
  individual: "Individual therapy",
  child_teen: "Child & teen support",
  christian_counseling: "Christian counseling",
};
const serviceDescription = (service: string) =>
  `[Insert service description for ${serviceNames[service] ?? service}]`;
const fmtDate = (value?: string) =>
  value
    ? new Date(value).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : "Not scheduled";
const fmtTime = (value?: string) =>
  value
    ? new Date(value).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
const titleCase = (value: string) =>
  value.replaceAll("_", " ").replace(/\b\w/g, (l) => l.toUpperCase());
const startOfWeek = () => {
  const value = new Date();
  const daysSinceMonday = (value.getDay() + 6) % 7;
  value.setDate(value.getDate() - daysSinceMonday);
  value.setHours(0, 0, 0, 0);
  return value;
};
const initials = (name?: string) =>
  name
    ?.split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "PP";
const toDateInput = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const zonedToUtc = (date: string, time: string, timeZone: string) => {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const offsetAt = (instant: Date) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(instant)
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
    return (
      Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second,
      ) - instant.getTime()
    );
  };
  let result = localAsUtc - offsetAt(new Date(localAsUtc));
  result = localAsUtc - offsetAt(new Date(result));
  return new Date(result);
};
const dateInZone = (value: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
const timeInZone = (value: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
const invalidate = (...keys: ReadonlyArray<readonly unknown[]>) =>
  Promise.all(
    keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  );

function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "quiet" | "outline" | "danger";
}) {
  const variants = {
    primary: "bg-primary text-primary-foreground hover:bg-primary/90",
    quiet: "bg-muted text-foreground hover:bg-muted/70",
    outline: "border border-border bg-transparent hover:bg-muted",
    danger: "bg-destructive/10 text-destructive hover:bg-destructive/15",
  };
  return (
    <button
      className={`button focus-ring inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
function Badge({
  children,
  tone = "sage",
}: {
  children: ReactNode;
  tone?: "sage" | "sand" | "blue" | "red" | "slate";
}) {
  const tones = {
    sage: "bg-primary/10 text-primary",
    sand: "bg-accent/35 text-foreground",
    blue: "bg-secondary/10 text-secondary",
    red: "bg-destructive/10 text-destructive",
    slate: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`soft-card ${className}`}>{children}</div>;
}
function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`animate-pulse-soft rounded-lg bg-muted ${className}`} />
  );
}
function LoadingState() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Skeleton className="h-28" />
      <Skeleton className="h-28" />
      <Skeleton className="h-64 sm:col-span-2" />
    </div>
  );
}
function EmptyState({
  title,
  copy,
  action,
}: {
  title: string;
  copy: string;
  action?: ReactNode;
}) {
  return (
    <Card className="flex min-h-48 flex-col items-center justify-center p-8 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Sparkles size={20} />
      </div>
      <h3 className="display text-xl">{title}</h3>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">{copy}</p>
      {action && <div className="mt-5">{action}</div>}
    </Card>
  );
}
function PageTitle({
  eyebrow,
  title,
  copy,
  action,
}: {
  eyebrow?: string;
  title: string;
  copy?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="mono text-[11px] uppercase tracking-[.2em] text-secondary">
          {eyebrow}
        </p>
        <h1 className="display mt-2 text-4xl leading-tight text-foreground sm:text-5xl">
          {title}
        </h1>
        {copy && (
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            {copy}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
function Logo() {
  return (
    <Link
      href="/"
      className="focus-ring inline-flex items-center gap-3"
      data-testid="link-home"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-primary text-primary-foreground">
        <HeartHandshake size={19} />
      </span>
      <span>
        <span className="display block text-lg leading-none">Porter</span>
        <span className="mono text-[10px] uppercase tracking-[.2em] text-muted-foreground">
          Psychology
        </span>
      </span>
    </Link>
  );
}

function PublicNav() {
  const [open, setOpen] = useState(false);
  return (
    <header className="absolute inset-x-0 top-0 z-10">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-6 lg:px-10">
        <Logo />
        <button
          className="rounded-full border border-border p-2 lg:hidden"
          onClick={() => setOpen(!open)}
          data-testid="button-open-menu"
        >
          <Menu size={18} />
        </button>
        <nav
          className={`${open ? "absolute left-5 right-5 top-20 flex" : "hidden"} flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-md lg:static lg:flex lg:flex-row lg:items-center lg:gap-8 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none`}
        >
          <a
            href="#practice"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            The practice
          </a>
          <a
            href="#services"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Services
          </a>
          <a
            href="#how-it-works"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            How it works
          </a>
          <a
            href="#approach"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Approach
          </a>
          <Link
            href="/login"
            className="button rounded-full bg-primary px-5 py-2.5 text-center text-sm font-semibold text-primary-foreground"
            data-testid="link-client-login"
          >
            Client sign in
          </Link>
        </nav>
      </div>
    </header>
  );
}
function Landing() {
  const { isLoading } = useHealthCheck({
    query: { queryKey: ["health"], staleTime: 60000 },
  });
  return (
    <div className="texture overflow-hidden">
      <PublicNav />
      <main>
        <section className="relative min-h-[720px] overflow-hidden bg-[#dfe8df] px-5 pb-20 pt-36 lg:px-10">
          <div className="absolute -right-24 top-24 h-[440px] w-[440px] rounded-full border border-primary/20 lg:right-[8%]" />
          <div className="absolute -right-10 top-40 h-[320px] w-[320px] rounded-full border border-primary/20" />
          <div className="mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[1fr_440px]">
            <div className="max-w-2xl animate-rise">
              <p className="mono text-[11px] uppercase tracking-[.28em] text-primary">
                A quieter place to begin
              </p>
              <h1 className="display mt-6 text-6xl leading-[.96] text-[#263b39] sm:text-8xl">
                Space to feel,
                <br />
                <em className="text-secondary">room to grow.</em>
              </h1>
              <p className="mt-7 max-w-lg text-lg leading-8 text-[#4d625f]">
                [Insert tagline]
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <Link
                  href="/client/book"
                  className="button inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground"
                  data-testid="link-book-session"
                >
                  Book a session <ArrowRight size={16} />
                </Link>
                <a
                  href="#practice"
                  className="button inline-flex items-center rounded-full border border-primary/30 px-6 py-3 text-sm font-semibold text-primary hover:bg-primary/10"
                  data-testid="link-learn-practice"
                >
                  Learn about the practice
                </a>
              </div>
              <p className="mt-8 text-xs text-[#5f736e]">
                Virtual care for couples, individuals, families, and those
                seeking Christian counseling.
              </p>
            </div>
            <div className="relative mx-auto h-[440px] w-[340px] max-w-full animate-rise animate-rise-2">
              <div className="absolute inset-5 rounded-[52%_48%_45%_55%] bg-[#c2d1c1]" />
              <div className="absolute inset-10 rounded-[46%_54%_53%_47%] border border-primary/30" />
              <img
                src="/images/lara-akinpelu.png"
                alt="Lara Akinpelu, Registered Provisional Psychologist"
                className="absolute inset-x-0 top-0 h-[390px] w-full object-contain object-bottom drop-shadow-xl"
              />
              <div className="absolute inset-x-3 bottom-0 rounded-2xl border border-white/60 bg-[#f7f0e5]/95 px-5 py-4 text-center shadow-lg backdrop-blur-sm">
                <p className="display text-2xl text-[#263b39]">
                  Lara Akinpelu, MS
                </p>
                <p className="mt-2 text-sm text-[#536762]">
                  Registered Provisional Psychologist
                </p>
              </div>
            </div>
          </div>
        </section>
        <section
          id="practice"
          className="mx-auto grid max-w-7xl gap-12 px-5 py-24 lg:grid-cols-[.7fr_1.3fr] lg:px-10"
        >
          <div>
            <p className="mono text-[11px] uppercase tracking-[.22em] text-secondary">
              The practice
            </p>
            <h2 className="display mt-4 text-4xl leading-tight sm:text-5xl">
              You do not have to carry it alone.
            </h2>
          </div>
          <div className="space-y-7 text-muted-foreground">
            <div className="space-y-5 leading-7">
              <p>
                Lara Akinpelu, MS, is a Registered Provisional Psychologist with
                the College of Alberta Psychologists. She holds a master&apos;s
                degree in General Psychology from Walden University in
                Minneapolis, Minnesota, and has completed the core counseling
                psychology coursework required for provisional registration in
                Alberta. She has also completed 1,600 hours of supervised
                practice.
              </p>
              <p>
                Lara is passionate about working with couples and believes that
                healthy relationships help nurture emotionally stable children,
                strong families, and healthy communities. In her pursuit of
                further training in couples counseling, she completed Levels 1
                and 2 of Gottman Couples Therapy training. She has also
                completed Beck Cognitive Behavior Therapy training focused on
                depression and suicide prevention.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col rounded-2xl bg-muted p-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-secondary">
                  Education & certifications
                </p>
                <p className="mt-3 leading-7">
                  MS, General Psychology · Gottman Couples Therapy, Levels 1 and
                  2 · Beck Cognitive Behavior Therapy training · Certified
                  Autism Specialist
                </p>
                <a
                  href="https://apps.ibcces.org/badges/v/1969967"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Verify Lara Akinpelu's Certified Autism Specialist credential in a new tab"
                  className="mt-5 flex flex-1 items-center justify-center rounded-xl bg-white p-4 transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <img
                    src="/images/certified-autism-specialist.png"
                    alt="Lara Akinpelu, Certified Autism Specialist"
                    className="h-40 w-auto object-contain"
                  />
                </a>
              </div>
              <div className="rounded-2xl bg-muted p-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-secondary">
                  Collaborative care
                </p>
                <p className="mt-3 leading-7">
                  Integrating the Gottman Method, Solution-Focused Therapy, and
                  Cognitive Therapy with a flexible approach.
                </p>
              </div>
            </div>
            <p className="text-sm leading-7">
              Specialties include anxiety, anger management, autism, ADHD,
              depression, grief, parenting, relationships, suicide prevention,
              and Christian counseling by request.
            </p>
          </div>
        </section>
        <section id="services" className="bg-[#f0e7d8] px-5 py-24 lg:px-10">
          <div className="mx-auto max-w-7xl">
            <div className="mb-12 flex items-end justify-between gap-5">
              <div>
                <p className="mono text-[11px] uppercase tracking-[.22em] text-secondary">
                  Ways we can work together
                </p>
                <h2 className="display mt-4 text-4xl sm:text-5xl">
                  A place for your whole story.
                </h2>
              </div>
              <ArrowRight className="hidden text-secondary sm:block" />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <ServiceCard service="individual" number="01" />
              <ServiceCard service="couples" number="02" />
              <ServiceCard service="child_teen" number="03" />
              <ServiceCard service="christian_counseling" number="04" />
            </div>
          </div>
        </section>
        <section
          id="how-it-works"
          className="mx-auto max-w-7xl px-5 py-24 lg:px-10"
        >
          <p className="mono text-[11px] uppercase tracking-[.22em] text-secondary">
            How it works
          </p>
          <h2 className="display mt-4 max-w-xl text-4xl sm:text-5xl">
            Care that meets you where you are.
          </h2>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            <ApproachRow
              n="01"
              title="Choose a session"
              copy="Sign in and choose the service, duration, date, and time that work for you."
            />
            <ApproachRow
              n="02"
              title="Meet virtually"
              copy="Every appointment takes place by secure video or phone—no travel required."
            />
            <ApproachRow
              n="03"
              title="Join the waitlist"
              copy="If the right time is unavailable, share your preferred day and time window."
            />
          </div>
        </section>
        <section
          id="approach"
          className="mx-auto max-w-7xl px-5 py-24 lg:px-10"
        >
          <div className="grid gap-12 lg:grid-cols-[1fr_1fr]">
            <div>
              <p className="mono text-[11px] uppercase tracking-[.22em] text-secondary">
                A grounded approach
              </p>
              <h2 className="display mt-4 text-4xl leading-tight sm:text-6xl">
                Warmth, clarity,
                <br />
                <span className="text-secondary">and useful next steps.</span>
              </h2>
            </div>
            <div className="space-y-8">
              <ApproachRow
                n="01"
                title="Listen without fixing"
                copy="We start with what is actually happening, not a version you have prepared for someone else."
              />
              <ApproachRow
                n="02"
                title="Make meaning together"
                copy="Patterns become easier to shift when they are named with compassion and context."
              />
              <ApproachRow
                n="03"
                title="Move at a human pace"
                copy="Your care plan should fit your real life. We will keep checking that it does."
              />
            </div>
          </div>
        </section>
        <section className="bg-primary px-5 py-20 text-primary-foreground lg:px-10">
          <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-8 sm:flex-row sm:items-end">
            <div>
              <p className="mono text-[11px] uppercase tracking-[.22em] text-primary-foreground/70">
                A first step can be small
              </p>
              <h2 className="display mt-4 max-w-xl text-4xl leading-tight sm:text-5xl">
                Come as you are. We will start there.
              </h2>
            </div>
            <Link
              href="/login"
              className="button inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-semibold text-foreground"
              data-testid="link-footer-book"
            >
              Find a time <ArrowRight size={16} />
            </Link>
          </div>
        </section>
      </main>
      <footer className="bg-[#263b39] px-5 py-9 text-[#e9eee6] lg:px-10">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-5 sm:flex-row sm:items-center">
          <Logo />
          <p className="text-xs text-[#afc0b8]">
            Virtual psychology care with Lara Akinpelu.
          </p>
        </div>
      </footer>
      {isLoading && (
        <span className="sr-only">Checking practice availability</span>
      )}
    </div>
  );
}
function ServiceCard({ service, number }: { service: string; number: string }) {
  return (
    <Card className="group flex min-h-44 flex-col justify-between bg-[#f7f0e5] p-6">
      <div className="flex justify-between">
        <span className="mono text-xs text-secondary">{number}</span>
        <ArrowRight
          className="text-secondary transition-transform group-hover:translate-x-1"
          size={18}
        />
      </div>
      <div>
        <h3 className="display text-2xl">{serviceNames[service]}</h3>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          {serviceDescription(service)}
        </p>
      </div>
    </Card>
  );
}
function ApproachRow({
  n,
  title,
  copy,
}: {
  n: string;
  title: string;
  copy: string;
}) {
  return (
    <div className="grid grid-cols-[48px_1fr] gap-4 border-t border-border pt-5">
      <span className="mono text-xs text-secondary">{n}</span>
      <div>
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{copy}</p>
      </div>
    </div>
  );
}

function Login() {
  const [, setLocation] = useLocation();
  const login = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate(
      { data: { email, password } },
      {
        onSuccess: (user) =>
          setLocation(user.role === "admin" ? "/admin" : "/client"),
      },
    );
  };
  return (
    <div className="texture grid min-h-[100dvh] lg:grid-cols-[.85fr_1.15fr]">
      <div className="hidden bg-[#dfe8df] p-10 lg:flex lg:flex-col lg:justify-between">
        <Logo />
        <div className="max-w-md">
          <p className="mono text-[11px] uppercase tracking-[.22em] text-primary">
            Your care space
          </p>
          <h1 className="display mt-5 text-6xl leading-[1.02] text-[#263b39]">
            A gentle place to keep moving.
          </h1>
          <p className="mt-6 leading-7 text-[#536762]">
            Appointments, messages, and next steps — gathered in one reassuring
            space.
          </p>
        </div>
        <p className="text-xs text-[#536762]">
          Porter Psychology · Virtual practice
        </p>
      </div>
      <div className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-md">
          <div className="mb-10 lg:hidden">
            <Logo />
          </div>
          <p className="mono text-[11px] uppercase tracking-[.22em] text-secondary">
            Welcome back
          </p>
          <h1 className="display mt-3 text-4xl">Sign in to your space.</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Use the email connected to your Porter Psychology account.
          </p>
          <form className="mt-8 space-y-5" onSubmit={submit}>
            <label className="block text-sm font-semibold">
              Email
              <input
                data-testid="input-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                required
                placeholder="you@example.com"
                className="mt-2 w-full rounded-xl border border-input bg-card px-4 py-3 text-sm"
              />
            </label>
            <label className="block text-sm font-semibold">
              Password
              <input
                data-testid="input-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                required
                placeholder="Your password"
                className="mt-2 w-full rounded-xl border border-input bg-card px-4 py-3 text-sm"
              />
              <Link
                href="/forgot-password"
                className="mt-2 block text-right text-xs font-semibold text-primary hover:underline"
              >
                Forgot password?
              </Link>
            </label>
            {login.isError && (
              <p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
                We could not sign you in. Please check your details and try
                again.
              </p>
            )}
            <Button
              data-testid="button-submit-login"
              className="w-full"
              disabled={login.isPending}
            >
              {login.isPending ? "Signing you in…" : "Continue securely"}
            </Button>
          </form>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            New client?{" "}
            <Link
              href="/register"
              className="font-semibold text-primary hover:underline"
            >
              Create your account
            </Link>
          </p>
          <Link
            href="/"
            className="mt-8 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            data-testid="link-back-home"
          >
            <ArrowLeft size={15} /> Return to Porter Psychology
          </Link>
        </div>
      </div>
    </div>
  );
}

function Register() {
  const [, setLocation] = useLocation();
  const register = useRegister();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const passwordsMatch = password === confirmation;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!passwordsMatch) return;
    register.mutate(
      {
        data: {
          name,
          email,
          password,
          phone: phone.trim() || undefined,
          timezone:
            Intl.DateTimeFormat().resolvedOptions().timeZone ||
            "America/Vancouver",
        },
      },
      {
        onSuccess: (user) => {
          queryClient.setQueryData(getGetCurrentUserQueryKey(), user);
          setLocation("/client");
        },
      },
    );
  };

  return (
    <div className="texture flex min-h-[100dvh] items-center justify-center px-5 py-10">
      <div className="w-full max-w-lg rounded-3xl border border-border bg-card p-6 shadow-sm sm:p-10">
        <Logo />
        <p className="mono mt-10 text-[11px] uppercase tracking-[.22em] text-secondary">
          Client registration
        </p>
        <h1 className="display mt-3 text-4xl">Create your care space.</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Create an account to view availability and book virtual sessions.
        </p>
        <form className="mt-8 grid gap-5 sm:grid-cols-2" onSubmit={submit}>
          <label className="block text-sm font-semibold sm:col-span-2">
            Full name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              autoComplete="name"
              className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm"
            />
          </label>
          <label className="block text-sm font-semibold sm:col-span-2">
            Email
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              required
              autoComplete="email"
              className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm"
            />
          </label>
          <label className="block text-sm font-semibold sm:col-span-2">
            Phone{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              type="tel"
              autoComplete="tel"
              className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm"
            />
          </label>
          <label className="block text-sm font-semibold">
            Password
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              minLength={12}
              required
              autoComplete="new-password"
              className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm"
            />
          </label>
          <label className="block text-sm font-semibold">
            Confirm password
            <input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              type="password"
              minLength={12}
              required
              autoComplete="new-password"
              className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm"
            />
          </label>
          {!passwordsMatch && confirmation && (
            <p className="text-sm text-destructive sm:col-span-2">
              Passwords do not match.
            </p>
          )}
          {register.isError && (
            <p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive sm:col-span-2">
              {register.error.message.includes("already exists")
                ? "An account with that email already exists."
                : "We could not create your account. Please review your details and try again."}
            </p>
          )}
          <Button
            className="sm:col-span-2"
            disabled={register.isPending || !passwordsMatch}
          >
            {register.isPending ? "Creating account…" : "Create account"}
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-semibold text-primary hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

function ForgotPassword() {
  const forgot = useForgotPassword();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  return (
    <div className="texture flex min-h-[100dvh] items-center justify-center px-5">
      <Card className="w-full max-w-md p-8">
        <Logo />
        <h1 className="display mt-10 text-4xl">Reset your password.</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Enter your account email. If it exists, we will send a secure reset
          link.
        </p>
        {sent ? (
          <p className="mt-7 rounded-xl bg-primary/10 p-4 text-sm text-primary">
            Check your email for the reset link.
          </p>
        ) : (
          <form
            className="mt-7"
            onSubmit={(event) => {
              event.preventDefault();
              forgot.mutate(
                { data: { email } },
                { onSuccess: () => setSent(true) },
              );
            }}
          >
            <label className="text-sm font-semibold">
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-2 w-full rounded-xl border border-input px-4 py-3"
              />
            </label>
            <Button className="mt-5 w-full" disabled={forgot.isPending}>
              {forgot.isPending ? "Sending…" : "Send reset link"}
            </Button>
          </form>
        )}
        <Link href="/login" className="mt-6 inline-block text-sm text-primary">
          Return to sign in
        </Link>
      </Card>
    </div>
  );
}

function ResetPassword() {
  const reset = useResetPassword();
  const [, setLocation] = useLocation();
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  return (
    <div className="texture flex min-h-[100dvh] items-center justify-center px-5">
      <Card className="w-full max-w-md p-8">
        <Logo />
        <h1 className="display mt-10 text-4xl">Choose a new password.</h1>
        <form
          className="mt-7 space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (password !== confirmation) return;
            reset.mutate(
              { data: { token, password } },
              { onSuccess: () => setLocation("/login") },
            );
          }}
        >
          <label className="block text-sm font-semibold">
            New password
            <input
              type="password"
              minLength={12}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 w-full rounded-xl border border-input px-4 py-3"
            />
          </label>
          <label className="block text-sm font-semibold">
            Confirm password
            <input
              type="password"
              minLength={12}
              required
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              className="mt-2 w-full rounded-xl border border-input px-4 py-3"
            />
          </label>
          {password !== confirmation && confirmation && (
            <p className="text-sm text-destructive">Passwords do not match.</p>
          )}
          {reset.isError && (
            <p className="text-sm text-destructive">{reset.error.message}</p>
          )}
          <Button
            className="w-full"
            disabled={!token || password !== confirmation || reset.isPending}
          >
            Reset password
          </Button>
        </form>
      </Card>
    </div>
  );
}

function VerifyEmail() {
  const verify = useVerifyEmail();
  const [, setLocation] = useLocation();
  const started = useRef(false);
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    verify.mutate(
      { data: { token } },
      {
        onSuccess: (user) => {
          queryClient.setQueryData(getGetCurrentUserQueryKey(), user);
          setLocation("/client");
        },
      },
    );
  }, [setLocation, token, verify]);
  return (
    <TokenStatus pending={verify.isPending} error={verify.isError || !token} />
  );
}

function VerifyEmailChange() {
  const verify = useVerifyEmailChange();
  const [, setLocation] = useLocation();
  const started = useRef(false);
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    verify.mutate(
      { data: { token } },
      {
        onSuccess: (user) => {
          queryClient.setQueryData(getGetCurrentUserQueryKey(), user);
          setLocation("/client/profile");
        },
      },
    );
  }, [setLocation, token, verify]);
  return (
    <TokenStatus pending={verify.isPending} error={verify.isError || !token} />
  );
}

function TokenStatus({ pending, error }: { pending: boolean; error: boolean }) {
  return (
    <div className="texture flex min-h-[100dvh] items-center justify-center px-5">
      <Card className="w-full max-w-md p-8 text-center">
        <Logo />
        <h1 className="display mt-10 text-4xl">
          {error
            ? "This link could not be verified."
            : "Verifying your account…"}
        </h1>
        {pending && <Skeleton className="mx-auto mt-6 h-3 w-2/3" />}
        {error && (
          <Link
            href="/login"
            className="mt-6 inline-block text-sm text-primary"
          >
            Return to sign in
          </Link>
        )}
      </Card>
    </div>
  );
}

function VerificationBanner() {
  const user = useGetCurrentUser().data;
  const resend = useResendVerification();
  const [sent, setSent] = useState(false);
  if (!user || user.emailVerified) return null;
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-secondary/30 bg-[#f7f0e5] p-4 text-sm">
      <p>
        Verify <strong>{user.email}</strong> before booking an appointment.
      </p>
      <Button
        variant="outline"
        disabled={resend.isPending || sent}
        onClick={() =>
          resend.mutate(undefined, { onSuccess: () => setSent(true) })
        }
      >
        {sent ? "Verification sent" : "Resend verification"}
      </Button>
    </div>
  );
}

function IdleSessionGuard() {
  const { mutate: logout } = useLogout();
  const { refetch: refreshSession } = useGetCurrentUser({
    query: { queryKey: getGetCurrentUserQueryKey(), retry: false },
  });
  const [, setLocation] = useLocation();
  const [warning, setWarning] = useState(false);
  const lastActivity = useRef(Date.now());
  useEffect(() => {
    let warningTimer: ReturnType<typeof setTimeout>;
    let logoutTimer: ReturnType<typeof setTimeout>;
    const reset = () => {
      lastActivity.current = Date.now();
      setWarning(false);
      clearTimeout(warningTimer);
      clearTimeout(logoutTimer);
      warningTimer = setTimeout(() => setWarning(true), 9 * 60_000);
      logoutTimer = setTimeout(
        () =>
          logout(undefined, {
            onSettled: () => {
              queryClient.clear();
              setLocation("/login");
            },
          }),
        10 * 60_000,
      );
    };
    const events = ["click", "keydown", "scroll", "touchstart"] as const;
    events.forEach((event) =>
      window.addEventListener(event, reset, { passive: true }),
    );
    const heartbeat = setInterval(() => {
      if (Date.now() - lastActivity.current < 10 * 60_000) {
        void refreshSession();
      }
    }, 4 * 60_000);
    reset();
    return () => {
      events.forEach((event) => window.removeEventListener(event, reset));
      clearTimeout(warningTimer);
      clearTimeout(logoutTimer);
      clearInterval(heartbeat);
    };
  }, [logout, refreshSession, setLocation]);
  if (!warning) return null;
  return (
    <div className="fixed inset-x-4 bottom-4 z-[100] mx-auto max-w-md rounded-2xl bg-foreground p-4 text-sm text-background shadow-xl">
      Your session will end in one minute due to inactivity. Interact with the
      page to stay signed in.
    </div>
  );
}

function ClientShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const logout = useLogout();
  const user = useGetCurrentUser().data;
  const [, setLocation] = useLocation();
  const nav = [
    { href: "/client", label: "Overview", icon: Home },
    { href: "/client/book", label: "Book a session", icon: Plus },
    { href: "/client/appointments", label: "Appointments", icon: CalendarDays },
    { href: "/client/profile", label: "My profile", icon: Settings2 },
  ];
  return (
    <div className="app-shell texture lg:grid lg:grid-cols-[250px_1fr]">
      <IdleSessionGuard />
      <aside
        className={`${open ? "flex" : "hidden"} fixed inset-y-0 left-0 z-30 w-[250px] flex-col bg-sidebar p-5 text-sidebar-foreground lg:static lg:flex`}
      >
        <div className="flex items-center justify-between">
          <Logo />
          <button
            className="text-sidebar-foreground/70 lg:hidden"
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>
        <div className="mt-14 rounded-2xl bg-sidebar-accent p-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground">
            {initials(user?.name)}
          </div>
          <p className="mt-3 text-sm font-semibold">
            {user?.name ?? "Your care space"}
          </p>
          <p className="mt-1 text-xs text-sidebar-foreground/60">
            Everything in one place
          </p>
        </div>
        <nav className="mt-8 space-y-1">
          {nav.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
              data-testid={`link-${label.toLowerCase().replaceAll(" ", "-")}`}
            >
              <Icon size={17} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto border-t border-sidebar-border pt-4">
          <button
            onClick={() => {
              logout.mutate();
              setLocation("/");
            }}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent"
            data-testid="button-logout"
          >
            <LogOut size={17} /> Sign out
          </button>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="flex items-center justify-between border-b border-border bg-background/80 px-5 py-4 backdrop-blur lg:px-10">
          <button
            className="rounded-full border border-border p-2 lg:hidden"
            onClick={() => setOpen(true)}
            data-testid="button-client-menu"
            aria-label="Open navigation"
          >
            <PanelLeft size={18} />
          </button>
          <div className="hidden lg:block">
            <p className="mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">
              Client portal
            </p>
            <p className="mt-1 text-sm font-semibold">
              A calm place to keep track
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#d8e5d7] text-xs font-bold text-primary">
              {initials(user?.name)}
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl p-5 lg:p-10">
          <VerificationBanner />
          {children}
        </main>
      </div>
    </div>
  );
}
function ClientDashboard() {
  const q = useGetClientDashboard();
  const data = q.data;
  const upcoming = data?.upcoming ?? [];
  const past = data?.past ?? [];
  const waitlist = data?.waitlist ?? [];
  return (
    <ClientShell>
      <PageTitle
        eyebrow="Good to see you"
        title="Your care space."
        copy="A quick view of what is ahead, and a gentle reminder that progress does not have to be linear."
        action={
          <Link
            href="/client/book"
            className="button inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground"
            data-testid="link-dashboard-book"
          >
            <Plus size={16} /> Book a session
          </Link>
        }
      />
      {q.isLoading ? (
        <LoadingState />
      ) : q.isError ? (
        <EmptyState
          title="Your space is taking a breath"
          copy="We could not load your dashboard right now."
          action={<Button onClick={() => q.refetch()}>Try again</Button>}
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1.35fr_.65fr]">
          <Card className="overflow-hidden bg-[#dfe8df] p-6 sm:p-8">
            <div className="flex items-start justify-between">
              <div>
                <p className="mono text-[10px] uppercase tracking-[.2em] text-primary">
                  Next appointment
                </p>
                <h2 className="display mt-3 text-3xl">
                  {upcoming[0]
                    ? serviceNames[upcoming[0].serviceType]
                    : "Nothing scheduled yet"}
                </h2>
              </div>
              <CloudSun className="text-primary" size={26} />
            </div>
            {upcoming[0] ? (
              <div className="mt-9 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold">
                    {fmtDate(upcoming[0].startTime)}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {fmtTime(upcoming[0].startTime)} · {upcoming[0].durationMin}{" "}
                    minutes
                  </p>
                </div>
                <Badge tone="sage">{titleCase(upcoming[0].status)}</Badge>
              </div>
            ) : (
              <div className="mt-8">
                <p className="text-sm text-muted-foreground">
                  When you are ready, choose a time that feels workable.
                </p>
                <Link
                  href="/client/book"
                  className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-primary"
                >
                  Find a time <ArrowRight size={15} />
                </Link>
              </div>
            )}
          </Card>
          <Card className="p-6">
            <p className="mono text-[10px] uppercase tracking-[.2em] text-secondary">
              Your rhythm
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-muted p-4">
                <p className="display text-3xl">{upcoming.length}</p>
                <p className="mt-1 text-xs text-muted-foreground">Upcoming</p>
              </div>
              <div className="rounded-xl bg-muted p-4">
                <p className="display text-3xl">{past.length}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Past sessions
                </p>
              </div>
            </div>
            <Link
              href="/client/appointments"
              className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-primary"
            >
              View appointments <ArrowRight size={15} />
            </Link>
          </Card>
          <Card className="p-6 lg:col-span-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="mono text-[10px] uppercase tracking-[.2em] text-secondary">
                  Waitlist
                </p>
                <h2 className="display mt-2 text-2xl">
                  If the right time opens up
                </h2>
              </div>
              <Clock3 className="text-secondary" size={22} />
            </div>
            {waitlist.length ? (
              <div className="mt-6 space-y-3">
                {waitlist.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted p-4"
                  >
                    <div>
                      <p className="text-sm font-semibold">
                        {serviceNames[item.serviceType]}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {
                          [
                            "Sunday",
                            "Monday",
                            "Tuesday",
                            "Wednesday",
                            "Thursday",
                            "Friday",
                            "Saturday",
                          ][item.preferredDay]
                        }{" "}
                        · {titleCase(item.preferredTimeWindow)}
                      </p>
                    </div>
                    <Badge
                      tone={item.status === "slot_available" ? "sand" : "slate"}
                    >
                      {titleCase(item.status)}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-5 text-sm text-muted-foreground">
                You are not currently on a waitlist.
              </p>
            )}
          </Card>
        </div>
      )}
    </ClientShell>
  );
}
function Booking() {
  const [service, setService] = useState<ServiceType>("individual");
  const [duration, setDuration] = useState(50);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [selected, setSelected] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [waitlistWindow, setWaitlistWindow] = useState<
    "morning" | "afternoon" | "evening"
  >("afternoon");
  const practice = useGetPublicPractice();
  const profile = useGetClientProfile();
  const currentUser = useGetCurrentUser().data;
  const paidDurations =
    practice.data?.prices
      .filter((price) => price.serviceType === service && price.active)
      .map((price) => price.durationMin) ?? [];
  const selectableDurations = service === "consultation" ? [15] : paidDurations;
  const selectedPrice = practice.data?.prices.find(
    (price) =>
      price.serviceType === service &&
      price.durationMin === duration &&
      price.active,
  );
  useEffect(() => {
    if (
      service !== "consultation" &&
      selectableDurations.length &&
      !selectableDurations.includes(duration as never)
    ) {
      setDuration(selectableDurations[0]);
      setSelected("");
    }
  }, [duration, selectableDurations, service]);
  const slots = useGetPublicSlots(
    { date, duration: duration as 30 | 45 | 50 | 60 | 80 | 90 | 120 },
    {
      query: {
        queryKey: getGetPublicSlotsQueryKey({
          date,
          duration: duration as 30 | 45 | 50 | 60 | 80 | 90 | 120,
        }),
        enabled: Boolean(date),
      },
    },
  );
  const create = useCreateAppointment();
  const waitlist = useCreateWaitlistEntry();
  const groups = slots.data ?? {
    timezone: "America/Vancouver",
    morning: [],
    afternoon: [],
    evening: [],
  };
  const book = () => {
    if (!selected) return;
    const start = new Date(selected);
    const end = new Date(start.getTime() + duration * 60000);
    create.mutate(
      {
        data: {
          clientId: 0,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          serviceType: service,
          durationMin: duration as 30 | 45 | 50 | 60 | 80 | 90 | 120,
          notes: null,
        } as never,
      },
      {
        onSuccess: (result) => {
          void invalidate(
            getGetClientDashboardQueryKey(),
            getGetClientAppointmentsQueryKey(),
            getGetClientProfileQueryKey(),
          );
          if (result.checkoutUrl) {
            window.location.assign(result.checkoutUrl);
          } else {
            setConfirmed(true);
          }
        },
      },
    );
  };
  const joinWaitlist = () => {
    waitlist.mutate(
      {
        data: {
          serviceType: service,
          preferredDay: new Date(`${date}T12:00:00`).getDay(),
          preferredTimeWindow: waitlistWindow,
        },
      },
      {
        onSuccess: () => {
          setWaitlistOpen(false);
          void invalidate(getGetClientDashboardQueryKey());
        },
      },
    );
  };
  return (
    <ClientShell>
      <PageTitle
        eyebrow="Make a little room"
        title="Book a session."
        copy="Choose what you need today. You can change or cancel from your appointments page."
      />
      {confirmed ? (
        <Card className="mx-auto max-w-2xl bg-[#dfe8df] p-8 text-center sm:p-12">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check />
          </div>
          <h2 className="display mt-6 text-4xl">You are on the calendar.</h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
            Your free consultation is confirmed. Check your email for the
            appointment confirmation.
          </p>
          <Link
            href="/client/appointments"
            className="mt-7 inline-flex rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground"
            data-testid="link-view-confirmed"
          >
            View my appointments
          </Link>
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[.8fr_1.2fr]">
          <Card className="p-6">
            <StepLabel n="01" label="What would be most helpful?" />
            <div className="mt-5 space-y-2">
              {Object.entries(serviceNames).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => {
                    const nextService = value as ServiceType;
                    if (
                      nextService === "consultation" &&
                      profile.data?.consultationAvailable === false
                    )
                      return;
                    setService(nextService);
                    if (nextService === "consultation") {
                      setDuration(15);
                      setSelected("");
                      return;
                    }
                    const settingKey = `default_${nextService}_duration`;
                    const nextDuration = practice.data?.settings?.[settingKey];
                    const prices =
                      practice.data?.prices.filter(
                        (price) =>
                          price.serviceType === nextService && price.active,
                      ) ?? [];
                    if (
                      nextDuration &&
                      prices.some((price) => price.durationMin === nextDuration)
                    )
                      setDuration(nextDuration);
                    else if (prices[0]) setDuration(prices[0].durationMin);
                    setSelected("");
                  }}
                  disabled={
                    value === "consultation" &&
                    profile.data?.consultationAvailable === false
                  }
                  className={`flex w-full items-start justify-between rounded-xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${service === value ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}
                  data-testid={`button-service-${value}`}
                >
                  <span>
                    <span className="block text-sm font-semibold">{label}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {value === "consultation"
                        ? profile.data?.consultationAvailable === false
                          ? "Your one-time introductory consultation has been used."
                          : "A one-time 15-minute introductory call for new clients."
                        : serviceDescription(value)}
                    </span>
                  </span>
                  {service === value && (
                    <Check className="mt-1 text-primary" size={17} />
                  )}
                </button>
              ))}
            </div>
            <StepLabel n="02" label="How much time feels right?" />
            <select
              value={duration}
              onChange={(event) => {
                setDuration(Number(event.target.value));
                setSelected("");
              }}
              className="mt-4 w-full rounded-xl border border-input bg-card px-4 py-3 text-sm"
              data-testid="select-duration"
            >
              {selectableDurations.map((min) => (
                <option key={min} value={min}>
                  {min} minutes
                  {service !== "consultation" &&
                    (() => {
                      const price = practice.data?.prices.find(
                        (item) =>
                          item.serviceType === service &&
                          item.durationMin === min,
                      );
                      return price
                        ? ` — ${new Intl.NumberFormat("en-CA", {
                            style: "currency",
                            currency: "CAD",
                          }).format(price.amountCents / 100)}`
                        : "";
                    })()}
                </option>
              ))}
            </select>
            {service !== "consultation" && !selectableDurations.length && (
              <p className="mt-3 text-xs text-destructive">
                Pricing for this service has not been configured yet.
              </p>
            )}
          </Card>
          <Card className="p-6">
            <StepLabel n="03" label="Find a time" />
            <div className="mt-5 grid gap-6 xl:grid-cols-[320px_1fr]">
              <div>
                <Calendar
                  mode="single"
                  selected={new Date(`${date}T12:00:00`)}
                  onSelect={(value) => {
                    if (!value) return;
                    setDate(toDateInput(value));
                    setSelected("");
                  }}
                  disabled={{ before: new Date() }}
                  className="w-full rounded-2xl border border-border bg-background"
                  classNames={{
                    month: "w-full",
                    table: "w-full border-collapse",
                  }}
                  data-testid="calendar-booking-date"
                />
                <p className="mono mt-3 text-center text-[10px] uppercase tracking-widest text-muted-foreground">
                  Times shown in {groups.timezone}
                </p>
              </div>
              <div>
                <p className="mb-4 text-sm font-semibold">
                  {fmtDate(`${date}T12:00:00`)}
                </p>
                <div className="space-y-5">
                  {(["morning", "afternoon", "evening"] as const).map(
                    (group) => (
                      <div key={group}>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          {group}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {groups[group]?.length ? (
                            groups[group].map((slot) => (
                              <button
                                key={slot.startTime}
                                onClick={() => setSelected(slot.startTime)}
                                className={`rounded-full border px-4 py-2 text-sm ${selected === slot.startTime ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary"}`}
                                data-testid={`button-slot-${slot.startTime}`}
                              >
                                {slot.label}
                              </button>
                            ))
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              No availability
                            </p>
                          )}
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </div>
            </div>
            {(slots.isError || create.isError) && (
              <p className="mt-5 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
                {create.isError
                  ? create.error.message
                  : "Availability could not be loaded. Please try again."}
              </p>
            )}
            <div className="mt-8 border-t border-border pt-5">
              <Button
                onClick={book}
                disabled={
                  !selected ||
                  create.isPending ||
                  !currentUser?.emailVerified ||
                  (service !== "consultation" && !selectedPrice)
                }
                className="w-full"
                data-testid="button-confirm-booking"
              >
                {create.isPending
                  ? "Saving your time…"
                  : selected
                    ? service === "consultation"
                      ? `Confirm free consultation on ${fmtDate(selected)}`
                      : `Continue to payment`
                    : "Choose a time to continue"}
              </Button>
              {service !== "consultation" && (
                <button
                  onClick={() => setWaitlistOpen(true)}
                  className="mt-4 w-full text-center text-xs font-semibold text-secondary underline-offset-4 hover:underline"
                  data-testid="button-join-waitlist"
                >
                  Prefer another time? Join the waitlist
                </button>
              )}
            </div>
            {waitlistOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 p-5">
                <Card className="w-full max-w-md p-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="mono text-[10px] uppercase tracking-[.2em] text-secondary">
                        Waitlist
                      </p>
                      <h2 className="display mt-2 text-3xl">
                        Keep me in mind.
                      </h2>
                    </div>
                    <button
                      onClick={() => setWaitlistOpen(false)}
                      className="rounded-full p-2 hover:bg-muted"
                    >
                      <X size={18} />
                    </button>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    Tell us what timing would be most helpful and we will flag a
                    suitable opening.
                  </p>
                  <label className="mt-5 block text-sm font-semibold">
                    Service
                    <select
                      value={service}
                      onChange={(e) =>
                        setService(e.target.value as ServiceType)
                      }
                      className="mt-2 w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm"
                    >
                      {paidServiceTypes.map((value) => (
                        <option key={value} value={value}>
                          {serviceNames[value]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="mt-4 block text-sm font-semibold">
                    Preferred time
                    <select
                      value={waitlistWindow}
                      onChange={(e) =>
                        setWaitlistWindow(
                          e.target.value as typeof waitlistWindow,
                        )
                      }
                      className="mt-2 w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm"
                    >
                      <option value="morning">Morning</option>
                      <option value="afternoon">Afternoon</option>
                      <option value="evening">Evening</option>
                    </select>
                  </label>
                  <Button
                    onClick={joinWaitlist}
                    disabled={waitlist.isPending}
                    className="mt-6 w-full"
                  >
                    {waitlist.isPending ? "Adding you…" : "Join the waitlist"}
                  </Button>
                </Card>
              </div>
            )}
          </Card>
        </div>
      )}
    </ClientShell>
  );
}
function StepLabel({ n, label }: { n: string; label: string }) {
  return (
    <div className="mt-7 flex items-center gap-3 first:mt-0">
      <span className="mono text-[10px] text-secondary">{n}</span>
      <h2 className="text-sm font-semibold">{label}</h2>
    </div>
  );
}

function ClientAppointmentActions({
  item,
  onCancelled,
}: {
  item: Appointment;
  onCancelled: () => void;
}) {
  const cancel = useCancelClientAppointment();
  const checkout = useCreateAppointmentCheckout();
  const meetingWindowRelevant =
    item.status === "confirmed" &&
    new Date(item.startTime).getTime() <= Date.now() + 24 * 60 * 60_000 &&
    new Date(item.endTime).getTime() + 30 * 60_000 >= Date.now();
  const meeting = useGetAppointmentMeeting(item.id, {
    query: {
      queryKey: getGetAppointmentMeetingQueryKey(item.id),
      enabled: meetingWindowRelevant,
      refetchInterval: meetingWindowRelevant ? 60_000 : false,
    },
  });
  if (item.status === "pending_payment") {
    return (
      <Button
        onClick={() =>
          checkout.mutate(
            { id: item.id },
            {
              onSuccess: ({ checkoutUrl }) =>
                window.location.assign(checkoutUrl),
            },
          )
        }
        disabled={checkout.isPending}
      >
        Complete payment
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {meeting.data?.available && meeting.data.joinUrl && (
        <a
          href={meeting.data.joinUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="button rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground"
        >
          Join session
        </a>
      )}
      {item.status !== "cancelled" && new Date(item.startTime) > new Date() && (
        <Button
          variant="outline"
          onClick={() => {
            if (confirm("Cancel this appointment?"))
              cancel.mutate({ id: item.id }, { onSuccess: onCancelled });
          }}
          data-testid={`button-cancel-${item.id}`}
        >
          Cancel
        </Button>
      )}
    </div>
  );
}

function ClientAppointments() {
  const paymentResult = new URLSearchParams(window.location.search).get(
    "payment",
  );
  const [pollPayment, setPollPayment] = useState(paymentResult === "success");
  const q = useGetClientAppointments({
    query: {
      queryKey: getGetClientAppointmentsQueryKey(),
      refetchInterval: pollPayment ? 3000 : false,
    },
  });
  useEffect(() => {
    if (!pollPayment) return;
    const timeout = setTimeout(() => setPollPayment(false), 30_000);
    return () => clearTimeout(timeout);
  }, [pollPayment]);
  const [notice, setNotice] = useState(
    paymentResult === "success"
      ? "Payment received. Your appointment will be confirmed shortly."
      : paymentResult === "cancelled"
        ? "Payment was not completed. Your slot remains reserved briefly."
        : "",
  );
  const items = q.data ?? [];
  return (
    <ClientShell>
      <PageTitle
        eyebrow="Your calendar"
        title="Appointments."
        copy="Keep an eye on what is coming up, and give yourself plenty of room around your sessions."
        action={
          <Link
            href="/client/book"
            className="button rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground"
            data-testid="link-appointments-book"
          >
            Book a session
          </Link>
        }
      />
      {notice && (
        <div className="mb-5 rounded-xl bg-primary/10 p-4 text-sm text-primary">
          {notice}
        </div>
      )}
      {q.isLoading ? (
        <LoadingState />
      ) : items.length === 0 ? (
        <EmptyState
          title="No appointments yet"
          copy="When you are ready, choose a time that works for your life."
          action={
            <Link
              href="/client/book"
              className="button rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground"
            >
              Find a time
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <Card
              key={item.id}
              className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-[#dfe8df] text-primary">
                  <span className="mono text-[10px] uppercase">
                    {new Date(item.startTime).toLocaleDateString(undefined, {
                      month: "short",
                    })}
                  </span>
                  <span className="display text-xl">
                    {new Date(item.startTime).getDate()}
                  </span>
                </div>
                <div>
                  <h3 className="font-semibold">
                    {serviceNames[item.serviceType]}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {fmtDate(item.startTime)} · {fmtTime(item.startTime)} ·{" "}
                    {item.durationMin} minutes
                  </p>
                  <Badge
                    tone={
                      item.status === "confirmed"
                        ? "sage"
                        : item.status === "cancelled"
                          ? "red"
                          : "sand"
                    }
                  >
                    {titleCase(item.status)}
                  </Badge>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {item.serviceType === "consultation"
                      ? "Free consultation"
                      : item.paymentStatus === "paid"
                        ? item.status === "cancelled"
                          ? "Paid · refund reviewed manually"
                          : "Paid"
                        : item.paymentStatus === "refunded"
                          ? "Refunded"
                          : item.paymentStatus === "pending"
                            ? `Payment pending${
                                item.paymentExpiresAt
                                  ? ` · reserved until ${fmtTime(item.paymentExpiresAt)}`
                                  : ""
                              }`
                            : ""}
                  </p>
                </div>
              </div>
              <ClientAppointmentActions
                item={item}
                onCancelled={() => {
                  setNotice("Your appointment has been cancelled.");
                  void invalidate(
                    getGetClientAppointmentsQueryKey(),
                    getGetClientDashboardQueryKey(),
                  );
                }}
              />
            </Card>
          ))}
        </div>
      )}
    </ClientShell>
  );
}
function ClientProfile() {
  const q = useGetClientProfile();
  const update = useUpdateClientProfile();
  const changePassword = useChangePassword();
  const changeEmail = useChangeEmail();
  const profile = q.data;
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [timezone, setTimezone] = useState("America/Edmonton");
  const [saved, setSaved] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [accountNotice, setAccountNotice] = useState("");
  useEffect(() => {
    if (profile) {
      setName(profile.name);
      setPhone(profile.phone ?? "");
      setTimezone(profile.timezone);
    }
  }, [profile]);
  return (
    <ClientShell>
      <PageTitle
        eyebrow="Your details"
        title="My profile."
        copy="Keep your contact details current so your care stays easy to coordinate."
      />
      {q.isLoading ? (
        <LoadingState />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_.65fr]">
          <Card className="p-6 sm:p-8">
            <div className="grid gap-5 sm:grid-cols-2">
              <label className="text-sm font-semibold">
                Name
                <input
                  data-testid="input-profile-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-input bg-card px-4 py-3 text-sm"
                />
              </label>
              <label className="text-sm font-semibold">
                Email
                <input
                  value={profile?.email ?? ""}
                  readOnly
                  className="mt-2 w-full rounded-xl border border-input bg-muted px-4 py-3 text-sm text-muted-foreground"
                  data-testid="input-profile-email"
                />
              </label>
              <label className="text-sm font-semibold">
                Phone
                <input
                  data-testid="input-profile-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-input bg-card px-4 py-3 text-sm"
                  placeholder="Optional"
                />
              </label>
              <label className="text-sm font-semibold sm:col-span-2">
                Timezone
                <select
                  data-testid="select-profile-timezone"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-input bg-card px-4 py-3 text-sm"
                >
                  <option>America/Edmonton</option>
                  <option>America/Vancouver</option>
                  <option>America/Toronto</option>
                </select>
              </label>
            </div>
            {saved && (
              <p className="mt-5 text-sm text-primary">
                Your details have been saved.
              </p>
            )}
            <Button
              className="mt-7"
              onClick={() =>
                update.mutate(
                  {
                    data: {
                      name,
                      phone: phone || null,
                      timezone,
                    },
                  },
                  {
                    onSuccess: () => {
                      setSaved(true);
                      void invalidate(getGetClientProfileQueryKey());
                    },
                  },
                )
              }
              disabled={update.isPending}
              data-testid="button-save-profile"
            >
              {update.isPending ? "Saving…" : "Save details"}
            </Button>
          </Card>
          <Card className="p-6 sm:p-8 lg:col-span-2">
            <p className="mono text-[10px] uppercase tracking-[.2em] text-secondary">
              Account security
            </p>
            {accountNotice && (
              <p className="mt-4 rounded-xl bg-primary/10 p-3 text-sm text-primary">
                {accountNotice}
              </p>
            )}
            <div className="mt-5 grid gap-8 md:grid-cols-2">
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  changePassword.mutate(
                    {
                      data: {
                        currentPassword,
                        newPassword,
                      },
                    },
                    {
                      onSuccess: () => {
                        setCurrentPassword("");
                        setNewPassword("");
                        setAccountNotice("Your password has been changed.");
                      },
                    },
                  );
                }}
              >
                <h2 className="font-semibold">Change password</h2>
                <input
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  placeholder="Current password"
                  className="w-full rounded-xl border border-input px-4 py-3 text-sm"
                />
                <input
                  type="password"
                  required
                  minLength={12}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="New password (12+ characters)"
                  className="w-full rounded-xl border border-input px-4 py-3 text-sm"
                />
                {changePassword.isError && (
                  <p className="text-sm text-destructive">
                    {changePassword.error.message}
                  </p>
                )}
                <Button disabled={changePassword.isPending}>
                  Update password
                </Button>
              </form>
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  changeEmail.mutate(
                    {
                      data: {
                        email: newEmail,
                        currentPassword: emailPassword,
                      },
                    },
                    {
                      onSuccess: () => {
                        setNewEmail("");
                        setEmailPassword("");
                        setAccountNotice(
                          "Check your new email address to confirm the change.",
                        );
                        void invalidate(getGetCurrentUserQueryKey());
                      },
                    },
                  );
                }}
              >
                <h2 className="font-semibold">Change email</h2>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(event) => setNewEmail(event.target.value)}
                  placeholder="New email address"
                  className="w-full rounded-xl border border-input px-4 py-3 text-sm"
                />
                <input
                  type="password"
                  required
                  value={emailPassword}
                  onChange={(event) => setEmailPassword(event.target.value)}
                  placeholder="Current password"
                  className="w-full rounded-xl border border-input px-4 py-3 text-sm"
                />
                {profile?.pendingEmail && (
                  <p className="text-xs text-muted-foreground">
                    Pending confirmation: {profile.pendingEmail}
                  </p>
                )}
                {changeEmail.isError && (
                  <p className="text-sm text-destructive">
                    {changeEmail.error.message}
                  </p>
                )}
                <Button disabled={changeEmail.isPending}>
                  Send confirmation
                </Button>
              </form>
            </div>
          </Card>
          <Card className="bg-[#dfe8df] p-6">
            <ShieldCheck className="text-primary" />
            <h2 className="display mt-5 text-2xl">Your privacy matters.</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Your profile is only used to coordinate your care and keep your
              appointment details accurate.
            </p>
          </Card>
        </div>
      )}
    </ClientShell>
  );
}

function AdminShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const logout = useLogout();
  const practice = useGetPublicPractice().data;
  const [, setLocation] = useLocation();
  const nav = [
    { href: "/admin", label: "Overview", icon: Home },
    { href: "/admin/calendar", label: "Calendar", icon: CalendarDays },
    { href: "/admin/clients", label: "Clients", icon: Users },
    { href: "/admin/appointments", label: "Appointments", icon: Clock3 },
    { href: "/admin/waitlist", label: "Waitlist", icon: Bell },
  ];
  return (
    <div className="app-shell texture lg:grid lg:grid-cols-[250px_1fr]">
      <IdleSessionGuard />
      <aside
        className={`${open ? "flex" : "hidden"} fixed inset-y-0 left-0 z-30 w-[250px] flex-col bg-sidebar p-5 text-sidebar-foreground lg:static lg:flex`}
      >
        <div className="flex items-center justify-between">
          <Logo />
          <button
            className="text-sidebar-foreground/70 lg:hidden"
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>
        <div className="mt-14 flex items-center gap-3 rounded-2xl bg-sidebar-accent p-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground">
            LA
          </div>
          <div>
            <p className="text-sm font-semibold">Lara Akinpelu</p>
            <p className="mt-1 text-xs text-sidebar-foreground/60">
              Practice workspace
            </p>
          </div>
        </div>
        <nav className="mt-8 space-y-1">
          {nav.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              data-testid={`link-admin-${label.toLowerCase()}`}
            >
              <Icon size={17} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto space-y-1 border-t border-sidebar-border pt-4">
          <Link
            href="/admin/availability"
            className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent"
            data-testid="link-admin-availability"
          >
            <Settings2 size={17} /> Availability
          </Link>
          <Link
            href="/admin/blocked-times"
            className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent"
            data-testid="link-admin-blocked"
          >
            <ShieldCheck size={17} /> Blocked times
          </Link>
          <Link
            href="/admin/account"
            className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent"
          >
            <KeyRound size={17} /> Account security
          </Link>
          <button
            onClick={() => {
              logout.mutate();
              setLocation("/");
            }}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent"
            data-testid="button-admin-logout"
          >
            <LogOut size={17} /> Sign out
          </button>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="flex items-center justify-between border-b border-border bg-background/80 px-5 py-4 backdrop-blur lg:px-10">
          <button
            className="rounded-full border border-border p-2 lg:hidden"
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
          >
            <PanelLeft size={18} />
          </button>
          <div>
            <p className="mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">
              Practice workspace
            </p>
            <p className="mt-1 text-sm font-semibold">
              {new Date().toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-muted-foreground sm:block">
              {practice?.timezone ?? "America/Vancouver"}
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#d8e5d7] text-xs font-bold text-primary">
              LA
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-[1440px] p-5 lg:p-10">{children}</main>
      </div>
    </div>
  );
}
function AdminOverview() {
  const q = useGetAdminSummary();
  const s = q.data;
  const next = s?.nextAppointment;
  return (
    <AdminShell>
      <PageTitle
        eyebrow="Practice pulse"
        title="Good morning, Lara."
        copy="A clear view of the day, with enough room to think."
        action={
          <Link
            href="/admin/calendar"
            className="button inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground"
            data-testid="link-open-calendar"
          >
            <CalendarDays size={16} /> Open calendar
          </Link>
        }
      />
      {q.isLoading ? (
        <LoadingState />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Metric
              label="Today"
              value={s?.todayCount ?? 0}
              detail="appointments"
              tone="sage"
            />
            <Metric
              label="This week"
              value={s?.weekCount ?? 0}
              detail="appointments"
              tone="blue"
            />
            <Metric
              label="Waitlist"
              value={s?.pendingWaitlist ?? 0}
              detail="need attention"
              tone="sand"
            />
          </div>
          <div className="mt-5 grid gap-5 lg:grid-cols-[1.25fr_.75fr]">
            <Card className="p-6 sm:p-8">
              <div className="flex items-start justify-between">
                <div>
                  <p className="mono text-[10px] uppercase tracking-[.2em] text-secondary">
                    Next on the calendar
                  </p>
                  <h2 className="display mt-3 text-3xl">
                    {next?.clientName ?? "Your calendar is clear"}
                  </h2>
                </div>
                <Clock3 className="text-secondary" />
              </div>
              {next ? (
                <div className="mt-8 flex items-end justify-between">
                  <div>
                    <p className="text-sm font-semibold">
                      {serviceNames[next.serviceType]}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {fmtDate(next.startTime)} · {fmtTime(next.startTime)} ·{" "}
                      {next.durationMin} minutes
                    </p>
                  </div>
                  <Badge tone="sage">{titleCase(next.status)}</Badge>
                </div>
              ) : (
                <p className="mt-5 text-sm text-muted-foreground">
                  No upcoming appointment is waiting for you.
                </p>
              )}
            </Card>
            <Card className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="mono text-[10px] uppercase tracking-[.2em] text-secondary">
                    Shortcuts
                  </p>
                  <h2 className="display mt-2 text-2xl">Keep moving</h2>
                </div>
                <Sparkles className="text-accent" />
              </div>
              <div className="mt-6 grid gap-2">
                <QuickLink
                  href="/admin/clients"
                  label="Find a client"
                  icon={Users}
                />
                <QuickLink
                  href="/admin/waitlist"
                  label="Review waitlist"
                  icon={Bell}
                />
                <QuickLink
                  href="/admin/blocked-times"
                  label="Block a time"
                  icon={ShieldCheck}
                />
              </div>
            </Card>
          </div>
        </>
      )}
    </AdminShell>
  );
}
function Metric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: number;
  detail: string;
  tone: "sage" | "blue" | "sand";
}) {
  return (
    <Card
      className={`p-5 ${tone === "sage" ? "bg-[#dfe8df]" : tone === "blue" ? "bg-[#e1e9ed]" : "bg-[#f0e7d8]"}`}
    >
      <p className="mono text-[10px] uppercase tracking-[.2em] text-muted-foreground">
        {label}
      </p>
      <p className="display mt-4 text-5xl">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
    </Card>
  );
}
function QuickLink({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: typeof Users;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between rounded-xl bg-muted p-3 text-sm font-semibold hover:bg-primary/10"
      data-testid={`link-shortcut-${label.toLowerCase().replaceAll(" ", "-")}`}
    >
      <span className="flex items-center gap-3">
        <Icon size={16} className="text-secondary" />
        {label}
      </span>
      <ArrowRight size={15} className="text-muted-foreground" />
    </Link>
  );
}

function AdminCalendar() {
  const calendarRef = useRef<FullCalendar | null>(null);
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [range, setRange] = useState(() => {
    const start = startOfWeek();
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start: start.toISOString(), end: end.toISOString() };
  });
  const [createAt, setCreateAt] = useState<DateSelectArg | null>(null);
  const [clientId, setClientId] = useState<number | "">("");
  const [service, setService] = useState<ServiceType>("individual");
  const [duration, setDuration] = useState(50);
  const [serviceFilter, setServiceFilter] = useState<ServiceType | "all">(
    "all",
  );
  const [statusFilter, setStatusFilter] = useState<AppointmentStatus | "all">(
    "all",
  );
  const [createMode, setCreateMode] = useState<"appointment" | "block">(
    "appointment",
  );
  const [blockReason, setBlockReason] = useState("Personal time");
  const q = useGetAdminCalendar(range, {
    query: { queryKey: getGetAdminCalendarQueryKey(range) },
  });
  const clients = useGetAdminClients(
    {},
    { query: { queryKey: getGetAdminClientsQueryKey({}) } },
  );
  const create = useCreateAppointment();
  const createBlocked = useCreateBlockedTime();
  const update = useUpdateAdminAppointment();
  const data = q.data;
  const events = [
    ...(data?.appointments ?? [])
      .filter(
        (appointment) =>
          (serviceFilter === "all" ||
            appointment.serviceType === serviceFilter) &&
          (statusFilter === "all" || appointment.status === statusFilter),
      )
      .map((appointment) => ({
        id: String(appointment.id),
        title: `${appointment.clientName} · ${serviceNames[appointment.serviceType]}`,
        start: appointment.startTime,
        end: appointment.endTime,
        backgroundColor: serviceColors[appointment.serviceType],
        borderColor: serviceColors[appointment.serviceType],
        extendedProps: { appointment },
      })),
    ...(data?.blockedTimes ?? []).map((blocked) => ({
      id: `blocked-${blocked.id}`,
      title: blocked.reason,
      start: blocked.startTime,
      end: blocked.endTime,
      classNames: ["blocked-calendar-time"],
      editable: false,
    })),
  ];
  const handleDatesSet = (info: { start: Date; end: Date }) => {
    const next = {
      start: info.start.toISOString(),
      end: info.end.toISOString(),
    };
    if (next.start !== range.start || next.end !== range.end) setRange(next);
  };
  const handleEventClick = (info: EventClickArg) => {
    const appointment = info.event.extendedProps.appointment as
      Appointment | undefined;
    if (appointment) setSelected(appointment);
  };
  const handleEventDrop = (info: EventDropArg) => {
    const appointment = info.event.extendedProps.appointment as
      Appointment | undefined;
    if (!appointment || !info.event.start || !info.event.end) return;
    if (appointment.serviceType === "consultation") {
      info.revert();
      return;
    }
    update.mutate(
      {
        id: appointment.id,
        data: {
          startTime: info.event.start.toISOString(),
          endTime: info.event.end.toISOString(),
        } as never,
      },
      {
        onSuccess: () => void invalidate(getGetAdminCalendarQueryKey(range)),
        onError: () => info.revert(),
      },
    );
  };
  const handleEventResize = (info: EventResizeDoneArg) => {
    const appointment = info.event.extendedProps.appointment as
      Appointment | undefined;
    if (!appointment || !info.event.start || !info.event.end) return;
    const durationMin = Math.round(
      (info.event.end.getTime() - info.event.start.getTime()) / 60000,
    );
    if (
      !paidDurationOptions.includes(
        durationMin as (typeof paidDurationOptions)[number],
      )
    ) {
      info.revert();
      return;
    }
    update.mutate(
      {
        id: appointment.id,
        data: {
          startTime: info.event.start.toISOString(),
          endTime: info.event.end.toISOString(),
          durationMin: durationMin as (typeof paidDurationOptions)[number],
        },
      },
      {
        onSuccess: () => void invalidate(getGetAdminCalendarQueryKey(range)),
        onError: () => info.revert(),
      },
    );
  };
  const createAppointment = () => {
    if (!createAt || clientId === "") return;
    const start = createAt.start;
    const end = new Date(start.getTime() + duration * 60000);
    create.mutate(
      {
        data: {
          clientId,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          serviceType: service,
          durationMin: duration as 30 | 45 | 50 | 60 | 80 | 90 | 120,
          notes: null,
        } as never,
      },
      {
        onSuccess: () => {
          setCreateAt(null);
          void invalidate(getGetAdminCalendarQueryKey(range));
        },
      },
    );
  };
  const blockSelectedTime = () => {
    if (!createAt || !blockReason.trim()) return;
    createBlocked.mutate(
      {
        data: {
          startTime: createAt.start.toISOString(),
          endTime: createAt.end.toISOString(),
          reason: blockReason.trim(),
        },
      },
      {
        onSuccess: () => {
          setCreateAt(null);
          setBlockReason("Personal time");
          void invalidate(
            getGetAdminCalendarQueryKey(range),
            getGetBlockedTimesQueryKey(),
          );
        },
      },
    );
  };
  return (
    <AdminShell>
      <PageTitle
        eyebrow="The week at a glance"
        title="Calendar."
        copy="Click an open time to create an appointment, or drag an existing session to reschedule it."
        action={
          <Link
            href="/admin/blocked-times"
            className="button inline-flex items-center gap-2 rounded-full border border-border px-5 py-3 text-sm font-semibold"
            data-testid="link-calendar-block"
          >
            <Plus size={16} /> Block time
          </Link>
        }
      />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-full border border-border bg-card p-1">
          {(["timeGridDay", "timeGridWeek", "dayGridMonth"] as const).map(
            (item) => (
              <button
                key={item}
                onClick={() => calendarRef.current?.getApi().changeView(item)}
                className="rounded-full px-4 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted"
                data-testid={`button-calendar-${item}`}
              >
                {item === "timeGridDay"
                  ? "Day"
                  : item === "timeGridWeek"
                    ? "Week"
                    : "Month"}
              </button>
            ),
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {Object.entries(serviceNames).map(([value, label]) => (
            <span key={value} className="hidden items-center gap-2 xl:flex">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: serviceColors[value as ServiceType] }}
              />
              {label}
            </span>
          ))}
          <span className="mono">{data?.timezone ?? "America/Vancouver"}</span>
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <Card className="p-3">
            <Calendar
              mode="single"
              selected={new Date(range.start)}
              onSelect={(date) => {
                if (!date) return;
                calendarRef.current?.getApi().gotoDate(date);
              }}
              className="w-full"
              classNames={{ month: "w-full", table: "w-full border-collapse" }}
            />
          </Card>
          <Card className="p-5">
            <p className="text-sm font-semibold">Calendar filters</p>
            <label className="mt-4 block text-xs font-semibold text-muted-foreground">
              Service
              <select
                value={serviceFilter}
                onChange={(event) =>
                  setServiceFilter(event.target.value as ServiceType | "all")
                }
                className="mt-2 w-full rounded-xl border border-input bg-card px-3 py-2 text-sm text-foreground"
              >
                <option value="all">All services</option>
                {Object.entries(serviceNames).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-4 block text-xs font-semibold text-muted-foreground">
              Status
              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(
                    event.target.value as AppointmentStatus | "all",
                  )
                }
                className="mt-2 w-full rounded-xl border border-input bg-card px-3 py-2 text-sm text-foreground"
              >
                <option value="all">All statuses</option>
                {[
                  "pending",
                  "confirmed",
                  "completed",
                  "cancelled",
                  "no_show",
                ].map((status) => (
                  <option key={status} value={status}>
                    {titleCase(status)}
                  </option>
                ))}
              </select>
            </label>
          </Card>
        </aside>
        <Card className="min-w-0 overflow-hidden p-3 sm:p-5">
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView="timeGridWeek"
            timeZone={data?.timezone ?? "America/Vancouver"}
            headerToolbar={{
              left: "title",
              center: "",
              right: "today prev,next",
            }}
            height="auto"
            allDaySlot={false}
            slotMinTime="08:00:00"
            slotMaxTime="18:00:00"
            nowIndicator
            selectable
            selectMirror
            editable
            eventResizableFromStart
            events={events}
            select={(info) => {
              setCreateMode("appointment");
              setCreateAt(info);
            }}
            datesSet={handleDatesSet}
            eventClick={handleEventClick}
            eventDrop={handleEventDrop}
            eventResize={handleEventResize}
          />
        </Card>
      </div>
      {selected && (
        <AppointmentDrawer
          appointment={selected}
          onClose={() => setSelected(null)}
        />
      )}
      {createAt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 p-5">
          <Card className="w-full max-w-md p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="mono text-[10px] uppercase tracking-[.2em] text-secondary">
                  Selected time
                </p>
                <h2 className="display mt-2 text-3xl">Add to the calendar.</h2>
              </div>
              <button
                onClick={() => setCreateAt(null)}
                className="rounded-full p-2 hover:bg-muted"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="mt-5 grid grid-cols-2 rounded-full bg-muted p-1">
              <button
                onClick={() => setCreateMode("appointment")}
                className={`rounded-full px-3 py-2 text-sm font-semibold ${createMode === "appointment" ? "bg-card shadow-sm" : "text-muted-foreground"}`}
              >
                Appointment
              </button>
              <button
                onClick={() => setCreateMode("block")}
                className={`rounded-full px-3 py-2 text-sm font-semibold ${createMode === "block" ? "bg-card shadow-sm" : "text-muted-foreground"}`}
              >
                Block this time
              </button>
            </div>
            <div className={createMode === "appointment" ? "block" : "hidden"}>
              <label className="mt-5 block text-sm font-semibold">
                Client
                <select
                  value={clientId}
                  onChange={(e) =>
                    setClientId(e.target.value ? Number(e.target.value) : "")
                  }
                  className="mt-2 w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm"
                >
                  <option value="">Choose a client</option>
                  {(clients.data ?? []).map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mt-4 block text-sm font-semibold">
                Service
                <select
                  value={service}
                  onChange={(e) => {
                    const next = e.target.value as ServiceType;
                    setService(next);
                    setDuration(next === "consultation" ? 15 : 50);
                  }}
                  className="mt-2 w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm"
                >
                  {Object.entries(serviceNames).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mt-4 block text-sm font-semibold">
                Duration
                <select
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="mt-2 w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm"
                >
                  {(service === "consultation"
                    ? [15]
                    : paidDurationOptions
                  ).map((value) => (
                    <option key={value} value={value}>
                      {value} minutes
                    </option>
                  ))}
                </select>
              </label>
              <Button
                onClick={createAppointment}
                disabled={clientId === "" || create.isPending}
                className="mt-6 w-full"
              >
                {create.isPending ? "Creating…" : "Create appointment"}
              </Button>
            </div>
            {createMode === "block" && (
              <div className="mt-5">
                <label className="block text-sm font-semibold">
                  Reason
                  <select
                    value={blockReason}
                    onChange={(event) => setBlockReason(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm"
                  >
                    <option>Vacation</option>
                    <option>Lunch</option>
                    <option>Personal time</option>
                    <option>Administration</option>
                  </select>
                </label>
                <Button
                  onClick={blockSelectedTime}
                  disabled={createBlocked.isPending}
                  className="mt-6 w-full"
                >
                  {createBlocked.isPending
                    ? "Blocking…"
                    : "Block selected time"}
                </Button>
              </div>
            )}
            {(create.isError || createBlocked.isError) && (
              <p className="mt-4 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
                {(create.error ?? createBlocked.error)?.message}
              </p>
            )}
          </Card>
        </div>
      )}
    </AdminShell>
  );
}
function AppointmentDrawer({
  appointment,
  onClose,
}: {
  appointment: Appointment;
  onClose: () => void;
}) {
  const update = useUpdateAdminAppointment();
  const [notes, setNotes] = useState(appointment.notes ?? "");
  const save = (patch: { status?: AppointmentStatus; notes?: string | null }) =>
    update.mutate(
      { id: appointment.id, data: patch },
      {
        onSuccess: () => {
          void invalidate(getGetAdminCalendarQueryKey());
          onClose();
        },
      },
    );
  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-foreground/15"
      onClick={onClose}
    >
      <aside
        className="h-full w-full max-w-md overflow-y-auto bg-card p-6 shadow-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="mono text-[10px] uppercase tracking-[.2em] text-secondary">
              Appointment details
            </p>
            <h2 className="display mt-2 text-3xl">{appointment.clientName}</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 hover:bg-muted"
            data-testid="button-close-drawer"
            aria-label="Close appointment details"
          >
            <X size={18} />
          </button>
        </div>
        <div className="mt-8 space-y-4">
          <InfoRow
            label="Session"
            value={serviceNames[appointment.serviceType]}
          />
          <InfoRow
            label="When"
            value={`${fmtDate(appointment.startTime)} · ${fmtTime(appointment.startTime)}`}
          />
          <InfoRow
            label="Duration"
            value={`${appointment.durationMin} minutes`}
          />
          <InfoRow label="Email" value={appointment.clientEmail} />
        </div>
        <label className="mt-8 block text-sm font-semibold">
          Status
          <select
            value={appointment.status}
            onChange={(e) =>
              save({ status: e.target.value as AppointmentStatus })
            }
            className="mt-2 w-full rounded-xl border border-input bg-card px-4 py-3 text-sm"
            data-testid="select-appointment-status"
          >
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="no_show">No show</option>
          </select>
        </label>
        <label className="mt-5 block text-sm font-semibold">
          Scheduling notes
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="mt-2 min-h-28 w-full rounded-xl border border-input bg-card p-3 text-sm"
            placeholder="Notes visible only in the practitioner workspace"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Coordination details only. Keep all clinical notes in Upheal.
          </p>
        </label>
        <Button
          variant="outline"
          className="mt-3 w-full"
          onClick={() => save({ notes: notes || null })}
          disabled={update.isPending}
        >
          Save scheduling notes
        </Button>
        <div className="mt-6 grid grid-cols-3 gap-2">
          <Button variant="quiet" onClick={() => save({ status: "completed" })}>
            Completed
          </Button>
          <Button
            variant="danger"
            onClick={() => save({ status: "cancelled" })}
          >
            Cancelled
          </Button>
          <Button variant="outline" onClick={() => save({ status: "no_show" })}>
            No-show
          </Button>
        </div>
        <Link
          href={`/admin/clients/${appointment.clientId}`}
          className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-primary"
          data-testid="link-drawer-client"
        >
          Open client record <ArrowRight size={15} />
        </Link>
      </aside>
    </div>
  );
}
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border pb-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-semibold">{value}</span>
    </div>
  );
}

function AdminClients() {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"name" | "newest" | "appointments">("name");
  const q = useGetAdminClients(
    { search, sort },
    {
      query: { queryKey: getGetAdminClientsQueryKey({ search, sort }) },
    },
  );
  const clients = q.data ?? [];
  return (
    <AdminShell>
      <PageTitle
        eyebrow="People in your care"
        title="Clients."
        copy="A considered list of the people and families you support."
      />
      <Card className="overflow-hidden">
        <div className="flex flex-col justify-between gap-3 border-b border-border p-4 sm:flex-row">
          <label className="relative max-w-sm flex-1">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              size={16}
            />
            <input
              data-testid="input-client-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-input bg-card py-2.5 pl-9 pr-3 text-sm"
              placeholder="Search by name or email"
            />
          </label>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as typeof sort)}
            className="rounded-xl border border-input bg-card px-3 py-2 text-sm"
            data-testid="select-client-sort"
          >
            <option value="name">Name</option>
            <option value="newest">Newest</option>
            <option value="appointments">Appointments</option>
          </select>
        </div>
        {q.isLoading ? (
          <div className="p-5">
            <Skeleton className="h-56" />
          </div>
        ) : clients.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="No clients match that search"
              copy="Try a different name or email."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="bg-muted text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-3">Client</th>
                  <th className="px-5 py-3">Phone</th>
                  <th className="px-5 py-3">Sessions</th>
                  <th className="px-5 py-3">Last session</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => (
                  <tr
                    key={client.id}
                    className="border-t border-border hover:bg-muted/50"
                  >
                    <td className="px-5 py-4">
                      <Link
                        href={`/admin/clients/${client.id}`}
                        className="font-semibold text-primary hover:underline"
                        data-testid={`link-client-${client.id}`}
                      >
                        {client.name}
                      </Link>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {client.email}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-muted-foreground">
                      {client.phone ?? "—"}
                    </td>
                    <td className="px-5 py-4">{client.appointmentCount}</td>
                    <td className="px-5 py-4 text-muted-foreground">
                      {fmtDate(client.lastAppointment ?? undefined)}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <MoreHorizontal
                        size={17}
                        className="text-muted-foreground"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </AdminShell>
  );
}
function ClientDetail() {
  const { id } = useParams<{ id: string }>();
  const q = useGetAdminClient(Number(id), {
    query: {
      queryKey: getGetAdminClientQueryKey(Number(id)),
      enabled: Boolean(id),
    },
  });
  const addNote = useCreateClientNote();
  const restoreConsultation = useRestoreClientConsultation();
  const [note, setNote] = useState("");
  const detail = q.data;
  return (
    <AdminShell>
      <Link
        href="/admin/clients"
        className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        data-testid="link-back-clients"
      >
        <ArrowLeft size={15} /> All clients
      </Link>
      {q.isLoading ? (
        <LoadingState />
      ) : (
        <>
          <PageTitle
            eyebrow="Client record"
            title={detail?.profile.name ?? "Client"}
            copy={detail?.profile.email}
          />
          <Card className="mb-5 grid gap-4 p-5 sm:grid-cols-3">
            <InfoRow label="Email" value={detail?.profile.email ?? "—"} />
            <InfoRow label="Phone" value={detail?.profile.phone ?? "—"} />
            <InfoRow label="Timezone" value={detail?.profile.timezone ?? "—"} />
            <div className="sm:col-span-3">
              <Button
                variant="outline"
                disabled={
                  restoreConsultation.isPending ||
                  detail?.profile.consultationAvailable
                }
                onClick={() =>
                  restoreConsultation.mutate(
                    { id: Number(id) },
                    {
                      onSuccess: () =>
                        void invalidate(getGetAdminClientQueryKey(Number(id))),
                    },
                  )
                }
              >
                {detail?.profile.consultationAvailable
                  ? "Free consultation available"
                  : "Restore free consultation eligibility"}
              </Button>
            </div>
          </Card>
          <div className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
            <Card className="p-6">
              <h2 className="display text-2xl">Session history</h2>
              {detail?.appointments?.length ? (
                <div className="mt-5 space-y-3">
                  {detail.appointments.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center justify-between rounded-xl bg-muted p-4"
                    >
                      <div>
                        <p className="text-sm font-semibold">
                          {serviceNames[a.serviceType]}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {fmtDate(a.startTime)} · {fmtTime(a.startTime)}
                        </p>
                      </div>
                      <Badge tone={a.status === "completed" ? "sage" : "slate"}>
                        {titleCase(a.status)}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-5 text-sm text-muted-foreground">
                  No appointments recorded yet.
                </p>
              )}
            </Card>
            <Card className="p-6">
              <h2 className="display text-2xl">Scheduling notes</h2>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                Coordination details only. Keep clinical notes in Upheal.
              </p>
              <div className="mt-5 space-y-3">
                {detail?.notes?.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-xl bg-[#f0e7d8] p-4 text-sm leading-6"
                  >
                    {item.content}
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      {fmtDate(item.createdAt)}
                    </p>
                  </div>
                ))}
              </div>
              <textarea
                data-testid="textarea-client-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="mt-5 min-h-28 w-full rounded-xl border border-input bg-card p-3 text-sm"
                placeholder="Add a non-clinical scheduling note…"
              />
              <Button
                className="mt-3"
                onClick={() => {
                  if (note.trim())
                    addNote.mutate(
                      { id: Number(id), data: { content: note } } as never,
                      {
                        onSuccess: () => {
                          setNote("");
                          void invalidate(
                            getGetAdminClientQueryKey(Number(id)),
                          );
                        },
                      },
                    );
                }}
                data-testid="button-add-note"
              >
                <Plus size={15} /> Add note
              </Button>
            </Card>
          </div>
        </>
      )}
    </AdminShell>
  );
}
function AdminAppointments() {
  const [status, setStatus] = useState<AppointmentStatus | "">("");
  const [clientId, setClientId] = useState<number | "">("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const params = {
    ...(status ? { status } : {}),
    ...(clientId ? { clientId } : {}),
    ...(startDate ? { start: `${startDate}T00:00:00.000Z` } : {}),
    ...(endDate ? { end: `${endDate}T23:59:59.999Z` } : {}),
  };
  const q = useGetAdminAppointments(params, {
    query: { queryKey: getGetAdminAppointmentsQueryKey(params) },
  });
  const clients = useGetAdminClients({});
  const update = useUpdateAdminAppointment();
  const bulkUpdate = useBulkUpdateAdminAppointments();
  const refund = useRefundAdminAppointment();
  const items = q.data ?? [];
  const refresh = () => {
    setSelectedIds([]);
    void invalidate(
      getGetAdminAppointmentsQueryKey(params),
      getGetAdminCalendarQueryKey(),
      getGetAdminSummaryQueryKey(),
    );
  };
  return (
    <AdminShell>
      <PageTitle
        eyebrow="All sessions"
        title="Appointments."
        copy="Review, update, and keep the practice calendar honest."
      />
      <Card className="mb-5 p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <select
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as AppointmentStatus | "")
            }
            className="rounded-xl border border-input bg-card px-3 py-2.5 text-sm"
          >
            <option value="">All statuses</option>
            {[
              "pending_payment",
              "pending",
              "confirmed",
              "completed",
              "cancelled",
              "no_show",
            ].map((value) => (
              <option key={value} value={value}>
                {titleCase(value)}
              </option>
            ))}
          </select>
          <select
            value={clientId}
            onChange={(event) =>
              setClientId(event.target.value ? Number(event.target.value) : "")
            }
            className="rounded-xl border border-input bg-card px-3 py-2.5 text-sm"
          >
            <option value="">All clients</option>
            {(clients.data ?? []).map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            aria-label="Start date"
            className="rounded-xl border border-input bg-card px-3 py-2.5 text-sm"
          />
          <input
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            aria-label="End date"
            className="rounded-xl border border-input bg-card px-3 py-2.5 text-sm"
          />
        </div>
        {selectedIds.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <span className="text-sm text-muted-foreground">
              {selectedIds.length} selected
            </span>
            {(["confirmed", "completed", "cancelled", "no_show"] as const).map(
              (nextStatus) => (
                <Button
                  key={nextStatus}
                  variant="outline"
                  onClick={() =>
                    bulkUpdate.mutate(
                      { data: { ids: selectedIds, status: nextStatus } },
                      { onSuccess: refresh },
                    )
                  }
                  disabled={bulkUpdate.isPending}
                >
                  Mark {titleCase(nextStatus)}
                </Button>
              ),
            )}
          </div>
        )}
      </Card>
      <div className="space-y-3">
        {items.length ? (
          items.map((a) => (
            <Card
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-4 p-5"
            >
              <div className="flex items-start gap-4">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(a.id)}
                  onChange={(event) =>
                    setSelectedIds((current) =>
                      event.target.checked
                        ? [...current, a.id]
                        : current.filter((id) => id !== a.id),
                    )
                  }
                  aria-label={`Select ${a.clientName}'s appointment`}
                  className="mt-1 h-4 w-4"
                />
                <div>
                  <p className="font-semibold">{a.clientName}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {serviceNames[a.serviceType]} · {fmtDate(a.startTime)} ·{" "}
                    {fmtTime(a.startTime)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {a.paymentStatus === "paid" && (
                  <Button
                    variant="outline"
                    disabled={refund.isPending}
                    onClick={() => {
                      if (confirm("Issue a full refund for this appointment?"))
                        refund.mutate({ id: a.id }, { onSuccess: refresh });
                    }}
                  >
                    Refund
                  </Button>
                )}
                <Badge
                  tone={
                    a.status === "confirmed"
                      ? "sage"
                      : a.status === "cancelled"
                        ? "red"
                        : "sand"
                  }
                >
                  {titleCase(a.status)}
                </Badge>
                <select
                  value={a.status}
                  onChange={(e) =>
                    update.mutate(
                      {
                        id: a.id,
                        data: { status: e.target.value as AppointmentStatus },
                      },
                      { onSuccess: refresh },
                    )
                  }
                  className="rounded-lg border border-input bg-card px-2 py-2 text-xs"
                  data-testid={`select-admin-appointment-${a.id}`}
                >
                  <option value="pending">Pending</option>
                  <option value="pending_payment">Payment pending</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="no_show">No show</option>
                </select>
              </div>
            </Card>
          ))
        ) : (
          <EmptyState
            title="No appointments to review"
            copy="New bookings will appear here."
          />
        )}
      </div>
    </AdminShell>
  );
}
function AdminWaitlist() {
  const q = useGetAdminWaitlist();
  const convert = useConvertWaitlistEntry();
  const practice = useGetPublicPractice();
  const items = q.data ?? [];
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const [converting, setConverting] = useState<WaitlistEntry | null>(null);
  const [date, setDate] = useState(toDateInput(tomorrow));
  const [time, setTime] = useState("10:00");
  const [duration, setDuration] = useState(50);
  const submitConversion = () => {
    if (!converting) return;
    const start = zonedToUtc(
      date,
      time,
      practice.data?.timezone ?? "America/Vancouver",
    );
    const end = new Date(start.getTime() + duration * 60000);
    convert.mutate(
      {
        id: converting.id,
        data: {
          clientId: converting.clientId,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          serviceType: converting.serviceType,
          durationMin: duration as (typeof durationOptions)[number],
          notes: null,
        },
      },
      {
        onSuccess: () => {
          setConverting(null);
          void invalidate(
            getGetAdminWaitlistQueryKey(),
            getGetAdminCalendarQueryKey(),
            getGetAdminAppointmentsQueryKey(),
          );
        },
      },
    );
  };
  return (
    <AdminShell>
      <PageTitle
        eyebrow="When timing is tender"
        title="Waitlist."
        copy="See who is waiting, and make an offer when a suitable slot opens up."
      />
      {items.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {items.map((item) => (
            <Card key={item.id} className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold">{item.clientName}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {serviceNames[item.serviceType]}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Added {fmtDate(item.createdAt)}
                  </p>
                </div>
                <Badge
                  tone={item.status === "slot_available" ? "sand" : "slate"}
                >
                  {titleCase(item.status)}
                </Badge>
              </div>
              <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-muted p-3">
                  <p className="text-xs text-muted-foreground">Preferred day</p>
                  <p className="mt-1 font-semibold">
                    {
                      [
                        "Sunday",
                        "Monday",
                        "Tuesday",
                        "Wednesday",
                        "Thursday",
                        "Friday",
                        "Saturday",
                      ][item.preferredDay]
                    }
                  </p>
                </div>
                <div className="rounded-xl bg-muted p-3">
                  <p className="text-xs text-muted-foreground">Window</p>
                  <p className="mt-1 font-semibold">
                    {titleCase(item.preferredTimeWindow)}
                  </p>
                </div>
              </div>
              <Button
                variant={item.status === "converted" ? "quiet" : "primary"}
                className="mt-5 w-full"
                disabled={item.status === "converted"}
                onClick={() => setConverting(item)}
                data-testid={`button-convert-waitlist-${item.id}`}
              >
                {item.status === "converted"
                  ? "Converted"
                  : "Convert to appointment"}
              </Button>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          title="The waitlist is clear"
          copy="A clear waitlist means your current availability is meeting demand."
        />
      )}
      {converting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 p-5">
          <Card className="w-full max-w-md p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="mono text-[10px] uppercase tracking-[.2em] text-secondary">
                  Waitlist conversion
                </p>
                <h2 className="display mt-2 text-3xl">
                  Schedule {converting.clientName}.
                </h2>
              </div>
              <button
                onClick={() => setConverting(null)}
                aria-label="Close"
                className="rounded-full p-2 hover:bg-muted"
              >
                <X size={18} />
              </button>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <label className="text-sm font-semibold">
                Date
                <input
                  type="date"
                  value={date}
                  min={toDateInput(new Date())}
                  onChange={(event) => setDate(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm"
                />
              </label>
              <label className="text-sm font-semibold">
                Time
                <input
                  type="time"
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm"
                />
              </label>
            </div>
            <label className="mt-4 block text-sm font-semibold">
              Duration
              <select
                value={duration}
                onChange={(event) => setDuration(Number(event.target.value))}
                className="mt-2 w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm"
              >
                {durationOptions.map((value) => (
                  <option key={value} value={value}>
                    {value} minutes
                  </option>
                ))}
              </select>
            </label>
            {convert.isError && (
              <p className="mt-4 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
                {convert.error.message}
              </p>
            )}
            <Button
              onClick={submitConversion}
              disabled={convert.isPending}
              className="mt-6 w-full"
            >
              {convert.isPending ? "Scheduling…" : "Create appointment"}
            </Button>
          </Card>
        </div>
      )}
    </AdminShell>
  );
}

function AdminAccount() {
  const user = useGetCurrentUser().data;
  const changePassword = useChangePassword();
  const changeEmail = useChangeEmail();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [notice, setNotice] = useState("");
  return (
    <AdminShell>
      <PageTitle
        eyebrow="Account access"
        title="Account security."
        copy="Change the practitioner login without reusing deployment bootstrap secrets."
      />
      {notice && (
        <p className="mb-5 rounded-xl bg-primary/10 p-4 text-sm text-primary">
          {notice}
        </p>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        <Card className="p-6">
          <h2 className="display text-2xl">Change password</h2>
          <form
            className="mt-5 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              changePassword.mutate(
                { data: { currentPassword, newPassword } },
                {
                  onSuccess: () => {
                    setCurrentPassword("");
                    setNewPassword("");
                    setNotice(
                      "Password changed and other sessions signed out.",
                    );
                  },
                },
              );
            }}
          >
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              placeholder="Current password"
              className="w-full rounded-xl border border-input px-4 py-3 text-sm"
            />
            <input
              type="password"
              required
              minLength={12}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="New password (12+ characters)"
              className="w-full rounded-xl border border-input px-4 py-3 text-sm"
            />
            <Button disabled={changePassword.isPending}>Change password</Button>
          </form>
        </Card>
        <Card className="p-6">
          <h2 className="display text-2xl">Change sign-in email</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Current email: {user?.email}
          </p>
          <form
            className="mt-5 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              changeEmail.mutate(
                {
                  data: {
                    email: newEmail,
                    currentPassword: emailPassword,
                  },
                },
                {
                  onSuccess: () => {
                    setNewEmail("");
                    setEmailPassword("");
                    setNotice("Confirmation sent to the new email address.");
                  },
                },
              );
            }}
          >
            <input
              type="email"
              required
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
              placeholder="New email address"
              className="w-full rounded-xl border border-input px-4 py-3 text-sm"
            />
            <input
              type="password"
              required
              value={emailPassword}
              onChange={(event) => setEmailPassword(event.target.value)}
              placeholder="Current password"
              className="w-full rounded-xl border border-input px-4 py-3 text-sm"
            />
            <Button disabled={changeEmail.isPending}>Send confirmation</Button>
          </form>
        </Card>
      </div>
    </AdminShell>
  );
}

function AdminAvailability() {
  const q = useGetAvailability();
  const update = useUpdateAvailability();
  const settingsQuery = useGetAdminSettings();
  const updateSettings = useUpdateAdminSettings();
  const pricesQuery = useGetAdminPrices();
  const updatePrices = useUpdateAdminPrices();
  const integrations = useGetPublicPractice();
  const defaults = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const [draft, setDraft] = useState(
    defaults.map((_, dayOfWeek) => ({
      dayOfWeek,
      startTime: "09:00",
      endTime: "17:00",
      isActive: dayOfWeek > 0 && dayOfWeek < 6,
    })),
  );
  const [settings, setSettings] = useState<PracticeSettings>({
    bufferMin: 0,
    defaultDurations: {
      couples: 60,
      individual: 50,
      child_teen: 50,
      christian_counseling: 50,
    },
  });
  const [priceDraft, setPriceDraft] = useState<ServicePrice[]>([]);
  useEffect(() => {
    if (q.data)
      setDraft(
        q.data.map(({ dayOfWeek, startTime, endTime, isActive }) => ({
          dayOfWeek,
          startTime,
          endTime,
          isActive,
        })),
      );
  }, [q.data]);
  useEffect(() => {
    if (settingsQuery.data) setSettings(settingsQuery.data);
  }, [settingsQuery.data]);
  useEffect(() => {
    if (pricesQuery.data) setPriceDraft(pricesQuery.data);
  }, [pricesQuery.data]);
  const setDay = (
    dayOfWeek: number,
    patch: Partial<(typeof draft)[number]>,
  ) => {
    setDraft((items) =>
      items.map((item) =>
        item.dayOfWeek === dayOfWeek ? { ...item, ...patch } : item,
      ),
    );
  };
  return (
    <AdminShell>
      <PageTitle
        eyebrow="Your working rhythm"
        title="Availability."
        copy="Set recurring hours once, then let the calendar protect them."
        action={
          <Button
            onClick={() => {
              update.mutate(
                { data: draft },
                {
                  onSuccess: () =>
                    void invalidate(getGetAvailabilityQueryKey()),
                },
              );
              updateSettings.mutate(
                { data: settings },
                {
                  onSuccess: () =>
                    void invalidate(getGetAdminSettingsQueryKey()),
                },
              );
            }}
            disabled={update.isPending || updateSettings.isPending}
          >
            {update.isPending || updateSettings.isPending
              ? "Saving…"
              : "Save availability"}
          </Button>
        }
      />
      <Card className="mb-5 p-5">
        <h2 className="display text-2xl">Integration status</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          {[
            ["Resend email", integrations.data?.emailConfigured],
            ["Stripe payments", integrations.data?.paymentsConfigured],
            ["Upheal meeting", integrations.data?.meetingConfigured],
          ].map(([label, configured]) => (
            <Badge key={String(label)} tone={configured ? "sage" : "red"}>
              {String(label)}: {configured ? "Connected" : "Not configured"}
            </Badge>
          ))}
        </div>
      </Card>
      <Card className="mb-5 p-5">
        <h2 className="display text-2xl">Session defaults</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-5">
          {paidServiceTypes.map((service) => (
            <label
              key={service}
              className="text-xs font-semibold text-muted-foreground"
            >
              {serviceNames[service]}
              <select
                value={settings.defaultDurations[service]}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    defaultDurations: {
                      ...current.defaultDurations,
                      [service]: Number(event.target.value),
                    },
                  }))
                }
                className="mt-2 w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm text-foreground"
              >
                {paidDurationOptions.map((value) => (
                  <option key={value} value={value}>
                    {value} min
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label className="text-xs font-semibold text-muted-foreground">
            Buffer between sessions
            <select
              value={settings.bufferMin}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  bufferMin: Number(event.target.value),
                }))
              }
              className="mt-2 w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm text-foreground"
            >
              {[0, 5, 10, 15, 20, 30, 45, 60].map((value) => (
                <option key={value} value={value}>
                  {value} min
                </option>
              ))}
            </select>
          </label>
        </div>
      </Card>
      <Card className="mb-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="display text-2xl">Online payment prices</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Prices are in Canadian dollars. Only active combinations appear in
              client booking.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() =>
                setPriceDraft((current) => [
                  ...current,
                  {
                    serviceType: "individual",
                    durationMin: 50,
                    amountCents: 10000,
                    active: true,
                  },
                ])
              }
            >
              Add price
            </Button>
            <Button
              disabled={updatePrices.isPending}
              onClick={() =>
                updatePrices.mutate(
                  { data: priceDraft },
                  {
                    onSuccess: () =>
                      void invalidate(
                        getGetAdminPricesQueryKey(),
                        getGetPublicPracticeQueryKey(),
                      ),
                  },
                )
              }
            >
              Save prices
            </Button>
          </div>
        </div>
        <div className="mt-5 space-y-3">
          {priceDraft.map((price, index) => (
            <div
              key={`${price.serviceType}-${price.durationMin}-${index}`}
              className="grid gap-3 rounded-xl bg-muted p-3 md:grid-cols-[1.5fr_.7fr_.8fr_auto_auto]"
            >
              <select
                value={price.serviceType}
                onChange={(event) =>
                  setPriceDraft((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index
                        ? {
                            ...item,
                            serviceType: event.target
                              .value as ServicePrice["serviceType"],
                          }
                        : item,
                    ),
                  )
                }
                className="rounded-xl border border-input bg-card px-3 py-2 text-sm"
              >
                {paidServiceTypes.map((service) => (
                  <option key={service} value={service}>
                    {serviceNames[service]}
                  </option>
                ))}
              </select>
              <select
                value={price.durationMin}
                onChange={(event) =>
                  setPriceDraft((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index
                        ? {
                            ...item,
                            durationMin: Number(
                              event.target.value,
                            ) as ServicePrice["durationMin"],
                          }
                        : item,
                    ),
                  )
                }
                className="rounded-xl border border-input bg-card px-3 py-2 text-sm"
              >
                {paidDurationOptions.map((duration) => (
                  <option key={duration} value={duration}>
                    {duration} min
                  </option>
                ))}
              </select>
              <label className="flex items-center rounded-xl border border-input bg-card px-3">
                <span className="mr-1 text-sm">$</span>
                <input
                  type="number"
                  min="0.50"
                  step="0.01"
                  value={(price.amountCents / 100).toFixed(2)}
                  onChange={(event) =>
                    setPriceDraft((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? {
                              ...item,
                              amountCents: Math.round(
                                Number(event.target.value) * 100,
                              ),
                            }
                          : item,
                      ),
                    )
                  }
                  className="w-full bg-transparent py-2 text-sm outline-none"
                />
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={price.active}
                  onChange={(event) =>
                    setPriceDraft((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, active: event.target.checked }
                          : item,
                      ),
                    )
                  }
                />
                Active
              </label>
              <button
                onClick={() =>
                  setPriceDraft((current) =>
                    current.filter((_, itemIndex) => itemIndex !== index),
                  )
                }
                className="px-2 text-destructive"
                aria-label="Remove price"
              >
                <X size={16} />
              </button>
            </div>
          ))}
          {!priceDraft.length && (
            <p className="text-sm text-muted-foreground">
              Add at least one price before enabling paid booking.
            </p>
          )}
          {updatePrices.isError && (
            <p className="text-sm text-destructive">
              {updatePrices.error.message}
            </p>
          )}
        </div>
      </Card>
      <div className="space-y-3">
        {draft.map((item) => (
          <Card
            key={item.dayOfWeek}
            className="flex flex-wrap items-center gap-4 p-5"
          >
            <div className="w-28">
              <p className="font-semibold">{defaults[item.dayOfWeek]}</p>
              <p className="text-xs text-muted-foreground">
                {item.isActive ? "Open for booking" : "Closed"}
              </p>
            </div>
            <input
              type="time"
              value={item.startTime}
              onChange={(e) =>
                setDay(item.dayOfWeek, { startTime: e.target.value })
              }
              className="rounded-xl border border-input bg-card px-3 py-2 text-sm"
              data-testid={`input-start-${item.dayOfWeek}`}
            />
            <span className="text-muted-foreground">to</span>
            <input
              type="time"
              value={item.endTime}
              onChange={(e) =>
                setDay(item.dayOfWeek, { endTime: e.target.value })
              }
              className="rounded-xl border border-input bg-card px-3 py-2 text-sm"
              data-testid={`input-end-${item.dayOfWeek}`}
            />
            <button
              onClick={() =>
                setDay(item.dayOfWeek, { isActive: !item.isActive })
              }
              className={`ml-auto rounded-full px-4 py-2 text-xs font-semibold ${item.isActive ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
              data-testid={`button-toggle-day-${item.dayOfWeek}`}
            >
              {item.isActive ? "Available" : "Unavailable"}
            </button>
          </Card>
        ))}
      </div>
    </AdminShell>
  );
}
function AdminBlockedTimes() {
  const q = useGetBlockedTimes();
  const create = useCreateBlockedTime();
  const update = useUpdateBlockedTime();
  const remove = useDeleteBlockedTime();
  const practice = useGetPublicPractice();
  const timezone = practice.data?.timezone ?? "America/Vancouver";
  const [editing, setEditing] = useState<BlockedTime | null>(null);
  const [date, setDate] = useState(toDateInput(new Date()));
  const [start, setStart] = useState("12:00");
  const [end, setEnd] = useState("13:00");
  const [reason, setReason] = useState("Personal time");
  const items = q.data ?? [];
  const reset = () => {
    setEditing(null);
    setDate(toDateInput(new Date()));
    setStart("12:00");
    setEnd("13:00");
    setReason("Personal time");
  };
  const saveBlockedTime = () => {
    const data = {
      startTime: zonedToUtc(date, start, timezone).toISOString(),
      endTime: zonedToUtc(date, end, timezone).toISOString(),
      reason,
    };
    const options = {
      onSuccess: () => {
        reset();
        void invalidate(
          getGetBlockedTimesQueryKey(),
          getGetAdminCalendarQueryKey(),
        );
      },
    };
    if (editing) update.mutate({ id: editing.id, data }, options);
    else create.mutate({ data }, options);
  };
  const beginEdit = (item: BlockedTime) => {
    setEditing(item);
    setDate(dateInZone(item.startTime, timezone));
    setStart(timeInZone(item.startTime, timezone));
    setEnd(timeInZone(item.endTime, timezone));
    setReason(item.reason);
  };
  return (
    <AdminShell>
      <PageTitle
        eyebrow="Protect the edges"
        title="Blocked times."
        copy="Keep space for the parts of life that do not belong on a calendar."
      />
      <div className="grid gap-5 lg:grid-cols-[.8fr_1.2fr]">
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <h2 className="display text-2xl">
              {editing ? "Edit blocked time" : "Block a new time"}
            </h2>
            {editing && (
              <button
                onClick={reset}
                className="text-xs font-semibold text-secondary"
              >
                Cancel edit
              </button>
            )}
          </div>
          <div className="mt-5 space-y-4">
            <label className="block text-sm font-semibold">
              Date
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-2 w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm"
                data-testid="input-block-date"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm font-semibold">
                Starts
                <input
                  type="time"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm"
                  data-testid="input-block-start"
                />
              </label>
              <label className="text-sm font-semibold">
                Ends
                <input
                  type="time"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm"
                  data-testid="input-block-end"
                />
              </label>
            </div>
            <label className="block text-sm font-semibold">
              Reason
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="mt-2 w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm"
                data-testid="input-block-reason"
              />
            </label>
            <Button
              onClick={saveBlockedTime}
              disabled={create.isPending || update.isPending}
              className="w-full"
              data-testid="button-create-block"
            >
              {editing ? "Save blocked time" : "Block this time"}
            </Button>
          </div>
        </Card>
        <Card className="p-6">
          <h2 className="display text-2xl">Upcoming blocks</h2>
          {items.length ? (
            <div className="mt-5 space-y-3">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-xl bg-muted p-4"
                >
                  <div>
                    <p className="text-sm font-semibold">{item.reason}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {fmtDate(item.startTime)} · {fmtTime(item.startTime)} –{" "}
                      {fmtTime(item.endTime)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" onClick={() => beginEdit(item)}>
                      Edit
                    </Button>
                    <button
                      onClick={() =>
                        remove.mutate(
                          { id: item.id },
                          {
                            onSuccess: () =>
                              void invalidate(
                                getGetBlockedTimesQueryKey(),
                                getGetAdminCalendarQueryKey(),
                              ),
                          },
                        )
                      }
                      aria-label={`Delete ${item.reason}`}
                      className="rounded-full p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      data-testid={`button-delete-block-${item.id}`}
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-5 text-sm text-muted-foreground">
              No blocked times on the horizon.
            </p>
          )}
        </Card>
      </div>
    </AdminShell>
  );
}

function AuthGate({ children }: { children: ReactNode }) {
  const q = useGetCurrentUser({
    query: { queryKey: getGetCurrentUserQueryKey(), retry: false },
  });
  const [currentLocation, setLocation] = useLocation();
  useEffect(() => {
    if (q.isError) {
      setLocation("/login");
      return;
    }
    if (
      q.data &&
      currentLocation.startsWith("/admin") &&
      q.data.role !== "admin"
    )
      setLocation("/client");
    if (
      q.data &&
      currentLocation.startsWith("/client") &&
      q.data.role !== "client"
    )
      setLocation("/admin");
  }, [currentLocation, q.data, q.isError, setLocation]);
  return (
    <>
      {q.isLoading || q.isError ? (
        <div className="app-shell flex items-center justify-center">
          <div className="w-64">
            <Skeleton className="h-3" />
            <Skeleton className="mt-3 h-3 w-3/4" />
          </div>
        </div>
      ) : (
        children
      )}
    </>
  );
}
function Router() {
  return (
    <ErrorBoundary resetKey={location.pathname}>
      <Switch>
        <Route path="/" component={Landing} />
        <Route path="/login" component={Login} />
        <Route path="/register" component={Register} />
        <Route path="/forgot-password" component={ForgotPassword} />
        <Route path="/reset-password" component={ResetPassword} />
        <Route path="/verify-email" component={VerifyEmail} />
        <Route path="/verify-email-change" component={VerifyEmailChange} />
        <Route
          path="/client/book"
          component={() => (
            <AuthGate>
              <Booking />
            </AuthGate>
          )}
        />
        <Route
          path="/client/appointments"
          component={() => (
            <AuthGate>
              <ClientAppointments />
            </AuthGate>
          )}
        />
        <Route
          path="/client/profile"
          component={() => (
            <AuthGate>
              <ClientProfile />
            </AuthGate>
          )}
        />
        <Route
          path="/client"
          component={() => (
            <AuthGate>
              <ClientDashboard />
            </AuthGate>
          )}
        />
        <Route
          path="/admin/calendar"
          component={() => (
            <AuthGate>
              <AdminCalendar />
            </AuthGate>
          )}
        />
        <Route
          path="/admin/clients/:id"
          component={() => (
            <AuthGate>
              <ClientDetail />
            </AuthGate>
          )}
        />
        <Route
          path="/admin/clients"
          component={() => (
            <AuthGate>
              <AdminClients />
            </AuthGate>
          )}
        />
        <Route
          path="/admin/appointments"
          component={() => (
            <AuthGate>
              <AdminAppointments />
            </AuthGate>
          )}
        />
        <Route
          path="/admin/waitlist"
          component={() => (
            <AuthGate>
              <AdminWaitlist />
            </AuthGate>
          )}
        />
        <Route
          path="/admin/account"
          component={() => (
            <AuthGate>
              <AdminAccount />
            </AuthGate>
          )}
        />
        <Route
          path="/admin/availability"
          component={() => (
            <AuthGate>
              <AdminAvailability />
            </AuthGate>
          )}
        />
        <Route
          path="/admin/blocked-times"
          component={() => (
            <AuthGate>
              <AdminBlockedTimes />
            </AuthGate>
          )}
        />
        <Route
          path="/admin"
          component={() => (
            <AuthGate>
              <AdminOverview />
            </AuthGate>
          )}
        />
        <Route component={NotFound} />
      </Switch>
    </ErrorBoundary>
  );
}
function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Router />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
export default App;
