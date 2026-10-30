import { UserFacingError } from './userFacingError';
import { parseMaterialContentsPhotoResult, type MaterialContentsRow } from '../../shared/materialContentsPhoto';
import { createAiImageFilePayload } from './aiImageAttachment';
import { getCloudflareAiProxyUrl } from './aiConfig';
import { getFirebaseAuth } from './firebaseClient';
import { buildPlanningImageAttachmentEndpoint } from './planningImageAttachment';
import type { MaterialStructureItem } from './bookshelfMaterialDetails';
import { createId } from './id';

export function materialContentsToStructure(items: MaterialContentsRow[], includePageRanges = true): MaterialStructureItem[] {
  const validated = parseMaterialContentsPhotoResult({ items });
  if (!validated) throw new UserFacingError('章・節の階層、見出し、ページ番号を確認してください。');
  const roots: MaterialStructureItem[] = [];
  const parents: MaterialStructureItem[] = [];
  for (const row of validated.items) {
    const item: MaterialStructureItem = {
      id: createId('material-structure'), title: row.title,
      ...(!includePageRanges || row.startPage === null ? {} : { startUnit: row.startPage }),
      ...(!includePageRanges || row.endPage === null ? {} : { endUnit: row.endPage }),
    };
    if (row.level === 1) roots.push(item);
    else (parents[row.level - 2].children ??= []).push(item);
    parents[row.level - 1] = item;
    parents.length = row.level;
  }
  return roots;
}

export async function extractMaterialContentsPhoto(file: File, signal: AbortSignal): Promise<MaterialContentsRow[]> {
  const proxyUrl = getCloudflareAiProxyUrl();
  const user = getFirebaseAuth()?.currentUser;
  if (!proxyUrl || !user) throw new UserFacingError('画像の読取にはログインとAI接続が必要です。');
  const payload = await createAiImageFilePayload(file);
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  try {
    const token = await user.getIdToken();
    const response = await fetch(buildPlanningImageAttachmentEndpoint(proxyUrl), {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ mimeType: payload.mimeType, base64: payload.base64, purpose: 'material_contents_photo' }),
    });
    const body = await response.json() as { result?: unknown };
    const result = response.ok ? parseMaterialContentsPhotoResult(body.result) : null;
    if (!result) throw new UserFacingError(response.status === 429
      ? '画像読取の利用上限です。時間をおいてお試しください。'
      : '目次を読み取れませんでした。鮮明な目次写真でもう一度お試しください。');
    return result.items;
  } catch (error) {
    if (signal.aborted) throw error;
    throw error instanceof UserFacingError ? error : new UserFacingError('目次を読み取れませんでした。通信を確認するか、手入力してください。');
  }
}
