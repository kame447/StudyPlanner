import { useEffect, useRef, useState } from 'react';
import { INQUIRY_ATTACHMENT_LIMIT } from '../../shared/inquiryAttachments';
import { inquiryAttachmentsAvailable, prepareInquiryAttachments, type PreparedInquiryAttachment } from '../services/inquiryAttachmentService';
import '../styles/support-inquiries.css';

function LocalPhoto({ photo, index }: { photo: PreparedInquiryAttachment; index: number }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const next = URL.createObjectURL(photo.file); setUrl(next);
    return () => { URL.revokeObjectURL(next); };
  }, [photo.file]);
  return url ? <img className="inquiry-photo-preview" src={url} alt={`添付予定の写真${index + 1}`} /> : null;
}

export function InquiryPhotoPicker({ photos, disabled, onChange, onPreparing }: {
  photos: PreparedInquiryAttachment[];
  disabled: boolean;
  onChange: (photos: PreparedInquiryAttachment[]) => void;
  onPreparing: (preparing: boolean) => void;
}) {
  const [availability, setAvailability] = useState<'checking' | 'available' | 'unavailable'>('checking');
  const [error, setError] = useState('');
  const [preparing, setPreparing] = useState(false);
  const active = useRef(true);
  const selection = useRef(0);
  const preparingRef = useRef(false);
  const checkAvailability = async () => {
    setAvailability('checking');
    const available = await inquiryAttachmentsAvailable();
    if (active.current) setAvailability(available ? 'available' : 'unavailable');
  };
  useEffect(() => {
    active.current = true;
    void checkAvailability();
    return () => { active.current = false; selection.current += 1; };
  }, []);

  const choose = async (files: File[]) => {
    if (disabled || preparingRef.current || files.length === 0) return;
    if (photos.length + files.length > INQUIRY_ATTACHMENT_LIMIT) { setError('写真は3枚まで添付できます。'); return; }
    const request = ++selection.current;
    preparingRef.current = true; setPreparing(true); onPreparing(true); setError('');
    try {
      const next = await prepareInquiryAttachments(files);
      if (active.current && request === selection.current) onChange([...photos, ...next]);
    } catch (reason) {
      if (active.current && request === selection.current) setError(reason instanceof Error ? reason.message : '写真を確認できませんでした。');
    } finally {
      if (active.current && request === selection.current) {
        preparingRef.current = false; setPreparing(false); onPreparing(false);
      }
    }
  };

  return <section className="inquiry-photo-picker" aria-label="写真の添付">
    <label className="field" htmlFor="inquiry-photos"><span>写真（任意・3枚まで）</span>
      <input id="inquiry-photos" type="file" accept="image/jpeg,image/png" multiple
        disabled={disabled || preparing || photos.length >= INQUIRY_ATTACHMENT_LIMIT || availability !== 'available'}
        aria-describedby="inquiry-photo-guidance"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          void choose(files);
        }} />
    </label>
    <p id="inquiry-photo-guidance" className="detail-note">JPEG・PNG、1枚5MBまで。一辺8192px・2400万画素以内。写真は管理者だけが開けます。位置情報などの画像内の情報も送信されるため、機密情報が写っていないか確認してください。</p>
    {availability === 'checking' && <p className="detail-note" role="status">写真の添付を確認しています</p>}
    {availability === 'unavailable' && <p className="detail-note">写真の添付は現在利用できません。本文のみ送信できます。 <button type="button" className="ghost-button" disabled={disabled} onClick={() => { void checkAvailability(); }}>再確認</button></p>}
    {preparing && <p role="status">写真を確認しています</p>}
    {error && <p role="alert">{error}</p>}
    {photos.length > 0 && <ul className="inquiry-photo-list">{photos.map((photo, index) => <li key={`${photo.descriptor.sha256}-${index}`}>
      <LocalPhoto photo={photo} index={index} />
      <span>写真{index + 1}（{(photo.descriptor.byteLength / 1024 / 1024).toFixed(1)}MB）</span>
      <button className="ghost-button" type="button" disabled={disabled || preparing} aria-label={`写真${index + 1}を取り除く`} onClick={() => onChange(photos.filter((_, position) => index !== position))}>取り除く</button>
    </li>)}</ul>}
  </section>;
}
