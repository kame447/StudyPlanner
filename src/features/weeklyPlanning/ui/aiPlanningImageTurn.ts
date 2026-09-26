/** Keep the attachment name in display copy; the planner receives only the typed utterance. */
export function buildAiPlanningImageTurn(userText: string, fileName: string): {
  userText: string;
  displayText: string;
} {
  const utterance = userText.trim();
  return {
    userText: utterance || '画像をもとに学習計画を作って',
    displayText: utterance
      ? `${utterance}\n\n画像: ${fileName}`
      : `画像「${fileName}」をもとに学習計画を作って`,
  };
}
