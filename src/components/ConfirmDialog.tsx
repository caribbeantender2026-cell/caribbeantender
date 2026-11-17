/**
 * The app's own "are you sure?" dialog, in place of the browser's confirm() and prompt() pop-ups, which
 * can't be styled and read "localhost says". A native <dialog>, so Escape, focus and the dimmed page come
 * from the browser.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from './ui/button.tsx';

const maximumReasonLength = 1000;

/** What to ask: a question, what happens next, and the words on the confirm button. */
export type ConfirmationRequest = {
  title: string;
  message: string;
  confirmLabel: string;
  /** The button that keeps things as they are; "Cancel" unless that would clash, as with "Cancel tender". */
  cancelLabel?: string;
  /** Red for actions that remove or stop something; gold for actions that go ahead. */
  tone?: 'danger' | 'go-ahead';
  /** When set, the dialog asks for a written reason under this label, and won't confirm without one. */
  reasonLabel?: string;
};

/** The person's answer, and the reason they wrote when one was asked for (empty otherwise). */
export type ConfirmationAnswer = { isConfirmed: boolean; reason: string };

/**
 * A dialog to render once in the page, and an ask() that opens it and resolves with the answer: confirmed,
 * or not (cancelled, Escape, or closed). Like confirm() and prompt(), but in the app's own design.
 */
export function useConfirmation(): [ReactNode, (request: ConfirmationRequest) => Promise<ConfirmationAnswer>] {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const answerRef = useRef<((answer: ConfirmationAnswer) => void) | null>(null);
  const [request, setRequest] = useState<ConfirmationRequest | null>(null);
  const [reason, setReason] = useState('');
  const titleId = useId();
  const reasonId = useId();

  const ask = useCallback(
    (nextRequest: ConfirmationRequest) =>
      new Promise<ConfirmationAnswer>((resolve) => {
        answerRef.current = resolve;
        setReason('');
        setRequest(nextRequest);
      }),
    [],
  );

  useEffect(() => {
    if (request && !dialogRef.current?.open) dialogRef.current?.showModal();
  }, [request]);

  /** Gives the waiting ask() its answer once, then closes the dialog. */
  function answer(isConfirmed: boolean) {
    answerRef.current?.({ isConfirmed, reason: isConfirmed ? reason.trim() : '' });
    answerRef.current = null;
    if (dialogRef.current?.open) dialogRef.current.close();
    setRequest(null);
  }

  const needsReason = request?.reasonLabel !== undefined && reason.trim() === '';
  const dialog = (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      // Escape and any other way of closing count as "no".
      onClose={() => answer(false)}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border bg-card p-0 text-ink shadow-[0_24px_60px_-16px_rgb(0_23_58/0.45)] backdrop:bg-navy-dark/40 backdrop:backdrop-blur-[2px]"
    >
      {request && (
        <form
          className="grid gap-5 p-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (!needsReason) answer(true);
          }}
        >
          <div className="grid gap-2">
            <h2 id={titleId} className="text-lg font-semibold text-navy-dark">{request.title}</h2>
            <p className="text-sm leading-relaxed text-ink/70">{request.message}</p>
          </div>
          {request.reasonLabel !== undefined && (
            <div className="grid gap-2">
              <label htmlFor={reasonId} className="text-sm font-medium">{request.reasonLabel}</label>
              <textarea
                id={reasonId}
                rows={3}
                maxLength={maximumReasonLength}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                autoFocus
              />
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {/* Focus starts on the safe choice (or the reason box), so pressing Enter by habit changes nothing. */}
            <Button type="button" variant="outline" autoFocus={request.reasonLabel === undefined} onClick={() => answer(false)}>
              {request.cancelLabel ?? 'Cancel'}
            </Button>
            <Button type="submit" variant={request.tone === 'danger' ? 'destructive' : 'gold'} disabled={needsReason}>
              {request.confirmLabel}
            </Button>
          </div>
        </form>
      )}
    </dialog>
  );
  return [dialog, ask];
}
