import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { useTicketEvents } from "../realtime/useTicketEvents";

export function Logo() {
  return (
    <span className="logo">
      <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden>
        <path d="M6 26C6 13 15 6 27 5c-1 12-8 21-21 21z" fill="var(--brand)" />
        <path d="M7 25 20 12" stroke="var(--surface)" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span>
        Book<strong>Leaf</strong>
      </span>
    </span>
  );
}

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const live = useTicketEvents(Boolean(user));
  const isAdmin = user?.role === "ADMIN";

  const links = isAdmin
    ? [
        { to: "/admin/tickets", label: "Ticket queue" },
        { to: "/admin/insights", label: "AI & queue insights" },
      ]
    : [
        { to: "/books", label: "My books" },
        { to: "/tickets", label: "My tickets" },
        { to: "/tickets/new", label: "Get help" },
      ];

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand-block">
            <Logo />
            <span className="product-name">{isAdmin ? "Support Desk" : "Author Portal"}</span>
          </div>
          <nav className="nav" aria-label="Main">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="topbar-right">
            <span className={`live live-${live}`} title={live === "live" ? "Updates arrive in real time" : "Reconnecting to live updates…"}>
              <span className="live-dot" /> {live === "live" ? "Live" : "Reconnecting"}
            </span>
            <span className="user-name">{user?.name}</span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={async () => {
                await logout();
                navigate("/login");
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="container">
        <Outlet />
      </main>
    </div>
  );
}
