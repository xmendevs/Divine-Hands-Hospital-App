import { useState } from "react";

interface Patient {
  id: string;
  patientId: string; // e.g., DHH0001
  fullName: string;
  gender: string;
  age: number;
  phone: string;
  category: "General" | "Family" | "Antenatal" | "Emergency";
  lastVisit: string;
}

export default function PatientsPage() {
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);

  // Initial mock state aligned with backend schema
  const [patients, setPatients] = useState<Patient[]>([
    { id: "1", patientId: "DHH0001", fullName: "Emmanuel Adebayo", gender: "Male", age: 34, phone: "+234 801 234 5678", category: "General", lastVisit: "2026-08-10" },
    { id: "2", patientId: "DHHA0001", fullName: "Blessing Okon", gender: "Female", age: 28, phone: "+234 802 987 6543", category: "Antenatal", lastVisit: "2026-08-14" },
    { id: "3", patientId: "DHHE0001", fullName: "Chidi Nnamdi", gender: "Male", age: 45, phone: "+234 803 555 1212", category: "Emergency", lastVisit: "2026-08-15" },
  ]);

  const [formData, setFormData] = useState({
    fullName: "",
    gender: "Male",
    age: "",
    phone: "",
    category: "General",
  });

  const handleCreatePatient = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Generate business ID prefix based on category rule
    const prefixMap: Record<string, string> = {
      General: "DHH",
      Family: "DHHF",
      Antenatal: "DHHA",
      Emergency: "DHHE",
    };
    const prefix = prefixMap[formData.category] || "DHH";
    const newPatientId = `${prefix}${String(patients.length + 1).padStart(4, "0")}`;

    const newPatient: Patient = {
      id: String(Date.now()),
      patientId: newPatientId,
      fullName: formData.fullName,
      gender: formData.gender,
      age: Number(formData.age) || 0,
      phone: formData.phone,
      category: formData.category as Patient["category"],
      lastVisit: new Date().toISOString().split("T")[0],
    };

    setPatients([newPatient, ...patients]);
    setShowModal(false);
    setFormData({ fullName: "", gender: "Male", age: "", phone: "", category: "General" });
  };

  const filteredPatients = patients.filter(
    (p) =>
      p.fullName.toLowerCase().includes(search.toLowerCase()) ||
      p.patientId.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Top Bar / Search Actions */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
        <input
          type="text"
          placeholder="Search patient by Name or ID (e.g. DHH0001)..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1,
            padding: "0.6rem 1rem",
            borderRadius: "6px",
            border: "1px solid #cbd5e1",
            fontSize: "0.95rem",
          }}
        />
        <button
          onClick={() => setShowModal(true)}
          style={{
            background: "#0284c7",
            color: "#fff",
            padding: "0.65rem 1.25rem",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          + Register Patient
        </button>
      </div>

      {/* Patient Table */}
      <div style={{ background: "#fff", borderRadius: "8px", border: "1px solid #e2e8f0", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
          <thead>
            <tr style={{ background: "#f1f5f9", borderBottom: "1px solid #e2e8f0", color: "#475569", fontSize: "0.85rem" }}>
              <th style={{ padding: "0.75rem 1rem" }}>PATIENT ID</th>
              <th style={{ padding: "0.75rem 1rem" }}>FULL NAME</th>
              <th style={{ padding: "0.75rem 1rem" }}>CATEGORY</th>
              <th style={{ padding: "0.75rem 1rem" }}>GENDER / AGE</th>
              <th style={{ padding: "0.75rem 1rem" }}>PHONE</th>
              <th style={{ padding: "0.75rem 1rem" }}>LAST VISIT</th>
              <th style={{ padding: "0.75rem 1rem" }}>ACTION</th>
            </tr>
          </thead>
          <tbody>
            {filteredPatients.map((p) => (
              <tr key={p.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "0.85rem 1rem", fontWeight: 600, color: "#0369a1" }}>{p.patientId}</td>
                <td style={{ padding: "0.85rem 1rem", fontWeight: 500 }}>{p.fullName}</td>
                <td style={{ padding: "0.85rem 1rem" }}>
                  <span
                    style={{
                      padding: "0.2rem 0.5rem",
                      borderRadius: "4px",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      background:
                        p.category === "Emergency"
                          ? "#fef2f2"
                          : p.category === "Antenatal"
                          ? "#fdf4ff"
                          : "#f0fdf4",
                      color:
                        p.category === "Emergency"
                          ? "#dc2626"
                          : p.category === "Antenatal"
                          ? "#c026d3"
                          : "#16a34a",
                    }}
                  >
                    {p.category}
                  </span>
                </td>
                <td style={{ padding: "0.85rem 1rem", color: "#64748b" }}>
                  {p.gender}, {p.age} yrs
                </td>
                <td style={{ padding: "0.85rem 1rem", color: "#64748b" }}>{p.phone}</td>
                <td style={{ padding: "0.85rem 1rem", color: "#64748b" }}>{p.lastVisit}</td>
                <td style={{ padding: "0.85rem 1rem" }}>
                  <button
                    onClick={() => setSelectedPatient(p)}
                    style={{
                      padding: "0.35rem 0.75rem",
                      background: "#f1f5f9",
                      border: "1px solid #cbd5e1",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "0.8rem",
                    }}
                  >
                    View EMR
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Registration Modal */}
      {showModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ background: "#fff", width: "450px", borderRadius: "8px", padding: "1.5rem", boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)" }}>
            <h3 style={{ margin: "0 0 1rem 0", color: "#0f172a" }}>Register New Patient</h3>
            <form onSubmit={handleCreatePatient} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#475569", marginBottom: "0.2rem" }}>
                  Full Name
                </label>
                <input
                  required
                  type="text"
                  value={formData.fullName}
                  onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem", borderRadius: "4px", border: "1px solid #cbd5e1" }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#475569", marginBottom: "0.2rem" }}>
                    Category
                  </label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    style={{ width: "100%", padding: "0.5rem", borderRadius: "4px", border: "1px solid #cbd5e1" }}
                  >
                    <option value="General">General (DHH)</option>
                    <option value="Family">Family (DHHF)</option>
                    <option value="Antenatal">Antenatal (DHHA)</option>
                    <option value="Emergency">Emergency (DHHE)</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#475569", marginBottom: "0.2rem" }}>
                    Gender
                  </label>
                  <select
                    value={formData.gender}
                    onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                    style={{ width: "100%", padding: "0.5rem", borderRadius: "4px", border: "1px solid #cbd5e1" }}
                  >
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                  </select>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#475569", marginBottom: "0.2rem" }}>
                    Age
                  </label>
                  <input
                    required
                    type="number"
                    value={formData.age}
                    onChange={(e) => setFormData({ ...formData, age: e.target.value })}
                    style={{ width: "100%", padding: "0.5rem", borderRadius: "4px", border: "1px solid #cbd5e1" }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#475569", marginBottom: "0.2rem" }}>
                    Phone Number
                  </label>
                  <input
                    required
                    type="text"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    style={{ width: "100%", padding: "0.5rem", borderRadius: "4px", border: "1px solid #cbd5e1" }}
                  />
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  style={{ padding: "0.5rem 1rem", border: "none", background: "#e2e8f0", borderRadius: "4px", cursor: "pointer" }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{ padding: "0.5rem 1rem", border: "none", background: "#0284c7", color: "#fff", borderRadius: "4px", cursor: "pointer" }}
                >
                  Save Registration
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Selected EMR Sidebar Drawer */}
      {selectedPatient && (
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", padding: "1.25rem", borderRadius: "8px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0, color: "#0f172a" }}>
              Patient EMR Timeline — {selectedPatient.fullName} ({selectedPatient.patientId})
            </h3>
            <button
              onClick={() => setSelectedPatient(null)}
              style={{ padding: "0.25rem 0.5rem", border: "none", background: "#f1f5f9", cursor: "pointer", borderRadius: "4px" }}
            >
              Close
            </button>
          </div>
          <hr style={{ border: "none", borderTop: "1px solid #e2e8f0", margin: "0.75rem 0 1rem 0" }} />
          <p style={{ color: "#64748b", fontSize: "0.9rem" }}>
            Vitals, Consultation Notes, Prescriptions, and Lab requests recorded for <strong>{selectedPatient.patientId}</strong> will stream live from PostgreSQL.
          </p>
        </div>
      )}
    </div>
  );
}
