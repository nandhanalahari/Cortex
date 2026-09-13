import { useState } from "react";
import { api, session } from "../api";
import type { AuthUser } from "../types";

interface Props {
  onClose: () => void;
  onAuthed: (user: AuthUser) => void;
}

type Mode = "login" | "signup";

const MIN_PASSWORD = 8;

export default function AuthModal({ onClose, onAuthed }: Props) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "signup" && password.length < MIN_PASSWORD) {
      setError(`Password needs at least ${MIN_PASSWORD} characters.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = mode === "login" ? await api.login(email.trim(), password) : await api.signup(email.trim(), password);
      session.set(res.token);
      onAuthed(res.user);
    } catch (err) {
      setError((err as Error).message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="redo-overlay" onClick={busy ? undefined : onClose}>
      <form className="auth-panel" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <header className="rs-head">
          <div>
            <h2 className="rs-title">{mode === "login" ? "Log in" : "Create account"}</h2>
            <p className="rs-sub">Optional. Cortex works without an account; signing in saves your Resegment history.</p>
          </div>
          <button type="button" className="rs-x" onClick={onClose} aria-label="Close" disabled={busy}>
            ×
          </button>
        </header>

        <div className="auth-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "on" : ""} onClick={() => switchMode("login")}>
            Log in
          </button>
          <button type="button" role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "on" : ""} onClick={() => switchMode("signup")}>
            Sign up
          </button>
        </div>

        {error && <div className="rs-error">{error}</div>}

        <label className="auth-field">
          <span>Email</span>
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </label>
        <label className="auth-field">
          <span>Password</span>
          <input
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={mode === "signup" ? MIN_PASSWORD : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode === "signup" && <small>At least {MIN_PASSWORD} characters</small>}
        </label>

        <div className="rs-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Continue without account
          </button>
          <button type="submit" className="btn btn-accent" disabled={busy}>
            {busy ? "…" : mode === "login" ? "Log in" : "Sign up"}
          </button>
        </div>
      </form>
    </div>
  );
}
