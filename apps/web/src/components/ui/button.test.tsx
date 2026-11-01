import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";

describe("Button", () => {
  it("renders and forwards click events", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    await userEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("applies variant and size classes", () => {
    const { container } = render(
      <Button variant="danger" size="sm">
        Delete
      </Button>
    );
    const el = container.firstElementChild;
    expect(el).toHaveClass("bg-danger");
    expect(el).toHaveClass("h-8");
  });

  it("honours the disabled state", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Busy
      </Button>
    );
    expect(screen.getByRole("button", { name: "Busy" })).toBeDisabled();
  });
});
