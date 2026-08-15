import { useState } from "react";
import { AuthProvider, useAuth } from "./auth/AuthContext";
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

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}

function AppShell() {
  const { me, loading, logout } = useAuth();
  const [activeTab, setActiveTab] = useState("roster");

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "system-ui, sans-serif" }}>
        Loading…
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
    <div style={{ display: "flex", height: "100vh", fontFamily: "system-ui, sans-serif", background: "#f8fafc" }}>
      {/* Sidebar Navigation */}
      <div style={{ width: "260px", background: "#0f172a", color: "#fff", display: "flex", flexDirection: "column", flexShrink: 0, overflowY: "auto" }}>
        <div style={{ padding: "1.25rem", borderBottom: "1px solid #1e293b" }}>
          <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800, color: "#fff" }}>Divine Hands Hospital</h2>
          <span style={{ fontSize: "0.7rem", color: "#94a3b8" }}>Enterprise Desktop OS</span>
        </div>

        <div style={{ padding: "1rem", flex: 1, display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <div>
            <div style={{ fontSize: "0.65rem", textTransform: "uppercase", color: "#64748b", fontWeight: 700, marginBottom: "0.5rem" }}>Clinical</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
              <button onClick={() => setActiveTab("patients")} style={navBtnStyle(activeTab === "patients")}>Patients Directory</button>
              <button onClick={() => setActiveTab("clinical")} style={navBtnStyle(activeTab === "clinical")}>Orders & Clinical</button>
              <button onClick={() => setActiveTab("lab")} style={navBtnStyle(activeTab === "lab")}>Lab & Pathology</button>
            </div>
          </div>

          <div>
            <div style={{ fontSize: "0.65rem", textTransform: "uppercase", color: "#64748b", fontWeight: 700, marginBottom: "0.5rem" }}>Pharmacy & Inventory</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
              <button onClick={() => setActiveTab("pharmacy")} style={navBtnStyle(activeTab === "pharmacy")}>Pharmacy Dispense</button>
              <button onClick={() => setActiveTab("inventory")} style={navBtnStyle(activeTab === "inventory")}>Hospital Inventory & Assets</button>
            </div>
          </div>

          <div>
            <div style={{ fontSize: "0.65rem", textTransform: "uppercase", color: "#64748b", fontWeight: 700, marginBottom: "0.5rem" }}>Finance & Billing</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
              <button onClick={() => setActiveTab("billing")} style={navBtnStyle(activeTab === "billing")}>Billing & Cashier</button>
            </div>
          </div>

          <div>
            <div style={{ fontSize: "0.65rem", textTransform: "uppercase", color: "#64748b", fontWeight: 700, marginBottom: "0.5rem" }}>Staff & Operations</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
              <button onClick={() => setActiveTab("roster")} style={navBtnStyle(activeTab === "roster")}>Roster & Shifts</button>
              <button onClick={() => setActiveTab("handover")} style={navBtnStyle(activeTab === "handover")}>Shift Handover Log</button>
              <button onClick={() => setActiveTab("communications")} style={navBtnStyle(activeTab === "communications")}>Staff Communications</button>
            </div>
          </div>
        </div>

        <div style={{ padding: "1rem", borderTop: "1px solid #1e293b", display: "flex", flexDirection: "column", gap: "0.2rem" }}>
          <span style={{ fontSize: "0.7rem", color: "#94a3b8", padding: "0 0.75rem" }}>{me.username}</span>
          <button onClick={() => setActiveTab("settings")} style={navBtnStyle(activeTab === "settings")}>Settings</button>
          <button onClick={() => void logout()} style={navBtnStyle(false)}>Sign out</button>
        </div>
      </div>

      {/* Main Content Area */}
      <div style={{ flex: 1, overflowY: "auto", height: "100vh" }}>
        {activeTab === "clinical" && <ClinicalPage />}
        {activeTab === "lab" && <LabPage />}
        {activeTab === "pharmacy" && <PharmacyPage />}
        {activeTab === "inventory" && <InventoryPage />}
        {activeTab === "billing" && <BillingPage />}
        {activeTab === "patients" && <PatientsPage />}
        {activeTab === "roster" && <RosterPage />}
        {activeTab === "handover" && <HandoverPage />}
        {activeTab === "communications" && <CommunicationsPage />}
        {activeTab === "settings" && <SettingsPage />}
      </div>
    </div>
  );
}

function navBtnStyle(active: boolean) {
  return {
    textAlign: "left" as const,
    background: active ? "#1e293b" : "transparent",
    color: active ? "#38bdf8" : "#cbd5e1",
    border: "none",
    padding: "0.5rem 0.75rem",
    borderRadius: "6px",
    fontSize: "0.85rem",
    fontWeight: active ? 700 : 500,
    cursor: "pointer",
  };
}
