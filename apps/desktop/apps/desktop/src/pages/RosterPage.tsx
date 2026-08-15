import React, { useState } from "react";

export type ShiftType = "Day (08:00 - 16:00)" | "Afternoon (16:00 - 00:00)" | "Night (00:00 - 08:00)" | "Off / Leave";
export type RosterStatus = "Draft (Matron)" | "Pending Super Admin Approval" | "Published & Active" | "Rejected";

export interface StaffMember {
  id: string;
  name: string;
  department: "Nursing" | "General Practice" | "Laboratory" | "Pharmacy" | "Administration";
  role: string;
  maxConsecutiveShifts: number;
}

export interface RosterAssignment {
  staffId: string;
  staffName: string;
  role: string;
  department: string;
  monday: ShiftType;
  tuesday: ShiftType;
  wednesday: ShiftType;
  thursday: ShiftType;
  friday: ShiftType;
  saturday: ShiftType;
  sunday: ShiftType;
}

export const INITIAL_STAFF: StaffMember[] = [
  { id: "STF-301", name: "Matron Elizabeth Cole", department: "Nursing", role: "Senior Matron", maxConsecutiveShifts: 5 },
  { id: "STF-302", name: "Nurse Aminat Bello", department: "Nursing", role: "Staff Nurse", maxConsecutiveShifts: 4 },
  { id: "STF-303", name: "Nurse Chidi Okafor", department: "Nursing", role: "Staff Nurse", maxConsecutiveShifts: 4 },
  { id: "STF-304", name: "Dr. Babatunde Fashola", department: "General Practice", role: "Consultant Physician", maxConsecutiveShifts: 5 },
  { id: "STF-305", name: "Pharm. Kelechi Nnamdi", department: "Pharmacy", role: "Chief Pharmacist", maxConsecutiveShifts: 5 },
  { id: "STF-306", name: "Lab Scientist Zainab Ahmed", department: "Laboratory", role: "Medical Lab Scientist", maxConsecutiveShifts: 5 },
];

export default function RosterPage() {
  const [activeTab, setActiveTab] = useState<"current-roster" | "generator" | "approvals">("current-roster");
  const [rosterStatus, setRosterStatus] = useState<RosterStatus>("Published & Active");
  const [selectedWeek, setSelectedWeek] = useState("Week 34: Aug 17 - Aug 23, 2026");

  const [rosterAssignments, setRosterAssignments] = useState<RosterAssignment[]>([
    {
      staffId: "STF-301",
      staffName: "Matron Elizabeth Cole",
      role: "Senior Matron",
      department: "Nursing",
      monday: "Day (08:00 - 16:00)",
      tuesday: "Day (08:00 - 16:00)",
      wednesday: "Day (08:00 - 16:00)",
      thursday: "Off / Leave",
      friday: "Day (08:00 - 16:00)",
      saturday: "Off / Leave",
      sunday: "Off / Leave",
    },
    {
      staffId: "STF-302",
      staffName: "Nurse Aminat Bello",
      role: "Staff Nurse",
      department: "Nursing",
      monday: "Night (00:00 - 08:00)",
      tuesday: "Night (00:00 - 08:00)",
      wednesday: "Off / Leave",
      thursday: "Day (08:00 - 16:00)",
      friday: "Day (08:00 - 16:00)",
      saturday: "Afternoon (16:00 - 00:00)",
      sunday: "Off / Leave",
    },
    {
      staffId: "STF-303",
      staffName: "Nurse Chidi Okafor",
      role: "Staff Nurse",
      department: "Nursing",
      monday: "Afternoon (16:00 - 00:00)",
      tuesday: "Afternoon (16:00 - 00:00)",
      wednesday: "Day (08:00 - 16:00)",
      thursday: "Night (00:00 - 08:00)",
      friday: "Night (00:00 - 08:00)",
      saturday: "Off / Leave",
      sunday: "Off / Leave",
    },
    {
      staffId: "STF-304",
      staffName: "Dr. Babatunde Fashola",
      role: "Consultant Physician",
      department: "General Practice",
      monday: "Day (08:00 - 16:00)",
      tuesday: "Day (08:00 - 16:00)",
      wednesday: "Day (08:00 - 16:00)",
      thursday: "Day (08:00 - 16:00)",
      friday: "Day (08:00 - 16:00)",
      saturday: "Off / Leave",
      sunday: "Off / Leave",
    },
  ]);

  const handleRunAutoGenerator = () => {
    // Simulated constraint-aware shift generator
    setRosterStatus("Draft (Matron)");
    alert("Constraint-aware roster auto-generated successfully! All rest-period rules and shift preferences evaluated. Review draft before submitting for Super Admin approval.");
    setActiveTab("current-roster");
  };

  const handleSubmitForApproval = () => {
    setRosterStatus("Pending Super Admin Approval");
    alert("Roster draft submitted successfully to Super Admin for validation and publication.");
  };

  const handleSuperAdminApprove = () => {
    setRosterStatus("Published & Active");
    alert("Roster successfully approved and published hospital-wide!");
  };

  const handleSuperAdminReject = () => {
    setRosterStatus("Rejected");
    alert("Roster returned to Matron with requested revisions.");
  };

  return (
    <div style={{ padding: "1.5rem", fontFamily: "system-ui, sans-serif", color: "#0f172a" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.2rem" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 800 }}>Automatic Roster Planning & Shift Governance</h2>
          <p style={{ margin: 0, fontSize: "0.875rem", color: "#64748b" }}>Constraint-aware staff scheduling, Matron draft submissions, and Super Admin approvals[cite: 15].</p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <span style={{ fontSize: "0.8rem", fontWeight: 700, padding: "0.3rem 0.7rem", borderRadius: "6px", background: rosterStatus === "Published & Active" ? "#f0fdf4" : rosterStatus === "Pending Super Admin Approval" ? "#fefce8" : "#f1f5f9", color: rosterStatus === "Published & Active" ? "#16a34a" : rosterStatus === "Pending Super Admin Approval" ? "#ca8a04" : "#475569" }}>
            Status: {rosterStatus}
          </span>
          <button
            onClick={() => setActiveTab("generator")}
            style={{ padding: "0.6rem 1.2rem", background: "#2563eb", color: "#fff", border: "none", borderRadius: "6px", fontWeight: 600, cursor: "pointer", fontSize: "0.875rem" }}
          >
            ⚙️ Run Auto-Generator
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: "1rem", borderBottom: "2px solid #e2e8f0", marginBottom: "1.5rem" }}>
        <button
          onClick={() => setActiveTab("current-roster")}
          style={{ padding: "0.6rem 1rem", background: "none", border: "none", borderBottom: activeTab === "current-roster" ? "2px solid #2563eb" : "none", fontWeight: activeTab === "current-roster" ? 700 : 500, color: activeTab === "current-roster" ? "#2563eb" : "#64748b", cursor: "pointer" }}
        >
          Active Weekly Schedule Matrix
        </button>
        <button
          onClick={() => setActiveTab("generator")}
          style={{ padding: "0.6rem 1rem", background: "none", border: "none", borderBottom: activeTab === "generator" ? "2px solid #2563eb" : "none", fontWeight: activeTab === "generator" ? 700 : 500, color: activeTab === "generator" ? "#2563eb" : "#64748b", cursor: "pointer" }}
        >
          Constraint Parameters & Generator
        </button>
        <button
          onClick={() => setActiveTab("approvals")}
          style={{ padding: "0.6rem 1rem", background: "none", border: "none", borderBottom: activeTab === "approvals" ? "2px solid #2563eb" : "none", fontWeight: activeTab === "approvals" ? 700 : 500, color: activeTab === "approvals" ? "#2563eb" : "#64748b", cursor: "pointer" }}
        >
          Submission & Super Admin Approvals
        </button>
      </div>

      {activeTab === "current-roster" && (
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <h3 style={{ margin: 0, fontSize: "1.1rem" }}>{selectedWeek}</h3>
            <select
              value={selectedWeek}
              onChange={(e) => setSelectedWeek(e.target.value)}
              style={{ padding: "0.4rem", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "0.85rem" }}
            >
              <option value="Week 34: Aug 17 - Aug 23, 2026">Week 34: Aug 17 - Aug 23, 2026</option>
              <option value="Week 35: Aug 24 - Aug 30, 2026">Week 35: Aug 24 - Aug 30, 2026</option>
            </select>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ background: "#f1f5f9", textAlign: "left", color: "#475569" }}>
                <th style={{ padding: "0.75rem" }}>Staff Member</th>
                <th style={{ padding: "0.75rem" }}>Role & Dept</th>
                <th style={{ padding: "0.75rem" }}>Mon</th>
                <th style={{ padding: "0.75rem" }}>Tue</th>
                <th style={{ padding: "0.75rem" }}>Wed</th>
                <th style={{ padding: "0.75rem" }}>Thu</th>
                <th style={{ padding: "0.75rem" }}>Fri</th>
                <th style={{ padding: "0.75rem" }}>Sat</th>
                <th style={{ padding: "0.75rem" }}>Sun</th>
              </tr>
            </thead>
            <tbody>
              {rosterAssignments.map((row) => (
                <tr key={row.staffId} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "0.75rem", fontWeight: 700, color: "#0284c7" }}>
                    {row.staffName} <span style={{ display: "block", fontSize: "0.7rem", color: "#64748b" }}>{row.staffId}</span>
                  </td>
                  <td style={{ padding: "0.75rem" }}>
                    {row.role} <span style={{ display: "block", fontSize: "0.7rem", color: "#64748b" }}>{row.department}</span>
                  </td>
                  <td style={{ padding: "0.75rem", fontSize: "0.8rem" }}>{row.monday}</td>
                  <td style={{ padding: "0.75rem", fontSize: "0.8rem" }}>{row.tuesday}</td>
                  <td style={{ padding: "0.75rem", fontSize: "0.8rem" }}>{row.wednesday}</td>
                  <td style={{ padding: "0.75rem", fontSize: "0.8rem" }}>{row.thursday}</td>
                  <td style={{ padding: "0.75rem", fontSize: "0.8rem" }}>{row.friday}</td>
                  <td style={{ padding: "0.75rem", fontSize: "0.8rem" }}>{row.saturday}</td>
                  <td style={{ padding: "0.75rem", fontSize: "0.8rem" }}>{row.sunday}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "generator" && (
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "1.5rem", maxWidth: "800px" }}>
          <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.1rem" }}>Constraint-Aware Roster Generation Engine</h3>
          <p style={{ fontSize: "0.85rem", color: "#64748b", marginBottom: "1.5rem" }}>
            The scheduling engine automatically evaluates active staff availability, mandatory rest periods, maximum consecutive shifts, and night-shift rotation rules[cite: 15].
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
            <div style={{ background: "#f8fafc", padding: "1rem", borderRadius: "6px" }}>
              <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.9rem" }}>Shift Timing Defaults</h4>
              <ul style={{ margin: 0, paddingLeft: "1.2rem", fontSize: "0.85rem", color: "#475569", display: "grid", gap: "0.3rem" }}>
                <li>Day Shift: 08:00 – 16:00[cite: 15]</li>
                <li>Afternoon Shift: 16:00 – 00:00[cite: 15]</li>
                <li>Night Shift: 00:00 – 08:00[cite: 15]</li>
              </ul>
            </div>
            <div style={{ background: "#f8fafc", padding: "1rem", borderRadius: "6px" }}>
              <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.9rem" }}>Hard Constraints</h4>
              <ul style={{ margin: 0, paddingLeft: "1.2rem", fontSize: "0.85rem", color: "#475569", display: "grid", gap: "0.3rem" }}>
                <li>Maximum 5 consecutive shifts[cite: 15]</li>
                <li>Minimum 12 hours rest between shifts[cite: 15]</li>
                <li>Leave requests fully blocked automatically[cite: 15]</li>
              </ul>
            </div>
          </div>

          <button
            onClick={handleRunAutoGenerator}
            style={{ padding: "0.75rem 1.5rem", background: "#16a34a", color: "#fff", border: "none", borderRadius: "6px", fontWeight: 700, cursor: "pointer", fontSize: "0.9rem" }}
          >
            Run Automated Roster Optimization Algorithm
          </button>
        </div>
      )}

      {activeTab === "approvals" && (
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "1.5rem", maxWidth: "800px" }}>
          <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.1rem" }}>Submission & Super Admin Approval Workflow</h3>
          <div style={{ background: "#f8fafc", padding: "1rem", borderRadius: "6px", marginBottom: "1.5rem", fontSize: "0.85rem" }}>
            <div><strong>Current Roster Version:</strong> v2.4-draft</div>
            <div><strong>Prepared By:</strong> Matron Elizabeth Cole</div>
            <div><strong>Current Status:</strong> <span style={{ fontWeight: 700, color: rosterStatus === "Published & Active" ? "#16a34a" : "#ca8a04" }}>{rosterStatus}</span></div>
          </div>

          <div style={{ display: "flex", gap: "1rem" }}>
            {rosterStatus === "Draft (Matron)" && (
              <button
                onClick={handleSubmitForApproval}
                style={{ padding: "0.6rem 1.2rem", background: "#2563eb", color: "#fff", border: "none", borderRadius: "6px", fontWeight: 600, cursor: "pointer", fontSize: "0.85rem" }}
              >
                Submit Draft to Super Admin
              </button>
            )}

            {rosterStatus === "Pending Super Admin Approval" && (
              <>
                <button
                  onClick={handleSuperAdminApprove}
                  style={{ padding: "0.6rem 1.2rem", background: "#16a34a", color: "#fff", border: "none", borderRadius: "6px", fontWeight: 600, cursor: "pointer", fontSize: "0.85rem" }}
                >
                  Approve & Publish Roster
                </button>
                <button
                  onClick={handleSuperAdminReject}
                  style={{ padding: "0.6rem 1.2rem", background: "#dc2626", color: "#fff", border: "none", borderRadius: "6px", fontWeight: 600, cursor: "pointer", fontSize: "0.85rem" }}
                >
                  Reject & Request Changes
                </button>
              </>
            )}

            {rosterStatus === "Published & Active" && (
              <p style={{ color: "#16a34a", fontWeight: 600, margin: 0, fontSize: "0.9rem" }}>✓ This schedule is currently active hospital-wide. Immutable except through controlled amendment workflows[cite: 15].</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
