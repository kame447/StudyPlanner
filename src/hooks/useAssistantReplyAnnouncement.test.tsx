import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it } from 'vitest';
import { useAssistantReplyAnnouncement } from './useAssistantReplyAnnouncement';

type Message = { id: string; role: string; content: string };
const message = (id: string, role: string, content: string): Message => ({ id, role, content });
let renderer: ReactTestRenderer | undefined;
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; });

function Probe({ chatId, messages, onText }: { chatId: string; messages: Message[]; onText: (text: string) => void }) {
  onText(useAssistantReplyAnnouncement(chatId, messages));
  return null;
}
function mount(chatId: string, messages: Message[]) {
  let text = '';
  const onText = (value: string) => { text = value; };
  act(() => { renderer = create(<Probe chatId={chatId} messages={messages} onText={onText} />); });
  return { text: () => text, update(nextChat: string, next: Message[]) { act(() => renderer!.update(<Probe chatId={nextChat} messages={next} onText={onText} />)); } };
}

const history = [message('u1', 'user', '数学を1時間'), message('a1', 'assistant', '最初の返信')];

it('is silent for the history present at mount and for a re-render of the same messages', () => {
  const probe = mount('chat-1', history);
  expect(probe.text()).toBe('');
  probe.update('chat-1', [...history]);
  expect(probe.text()).toBe('');
});

it('announces the text of a new assistant reply once, and ignores a user message', () => {
  const probe = mount('chat-1', history);
  const withUser = [...history, message('u2', 'user', 'もう一つ')];
  probe.update('chat-1', withUser);
  expect(probe.text()).toBe('');
  probe.update('chat-1', [...withUser, message('a2', 'assistant', '新しい返信')]);
  expect(probe.text()).toBe('新しい返信');
  probe.update('chat-1', [...withUser, message('a2', 'assistant', '新しい返信')]);
  expect(probe.text()).toBe('新しい返信');
});

it('changes the text for an identical consecutive reply so it is announced again', () => {
  const probe = mount('chat-1', history);
  const first = [...history, message('a2', 'assistant', '同じ文')];
  probe.update('chat-1', first);
  const firstText = probe.text();
  probe.update('chat-1', [...first, message('u2', 'user', 'もう一度'), message('a3', 'assistant', '同じ文')]);
  expect(probe.text()).not.toBe(firstText);
  expect(probe.text().trim()).toBe('同じ文');
});

it('does not announce the replies of another chat after a chat switch', () => {
  const probe = mount('chat-1', history);
  probe.update('chat-1', [...history, message('a2', 'assistant', '新しい返信')]);
  expect(probe.text()).toBe('新しい返信');
  probe.update('chat-2', [message('b1', 'assistant', '別のチャットの返信')]);
  expect(probe.text()).toBe('');
});
