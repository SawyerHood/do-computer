// The one line a chat keeps of a sign-in with a saved login or a payment with a saved card. A
// port of apps/web/src/lib/passwords.ts `keptLine`, which lives in the React app and not in the
// protocol, so it cannot be mounted here; keep the two the same.
import type { PayDetails, SignInDetails } from '../protocol/passwords.ts';
import type { MessagePart } from '../protocol/chat.ts';

const SIGNED: readonly string[] = ['signing_in', 'signed_in', 'wrong_site', 'no_form', 'still_asking', 'failed'];
const PAID: readonly string[] = ['paying', 'sent', 'no_form', 'still_asking', 'failed'];

function signInOf(part: MessagePart): SignInDetails['signIn'] | undefined {
  if (part.type !== 'tool' || part.name !== 'sign_in') return undefined;
  const signIn = (part.details as Partial<SignInDetails> | null | undefined)?.signIn;
  return typeof signIn === 'object' && signIn !== null && typeof signIn.username === 'string' &&
    typeof signIn.login === 'string' && (signIn.site === null || typeof signIn.site === 'string') &&
    SIGNED.includes(signIn.outcome)
    ? signIn
    : undefined;
}

function payOf(part: MessagePart): PayDetails['pay'] | undefined {
  if (part.type !== 'tool' || part.name !== 'pay') return undefined;
  const pay = (part.details as Partial<PayDetails> | null | undefined)?.pay;
  return typeof pay === 'object' && pay !== null && typeof pay.card === 'string' &&
    (pay.site === null || typeof pay.site === 'string') && PAID.includes(pay.outcome)
    ? pay
    : undefined;
}

export type Kept = { of: 'sign-in' | 'pay'; words: string; going: boolean; refused: boolean };

/** Undefined for every other part, and for a call that carries nothing yet. */
export function keptLine(part: MessagePart): Kept | undefined {
  if (part.type !== 'tool') return undefined;
  const running = part.status === 'pending' || part.status === 'running';
  const line = (of: Kept['of'], words: string, refused = false): Kept => ({ of, words, going: false, refused });
  const signIn = signInOf(part);
  if (signIn !== undefined) {
    const { site, username, login } = signIn;
    const to = site === null ? '' : ` to ${site}`;
    switch (signIn.outcome) {
      case 'signing_in':
        return running ? { of: 'sign-in', words: `Signing in${to} as ${username}…`, going: true, refused: false } : line('sign-in', `Stopped while signing in${to}`);
      case 'signed_in':
        return line('sign-in', `Signed in${to} as ${username}`);
      case 'wrong_site':
        return line('sign-in', `Did not sign in: this page is ${site === null ? 'not' : `${site}, not`} one the login ${login} is for`, true);
      case 'no_form':
        return line('sign-in', `Did not sign in: no password box on ${site ?? 'the page'}`);
      case 'still_asking':
        return line('sign-in', `${site ?? 'The page'} still asks to sign in`);
      case 'failed':
        return line('sign-in', `Could not sign in${to}`);
    }
  }
  const pay = payOf(part);
  if (pay === undefined) return undefined;
  const { site, card } = pay;
  const on = site === null ? '' : ` on ${site}`;
  switch (pay.outcome) {
    case 'paying':
      return running ? { of: 'pay', words: `Paying${on} with ${card}…`, going: true, refused: false } : line('pay', `Stopped while paying${on}`);
    case 'sent':
      return line('pay', `Typed ${card}${on} and pressed the button`);
    case 'no_form':
      return line('pay', `Did not pay: no card boxes on ${site ?? 'the page'}`);
    case 'still_asking':
      return line('pay', `${site ?? 'The page'} did not take the payment`);
    case 'failed':
      return line('pay', `Could not pay${on}`);
  }
}
