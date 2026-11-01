"use client";
import { nextField, useKeyboardViewport } from "./data-entry";
import { haptic } from "./haptics";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { RefreshCw } from "lucide-react";
import { HatchDevice } from "./artwork";
import { BusyIcon } from "./busy-icon";
import { SoundRoom } from "./sound-room";
import { isRoomState } from "./room-state";
import type { RoomState } from "./types";

type Session =
  | { authenticated: false }
  | { authenticated: true; displayName: string; room: RoomState };

async function authRequest(path: "bootstrap" | "login" | "logout", body?: unknown): Promise<Session> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(`/auth/${path}`, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
    const data = (await response.json().catch(() => null)) as
      ({ error?: string } & Record<string, unknown>) | null;
    if (!response.ok)
      throw new Error(
        data?.error ||
          "Sign-in could not be completed. Check your details and try again.",
      );
    if (
      !data || typeof data.authenticated !== "boolean" ||
      (data.authenticated && (typeof data.displayName !== "string" || !isRoomState(data.room)))
    )
      throw new Error(
        "The room returned an unreadable response. Refresh and try again.",
      );
    return data as Session;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError")
      throw new Error("The connection took too long. Try again.");
    if (error instanceof TypeError)
      throw new Error(
        "Your room could not be reached. Check your connection and try again.",
      );
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function SoundRoomApp() {
  useKeyboardViewport();
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);

  const checkSession = useCallback(async () => {
    try {
      setSession(await authRequest("bootstrap"));
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The room could not be reached. Try again.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Let Strict Mode cancel its rehearsal before starting the session request.
    const initialRequest = window.setTimeout(() => void checkSession(), 0);
    return () => window.clearTimeout(initialRequest);
  }, [checkSession]);

  async function logout() {
    setSigningOut(true);
    try {
      await authRequest("logout", {});
      haptic("success");
      setSession({ authenticated: false });
    } catch (cause) {
      haptic("error");
      setError(
        cause instanceof Error ? cause.message : "Sign-out failed. Try again.",
      );
    } finally {
      setSigningOut(false);
    }
  }

  if (loading)
    return (
      <div className="auth-state" role="status" aria-live="polite">
        <BusyIcon size={23} />
        <p>Opening Your Sound Room…</p>
      </div>
    );
  if (session?.authenticated)
    return (
      <>
        <SoundRoom
          name={session.displayName?.trim().split(/\s+/)[0] || "Owner"}
          onLogout={logout}
          signingOut={signingOut}
          initialRoom={session.room}
        />
        {error && (
          <div className="auth-logout-error" role="status" aria-live="polite">
            <p>{error}</p>
            <button className="key key-compact" onClick={() => setError("")}>
              Dismiss
            </button>
          </div>
        )}
      </>
    );
  if (!session)
    return (
      <div className="auth-state" role="status" aria-live="polite">
        <p>{error || "Your room could not be loaded."}</p>
        <button
          className="key"
          onClick={() => {
            setLoading(true);
            void checkSession();
          }}
        >
          <RefreshCw size={16} aria-hidden="true" />
          Try Again
        </button>
      </div>
    );
  return <SignIn onSuccess={setSession} />;
}

function SignIn({ onSuccess }: { onSuccess: (session: Session) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get("email") || "").trim();
    const password = String(data.get("password") || "");
    const next: Record<string, string> = {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      next.email = "Enter the email address for your Hatch account.";
    if (!password) next.password = "Enter your Hatch account password.";
    setErrors(next);
    setError("");
    if (Object.keys(next).length) {
      haptic("error");
      (
        form.elements.namedItem(Object.keys(next)[0]) as HTMLElement | null
      )?.focus();
      return;
    }
    setBusy(true);
    try {
      const session = await authRequest("login", { email, password });
      const input = form.elements.namedItem("password");
      if (input instanceof HTMLInputElement) input.value = "";
      onSuccess(session);
      haptic("success");
    } catch (cause) {
      haptic("error");
      setError(
        cause instanceof Error
          ? cause.message
          : "Sign-in failed. Check your details and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page" id="main-content">
      <a className="skip-link" href="#signin-email">
        Skip to Sign In
      </a>
      <div className="auth-hero">
        <HatchDevice on color="#ffcc2e" brightness={70} size="small" />
        <p className="eyebrow" translate="no">
          Hatch
        </p>
        <h1>Sound Room</h1>
        <p className="auth-lede">
          Your sounds, a little light, and a gentler start to the day.
        </p>
      </div>
      <section className="auth-card" aria-labelledby="signin-title">
        <h2 id="signin-title">Open Your Room</h2>
        <form onSubmit={submit} noValidate>
          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {Object.values(errors).join(" ")}
          </p>
          <div className="row-group">
            <div className="field row-field stacked">
              <label htmlFor="signin-email">Hatch Account Email</label>
              <input
                id="signin-email"
                required
                type="email"
                name="email"
                autoComplete="username"
                enterKeyHint="next" onKeyDown={nextField} autoCorrect="off"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="you@example.com…"
                aria-invalid={Boolean(errors.email)}
                aria-describedby={
                  errors.email ? "signin-email-error" : undefined
                }
                disabled={busy}
              />
              {errors.email && (
                <span className="field-error" id="signin-email-error">
                  {errors.email}
                </span>
              )}
            </div>
            <div className="field row-field stacked">
              <label htmlFor="signin-password">Password</label>
              <input
                id="signin-password"
                required
                type="password"
                name="password"
                autoComplete="current-password"
                enterKeyHint="go" autoCapitalize="off" autoCorrect="off" spellCheck={false}
                aria-invalid={Boolean(errors.password)}
                aria-describedby={
                  errors.password ? "signin-password-error" : undefined
                }
                disabled={busy}
              />
              {errors.password && (
                <span className="field-error" id="signin-password-error">
                  {errors.password}
                </span>
              )}
            </div>
          </div>
          <button className="key key-blue key-wide" type="submit" disabled={busy}>
            {busy ? (
              <>
                <BusyIcon size={16} />
                Signing In…
              </>
            ) : (
              "Open Sound Room"
            )}
          </button>
          <p className="form-error" role="status" aria-live="polite">
            {error}
          </p>
        </form>
        <p className="hint">
          Use your existing Hatch account. Your session stays private in this
          browser.
        </p>
      </section>
    </main>
  );
}
