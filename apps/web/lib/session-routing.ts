export type SessionUser = {
  role: "admin" | "teacher";
  status: "active" | "leave" | "retired";
  mustChangePassword: boolean;
};

export const destinationForUser = (user: SessionUser) => {
  if (user.status !== "active") return "/account-inactive";
  if (user.mustChangePassword) return "/change-password";
  return user.role === "admin" ? "/admin" : "/teacher/subjects";
};

export const isAllowedRoute = (pathname: string, user: SessionUser) => {
  if (user.status !== "active") return pathname === "/account-inactive";
  if (user.mustChangePassword) return pathname === "/change-password";
  if (user.role === "admin") return pathname === "/admin" || pathname.startsWith("/admin/");
  return pathname === "/teacher/subjects" || pathname.startsWith("/teacher/subjects/");
};
