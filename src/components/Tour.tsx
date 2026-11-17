/**
 * The onboarding tour (PRD P1-02): on a person's first visit as a business or a supplier, a guided walk
 * through the whole process with sample data and a short demo form. Nothing it shows is saved: the
 * demo form lives in this component's state, and the only write is record_onboarding_completed.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AccountType } from '../auth/AccountContext.tsx';
import { formatAmount } from '../lib/queries.ts';
import type { FormData, FormSchema } from '../lib/forms.ts';
import { supabase } from '../lib/supabase.ts';
import { FormFields } from './FormFields.tsx';
import { Notice } from './Notices.tsx';
import { Badge } from './ui/badge.tsx';
import { Button } from './ui/button.tsx';
import { Card } from './ui/card.tsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table.tsx';

// A shortened copy of each draft form, for practice only.
const demoRequirementsForm: FormSchema = {
  fields: [
    { name: 'need_summary', label: 'Summary of what you need', type: 'textarea', required: true },
    { name: 'delivery_location', label: 'Delivery location', type: 'text', required: true },
  ],
};
const demoProposalForm: FormSchema = {
  fields: [
    { name: 'deliverables', label: 'What will be delivered', type: 'textarea', required: true },
    {
      name: 'cost_breakdown',
      label: 'Cost breakdown',
      type: 'table',
      columns: [
        { name: 'item', label: 'Item', type: 'text' },
        { name: 'quantity', label: 'Quantity', type: 'number' },
        { name: 'unit_cost', label: 'Unit cost (JMD)', type: 'number' },
      ],
      lineTotal: { label: 'Line total (JMD)', multiply: ['quantity', 'unit_cost'] },
      grandTotal: { label: 'Grand total (JMD)' },
    },
  ],
};

function SampleTender() {
  return (
    <div className="mt-4 rounded-xl border p-6">
      <strong>Sample: 40 ergonomic office chairs</strong>
      <p className="text-sm text-muted-foreground">Office furniture · closes 30 Nov 2026, 5:00 pm Jamaica time · <Badge variant="open">Open</Badge></p>
    </div>
  );
}

type Step = { title: string; text: string; demo?: ReactNode };

function businessSteps(form: FormData, setForm: (data: FormData) => void): Step[] {
  return [
    { title: 'Post a tender', text: 'Give it a title, a category, a description and a closing time. Save it as a draft until it is ready.', demo: <SampleTender /> },
    { title: 'Attach the requirements form', text: 'Fill in the requirements form online, or upload your own. Try it here; nothing is saved.', demo: <FormFields schema={demoRequirementsForm} data={form} onChange={setForm} idPrefix="tour-requirements" /> },
    { title: 'Bids arrive sealed', text: 'Suppliers bid until the closing time. Nobody, not even you, can see a bid, or how many there are, before then.', demo: <div className="mt-4 rounded-xl border p-6"><p>Bids: <strong>sealed until 30 Nov 2026, 5:00 pm</strong></p></div> },
    {
      title: 'Bids open at the closing time',
      text: 'From the closing time you see every bid, with the supplier\'s name, amount, documents and proposal form.',
      demo: (
        <Table>
          <TableHeader><TableRow><TableHead>Supplier</TableHead><TableHead>Amount</TableHead></TableRow></TableHeader>
          <TableBody>
            <TableRow><TableCell>Sample Furniture Ltd</TableCell><TableCell>{formatAmount(98_000)}</TableCell></TableRow>
            <TableRow><TableCell>Sample Office Supplies</TableCell><TableCell>{formatAmount(104_500)}</TableCell></TableRow>
          </TableBody>
        </Table>
      ),
    },
    { title: 'Award one bid', text: 'Choose the winning bid. The others are marked unsuccessful. You can cancel an open or closed tender instead, with a reason.' },
  ];
}

function supplierSteps(form: FormData, setForm: (data: FormData) => void): Step[] {
  return [
    { title: 'Browse open tenders', text: 'Open tenders are listed soonest-closing first. Filter them by category.', demo: <SampleTender /> },
    { title: 'Open a tender', text: 'Read the description and the business\'s requirements form, and download its documents.' },
    { title: 'Fill in the proposal form', text: 'Describe what you will deliver and price it. Try it here; nothing is saved.', demo: <FormFields schema={demoProposalForm} data={form} onChange={setForm} idPrefix="tour-proposal" /> },
    { title: 'Submit your sealed bid', text: 'Enter the amount, attach your proposal, and submit before the closing time. A bid can\'t be changed afterwards.' },
    {
      title: 'Keep the receipt',
      text: 'You get a receipt with the exact submission time, on screen and by email. My bids shows every bid and its outcome.',
      demo: <Notice tone="success">Sample receipt: {formatAmount(98_000)}, submitted 28 Nov 2026, 2:14:07 pm Jamaica time.</Notice>,
    },
  ];
}

/** The tour as a dialog. Finishing or skipping records it for this role, so it shows once. */
export function Tour({ accountType, onClose }: { accountType: AccountType; onClose: () => void }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [demoForm, setDemoForm] = useState<FormData>({});
  const headingRef = useRef<HTMLHeadingElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const steps = accountType === 'business' ? businessSteps(demoForm, setDemoForm) : supplierSteps(demoForm, setDemoForm);
  const step = steps[stepIndex] ?? steps[0];

  // A native modal dialog keeps keyboard focus inside it and makes the page behind inert.
  useEffect(() => {
    if (!dialogRef.current?.open) dialogRef.current?.showModal();
  }, []);
  // Moves focus to each step's heading, so keyboard and screen-reader users follow along.
  useEffect(() => headingRef.current?.focus(), [stepIndex]);

  async function finish() {
    // The frame closes the tour whatever happens: if recording fails (for example, a deactivated
    // account), it shows again on the next visit instead of trapping the person now.
    await supabase.rpc('record_onboarding_completed', { completed_account_type: accountType });
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="tourHeading"
      // Escape: skip the tour, like the link.
      onCancel={(event) => {
        event.preventDefault();
        void finish();
      }}
      className="m-auto w-[min(36rem,calc(100vw-2rem))] max-w-none overflow-visible bg-transparent p-0 backdrop:bg-navy-dark/60 backdrop:backdrop-blur-sm"
    >
      {/* gap-0: the space differs between parts (more above the heading than below it), so each part sets its own margin. */}
      <Card className="max-h-[90vh] w-full gap-0 overflow-y-auto p-6">
        <p className="text-sm text-muted-foreground">How CaribbeanTender works for {accountType === 'business' ? 'businesses' : 'suppliers'} · step {stepIndex + 1} of {steps.length}</p>
        <h3 id="tourHeading" ref={headingRef} tabIndex={-1} className="mt-6 mb-3 text-base font-semibold text-navy-dark">{step?.title}</h3>
        <p>{step?.text}</p>
        {step?.demo}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {stepIndex > 0 && <Button type="button" variant="outline" onClick={() => setStepIndex(stepIndex - 1)}>Back</Button>}
          {stepIndex < steps.length - 1 ? (
            <Button type="button" onClick={() => setStepIndex(stepIndex + 1)}>Next</Button>
          ) : (
            <Button type="button" variant="gold" onClick={() => void finish()}>Finish</Button>
          )}
          <button type="button" className="cursor-pointer font-medium text-primary underline underline-offset-4" onClick={() => void finish()}>Skip the tour</button>
        </div>
      </Card>
    </dialog>
  );
}
