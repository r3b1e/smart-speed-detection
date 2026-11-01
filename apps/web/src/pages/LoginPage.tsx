import { LoginInputSchema, RegisterInputSchema } from "@smart-speed/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { Button } from "../components/ui/button";
import { Input, Label } from "../components/ui/input";
import { Spinner } from "../components/ui/states";
import { ApiError } from "../lib/api";
import { useAuth } from "../stores/auth";

type Mode = "login" | "register";

/** Both modes share one form shape; the login schema strips the extra field. */
interface FormValues {
  name: string;
  email: string;
  password: string;
}

const DEMO_ACCOUNTS = [
  { label: "Admin", email: "admin@smartspeed.local" },
  { label: "Authority", email: "authority@smartspeed.local" },
  { label: "Driver", email: "driver@smartspeed.local" },
];

export function LoginPage() {
  const [mode, setMode] = useState<Mode>("login");
  const login = useAuth((s) => s.login);
  const register = useAuth((s) => s.register);
  const serverError = useAuth((s) => s.error);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const schema = mode === "login" ? LoginInputSchema : RegisterInputSchema;
  const {
    register: field,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema) as unknown as Resolver<FormValues>,
    defaultValues: { email: "", password: "", name: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setPending(true);
    setFormError(null);
    try {
      if (mode === "login") {
        await login(values.email, values.password);
      } else {
        await register(values.name ?? "", values.email, values.password);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setFormError(
          err.code === "RATE_LIMITED"
            ? "Too many attempts — wait a minute and try again."
            : err.message
        );
      } else {
        setFormError("Something went wrong. Please try again.");
      }
    } finally {
      setPending(false);
    }
  });

  const error = formError ?? serverError;

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden p-4">
      {/* animated backdrop */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,hsl(var(--primary)/0.12),transparent_55%)]" />
        <div className="absolute inset-0 opacity-[0.35] [background-image:linear-gradient(hsl(var(--border)/0.6)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--border)/0.6)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
        <motion.div
          className="absolute -left-32 top-1/4 h-72 w-72 rounded-full bg-primary/20 blur-3xl"
          animate={{ x: [0, 60, 0], y: [0, 40, 0] }}
          transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute -right-24 bottom-1/4 h-72 w-72 rounded-full bg-accent/20 blur-3xl"
          animate={{ x: [0, -50, 0], y: [0, -30, 0] }}
          transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="glass relative z-10 w-full max-w-md p-7"
      >
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20 text-primary">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Smart Speed</h1>
            <p className="text-xs text-muted-foreground">Traffic operations console</p>
          </div>
        </div>

        <form onSubmit={(e) => void onSubmit(e)} className="space-y-4" noValidate>
          {mode === "register" ? (
            <div>
              <Label htmlFor="name">Name</Label>
              <Input id="name" autoComplete="name" placeholder="Your name" {...field("name")} />
              {errors.name ? (
                <p className="mt-1 text-xs text-danger">{errors.name.message}</p>
              ) : null}
            </div>
          ) : null}

          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              {...field("email")}
            />
            {errors.email ? (
              <p className="mt-1 text-xs text-danger">{errors.email.message}</p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              placeholder="••••••••"
              {...field("password")}
            />
            {errors.password ? (
              <p className="mt-1 text-xs text-danger">{errors.password.message}</p>
            ) : null}
          </div>

          {error ? (
            <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          ) : null}

          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? <Spinner className="h-4 w-4" /> : null}
            {mode === "login" ? "Sign in" : "Create account"}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </form>

        <button
          type="button"
          className="mt-4 w-full text-center text-xs text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setFormError(null);
          }}
        >
          {mode === "login" ? "No account? Register as a driver" : "Already registered? Sign in"}
        </button>

        <div className="mt-6 rounded-lg border border-border/70 bg-muted/40 p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Demo accounts (seeded)
          </p>
          <div className="flex flex-wrap gap-1.5">
            {DEMO_ACCOUNTS.map((acct) => (
              <button
                key={acct.email}
                type="button"
                className="rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium hover:border-primary/50 hover:text-primary"
                onClick={() => {
                  setMode("login");
                  setValue("email", acct.email, { shouldValidate: true });
                  setValue("password", "Demo@1234", { shouldValidate: true });
                }}
              >
                {acct.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[10px] text-muted-foreground">password: Demo@1234</p>
        </div>
      </motion.div>
    </div>
  );
}
