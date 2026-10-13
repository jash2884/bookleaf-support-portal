import type { ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { Role } from "./api/types";
import { useAuth } from "./auth/AuthProvider";
import { AppShell } from "./components/AppShell";
import { EmptyState, PageLoader } from "./components/ui";
import { LoginPage } from "./pages/LoginPage";
import { BooksPage } from "./pages/author/BooksPage";
import { MyTicketsPage } from "./pages/author/MyTicketsPage";
import { NewTicketPage } from "./pages/author/NewTicketPage";
import { AuthorTicketPage } from "./pages/author/AuthorTicketPage";
import { QueuePage } from "./pages/admin/QueuePage";
import { AdminTicketPage } from "./pages/admin/AdminTicketPage";
import { InsightsPage } from "./pages/admin/InsightsPage";

export const homeFor = (role: Role) => (role === "ADMIN" ? "/admin/tickets" : "/books");

/** Route guard: signed-in users of the given role only. Server enforces the same rules. */
function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.role !== role) return <Navigate to={homeFor(user.role)} replace />;
  return <>{children}</>;
}

function Home() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <PageLoader />;
  return <Navigate to={user ? homeFor(user.role) : "/login"} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<Home />} />

      <Route element={<RequireRole role="AUTHOR"><AppShell /></RequireRole>}>
        <Route path="/books" element={<BooksPage />} />
        <Route path="/tickets" element={<MyTicketsPage />} />
        <Route path="/tickets/new" element={<NewTicketPage />} />
        <Route path="/tickets/:ticketId" element={<AuthorTicketPage />} />
      </Route>

      <Route element={<RequireRole role="ADMIN"><AppShell /></RequireRole>}>
        <Route path="/admin" element={<Navigate to="/admin/tickets" replace />} />
        <Route path="/admin/tickets" element={<QueuePage />} />
        <Route path="/admin/tickets/:ticketId" element={<AdminTicketPage />} />
        <Route path="/admin/insights" element={<InsightsPage />} />
      </Route>

      <Route
        path="*"
        element={
          <div className="container">
            <EmptyState title="Page not found" action={<Link to="/" className="btn btn-primary">Go home</Link>}>
              The page you're looking for doesn't exist.
            </EmptyState>
          </div>
        }
      />
    </Routes>
  );
}
