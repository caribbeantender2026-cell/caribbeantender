// The forms engine's rules mirror private.form_data_problems, so the screen refuses what the database would.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { displayValue, formProblems, grandTotal, isShown, lineTotal, numberFieldText, readNumber, readSchema, showsLineTotal, type FormSchema } from '../../src/lib/forms.ts';

const proposal: FormSchema = {
  fields: [
    { name: 'deliverables', label: 'What will be delivered', type: 'textarea', required: true, maxLength: 20 },
    { name: 'contact', label: 'Contact email', type: 'email' },
    { name: 'start', label: 'Start date', type: 'date' },
    {
      name: 'cost_breakdown',
      label: 'Cost breakdown',
      type: 'table',
      required: true,
      columns: [
        { name: 'item', label: 'Item', type: 'text', required: true },
        { name: 'quantity', label: 'Quantity', type: 'number', required: true, minimum: 0 },
        { name: 'unit_cost', label: 'Unit cost', type: 'number', required: true, minimum: 0 },
        { name: 'labour', label: 'Labour', type: 'number', minimum: 0 },
      ],
      lineTotal: { label: 'Line total', multiply: ['quantity', 'unit_cost'], add: ['labour'] },
    },
  ],
};
const rule = proposal.fields[3]?.lineTotal ?? { label: '' };

test('A complete, valid form has no problems', () => {
  const data = { deliverables: 'Chairs', contact: 'sales@example.com', start: '2026-12-01', cost_breakdown: [{ item: 'Chair', quantity: 10, unit_cost: 2500, labour: 500 }] };
  assert.deepEqual(formProblems(proposal, data, true), []);
});

test('Required fields and required cells are reported only when the form must be complete', () => {
  const data = { cost_breakdown: [{ item: '', quantity: 1, unit_cost: null }] };
  assert.deepEqual(formProblems(proposal, data, false), []);
  assert.deepEqual(formProblems(proposal, data, true), [
    'What will be delivered is required.',
    'Row 1 of Cost breakdown: Item is required.',
    'Row 1 of Cost breakdown: Unit cost is required.',
  ]);
});

test('Wrong types, oversized text, bad emails and dates, negative and non-finite numbers are refused', () => {
  const problems = formProblems(
    proposal,
    {
      deliverables: 'x'.repeat(21),
      contact: 'not an email',
      start: '2026-02-30x',
      cost_breakdown: [{ item: 'A', quantity: -1, unit_cost: Number.POSITIVE_INFINITY }, { item: 7 as unknown as string, quantity: '3' as unknown as number, unit_cost: 1 }],
    },
    true,
  );
  assert.deepEqual(problems, [
    'What will be delivered must be at most 20 characters.',
    'Contact email must be an email address.',
    'Start date must be a date like 2026-11-30.',
    'Row 1 of Cost breakdown: Quantity must be at least 0.',
    'Row 1 of Cost breakdown: Unit cost must be a number.',
    'Row 2 of Cost breakdown: Item must be text.',
    'Row 2 of Cost breakdown: Quantity must be a number.',
  ]);
});

test('Impossible calendar dates are refused, real ones accepted', () => {
  const dateOnly: FormSchema = { fields: [{ name: 'start', label: 'Start date', type: 'date' }] };
  for (const impossible of ['2026-02-30', '2026-13-01', '2026-00-10', '2025-02-29']) {
    assert.deepEqual(formProblems(dateOnly, { start: impossible }, false), ['Start date must be a date like 2026-11-30.'], impossible);
  }
  assert.deepEqual(formProblems(dateOnly, { start: '2028-02-29' }, false), [], 'leap day');
});

test('A table must be a list of at most 200 rows', () => {
  assert.deepEqual(formProblems(proposal, { cost_breakdown: 'rows' as unknown as [] }, false), ['Cost breakdown must be a list of rows.']);
  const tooMany = Array.from({ length: 201 }, () => ({ item: 'A', quantity: 1, unit_cost: 1 }));
  assert.deepEqual(formProblems(proposal, { cost_breakdown: tooMany }, false), ['Cost breakdown can have at most 200 rows.']);
});

test('Line totals multiply then add, empty cells count as zero, and the grand total sums them', () => {
  assert.equal(lineTotal({ quantity: 10, unit_cost: 2500, labour: 500 }, rule), 25_500);
  assert.equal(lineTotal({ quantity: 10, unit_cost: null, labour: 500 }, rule), 500);
  assert.equal(grandTotal([{ quantity: 2, unit_cost: 3 }, { quantity: 1, unit_cost: 4, labour: 1 }], rule), 11);
});

test('A stored schema that is not a list of named fields becomes an empty form', () => {
  for (const stored of [null, 'text', 42, {}, { fields: 'no' }]) {
    assert.deepEqual(readSchema(stored).fields, []);
  }
  assert.equal(readSchema({ fields: [{ name: 'a', label: 'A', type: 'text' }, { label: 'no name' }, null] }).fields.length, 1);
});

const tickBoxes: FormSchema = {
  fields: [
    { name: 'parish', label: 'Parish', type: 'choice', options: ['Kingston', 'St. Ann'], required: true, section: 'Address' },
    { name: 'service_areas', label: 'Service areas', type: 'checkboxes', options: ['Kingston', 'Islandwide'], required: true },
  ],
};

test('Pick-one and tick-any fields accept only their listed options', () => {
  assert.deepEqual(formProblems(tickBoxes, { parish: 'St. Ann', service_areas: ['Kingston', 'Islandwide'] }, true), []);
  assert.deepEqual(formProblems(tickBoxes, { parish: 'Nowhere', service_areas: ['Mars'] }, false), [
    'Parish must be one of the listed options.',
    'Service areas must only contain the listed options.',
  ]);
  assert.deepEqual(formProblems(tickBoxes, { parish: ['Kingston'], service_areas: 'Kingston' }, false), [
    'Parish must be one of the listed options.',
    'Service areas must be a list of the listed options.',
  ]);
  assert.deepEqual(formProblems(tickBoxes, { service_areas: [] }, true), ['Parish is required.', 'Service areas is required.']);
});

test('Ticked options read as a list on screen and in the PDF', () => {
  assert.equal(displayValue(['Kingston', 'Islandwide']), 'Kingston, Islandwide');
});

test('Typed numbers keep their decimals and may be written with thousands commas', () => {
  assert.equal(readNumber('1,500,000'), 1_500_000);
  assert.equal(readNumber(' 1250.50 '), 1250.5);
  assert.equal(readNumber('12.'), 12);
  assert.equal(readNumber(''), null);
  assert.equal(readNumber('   '), null);
  assert.equal(readNumber('abc'), null);
  assert.equal(readNumber('1e400'), null);
  // While someone types "12." the box must keep showing "12.", so the decimal point can be typed.
  assert.equal(numberFieldText('12.', 12), '12.');
  assert.equal(numberFieldText('1,500', 1500), '1,500');
  // A value changed from outside (a removed row shifting up, a loaded draft) shows that value instead.
  assert.equal(numberFieldText('12.', 40), '40');
  assert.equal(numberFieldText('', null), '');
  assert.equal(numberFieldText('7', null), '');
});

test('A per-row total that only repeats one column is not shown as its own column', () => {
  assert.equal(showsLineTotal({ label: 'Weight (%)', add: ['weight'] }), false);
  assert.equal(showsLineTotal({ label: 'Total', multiply: ['quantity', 'unit_price'] }), true);
  assert.equal(showsLineTotal({ label: 'Total', add: ['labour', 'materials'] }), true);
  assert.equal(showsLineTotal(undefined), false);
});

test('One complete reference and a manually discounted proposal total are valid', () => {
  const schema: FormSchema = { fields: [
    { name: 'bid_references', label: 'References', required: true, type: 'table', columns: [{ name: 'name', label: 'Name', required: true, type: 'text' }] },
    { name: 'pricing_schedule', label: 'Schedule', type: 'table', columns: [{ name: 'unit_price', label: 'Price', type: 'number' }] },
    { name: 'total_bid_value', label: 'Total bid value', required: true, type: 'number' },
  ] };
  const answers = { bid_references: [{ name: 'Purchasing manager' }], pricing_schedule: [{ unit_price: 1000 }], total_bid_value: 700 };
  assert.deepEqual(formProblems(schema, answers, true), []);
  assert.match(formProblems(schema, { ...answers, bid_references: [] }, true).join(' '), /References is required/);
});

// Rockell, 24 Nov 2026: budget amounts appear and become required only for the budget type that uses them.
const budget: FormSchema = { fields: [
  { name: 'budget_type', label: 'Budget type', type: 'choice', required: true, options: ['Fixed Budget', 'Budget Range', 'Open Competitive Bidding'] },
  { name: 'fixed_budget', label: 'Fixed budget', type: 'number', required: true, minimum: 0, showWhen: { field: 'budget_type', equals: 'Fixed Budget' } },
  { name: 'budget_minimum', label: 'Minimum', type: 'number', required: true, minimum: 0, showWhen: { field: 'budget_type', equals: 'Budget Range' } },
  { name: 'budget_maximum', label: 'Maximum', type: 'number', required: true, minimum: 0, showWhen: { field: 'budget_type', equals: 'Budget Range' } },
] };

test('A field shown for one answer is required only while that answer is picked', () => {
  assert.deepEqual(formProblems(budget, { budget_type: 'Open Competitive Bidding' }, true), []);
  assert.deepEqual(formProblems(budget, { budget_type: 'Fixed Budget' }, true), ['Fixed budget is required.']);
  assert.deepEqual(formProblems(budget, { budget_type: 'Budget Range', budget_minimum: 100 }, true), ['Maximum is required.']);
  // Nothing picked yet: the amounts don't apply, so only the choice itself is missing.
  assert.deepEqual(formProblems(budget, {}, true), ['Budget type is required.']);
});

test('An answer left in a field that no longer applies is neither checked nor shown', () => {
  const switched = { budget_type: 'Budget Range', budget_minimum: 100, budget_maximum: 200, fixed_budget: -5 };
  assert.deepEqual(formProblems(budget, switched, true), []);
  assert.deepEqual(budget.fields.filter((field) => isShown(field, switched)).map((field) => field.name), ['budget_type', 'budget_minimum', 'budget_maximum']);
});

test('A date column takes only real calendar dates', () => {
  const milestones: FormSchema = { fields: [
    { name: 'milestones', label: 'Key milestones', type: 'table', required: true, columns: [
      { name: 'milestone', label: 'Milestone', type: 'text', required: true },
      { name: 'target_date', label: 'Target date', type: 'date', required: true },
    ] },
  ] };
  assert.deepEqual(formProblems(milestones, { milestones: [{ milestone: 'Delivery', target_date: '2026-12-15' }] }, true), []);
  assert.deepEqual(formProblems(milestones, { milestones: [{ milestone: 'Delivery', target_date: 'mid-December' }] }, true), [
    'Row 1 of Key milestones: Target date must be a date like 2026-11-30.',
  ]);
  assert.deepEqual(formProblems(milestones, { milestones: [{ milestone: 'Delivery' }] }, true), ['Row 1 of Key milestones: Target date is required.']);
});
