import { afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

afterEach(() => cleanup());
import { Button } from "./Button";

describe("Button", () => {
  it("renders its label", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("uses the primary token background by default", () => {
    render(<Button>Save</Button>);
    // jsdom normalizes hex to rgb()
    expect(screen.getByRole("button", { name: "Save" }).style.backgroundColor).toBe("rgb(37, 99, 235)");
  });

  it("supports the danger variant", () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole("button", { name: "Delete" }).style.backgroundColor).toBe("rgb(220, 38, 38)");
  });

  it("is disabled and busy while loading", () => {
    render(<Button loading>Save</Button>);
    const btn = screen.getByRole("button", { name: /Save/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(btn.getAttribute("aria-busy")).toBe("true");
  });
});
