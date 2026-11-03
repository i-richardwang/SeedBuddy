/** Isolated DOM harness for kit components; the scenario to run is the first argument. */
import assert from "node:assert/strict";

import { useState } from "react";

import { body, browser, byRole, press, render, unmount, waitFor } from "./dom";

const scenarios: Record<string, () => Promise<void>> = {
  async modal() {
    const { Modal } = await import("../src/ui/kit/Modal");
    function Dialog({ open }: { open: boolean }) {
      return (
        <Modal open={open} title="Rename" okText="Save" onClose={() => {}}>
          <input data-field="name" />
        </Modal>
      );
    }
    await render(<Dialog open />);
    assert.ok(body.querySelector("[data-field=name]"), "an open dialog shows");
    await render(<Dialog open={false} />);
    await waitFor(
      () => body.querySelector("[data-field=name]") === null,
      "a closed dialog unmounts its body, so reopening starts a fresh form",
    );
  },

  async select() {
    const { Select } = await import("../src/ui/kit/Select");
    const chosen: string[] = [];
    function Field() {
      const [value, setValue] = useState("a");
      return (
        <Select
          aria-label="Letter"
          options={[
            { label: "Alpha", value: "a" },
            { label: "Beta", value: "b" },
          ]}
          value={value}
          onChange={(next) => {
            chosen.push(next);
            setValue(next);
          }}
        />
      );
    }
    await render(<Field />);
    await press(body.querySelector('[aria-label="Letter"]'));
    const beta = await waitFor(
      () =>
        byRole("option").find((option) => option.textContent?.includes("Beta")),
      "the options show",
    );
    await press(beta);
    assert.deepEqual(chosen, ["b"], "choosing an option reports its value");
  },

  async dropdownMenu() {
    const { DropdownMenu } = await import("../src/ui/kit/DropdownMenu");
    const { Button } = await import("../src/ui/kit/Button");
    const ran: string[] = [];
    await render(
      <DropdownMenu
        items={[
          { key: "edit", label: "Edit", onClick: () => ran.push("edit") },
          { type: "divider" },
          {
            key: "delete",
            label: "Delete",
            danger: true,
            onClick: () => ran.push("delete"),
          },
        ]}
      >
        <Button aria-label="Actions" />
      </DropdownMenu>,
    );
    assert.equal(byRole("menuitem").length, 0, "a closed menu has no items");
    await press(body.querySelector('[aria-label="Actions"]'));
    await waitFor(
      () => byRole("menuitem").length === 2,
      "the trigger opens the menu",
    );
    await press(
      byRole("menuitem").find((item) => item.textContent === "Delete"),
    );
    assert.deepEqual(ran, ["delete"], "an item runs its onClick");
  },

  async table() {
    const { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } =
      await import("../src/ui/kit/Table");
    function List({ rows }: { rows: string[] }) {
      return (
        <Table
          aria-label="Letters"
          empty={rows.length === 0 && <p data-empty="">Nothing yet</p>}
        >
          <TableHeader>
            <tr>
              <TableHead>Letter</TableHead>
            </tr>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row}>
                <TableCell cellSlot="title">{row}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      );
    }
    await render(<List rows={["a", "b"]} />);
    assert.equal(
      body.querySelectorAll("tr").length,
      3,
      "a header row and one row per item",
    );
    await render(<List rows={[]} />);
    assert.equal(
      body.querySelector("table"),
      null,
      "an empty table draws no table, header included",
    );
    assert.ok(body.querySelector("[data-empty]"), "the empty state shows");
  },

  async form() {
    const { Form } = await import("../src/ui/kit/Form");
    const { Input } = await import("../src/ui/kit/Input");
    await render(
      <Form errors={{ email: "Already taken" }} onSubmit={() => {}}>
        <Form.Field label="Name" name="name">
          <Input />
        </Form.Field>
        <Form.Field label="Email" name="email">
          <Input />
        </Form.Field>
      </Form>,
    );
    /** The text of what describes the control labelled `label`. */
    const errorOf = (label: string) => {
      const owner = Array.from(body.querySelectorAll("label")).find(
        (element) => element.textContent === label,
      );
      const control = owner && browser.document.getElementById(owner.htmlFor);
      assert.ok(control, `a control is labelled ${label}`);
      const described = control.getAttribute("aria-describedby");
      if (!described) return null;
      return described
        .split(" ")
        .map((id) => browser.document.getElementById(id)?.textContent ?? "")
        .join("");
    };
    assert.equal(errorOf("Email"), "Already taken");
    assert.equal(errorOf("Name"), null, "other fields show no error");
  },

  async formGroup() {
    const { Form } = await import("../src/ui/kit/Form");
    const { Input } = await import("../src/ui/kit/Input");
    await render(
      <Form onSubmit={() => {}}>
        <Form.Group
          title="Advanced"
          description="Seldom needed"
          extra={<button type="button">Restore</button>}
          collapsible
        >
          <Form.Field label="Seed" name="seed">
            <Input />
          </Form.Field>
        </Form.Group>
      </Form>,
    );
    const trigger = body.querySelector("[aria-expanded]");
    assert.ok(trigger, "the heading is the trigger");
    const group = body.querySelector("fieldset");
    const titled = group?.getAttribute("aria-labelledby");
    assert.equal(
      titled && browser.document.getElementById(titled)?.textContent,
      "Advanced",
      "the group is named by its title alone",
    );
    const shows = (text: string) => body.textContent?.includes(text) ?? false;
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.ok(!shows("Seed"), "a collapsible group starts closed");
    assert.ok(!shows("Restore"), "a closed group hides its command");
    await press(trigger);
    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    assert.ok(shows("Seed") && shows("Seldom needed"), "opening shows it");
    assert.ok(shows("Restore"), "an open group shows its command");
    await press(trigger);
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    await waitFor(() => !shows("Seed"), "closing folds the fields away");
    assert.ok(!shows("Restore"), "closing hides the command");
  },

  async checkboxGroup() {
    const { CheckboxGroup } = await import("../src/ui/kit/Checkbox");
    const changes: string[][] = [];
    await render(
      <CheckboxGroup
        value={["a", "b"]}
        options={[
          { label: "Alpha", value: "a", disabled: true },
          { label: "Beta", value: "b" },
        ]}
        onChange={(next) => changes.push(next)}
      />,
    );
    const [alpha, beta] = byRole("checkbox");
    assert.ok(alpha?.hasAttribute("data-disabled"), "an option can be held");
    assert.ok(!beta?.hasAttribute("data-disabled"), "the others stay free");
    /** Presses an option by its text, as a reader does. */
    const pressText = (text: string) =>
      press(
        Array.from(body.querySelectorAll("label span")).find(
          (element) => element.textContent === text,
        ),
      );
    await pressText("Alpha");
    assert.deepEqual(changes, [], "a held option does not change");
    await pressText("Beta");
    assert.deepEqual(changes, [["a"]], "a free option changes");
  },

  async actionIcon() {
    const { ActionIcon } = await import("../src/ui/kit/ActionIcon");
    const { Hash, Lock } = await import("lucide-react");
    await render(
      <>
        <ActionIcon icon={Hash} title="Numbers" pressed />
        <ActionIcon icon={Lock} title="Lock editing" />
      </>,
    );
    const named = (label: string) =>
      body.querySelector(`button[aria-label="${label}"]`);
    const numbers = named("Numbers");
    assert.equal(
      numbers?.getAttribute("aria-pressed"),
      "true",
      "a pressed toggle says so",
    );
    assert.ok(
      !named("Lock editing")?.hasAttribute("aria-pressed"),
      "a command is no toggle",
    );
    await render(<ActionIcon icon={Hash} title="Numbers" pressed={false} />);
    assert.equal(
      named("Numbers")?.getAttribute("aria-pressed"),
      "false",
      "a toggle let go keeps its name and says it is off",
    );
  },
};

const name = process.argv[2] ?? "";
const scenario = scenarios[name];
assert.ok(scenario, `unknown scenario ${name}`);
await scenario();
await unmount();
console.log(`kit ${name} behaves`);
process.exit(0);
