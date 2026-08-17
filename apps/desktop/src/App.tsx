import { useState } from "react";
import { theme, Spinner, ToastProvider } from "@hims/ui";
import { AuthProvider, useAuth } from "./auth/AuthContext";
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

const navGroups: NavGroup[] = [
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
  {
    title: "Finance & Billing",
    items: [{ key: "billing", label: "Billing & Cashier", icon: "cash" }],
  },
  {
    title: "Staff & Operations",
    items: [
      { key: "staff", label: "Staff Management", icon: "users" },
      { key: "attendance", label: "Attendance & Clock In/Out", icon: "clock" },
      { key: "roster", label: "Roster & Shifts", icon: "calendar" },
      { key: "handover", label: "Shift Handover Log", icon: "book" },
      { key: "communications", label: "Staff Communications", icon: "chat" },
      { key: "reports", label: "Reports & Dashboard", icon: "file-text" },
    ],
  },
];

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <AppShell />
      </ToastProvider>
    </AuthProvider>
  );
}

function AppShell() {
  const { me, loading, logout } = useAuth();
  const [activeTab, setActiveTab] = useState("roster");

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
        <span>Loading…</span>
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
        username={me.username}
      />

      {/* Main content */}
      <main style={{ flex: 1, overflowY: "auto", height: "100vh", padding: theme.spacing["8"] }}>
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
  );
}
