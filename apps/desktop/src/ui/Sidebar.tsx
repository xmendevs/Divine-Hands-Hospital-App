import { useState, useEffect } from "react";
import { theme, Icon, type IconName } from "@hims/ui";
import { apiFetch } from "../api/client";
import type { CSSProperties } from "react";

export interface NavItem {
  key: string;
  label: string;
  icon: IconName;
  onSelect?: () => void;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export interface SidebarProps {
  groups: NavGroup[];
  active: string;
  onSelect: (key: string) => void;
  onLogout: () => void;
  onSwitchUser?: (username: string, password: string) => Promise<void>;
  onReturnToAdmin?: () => Promise<void>;
  username: string;
  isSuperAdmin?: boolean;
}

interface TestAccount {
  username: string;
  label: string;
  role: string;
  password: string;
}

const TEST_ACCOUNTS: TestAccount[] = [
  { username: "doctor1", label: "Dr. Chidi Okonkwo", role: "Doctor", password: "Doctor123!" },
  { username: "nurse1", label: "Adaeze Nwosu", role: "Nurse", password: "Nurse123!" },
  { username: "matron1", label: "Chief Ngozi Eze", role: "Matron", password: "Matron123!" },
  { username: "pharmacist1", label: "Emeka Adeyemi", role: "Pharmacist", password: "Pharm123!" },
  { username: "cashier1", label: "Funke Adeyemi", role: "Cashier", password: "Cashier123!" },
  { username: "labtech1", label: "Tunde Bakare", role: "Lab Tech", password: "LabTech123!" },
  { username: "labsupervisor1", label: "Dr. Aisha Mohammed", role: "Lab Supervisor", password: "LabSup123!" },
];

const navBtnBase: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: theme.spacing["2"],
  width: "100%",
  textAlign: "left",
  background: "transparent",
  color: theme.sidebar.text,
  border: "none",
  padding: "0.5rem 0.75rem",
  borderRadius: theme.radius.md,
  fontSize: theme.fontSize.base,
  fontWeight: theme.fontWeight.medium,
  cursor: "pointer",
  transition: "background-color 150ms ease, color 150ms ease",
};

const roleColors: Record<string, string> = {
  Doctor: "#60a5fa",
  Nurse: "#a78bfa",
  Matron: "#e879f9",
  Pharmacist: "#34d399",
  Cashier: "#fbbf24",
  "Lab Tech": "#f87171",
  "Lab Supervisor": "#fb923c",
};

export function Sidebar({
  groups,
  active,
  onSelect,
  onLogout,
  onSwitchUser,
  onReturnToAdmin,
  username,
  isSuperAdmin,
}: SidebarProps) {
  const [switching, setSwitching] = useState(false);
  const [switchingUser, setSwitchingUser] = useState("");
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [createForm, setCreateForm] = useState({
    username: "",
    email: "",
    password: "",
    firstName: "",
    lastName: "",
    employeeNo: "",
    roleCode: "doctor",
  });
  const [creating, setCreating] = useState(false);
  const [users, setUsers] = useState<{ id: string; username: string; email: string; roles: string[] }[]>([]);
  const [showUserList, setShowUserList] = useState(false);

  const loadUsers = () => {
    apiFetch<Record<string, unknown>[]>("/staff")
      .then((staff) => {
        setUsers(
          staff.map((s) => ({
            id: String(s.userId || s.id || ""),
            username: String(s.username || ""),
            email: String(s.contactEmail || ""),
            roles: Array.isArray(s.roles) ? (s.roles as { code: string }[]).map((r) => r.code) : [],
          })),
        );
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (showUserList) loadUsers();
  }, [showUserList]);

  async function handleSwitch(username: string, password: string) {
    setSwitching(true);
    setSwitchingUser(username);
    try {
      await onSwitchUser?.(username, password);
    } finally {
      setSwitching(false);
      setSwitchingUser("");
    }
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      await apiFetch("/admin/users", {
        method: "POST",
        body: JSON.stringify({
          username: createForm.username,
          email: createForm.email,
          password: createForm.password,
          firstName: createForm.firstName,
          lastName: createForm.lastName,
          employeeNo: createForm.employeeNo,
          roleCodes: [createForm.roleCode],
        }),
      });
      setShowCreateUser(false);
      setCreateForm({ username: "", email: "", password: "", firstName: "", lastName: "", employeeNo: "", roleCode: "doctor" });
      loadUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteUser(userId: string, uname: string) {
    if (!confirm(`Delete user "${uname}"? This cannot be undone.`)) return;
    try {
      await apiFetch(`/admin/users/${userId}/suspend`, { method: "POST" });
      loadUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete user");
    }
  }

  return (
    <aside
      role="navigation"
      aria-label="Main navigation"
      style={{
        width: 260,
        background: theme.sidebar.bg,
        color: "#ffffff",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        overflowY: "auto",
        height: "100vh",
      }}
    >
      <div style={{ padding: "1.25rem", borderBottom: `1px solid ${theme.sidebar.border}` }}>
        <h2 style={{ margin: 0, fontSize: theme.fontSize.lg, fontWeight: theme.fontWeight.bold, color: "#ffffff" }}>
          Divine Hands Hospital
        </h2>
        <span style={{ fontSize: theme.fontSize.sm, color: theme.sidebar.text }}>Enterprise Desktop OS</span>
      </div>

      <div style={{ padding: theme.spacing["4"], flex: 1, display: "flex", flexDirection: "column", gap: "1.2rem", overflowY: "auto" }}>
        {/* Quick Account Switcher */}
        <div>
          <div
            style={{
              fontSize: theme.fontSize.xs,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: theme.sidebar.category,
              fontWeight: theme.fontWeight.bold,
              marginBottom: theme.spacing["2"],
            }}
          >
            Quick Switch Account
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
            {TEST_ACCOUNTS.map((acc) => (
              <button
                key={acc.username}
                onClick={() => void handleSwitch(acc.username, acc.password)}
                disabled={switching}
                onMouseEnter={(e) => {
                  if (!switching) e.currentTarget.style.background = theme.sidebar.hoverBg;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
                style={{
                  ...navBtnBase,
                  padding: "0.35rem 0.75rem",
                  fontSize: theme.fontSize.xs,
                  opacity: switching && switchingUser !== acc.username ? 0.5 : 1,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: roleColors[acc.role] || "#888",
                    flexShrink: 0,
                  }}
                />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {acc.label}
                </span>
                <span style={{ fontSize: "0.65rem", color: theme.sidebar.category }}>{acc.role}</span>
              </button>
            ))}
            {switching && (
              <div style={{ fontSize: theme.fontSize.xs, color: theme.sidebar.category, padding: "0.25rem 0.75rem" }}>
                Switching to {switchingUser}...
              </div>
            )}
          </div>
        </div>

        {/* Return to SuperAdmin */}
        {username !== "superadmin" && onReturnToAdmin && (
          <button
            onClick={() => void onReturnToAdmin()}
            onMouseEnter={(e) => (e.currentTarget.style.background = theme.sidebar.hoverBg)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            style={{
              ...navBtnBase,
              background: "rgba(251, 191, 36, 0.15)",
              color: "#fbbf24",
              border: "1px solid rgba(251, 191, 36, 0.3)",
              fontWeight: theme.fontWeight.semibold,
            }}
          >
            <Icon name="users" size={16} color="#fbbf24" />
            Return to SuperAdmin
          </button>
        )}

        {/* Navigation Groups */}
        {groups.map((group) => (
          <div key={group.title}>
            <div
              style={{
                fontSize: theme.fontSize.xs,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: theme.sidebar.category,
                fontWeight: theme.fontWeight.bold,
                marginBottom: theme.spacing["2"],
              }}
            >
              {group.title}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
              {group.items.map((item) => {
                const isActive = item.key === active;
                return (
                  <button
                    key={item.key}
                    onClick={() => (item.onSelect ? item.onSelect() : onSelect(item.key))}
                    aria-current={isActive ? "page" : undefined}
                    onMouseEnter={(e) => {
                      if (!isActive) e.currentTarget.style.background = theme.sidebar.hoverBg;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = isActive ? theme.sidebar.activeBg : "transparent";
                    }}
                    style={{
                      ...navBtnBase,
                      background: isActive ? theme.sidebar.activeBg : "transparent",
                      color: isActive ? theme.sidebar.activeTextAlt : theme.sidebar.text,
                      fontWeight: isActive ? theme.fontWeight.semibold : theme.fontWeight.medium,
                    }}
                  >
                    <Icon name={item.icon} size={16} color={isActive ? theme.sidebar.activeText : theme.sidebar.text} />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {/* User Management (superadmin only) */}
        {isSuperAdmin && (
          <div>
            <div
              style={{
                fontSize: theme.fontSize.xs,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: theme.sidebar.category,
                fontWeight: theme.fontWeight.bold,
                marginBottom: theme.spacing["2"],
              }}
            >
              User Management
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
              <button
                onClick={() => setShowCreateUser(!showCreateUser)}
                onMouseEnter={(e) => (e.currentTarget.style.background = theme.sidebar.hoverBg)}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                style={navBtnBase}
              >
                <Icon name="users" size={16} color={theme.sidebar.text} />
                Create Account
              </button>
              <button
                onClick={() => setShowUserList(!showUserList)}
                onMouseEnter={(e) => (e.currentTarget.style.background = theme.sidebar.hoverBg)}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                style={navBtnBase}
              >
                <Icon name="users" size={16} color={theme.sidebar.text} />
                Manage Users
              </button>
            </div>

            {/* Create User Form */}
            {showCreateUser && (
              <form
                onSubmit={(e) => void handleCreateUser(e)}
                style={{
                  marginTop: theme.spacing["2"],
                  padding: theme.spacing["3"],
                  background: "rgba(255,255,255,0.05)",
                  borderRadius: theme.radius.md,
                  display: "flex",
                  flexDirection: "column",
                  gap: theme.spacing["2"],
                }}
              >
                <input
                  placeholder="Username"
                  value={createForm.username}
                  onChange={(e) => setCreateForm((f) => ({ ...f, username: e.target.value }))}
                  required
                  style={inputStyle}
                />
                <input
                  placeholder="Email"
                  type="email"
                  value={createForm.email}
                  onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                  required
                  style={inputStyle}
                />
                <input
                  placeholder="Password"
                  type="password"
                  value={createForm.password}
                  onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
                  required
                  style={inputStyle}
                />
                <div style={{ display: "flex", gap: theme.spacing["2"] }}>
                  <input
                    placeholder="First Name"
                    value={createForm.firstName}
                    onChange={(e) => setCreateForm((f) => ({ ...f, firstName: e.target.value }))}
                    required
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <input
                    placeholder="Last Name"
                    value={createForm.lastName}
                    onChange={(e) => setCreateForm((f) => ({ ...f, lastName: e.target.value }))}
                    required
                    style={{ ...inputStyle, flex: 1 }}
                  />
                </div>
                <input
                  placeholder="Employee No (e.g. EMP-001)"
                  value={createForm.employeeNo}
                  onChange={(e) => setCreateForm((f) => ({ ...f, employeeNo: e.target.value }))}
                  required
                  style={inputStyle}
                />
                <select
                  value={createForm.roleCode}
                  onChange={(e) => setCreateForm((f) => ({ ...f, roleCode: e.target.value }))}
                  style={inputStyle}
                >
                  <option value="doctor">Doctor</option>
                  <option value="nurse">Nurse</option>
                  <option value="pharmacist">Pharmacist</option>
                  <option value="cashier">Cashier</option>
                  <option value="lab_technician">Lab Technician</option>
                  <option value="lab_supervisor">Lab Supervisor</option>
                  <option value="matron">Matron</option>
                  <option value="receptionist">Receptionist</option>
                </select>
                <div style={{ display: "flex", gap: theme.spacing["2"] }}>
                  <button
                    type="button"
                    onClick={() => setShowCreateUser(false)}
                    style={{ ...inputStyle, flex: 1, cursor: "pointer", textAlign: "center" }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creating}
                    style={{ ...inputStyle, flex: 1, cursor: "pointer", background: theme.action.primary, color: "#fff", textAlign: "center", border: "none" }}
                  >
                    {creating ? "Creating..." : "Create"}
                  </button>
                </div>
              </form>
            )}

            {/* User List */}
            {showUserList && (
              <div
                style={{
                  marginTop: theme.spacing["2"],
                  padding: theme.spacing["2"],
                  background: "rgba(255,255,255,0.05)",
                  borderRadius: theme.radius.md,
                  maxHeight: 200,
                  overflowY: "auto",
                }}
              >
                {users.length === 0 && (
                  <div style={{ fontSize: theme.fontSize.xs, color: theme.sidebar.category, padding: theme.spacing["2"] }}>
                    Loading users...
                  </div>
                )}
                {users.map((u) => (
                  <div
                    key={u.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "0.3rem 0.5rem",
                      borderBottom: "1px solid rgba(255,255,255,0.1)",
                      fontSize: theme.fontSize.xs,
                    }}
                  >
                    <span style={{ color: theme.sidebar.text }}>{u.username}</span>
                    {u.username !== "superadmin" && (
                      <button
                        onClick={() => void handleDeleteUser(u.id, u.username)}
                        style={{
                          background: "rgba(248, 113, 113, 0.2)",
                          color: "#f87171",
                          border: "none",
                          borderRadius: 4,
                          padding: "0.15rem 0.4rem",
                          fontSize: "0.6rem",
                          cursor: "pointer",
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div
        style={{
          padding: theme.spacing["4"],
          borderTop: `1px solid ${theme.sidebar.border}`,
          display: "flex",
          flexDirection: "column",
          gap: "0.2rem",
        }}
      >
        <span style={{ fontSize: theme.fontSize.sm, color: theme.sidebar.text, padding: `0 ${theme.spacing["3"]}`, marginBottom: theme.spacing["2"] }}>
          {username}
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
          <button
            onClick={() => onSelect("settings")}
            aria-current={active === "settings" ? "page" : undefined}
            onMouseEnter={(e) => {
              if (active !== "settings") e.currentTarget.style.background = theme.sidebar.hoverBg;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = active === "settings" ? theme.sidebar.activeBg : "transparent";
            }}
            style={{
              ...navBtnBase,
              background: active === "settings" ? theme.sidebar.activeBg : "transparent",
              color: active === "settings" ? theme.sidebar.activeTextAlt : theme.sidebar.text,
              fontWeight: active === "settings" ? theme.fontWeight.semibold : theme.fontWeight.medium,
            }}
          >
            <Icon name="gear" size={16} color={active === "settings" ? theme.sidebar.activeText : theme.sidebar.text} />
            Settings
          </button>
          <button
            onClick={onLogout}
            onMouseEnter={(e) => (e.currentTarget.style.background = theme.sidebar.hoverBg)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            style={navBtnBase}
          >
            <Icon name="logout" size={16} color={theme.sidebar.text} />
            Sign out
          </button>
        </div>
      </div>
    </aside>
  );
}

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "0.4rem 0.6rem",
  borderRadius: theme.radius.md,
  border: `1px solid rgba(255,255,255,0.2)`,
  background: "rgba(255,255,255,0.1)",
  color: "#fff",
  fontSize: theme.fontSize.xs,
  outline: "none",
  boxSizing: "border-box",
};
