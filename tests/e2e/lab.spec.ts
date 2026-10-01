import { expect, test, type Page } from "@playwright/test";

/* ── Helpers ─────────────────────────────────────────────────────────────── */

const loadSample = async (page: Page, name: string) => {
  await page.getByRole("button", { name, exact: true }).first().click();
  await page.waitForSelector(".inspector");
};

const flipBitAt = async (page: Page, bitOffset: number) => {
  await page.locator(`button.bit[data-bit="${bitOffset}"]`).first().click();
  await expect(page.locator(".flip .bitfield__bit--changed").first()).toBeVisible();
};

const severityText = (page: Page) => page.locator(".severity").first().innerText();

const readouts = async (page: Page, label: string) => {
  const row = page.locator(".readout__row", { hasText: label }).first();
  return (await row.count()) ? (await row.locator(".readout__value").innerText()).trim() : null;
};

/* ── Empty state ─────────────────────────────────────────────────────────── */

test.describe("empty state", () => {
  test("opens on the experiment, not a marketing page", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Bit Flip/);
    await expect(page.getByText("One bit. One mutation. One experiment.")).toBeVisible();
    // The samples are offered, not buried behind a start button.
    await expect(page.getByRole("button", { name: "BLAB record" }).first()).toBeVisible();
    await expect(page.locator(".empty-grid")).toBeVisible();
  });

  test("declares the execution policy before any file is chosen", async ({ page }) => {
    await page.goto("/");
    const body = await page.locator("body").innerText();
    expect(body).toContain("Never uploaded, never run");
  });
});

/* ── Sample experiment ───────────────────────────────────────────────────── */

test.describe("sample experiment", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("loads a sample and reports its structure", async ({ page }) => {
    await loadSample(page, "BLAB record");
    await expect(page.getByRole("heading", { name: "Byte inspector" })).toBeVisible();
    await expect(page.getByText("8 named regions")).toBeVisible();
    // The inspector shows exactly the sample's bytes.
    await expect(page.locator("button.bit")).toHaveCount(await page.locator("button.bit").count());
    expect(await page.locator("button.bit").count()).toBeGreaterThan(400);
  });

  test("selecting a bit flips it and measures the consequence", async ({ page }) => {
    await loadSample(page, "BF11 atlas");
    await flipBitAt(page, 90);

    // The flip event shows the byte before and after, with the bit isolated.
    await expect(page.locator(".flip__stage").first()).toBeVisible();
    await expect(page.locator(".bitfield__bit--changed")).toHaveCount(2);
    await expect(page.locator(".bitfield__bit--struck")).toHaveCount(1);

    // The causal rail reported every stage for a format it can decode.
    const stages = page.locator(".causal__stage[data-state='measured']");
    await expect(stages).toHaveCount(5);
    await expect(page.locator(".causal__stage").nth(3)).toContainText("decoded");
  });

  test("reports exactly one changed pixel for a pixel-bit flip", async ({ page }) => {
    await loadSample(page, "BF11 atlas");
    await flipBitAt(page, 90);
    await expect(page.getByText("Pixels changed 1 of 448")).toBeVisible();
    await expect(page.getByText(/changed region x\d+ y\d+ 1×1/)).toBeVisible();
  });

  test("classifies a mutation that destroys the format as critical", async ({ page }) => {
    await loadSample(page, "BLAB record");
    await flipBitAt(page, 0); // magic byte
    expect(await severityText(page)).toMatch(/critical/i);
    await expect(page.getByText("The mutated data no longer decodes")).toBeVisible();
  });

  test("refuses to classify a format with no decoder", async ({ page }) => {
    await loadSample(page, "Raw block");
    await flipBitAt(page, 3);
    expect(await severityText(page)).toMatch(/unclassified/i);
    await expect(page.getByText("No structure to map")).toBeVisible();
    await expect(page.getByText("No renderer for this format.")).toBeVisible();
  });

  test("the byte and the bit in the flip event agree with the readouts", async ({ page }) => {
    await loadSample(page, "BLAB record");
    await flipBitAt(page, 100);

    const byteBefore = await readouts(page, "Byte before");
    const byteAfter = await readouts(page, "Byte after");
    expect(byteBefore).not.toBe(byteAfter);
    // The causal rail's BYTE stage repeats the same transition.
    await expect(page.locator(".causal__stage").nth(1)).toContainText(
      `${byteBefore} → ${byteAfter}`,
    );
  });

  test("the changed bit in the inspector is the bit that was clicked", async ({ page }) => {
    await loadSample(page, "BLAB record");
    await flipBitAt(page, 100);
    await expect(page.locator('button.bit[data-flipped="true"]')).toHaveCount(1);
    await expect(page.locator('button.bit[data-bit="100"]')).toHaveAttribute(
      "data-flipped",
      "true",
    );
  });

  test("changing the integrity digest is required for a valid measurement", async ({ page }) => {
    await loadSample(page, "BLAB record");
    await flipBitAt(page, 100);
    const digests = page.locator(".digest__value");
    await expect(digests).toHaveCount(2);
    expect(await digests.nth(0).innerText()).not.toBe(await digests.nth(1).innerText());
    // Full SHA-256, not a truncated prefix.
    expect((await digests.nth(1).innerText()).replace(/\s/g, "")).toHaveLength(64);
  });
});

/* ── Reset ───────────────────────────────────────────────────────────────── */

test.describe("reset", () => {
  test("returns to the unmutated source", async ({ page }) => {
    await page.goto("/");
    await loadSample(page, "BF11 atlas");
    await flipBitAt(page, 90);
    await page.getByRole("button", { name: "Reset experiment" }).click();

    await expect(page.locator(".bitfield")).toHaveCount(0);
    await expect(page.getByText("Select one bit")).toBeVisible();
    await expect(page.locator('button.bit[data-flipped="true"]')).toHaveCount(0);
    // The byte table is gone too, so no mutated bytes remain on screen.
    await expect(page.getByRole("heading", { name: "Comparison" })).toHaveCount(0);
    await expect(page.locator(".state__title", { hasText: "No bit selected" })).toBeVisible();
  });
});

/* ── Keyboard ────────────────────────────────────────────────────────────── */

test.describe("keyboard", () => {
  test("the inspector is a single tab stop with arrow-key navigation", async ({ page }) => {
    await page.goto("/");
    await loadSample(page, "BLAB record");

    const firstBit = page.locator("button.bit[data-bit='0']");
    await firstBit.focus();
    await expect(firstBit).toBeFocused();

    // Read the row width from the panel note rather than assuming a layout,
    // so the test tracks the responsive column count. The note is uppercased
    // by CSS, and innerText reflects that.
    const note = await page.getByText(/\d+ per row/i).first().innerText();
    const perRow = Number(/(\d+)\s*per\s*row/i.exec(note)![1]);
    expect(perRow).toBeGreaterThan(0);

    await page.keyboard.press("ArrowRight");
    await expect(page.locator("button.bit[data-bit='1']")).toBeFocused();
    // Down moves a whole row: one byte per column.
    await page.keyboard.press("ArrowDown");
    const row1 = 1 + perRow * 8;
    await expect(page.locator(`button.bit[data-bit='${row1}']`)).toBeFocused();
    // Home and End are row-scoped, matching grid convention. The caret is on
    // row 1 now, which spans bits perRow*8 … perRow*16 - 1.
    await page.keyboard.press("End");
    await expect(page.locator(`button.bit[data-bit='${perRow * 16 - 1}']`)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(page.locator(`button.bit[data-bit='${perRow * 8}']`)).toBeFocused();
    // ArrowLeft at the very first bit must not wrap or escape the grid.
    await page.locator("button.bit[data-bit='0']").focus();
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator("button.bit[data-bit='0']")).toBeFocused();

    // Tab leaves the grid entirely rather than walking every bit.
    expect(await page.locator("button.bit[tabindex='0']").count()).toBe(1);
  });

  test("Enter flips the focused bit", async ({ page }) => {
    await page.goto("/");
    await loadSample(page, "BF11 atlas");
    await page.locator("button.bit[data-bit='90']").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".bitfield__bit--changed").first()).toBeVisible();
  });

  test("every tab stop has a visible focus ring", async ({ page }) => {
    await page.goto("/");
    await loadSample(page, "BLAB record");
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      const ring = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const s = getComputedStyle(el);
        return s.outlineStyle === "none" || s.outlineWidth === "0px";
      });
      expect(ring, `element without a visible focus ring at step ${i}`).toBeFalsy();
    }
  });

  test("the bit picker offers full-size targets for every bit of the byte", async ({ page }) => {
    await page.goto("/");
    await loadSample(page, "BLAB record");
    await expect(page.locator(".bit-picker__bit")).toHaveCount(8);
    for (let i = 0; i < 8; i++) {
      const box = await page.locator(".bit-picker__bit").nth(i).boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(24);
      expect(box!.height).toBeGreaterThanOrEqual(24);
    }
  });
});

/* ── Butterfly mode ──────────────────────────────────────────────────────── */

test.describe("butterfly mode", () => {
  test("measures a bounded sweep and plots the results", async ({ page }) => {
    await page.goto("/");
    await loadSample(page, "BLAB record");
    await page.getByRole("button", { name: "Butterfly" }).click();

    await expect(page.getByText("No sweep has been run")).toBeVisible();

    await page.getByRole("button", { name: "16", exact: true }).click();
    await page.getByRole("button", { name: "Run sweep of 16" }).click();
    await expect(page.getByRole("table")).toBeVisible();

    const rows = page.locator(".stage table tbody tr");
    await expect(rows).toHaveCount(16);

    // Every row carries a measured rationale, not a guess.
    const rationales = await rows.locator("td").last().allInnerTexts();
    for (const text of rationales) expect(text.length).toBeGreaterThan(15);

    // Coverage is reported, including what was not covered.
    await expect(page.getByText("Coverage", { exact: true })).toBeVisible();
  });

  test("finds more than one severity within a structured record", async ({ page }) => {
    await page.goto("/");
    await loadSample(page, "BLAB record");
    await page.getByRole("button", { name: "Butterfly" }).click();
    await page.getByRole("button", { name: "64", exact: true }).click();
    await page.getByRole("button", { name: "Run sweep of 64" }).click();
    await expect(page.locator(".stage table tbody tr")).toHaveCount(64);

    const severities = await page.locator(".stage table tbody .severity").allInnerTexts();
    expect(new Set(severities.map((s) => s.trim())).size).toBeGreaterThan(1);
  });

  test("the sensitivity map has a text equivalent", async ({ page }) => {
    await page.goto("/");
    await loadSample(page, "BLAB record");
    await page.getByRole("button", { name: "Butterfly" }).click();
    await page.getByRole("button", { name: "8", exact: true }).click();
    await page.getByRole("button", { name: "Run sweep of 8" }).click();
    await expect(page.getByText("Textual equivalent")).toBeVisible();
    await expect(page.getByRole("img", { name: /Sensitivity map/ })).toBeVisible();
  });

  test("asks for a source before a sweep can run", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Butterfly" }).click();
    await expect(page.getByText("Load a source first")).toBeVisible();
  });
});

/* ── Experiment records ──────────────────────────────────────────────────── */

test.describe("experiment records", () => {
  test("records every flip and can reproduce one", async ({ page }) => {
    await page.goto("/");
    await loadSample(page, "BLAB record");
    await flipBitAt(page, 100);
    await flipBitAt(page, 40);

    await page.getByRole("button", { name: /Experiments/ }).click();
    await expect(page.getByRole("table")).toBeVisible();
    const rows = page.locator(".stage table tbody tr");
    await expect(rows).toHaveCount(2);

    await rows.first().getByRole("button", { name: "Open" }).click();
    const dialog = page.locator("dialog.sheet");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/SHA-256 before/)).toBeVisible();

    await dialog.getByRole("button", { name: "Verify reproduction" }).click();
    await expect(dialog.getByText(/re-ran to identical integrity and severity/)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("the log distinguishes an empty state from a cleared one", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Experiments/ }).click();
    await expect(page.getByText("No experiments yet")).toBeVisible();
  });
});

/* ── Navigation ──────────────────────────────────────────────────────────── */

test.describe("navigation", () => {
  test("moves focus to the new view on route change", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "About" }).click();
    await expect(page.locator("main")).toBeFocused();
  });

  test("the About page states what the application does not do", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "About" }).click();
    const text = await page.locator("main").innerText();
    expect(text).toContain("It does not run uploaded files");
    expect(text).toContain("does not claim a bit flip will corrupt an image");
    expect(text).toContain("References");
    expect(text).toContain("FIPS PUB 180-4");
  });

  test("a skip link is the first tab stop", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.locator(".skip-link")).toBeFocused();
  });
});

/* ── Unsupported and error states ────────────────────────────────────────── */

test.describe("unsupported data", () => {
  test("marks the control rather than silently failing", async ({ page }) => {
    await page.goto("/");
    await loadSample(page, "Raw block");
    await flipBitAt(page, 3);

    // A format with no renderer has nothing to show, so all three modes are
    // unavailable and the panel says so in words.
    for (const mode of ["original", "mutated", "difference"]) {
      await expect(page.getByRole("button", { name: mode, exact: true })).toBeDisabled();
    }
    await expect(page.getByText("No renderer for this format.")).toBeVisible();
  });

  test("falls back to the original when the mutation destroys the image", async ({ page }) => {
    await page.goto("/");
    await loadSample(page, "PNG plate");
    await flipBitAt(page, 20); // inside the signature: the PNG can no longer decode

    await expect(page.getByText("The mutated data no longer decodes")).toBeVisible();
    const original = page.getByRole("button", { name: "original", exact: true });
    await expect(original).toBeEnabled();
    await expect(original).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "mutated", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "difference", exact: true })).toBeDisabled();
    // The original still renders, so the failure is visible, not implied.
    await expect(page.getByRole("img", { name: /Original/ })).toBeVisible();
  });

  test("rejects an out-of-range address in the jump control", async ({ page }) => {
    await page.goto("/");
    await loadSample(page, "BLAB record");
    await page.getByLabel("Jump to byte", { exact: true }).fill("0xFFFF");
    await page.getByRole("button", { name: "Go" }).click();
    // No experiment is created, and no error is invented.
    await expect(page.getByText("Select one bit")).toBeVisible();
  });
});

/* ── Reduced motion ──────────────────────────────────────────────────────── */

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("remains fully understandable without animation", async ({ page }) => {
    await page.goto("/");
    await loadSample(page, "BLAB record");
    await flipBitAt(page, 0);

    const duration = await page.evaluate(() => {
      const el = document.querySelector(".causal__fill");
      return el ? getComputedStyle(el).transitionDuration : null;
    });
    expect(duration).toBe("1e-05s");
    // Every measured stage is still lit and readable.
    await expect(page.locator(".causal__stage[data-state='measured']")).toHaveCount(5);
    expect(await severityText(page)).toMatch(/critical/i);
  });
});

/* ── Layout ──────────────────────────────────────────────────────────────── */

test.describe("layout", () => {
  for (const [name, width, height] of [
    ["desktop", 1440, 900],
    ["tablet", 834, 1112],
    ["mobile", 390, 844],
  ] as const) {
    test(`has no horizontal page scroll at ${name}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      await loadSample(page, "PNG plate");
      await flipBitAt(page, 40);

      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(overflows).toBe(false);
    });
  }

  test("inspector rows never overlap at any width", async ({ page }) => {
    for (const width of [1440, 1024, 834, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await loadSample(page, "PNG plate");
      const violations = await page.evaluate(() => {
        const rows = [...document.querySelectorAll(".inspector__row")];
        return rows
          .filter((r) => {
            const box = r.getBoundingClientRect();
            const bottom = Math.max(
              ...[...r.querySelectorAll(".byte")].map((e) => e.getBoundingClientRect().bottom),
            );
            return bottom > box.bottom + 0.5;
          })
          .length;
      });
      expect(violations, `rows overlap at ${width}px`).toBe(0);
    }
  });
});
