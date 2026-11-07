export interface ConversationSyncUi {
  status: 'checking' | 'disabled' | 'loading' | 'locked' | 'synced' | 'pending' | 'offline' | 'conflict' | 'error';
  message: string;
  unpersisted: boolean;
  remoteDeleted: boolean;
  localText: string;
  remoteText: string;
  enable(): Promise<void>;
  retry(): Promise<void>;
  resolve(choice: 'local' | 'remote'): Promise<void>;
}
