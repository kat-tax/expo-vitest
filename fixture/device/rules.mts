// A model of rules, for the fixture's agent tests: it reads the screen as
// the agent sends it and answers as a model would, with no key and no cost,
// so the tests run anywhere. It knows one app, the sign-in page, and the
// steps the tests give it.
import type {Completion, CompletionRequest, Message, Model} from 'expo-vitest/agent';

const usage = {input: 0, output: 0, cacheRead: 0, cacheWrite: 0};
let made = 0;

const calls = (name: string, input: unknown): Completion => ({text: '', toolCalls: [{id: `toolu_rule_${(made += 1)}`, name, input}], stopReason: 'tool_use', usage, model: 'fixture-rules'});
const says = (text: string): Completion => ({text, toolCalls: [], stopReason: 'end', usage, model: 'fixture-rules'});

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

/** The ref a view gives the node of a kind and a name. */
function refOf(view: string, kind: string, name: string): string {
  const line = view.split('\n').find(each => each.includes(`  ${kind}  ${JSON.stringify(name)}`));
  if (!line) throw new Error(`the view has no ${kind} ${JSON.stringify(name)}:\n${view}`);
  return line.trim().split(/\s+/)[0] as string;
}

export const rules: Model = {
  id: 'fixture-rules',
  async complete(request: CompletionRequest): Promise<Completion> {
    const texts = textsOf(request.messages);
    const all = texts.join('\n');
    // A judgment: the welcome heading is what the tests assert, wait for and read.
    if (request.tools.some(tool => tool.name === 'verdict')) {
      const shown = all.includes('"Welcome, ada"');
      return calls('verdict', {verdict: shown ? 'pass' : 'fail', explanation: shown ? 'The heading reads Welcome, ada.' : 'No heading welcomes ada.'});
    }
    if (request.format) {
      const name = /"Welcome, ([^"]+)"/.exec(all)?.[1];
      return says(JSON.stringify(name ? {found: true, value: name, explanation: 'The welcome heading names them.'} : {found: false, value: null, explanation: 'No welcome heading shows.'}));
    }
    // The second run replays what the first recorded, and asks no model to act.
    if (process.env.FIXTURE_AGENT_REPLAY) throw new Error('the replay run asked the model to act');
    const [instruction = '', view = ''] = texts;
    const acted = request.messages.filter(message => message.role === 'assistant').length;
    if (instruction.startsWith('Instruction: fill the recovery code')) {
      if (acted === 0) return calls('type_secret', {ref: refOf(view, 'textbox', 'Recovery code'), secret: 'FIXTURE_RECOVERY'});
      return calls('complete_step', {status: 'passed', summary: 'Filled the recovery code.', errorCode: null});
    }
    const user = /sign in as (\S+)/.exec(instruction)?.[1] ?? '';
    if (acted === 0) return calls('type', {ref: refOf(view, 'textbox', 'Email'), text: user, replace: true});
    if (acted === 1) return calls('type_secret', {ref: refOf(view, 'textbox', 'Recovery code'), secret: 'FIXTURE_RECOVERY'});
    if (acted === 2) return calls('type_secret', {ref: refOf(view, 'textbox', 'Password'), secret: 'FIXTURE_PASSWORD'});
    if (acted === 3) return calls('tap', {ref: refOf(view, 'button', 'Sign in')});
    const signedIn = all.includes(`"Welcome, ${user}"`);
    return calls('complete_step', {status: signedIn ? 'passed' : 'failed', summary: signedIn ? `Signed in as ${user}.` : 'No welcome showed.', errorCode: signedIn ? null : 'ASSERTION_FAILED'});
  },
};
