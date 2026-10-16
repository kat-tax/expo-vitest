// A model of rules for the agent: it reads the screen as the agent sends it
// and answers as a model would, with no key and no cost, so an explore of
// the app runs anywhere. It knows one explore: a sign-in with a wrong
// password, and whether the app says so.
import type {Completion, CompletionRequest, Message, Model} from 'expo-vitest/agent';

const usage = {input: 0, output: 0, cacheRead: 0, cacheWrite: 0};
/** How long the model takes over the look after the press, in ms, as a real model's answer would. */
const THINKING = 2000;
let made = 0;

const calls = (name: string, input: unknown): Completion => ({text: '', toolCalls: [{id: `toolu_rule_${(made += 1)}`, name, input}], stopReason: 'tool_use', usage, model: 'testapp-rules'});

/** Every text the request carries, in order: each turn's and each result's. */
function textsOf(messages: readonly Message[]): string[] {
  return messages.flatMap(message => {
    if (message.role === 'system') return [message.content];
    if (message.role === 'assistant') return [];
    return message.content.flatMap(part => {
      if (part.type === 'text') return [part.text];
      if (part.type === 'tool_result') return part.content.flatMap(each => (each.type === 'text' ? [each.text] : []));
      return [];
    });
  });
}

/**
 * The ref of the node of a kind and a name, from the latest text that shows
 * it: an action answers a diff of the view, whose lines carry a mark before
 * the ref.
 */
function refOf(texts: readonly string[], kind: string, name: string): string {
  const wanted = `  ${kind}  ${JSON.stringify(name)}`;
  const line = texts.flatMap(text => text.split('\n')).findLast(each => each.includes(wanted));
  const ref = line?.trim().split(/\s+/).find(token => token.startsWith('@'));
  if (!ref) throw new Error(`no view shows ${kind} ${JSON.stringify(name)}:\n${texts.at(-1)}`);
  return ref;
}

export const rules: Model = {
  id: 'testapp-rules',
  async complete(request: CompletionRequest): Promise<Completion> {
    const texts = textsOf(request.messages);
    const acted = request.messages.filter(message => message.role === 'assistant').length;
    // To sign-in, a look, the demo email with a wrong password, the press, a
    // look once the pretend server has had the moment a real model's answer
    // takes, and what the app said.
    if (acted === 0) return calls('navigate', {url: '/sign-in'});
    if (acted === 1) return calls('observe', {});
    if (acted === 2) return calls('type', {ref: refOf(texts, 'textbox', 'Email'), text: 'ada@example.com', replace: true});
    if (acted === 3) return calls('type', {ref: refOf(texts, 'textbox', 'Password'), text: 'not-the-password', replace: true});
    if (acted === 4) return calls('tap', {ref: refOf(texts, 'button', 'Sign in')});
    if (acted === 5) {
      await new Promise(resolve => setTimeout(resolve, THINKING));
      return calls('observe', {});
    }
    const said = texts.join('\n').includes('The email or the password is wrong.');
    if (acted === 6 && !said) {
      return calls('report_finding', {
        severity: 'issue',
        title: 'A wrong password is not refused',
        expected: 'a message that the email or the password is wrong',
        observed: 'no such message',
        steps: ['open /sign-in', 'type ada@example.com and a wrong password', 'tap Sign in'],
      });
    }
    return calls('complete_step', {
      status: 'passed',
      summary: said ? 'Signed in with a wrong password; the app said the email or the password is wrong.' : 'Signed in with a wrong password; the app said nothing of it.',
      errorCode: null,
    });
  },
};
