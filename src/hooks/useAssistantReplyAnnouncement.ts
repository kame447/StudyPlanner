import { useEffect, useRef, useState } from 'react';

interface ChatMessage { id: string; role: string; content: string }

/**
 * Text for a live region that announces only a new assistant reply: not the history present at mount, not a chat switch,
 * and not a re-render. An identical consecutive reply (a fixed message) still changes the text so it is announced again.
 */
export function useAssistantReplyAnnouncement(chatId: string | null | undefined, messages: readonly ChatMessage[]): string {
  const latest = [...messages].reverse().find((message) => message.role === 'assistant');
  const latestId = latest?.id ?? null;
  const latestText = latest?.content ?? '';
  const announced = useRef({ chatId, messageId: latestId });
  const [text, setText] = useState('');
  useEffect(() => {
    const previous = announced.current;
    announced.current = { chatId, messageId: latestId };
    if (previous.chatId !== chatId) { setText(''); return; }
    if (latestId !== null && latestId !== previous.messageId) {
      setText((current) => (current === latestText ? `${latestText} ` : latestText));
    }
  }, [chatId, latestId, latestText]);
  return text;
}
