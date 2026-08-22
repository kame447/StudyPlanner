import { transcribePlanningVoice } from './planningVoiceTranscription';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike extends Array<SpeechRecognitionAlternativeLike> {
  isFinal: boolean;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorEventLike {
  error: string;
  message?: string;
}

type SpeechRecognitionResultHandler = ((event: SpeechRecognitionEventLike) => void) | null;
type SpeechRecognitionErrorHandler = ((event: SpeechRecognitionErrorEventLike) => void) | null;
type SpeechRecognitionEndHandler = (() => void) | null;

type SpeechRecognitionConstructorLike = new () => StudyPlannerSpeechRecognition;

type SpeechRecognitionWindowLike = Window & {
  SpeechRecognition?: SpeechRecognitionConstructorLike;
  webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
};

const MAX_RECORDING_MS = 30_000;
const AUDIO_MIME_TYPE_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
];

function resolveRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return AUDIO_MIME_TYPE_CANDIDATES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
}

function mapMicrophoneError(error: unknown): string {
  if (!(error instanceof DOMException)) return 'audio-capture';

  switch (error.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'not-allowed';
    case 'NotFoundError':
    case 'NotReadableError':
    case 'AbortError':
      return 'audio-capture';
    default:
      return 'audio-capture';
  }
}

class StudyPlannerSpeechRecognition {
  lang = 'ja-JP';
  continuous = false;
  interimResults = false;
  onresult: SpeechRecognitionResultHandler = null;
  onerror: SpeechRecognitionErrorHandler = null;
  onend: SpeechRecognitionEndHandler = null;

  private mediaRecorder: MediaRecorder | null = null;
  private mediaStream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private recordingTimer: number | null = null;
  private starting = false;
  private stopRequested = false;
  private aborted = false;
  private ended = true;

  start(): void {
    if (this.starting || (this.mediaRecorder && this.mediaRecorder.state !== 'inactive')) {
      throw new DOMException('Speech recognition has already started.', 'InvalidStateError');
    }

    this.starting = true;
    this.stopRequested = false;
    this.aborted = false;
    this.ended = false;
    this.chunks = [];
    void this.startRecording();
  }

  stop(): void {
    if (this.ended) return;

    if (this.starting && !this.mediaRecorder) {
      this.stopRequested = true;
      return;
    }

    if (this.mediaRecorder?.state === 'recording') {
      this.mediaRecorder.stop();
    }
  }

  abort(): void {
    if (this.ended) return;

    this.aborted = true;
    this.stopRequested = true;
    this.clearRecordingTimer();

    if (this.mediaRecorder?.state === 'recording') {
      this.mediaRecorder.stop();
      return;
    }

    if (!this.starting) {
      this.cleanupStream();
      this.emitError('aborted');
      this.emitEnd();
    }
  }

  private async startRecording(): Promise<void> {
    try {
      if (!window.isSecureContext) {
        this.starting = false;
        this.emitError(
          'not-allowed',
          '音声入力にはHTTPSが必要です。スマホ実機ではhttps://の開発URLを使用してください。',
        );
        this.emitEnd();
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        this.starting = false;
        this.emitError(
          'audio-capture',
          'このブラウザでは録音機能を利用できません。マイク対応ブラウザとHTTPS接続を確認してください。',
        );
        this.emitEnd();
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      this.mediaStream = stream;

      if (this.aborted || this.stopRequested) {
        this.starting = false;
        this.cleanupStream();
        if (this.aborted) this.emitError('aborted');
        this.emitEnd();
        return;
      }

      const mimeType = resolveRecorderMimeType();
      this.mediaRecorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      this.mediaRecorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) this.chunks.push(event.data);
      });
      this.mediaRecorder.addEventListener('error', () => {
        this.clearRecordingTimer();
        this.cleanupStream();
        this.emitError('audio-capture', '録音中にマイクエラーが発生しました。');
        this.emitEnd();
      });
      this.mediaRecorder.addEventListener('stop', () => {
        void this.finishRecording();
      }, { once: true });

      this.mediaRecorder.start(250);
      this.starting = false;
      this.recordingTimer = window.setTimeout(() => this.stop(), MAX_RECORDING_MS);
    } catch (error) {
      this.starting = false;
      this.cleanupStream();
      this.emitError(mapMicrophoneError(error));
      this.emitEnd();
    }
  }

  private async finishRecording(): Promise<void> {
    this.clearRecordingTimer();
    const mimeType = this.mediaRecorder?.mimeType || this.chunks[0]?.type || 'audio/webm';
    const audioBlob = new Blob(this.chunks, { type: mimeType });
    this.mediaRecorder = null;
    this.chunks = [];
    this.cleanupStream();

    if (this.aborted) {
      this.emitError('aborted');
      this.emitEnd();
      return;
    }

    if (audioBlob.size === 0) {
      this.emitError('no-speech');
      this.emitEnd();
      return;
    }

    try {
      const result = await transcribePlanningVoice(audioBlob);
      if (!result.text) {
        this.emitError('no-speech');
        return;
      }
      this.emitResult(result.text);
    } catch (error) {
      this.emitError(
        'service-error',
        error instanceof Error
          ? error.message
          : '音声文字起こしに失敗しました。もう一度お試しください。',
      );
    } finally {
      this.emitEnd();
    }
  }

  private emitResult(transcript: string): void {
    const alternative: SpeechRecognitionAlternativeLike = { transcript };
    const result = Object.assign([alternative], { isFinal: true }) as SpeechRecognitionResultLike;
    const results: SpeechRecognitionResultLike[] = [result];
    this.onresult?.({ resultIndex: 0, results });
  }

  private emitError(error: string, message?: string): void {
    this.onerror?.({ error, ...(message ? { message } : {}) });
  }

  private emitEnd(): void {
    if (this.ended) return;
    this.ended = true;
    this.starting = false;
    this.stopRequested = false;
    this.clearRecordingTimer();
    this.onend?.();
  }

  private cleanupStream(): void {
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.mediaStream = null;
  }

  private clearRecordingTimer(): void {
    if (this.recordingTimer === null) return;
    window.clearTimeout(this.recordingTimer);
    this.recordingTimer = null;
  }
}

export function installStudyPlannerSpeechRecognition(): void {
  if (typeof window === 'undefined') return;

  const speechWindow = window as SpeechRecognitionWindowLike;
  speechWindow.SpeechRecognition = StudyPlannerSpeechRecognition;
  speechWindow.webkitSpeechRecognition = StudyPlannerSpeechRecognition;
}
