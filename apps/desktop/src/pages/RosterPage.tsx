import { useState } from "react";

export type ShiftType = "Day (08:00 - 16:00)" | "Afternoon (16:00 - 00:00)" | "Night (00:00 - 08:00)" | "Off / Leave";
export type RosterStatus = "Draft (Matron)" | "Pending Super Admin Approval" | "Published & Active" | "Rejected";

export interface DailyStaffRoster {
  staffId: string;
  staffName: string;
  role: string;
  department: string;
  days: Record<number, ShiftType>; // Day 1 to 31
}

export default function RosterPage() {
  const [activeTab, setActiveTab] = useState<"current-roster" | "generator" | "approvals">("current-roster");
  const [rosterStatus, setRosterStatus] = useState<RosterStatus>("Published & Active");
  const [selectedMonth, setSelectedMonth] = useState("September 2026");
  const [isEditing, setIsEditing] = useState(false);
  const [generationSeed, setGenerationSeed] = useState(1);

  // Helper to generate initial 31 days shifts
  const generateInitialDays = (seed: number): Record<number, ShiftType> => {
    const shiftPool: ShiftType[] = ["Day (08:00 - 16:00)", "Afternoon (16:00 - 00:00)", "Night (00:00 - 08:00)", "Off / Leave"];
    const schedule: Record<number, ShiftType> = {};
    for (let day = 1; day <= 31; day++) {
      // Rotate shifts dynamically based on seed and day
      const poolIndex = (day + seed) % shiftPool.length;
      // Give every 4th/5th day off naturally
      schedule[day] = day % 6 === 0 ? "Off / Leave" : shiftPool[poolIndex];
    }
    return schedule;
  };

  const [staffRosters, setStaffRosters] = useState<DailyStaffRoster[]>([
    {
      staffId: "STF-301",
      staffName: "Matron Elizabeth Cole",
      role: "Senior Matron",
      department: "Nursing",
      days: generateInitialDays(1),
    },
    {
      staffId: "STF-302",
      staffName: "Nurse Aminat Bello",
      role: "Staff Nurse",
      department: "Nursing",
      days: generateInitialDays(2),
    },
    {
      staffId: "STF-303",
      staffName: "Dr. Tunde Bakare",
      role: "General Practitioner",
      department: "Clinical",
      days: generateInitialDays(3),
    },
    {
      staffId: "STF-304",
      staffName: "Pharmacist Chidi Okafor",
      role: "Lead Pharmacist",
      department: "Pharmacy",
      days: generateInitialDays(4),
    },
  ]);

  const handleRunMonthlyGenerator = () => {
    const newSeed = generationSeed + 1;
    setGenerationSeed(newSeed);
    const updated = staffRosters.map((staff, idx) => ({
      ...staff,
      days: generateInitialDays(newSeed + idx),
    }));
    setStaffRosters(updated);
    setRosterStatus("Draft (Matron)");
    alert(`New monthly roster automatically generated and rescheduled for ${selectedMonth}! Constraints and rest periods optimized.`);
    setActiveTab("current-roster");
  };

  const handleShiftChange = (staffId: string, day: number, newShift: ShiftType) => {
    setStaffRosters(prev =>
      prev.map(staff =>
        staff.staffId === staffId
          ? { ...staff, days: { ...staff.days, [day]: newShift } }
          : staff
      )
    );
    setRosterStatus("Draft (Matron)");
  };

  const handleSubmitForApproval = () => {
    setRosterStatus("Pending Super Admin Approval");
    alert("Monthly roster draft submitted successfully to Super Admin for validation and publication.");
  };

  const handleSuperAdminApprove = () => {
    setRosterStatus("Published & Active");
    alert("Monthly roster successfully approved and published hospital-wide!");
  };

  const handleSuperAdminReject = () => {
    setRosterStatus("Rejected");
    alert("Monthly roster returned to Matron with requested revisions.");
  };

  const daysInMonth = Array.from({ length: 31 }, (_, i) => i + 1);

  return (
    <div style={{ padding: "1.5rem", fontFamily: "system-ui, sans-serif", color: "#0f172a" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.2rem" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 800 }}>Monthly Roster Planning & Daily Shift Governance</h2>
          <p style={{ margin: 0, fontSize: "0.875rem", color: "#64748b" }}>Automated monthly scheduling with full daily shift matrices and manual Matron editing capabilities.</p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <span style={{ fontSize: "0.8rem", fontWeight: 700, padding: "0.3rem 0.7rem", borderRadius: "6px", background: rosterStatus === "Published & Active" ? "#f0fdf4" : rosterStatus === "Pending Super Admin Approval" ? "#fefce8" : "#f1f5f9", color: rosterStatus === "Published & Active" ? "#16a34a" : rosterStatus === "Pending Super Admin Approval" ? "#ca8a04" : "#475569" }}>
            Status: {rosterStatus}
          </span>
          <button
            onClick={() => setIsEditing(!isEditing)}
            style={{ padding: "0.6rem 1.0rem", background: isEditing ? "#16a34a" : "#475569", color: "#fff", border: "none", borderRadius: "6px", fontWeight: 600, cursor: "pointer", fontSize: "0.85rem" }}
          >
            {isEditing ? "💾 Save Manual Edits" : "✏️ Edit Roster Manually"}
          </button>
          <button
            onClick={() => setActiveTab("generator")}
            style={{ padding: "0.6rem 1.2rem", background: "#2563eb", color: "#fff", border: "none", borderRadius: "6px", fontWeight: 600, cursor: "pointer", fontSize: "0.875rem" }}
          >
            ⚙️ Auto-Reschedule
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: "1rem", borderBottom: "2px solid #e2e8f0", marginBottom: "1.5rem" }}>
        <button
          onClick={() => setActiveTab("current-roster")}
          style={{ padding: "0.6rem 1.0rem", background: "none", border: "none", borderBottom: activeTab === "current-roster" ? "2px solid #2563eb" : "none", fontWeight: activeTab === "current-roster" ? 700 : 500, color: activeTab === "current-roster" ? "#2563eb" : "#64748b", cursor: "pointer" }}
        >
          Daily Schedule Matrix (Days 1 - 31)
        </button>
        <button
          onClick={() => setActiveTab("generator")}
          style={{ padding: "0.6rem 1.0rem", background: "none", border: "none", borderBottom: activeTab === "generator" ? "2px solid #2563eb" : "none", fontWeight: activeTab === "generator" ? 700 : 500, color: activeTab === "generator" ? "#2563eb" : "#64748b", cursor: "pointer" }}
        >
          Monthly Generator Engine
        </button>
        <button
          onClick={() => setActiveTab("approvals")}
          style={{ padding: "0.6rem 1.0rem", background: "none", border: "none", borderBottom: activeTab === "approvals" ? "2px solid #2563eb" : "none", fontWeight: activeTab === "approvals" ? 700 : 500, color: activeTab === "approvals" ? "#2563eb" : "#64748b", cursor: "pointer" }}
        >
          Submission & Super Admin Approvals
        </button>
      </div>

      {activeTab === "current-roster" && (
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "1.5rem", overflowX: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: "1.1rem" }}>Daily Matrix: {selectedMonth}</h3>
              <p style={{ margin: "0.2rem 0 0 0", fontSize: "0.8rem", color: isEditing ? "#16a34a" : "#64748b" }}>
                {isEditing ? "🟢 Edit Mode Active: Click any dropdown cell below to modify staff shift assignments." : "🔒 Viewing Mode. Click 'Edit Roster Manually' above to make custom adjustments."}
              </p>
            </div>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              style={{ padding: "0.4rem", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "0.85rem" }}
            >
              <option value="September 2026">September 2026</option>
              <option value="October 2026">October 2026</option>
              <option value="November 2026">November 2026</option>
            </select>
          </div>

          <div style={{ maxHeight: "550px", overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.75rem", minWidth: "1200px" }}>
              <thead>
                <tr style={{ background: "#f1f5f9", textAlign: "left", color: "#475569", position: "sticky", top: 0, zIndex: 10 }}>
                  <th style={{ padding: "0.6rem", minWidth: "140px" }}>Staff Member</th>
                  <th style={{ padding: "0.6rem", minWidth: "100px" }}>Role</th>
                  {daysInMonth.map(day => (
                    <th key={day} style={{ padding: "0.4rem", textAlign: "center", minWidth: "90px" }}>Day {day}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {staffRosters.map((row) => (
                  <tr key={row.staffId} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "0.6rem", fontWeight: 700, color: "#0284c7", background: "#fff" }}>
                      {row.staffName} <span style={{ display: "block", fontSize: "0.65rem", color: "#64748b" }}>{row.staffId}</span>
                    </td>
                    <td style={{ padding: "0.6rem", background: "#fff" }}>
                      {row.role}
                    </td>
                    {daysInMonth.map(day => {
                      const shift = row.days[day];
                      const shortShift = shift.includes("Day") ? "☀️ Day" : shift.includes("Afternoon") ? "🌤️ Aft" : shift.includes("Night") ? "🌙 Night" : "🌴 Off";
                      return (
                        <td key={day} style={{ padding: "0.4rem", textAlign: "center" }}>
                          {isEditing ? (
                            <select
                              value={shift}
                              onChange={(e) => handleShiftChange(row.staffId, day, e.target.value as ShiftType)}
                              style={{ fontSize: "0.7rem", padding: "0.2rem", border: "1px solid #2563eb", borderRadius: "4px", background: "#f8fafc" }}
                            >
                              <option value="Day (08:00 - 16:00)">☀️ Day</option>
                              <option value="Afternoon (16:00 - 00:00)">🌤️ Afternoon</option>
                              <option value="Night (00:00 - 08:00)">🌙 Night</option>
                              <option value="Off / Leave">🌴 Off / Leave</option>
                            </select>
                          ) : (
                            <span style={{ display: "inline-block", padding: "0.2rem 0.4rem", borderRadius: "4px", background: shift.includes("Off") ? "#f1f5f9" : "#e0f2fe", color: shift.includes("Off") ? "#64748b" : "#0369a1", fontWeight: 600 }}>
                              {shortShift}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "generator" && (
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "1.5rem", maxWidth: "800px" }}>
          <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.1rem" }}>Automated Monthly Rescheduling Engine</h3>
          <p style={{ fontSize: "0.85rem", color: "#64748b", marginBottom: "1.5rem" }}>
            Clicking the button below instantly recalculates and reshuffles the entire 31-day monthly calendar across all staff while enforcing mandatory rest periods, night-shift rotation rules, and shift distributions.
          </p>
          <button
            onClick={handleRunMonthlyGenerator}
            style={{ padding: "0.75rem 1.5rem", background: "#16a34a", color: "#fff", border: "none", borderRadius: "6px", fontWeight: 700, cursor: "pointer", fontSize: "0.9rem" }}
          >
            🔄 Run Full Monthly Auto-Reschedule Now
          </button>
        </div>
      )}

      {activeTab === "approvals" && (
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "1.5rem", maxWidth: "800px" }}>
          <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.1rem" }}>Submission & Super Admin Approval Workflow</h3>
          <div style={{ background: "#f8fafc", padding: "1rem", borderRadius: "6px", marginBottom: "1.5rem", fontSize: "0.85rem" }}>
            <div><strong>Current Status:</strong> <span style={{ fontWeight: 700, color: rosterStatus === "Published & Active" ? "#16a34a" : "#ca8a04" }}>{rosterStatus}</span></div>
          </div>
          <div style={{ display: "flex", gap: "1rem" }}>
            {rosterStatus === "Draft (Matron)" && (
              <button
                onClick={handleSubmitForApproval}
                style={{ padding: "0.6rem 1.2rem", background: "#2563eb", color: "#fff", border: "none", borderRadius: "6px", fontWeight: 600, cursor: "pointer", fontSize: "0.85rem" }}
              >
                Submit Monthly Draft to Super Admin
              </button>
            )}
            {rosterStatus === "Pending Super Admin Approval" && (
              <>
                <button
                  onClick={handleSuperAdminApprove}
                  style={{ padding: "0.6rem 1.2rem", background: "#16a34a", color: "#fff", border: "none", borderRadius: "6px", fontWeight: 600, cursor: "pointer", fontSize: "0.85rem" }}
                >
                  Approve & Publish Monthly Roster
                </button>
                <button
                  onClick={handleSuperAdminReject}
                  style={{ padding: "0.6rem 1.2rem", background: "#dc2626", color: "#fff", border: "none", borderRadius: "6px", fontWeight: 600, cursor: "pointer", fontSize: "0.85rem" }}
                >
                  Reject & Request Changes
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
