import { afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Sidebar, type NavGroup } from "./Sidebar";

afterEach(() => cleanup());

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
  {
    title: "Finance & Billing",
    items: [{ key: "billing", label: "Billing & Cashier", icon: "cash" }],
  },
  {
    title: "Staff & Operations",
    items: [
      { key: "roster", label: "Roster & Shifts", icon: "calendar" },
      { key: "handover", label: "Shift Handover Log", icon: "book" },
      { key: "communications", label: "Staff Communications", icon: "chat" },
    ],
  },
];

describe("Sidebar", () => {
  it("renders all categories and nav labels", () => {
    render(<Sidebar groups={groups} active="roster" onSelect={() => {}} onLogout={() => {}} username="superadmin" />);
    for (const label of [
      "Clinical",
      "Pharmacy & Inventory",
      "Finance & Billing",
      "Staff & Operations",
      "System & Admin",
      "Patients Directory",
      "Orders & Clinical",
      "Lab & Pathology",
      "Pharmacy Dispense",
      "Hospital Inventory & Assets",
      "Billing & Cashier",
      "Roster & Shifts",
      "Shift Handover Log",
      "Staff Communications",
      "Settings",
      "Sign out",
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText("superadmin")).toBeTruthy();
  });

  it("marks the active item with aria-current", () => {
    render(<Sidebar groups={groups} active="roster" onSelect={() => {}} onLogout={() => {}} username="superadmin" />);
    const roster = screen.getByRole("button", { name: /Roster & Shifts/ });
    expect(roster.getAttribute("aria-current")).toBe("page");
    const patients = screen.getByRole("button", { name: /Patients Directory/ });
    expect(patients.getAttribute("aria-current")).toBeNull();
  });
});
