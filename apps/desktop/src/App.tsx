import { useCallback, useMemo, useRef, useState } from "react";
import { theme, Spinner, ToastProvider } from "@hims/ui";
import { AuthProvider, useAuth, type Me } from "./auth/AuthContext";
import { NotificationProvider } from "./notifications/NotificationContext";
import NotificationBell from "./notifications/NotificationBell";
import IncomingCallAlert from "./notifications/IncomingCallAlert";
import { Sidebar, type NavGroup } from "./ui/Sidebar";
import LoginPage from "./pages/LoginPage";
import SettingsPage from "./pages/SettingsPage";
import ClinicalPage from "./pages/ClinicalPage";
import LabPage from "./pages/LabPage";
import PharmacyPage from "./pages/PharmacyPage";
import InventoryPage from "./pages/InventoryPage";
import BillingPage from "./pages/BillingPage";
import PatientsPage from "./pages/PatientsPage";
import RosterPage from "./pages/RosterPage";
import HandoverPage from "./pages/HandoverPage";
import CommunicationsPage from "./pages/CommunicationsPage";
import StaffPage from "./pages/StaffPage";
import ReportsPage from "./pages/ReportsPage";
import AttendancePage from "./pages/AttendancePage";

function hasRole(me: Me | null, ...codes: string[]): boolean {
  if (!me?.roles) return false;
  return me.roles.some((r) => codes.includes(r.code));
}

function buildNavGroups(me: Me | null): NavGroup[] {
  const groups: NavGroup[] = [
    {
      title: "Clinical",
      items: [
        { key: "patients", label: "Patients Directory", icon: "users" },
        { key: "clinical", label: "Orders & Clinical", icon: "clipboard" },
        { key: "lab", label: "Lab & Pathology", icon: "flask" },
      ],
    },
    {
      title: "Pharmacy & Inventory",
      items: [
        { key: "pharmacy", label: "Pharmacy Dispense", icon: "pill" },
        { key: "inventory", label: "Hospital Inventory & Assets", icon: "box" },
      ],
    },
  ];

  // Only show Finance & Billing for cashier and super_admin roles
  if (hasRole(me, "cashier", "super_admin")) {
    groups.push({
      title: "Finance & Billing",
      items: [{ key: "billing", label: "Billing & Cashier", icon: "cash" }],
    });
  }

  groups.push({
    title: "Staff & Operations",
    items: [
      { key: "staff", label: "Staff Management", icon: "users" },
      { key: "attendance", label: "Attendance & Clock In/Out", icon: "clock" },
      { key: "roster", label: "Roster & Shifts", icon: "calendar" },
      { key: "handover", label: "Shift Handover Log", icon: "book" },
      { key: "communications", label: "Staff Communications", icon: "chat" },
      { key: "reports", label: "Reports & Dashboard", icon: "file-text" },
    ],
  });

  return groups;
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <NotificationProvider>
          <AppShell />
          <IncomingCallAlert />
        </NotificationProvider>
      </ToastProvider>
    </AuthProvider>
  );
}

function AppShell() {
  const { me, loading, logout, login } = useAuth();
  const [activeTab, setActiveTab] = useState("roster");
  const [switching, setSwitching] = useState(false);

  // Store superadmin credentials for quick switch-back
  const superAdminCreds = useRef({ username: "superadmin", password: "61922939070a1707696c" });

  const navGroups = useMemo(() => buildNavGroups(me), [me]);
  const isSuperAdmin = hasRole(me, "super_admin");

  const handleSwitchUser = useCallback(
    async (username: string, password: string) => {
      setSwitching(true);
      try {
        // If we're not superadmin, store the current superadmin creds for return
        if (!isSuperAdmin && me?.username !== "superadmin") {
          // Keep the stored creds
        }
        await login(username, password);
        setActiveTab("clinical"); // Reset to a default tab
      } catch (err) {
        console.error("Switch failed:", err);
      } finally {
        setSwitching(false);
      }
    },
    [login, isSuperAdmin, me],
  );

  const handleReturnToAdmin = useCallback(async () => {
    setSwitching(true);
    try {
      await login(superAdminCreds.current.username, superAdminCreds.current.password);
      setActiveTab("roster");
    } catch (err) {
      console.error("Return to admin failed:", err);
    } finally {
      setSwitching(false);
    }
  }, [login]);

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: theme.spacing["3"],
          height: "100vh",
          background: theme.surface.canvas,
          color: theme.text.muted,
        }}
      >
        <Spinner size={20} />
        <span>Loading...</span>
      </div>
    );
  }

  if (!me) {
    return <LoginPage />;
  }

  if (me.mustChangePassword) {
    return <SettingsPage />;
  }

  return (
    <div style={{ display: "flex", height: "100vh", background: theme.surface.canvas }}>
      <Sidebar
        groups={navGroups}
        active={activeTab}
        onSelect={setActiveTab}
        onLogout={() => void logout()}
        onSwitchUser={handleSwitchUser}
        onReturnToAdmin={me.username !== "superadmin" ? handleReturnToAdmin : undefined}
        username={me.username}
        isSuperAdmin={isSuperAdmin}
      />

      {/* Main content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
        {/* Top bar with notification bell */}
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", padding: `${theme.spacing["2"]} ${theme.spacing["6"]}`, borderBottom: `1px solid ${theme.surface.border}`, background: theme.surface.canvas, flexShrink: 0 }}>
          <NotificationBell onNavigate={(tab) => setActiveTab(tab)} />
        </div>
        <main style={{ flex: 1, overflowY: "auto", padding: theme.spacing["8"] }}>
        {switching && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: "rgba(0,0,0,0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
              color: "#fff",
              fontSize: theme.fontSize.lg,
            }}
          >
            <Spinner size={24} /> Switching account...
          </div>
        )}
        {activeTab === "clinical" && <ClinicalPage />}
        {activeTab === "lab" && <LabPage />}
        {activeTab === "pharmacy" && <PharmacyPage />}
        {activeTab === "inventory" && <InventoryPage />}
        {activeTab === "billing" && <BillingPage />}
        {activeTab === "patients" && <PatientsPage />}
        {activeTab === "roster" && <RosterPage />}
        {activeTab === "handover" && <HandoverPage />}
        {activeTab === "communications" && <CommunicationsPage />}
        {activeTab === "staff" && <StaffPage />}
        {activeTab === "attendance" && <AttendancePage />}
        {activeTab === "reports" && <ReportsPage />}
        {activeTab === "settings" && <SettingsPage />}
      </main>
      </div>
    </div>
  );
}
