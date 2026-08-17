import { afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

afterEach(() => cleanup());
import { PageHeader } from "./PageHeader";
import { TabNav } from "./TabNav";
import { ShiftBadge } from "./Badge";
import { Modal } from "./Modal";
import { Icon } from "./Icon";
import { ToastProvider, useToast } from "./Toast";
import { Button } from "./Button";

describe("PageHeader", () => {
  it("renders title and description", () => {
    render(<PageHeader title="Roster" description="Monthly schedule" />);
    expect(screen.getByRole("heading", { name: "Roster" })).toBeTruthy();
    expect(screen.getByText("Monthly schedule")).toBeTruthy();
  });
});

describe("TabNav", () => {
  it("renders tabs and marks the active one", () => {
    render(<TabNav tabs={[{ key: "a", label: "Alpha" }, { key: "b", label: "Beta" }]} active="b" onChange={() => {}} />);
    expect(screen.getByRole("tab", { name: "Alpha" }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("tab", { name: "Beta" }).getAttribute("aria-selected")).toBe("true");
  });
});

describe("ShiftBadge", () => {
  it("renders the shift label", () => {
    render(<ShiftBadge variant="Night" />);
    expect(screen.getByText("Night")).toBeTruthy();
  });
});

describe("Modal", () => {
  it("renders nothing when closed and content when open", () => {
    const { rerender } = render(<Modal open={false} title="Edit" onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(<Modal open title="Edit" onClose={() => {}}>Body</Modal>);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Body")).toBeTruthy();
  });

  it("calls onClose on Escape", () => {
    let closed = false;
    render(<Modal open title="Edit" onClose={() => (closed = true)}>Body</Modal>);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(closed).toBe(true);
  });
});

describe("Icon", () => {
  it("renders an svg with an accessible title", () => {
    render(<Icon name="gear" title="Settings" />);
    expect(screen.getByTitle("Settings")).toBeTruthy();
  });
});

describe("ToastProvider", () => {
  it("shows a toast pushed via useToast", () => {
    function Trigger() {
      const toast = useToast();
      return <Button onClick={() => toast.success("Saved!")}>Go</Button>;
    }
    render(<ToastProvider><Trigger /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(screen.getByText("Saved!")).toBeTruthy();
  });
});
