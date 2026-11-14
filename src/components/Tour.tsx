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
    <div className="card">
      <strong>Sample: 40 ergonomic office chairs</strong>
      <p className="small">Office furniture · closes 30 Nov 2026, 5:00 pm Jamaica time · <span className="badge open">Open</span></p>
    </div>
  );
}

type Step = { title: string; text: string; demo?: ReactNode };

function businessSteps(form: FormData, setForm: (data: FormData) => void): Step[] {
  return [
    { title: 'Post a tender', text: 'Give it a title, a category, a description and a closing time. Save it as a draft until it is ready.', demo: <SampleTender /> },
    { title: 'Attach the requirements form', text: 'Fill in the requirements form online, or upload your own. Try it here; nothing is saved.', demo: <FormFields schema={demoRequirementsForm} data={form} onChange={setForm} idPrefix="tour-requirements" /> },
    { title: 'Bids arrive sealed', text: 'Suppliers bid until the closing time. Nobody, not even you, can see a bid, or how many there are, before then.', demo: <div className="card"><p>Bids: <strong>sealed until 30 Nov 2026, 5:00 pm</strong></p></div> },
    {
      title: 'Bids open at the closing time',
      text: 'From the closing time you see every bid, with the supplier\'s name, amount, documents and proposal form.',
      demo: (
        <table className="table">
          <thead><tr><th>Supplier</th><th>Amount</th></tr></thead>
          <tbody>
            <tr><td>Sample Furniture Ltd</td><td>{formatAmount(98_000)}</td></tr>
            <tr><td>Sample Office Supplies</td><td>{formatAmount(104_500)}</td></tr>
          </tbody>
        </table>
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
      demo: <div className="notice success">Sample receipt: {formatAmount(98_000)}, submitted 28 Nov 2026, 2:14:07 pm Jamaica time.</div>,
    },
  ];
}

/** The tour as a dialog. Finishing or skipping records it for this role, so it shows once. */
export function Tour({ accountType, onClose }: { accountType: AccountType; onClose: () => void }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [demoForm, setDemoForm] = useState<FormData>({});
  const headingRef = useRef<HTMLHeadingElement>(null);
  const steps = accountType === 'business' ? businessSteps(demoForm, setDemoForm) : supplierSteps(demoForm, setDemoForm);
  const step = steps[stepIndex] ?? steps[0];

  // Moves focus to each step's heading, so keyboard and screen-reader users follow along.
  useEffect(() => headingRef.current?.focus(), [stepIndex]);

  async function finish() {
    // If recording fails (for example, a deactivated account), the tour still closes for now.
    await supabase.rpc('record_onboarding_completed', { completed_account_type: accountType });
    onClose();
  }

  return (
    <div className="tour-backdrop">
      <div className="tour card" role="dialog" aria-modal="true" aria-labelledby="tourHeading" onKeyDown={(event) => event.key === 'Escape' && void finish()}>
        <p className="small">How CaribbeanTender works for {accountType === 'business' ? 'businesses' : 'suppliers'} · step {stepIndex + 1} of {steps.length}</p>
        <h3 id="tourHeading" ref={headingRef} tabIndex={-1}>{step?.title}</h3>
        <p>{step?.text}</p>
        {step?.demo}
        <div className="actions">
          {stepIndex > 0 && <button type="button" className="btn outline" onClick={() => setStepIndex(stepIndex - 1)}>Back</button>}
          {stepIndex < steps.length - 1 ? (
            <button type="button" className="btn" onClick={() => setStepIndex(stepIndex + 1)}>Next</button>
          ) : (
            <button type="button" className="btn gold" onClick={() => void finish()}>Finish</button>
          )}
          <button type="button" className="link-button" onClick={() => void finish()}>Skip the tour</button>
        </div>
      </div>
    </div>
  );
}
