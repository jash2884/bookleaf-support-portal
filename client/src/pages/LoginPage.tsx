import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "../api/http";
import { useAuth } from "../auth/AuthProvider";
import { Logo } from "../components/AppShell";
import { homeFor } from "../App";

const DEMO_ACCOUNTS = [
  { label: "Priya Sharma", hint: "Author · 2 published books, royalty pending", email: "priya.sharma@email.com", password: "Author@123" },
  { label: "Kavita Deshmukh", hint: "Author · 1 book in production, pending below ₹1,000", email: "kavita.deshmukh@email.com", password: "Author@123" },
  { label: "Neha Iyer", hint: "BookLeaf admin · support desk", email: "admin@bookleaf.com", password: "Admin@123" },
];

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to={homeFor(user.role)} replace />;

  async function signIn(e?: FormEvent, creds = { email, password }) {
    e?.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const signedIn = await login(creds.email, creds.password);
      // Return to the page that required sign-in, if it belongs to this user's portal.
      const from = (location.state as { from?: string } | null)?.from;
      const fromAllowed = from && (signedIn.role === "ADMIN") === from.startsWith("/admin");
      navigate(fromAllowed ? from : homeFor(signedIn.role), { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign-in failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login">
      <section className="login-hero">
        <Logo />
        <h1>Support that keeps authors writing.</h1>
        <p>Track your books and royalties, ask us anything, and see our replies the moment they're sent.</p>
      </section>

      <section className="login-panel">
        <form className="card login-card" onSubmit={signIn} noValidate>
          <h2>Sign in</h2>
          <p className="muted">Authors and BookLeaf team members use the same sign-in.</p>

          <label className="field">
            <span>Email</span>
            <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>

          {error && <div className="notice notice-error" role="alert">{error}</div>}

          <button className="btn btn-primary btn-block" disabled={submitting || !email || !password}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="demo-accounts">
          <h3>Demo accounts</h3>
          <p className="muted small">Every seeded author uses the password <code>Author@123</code>.</p>
          {DEMO_ACCOUNTS.map((a) => (
            <button
              key={a.email}
              type="button"
              className="demo-account"
              disabled={submitting}
              onClick={() => {
                setEmail(a.email);
                setPassword(a.password);
                void signIn(undefined, a);
              }}
            >
              <strong>{a.label}</strong>
              <span>{a.hint}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
