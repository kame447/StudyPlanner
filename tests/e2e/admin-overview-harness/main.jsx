import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  Activity,
  ArrowLeft,
  Bot,
  CalendarClock,
  ListTree,
  Settings,
  Users,
} from 'lucide-react';
import { AnnouncementsButton } from '../../../src/components/AnnouncementsButton';
import { ContactPage } from '../../../src/components/ContactPage';
import { AdminApp } from '../../../src/components/AdminApp';
import { ApplicationRouteRoot } from '../../../src/components/ApplicationRouteRoot';
import { AdminAiApiPage } from '../../../src/components/AdminAiApiPage';
import { AdminLogsPage } from '../../../src/components/AdminLogsPage';
import { AdminOverviewPage } from '../../../src/components/AdminOverviewPage';
import { AdminPlanningPage } from '../../../src/components/AdminPlanningPage';
import { AdminSystemPage } from '../../../src/components/AdminSystemPage';
import { AdminUserDetailPage } from '../../../src/components/AdminUserDetailPage';
import { AdminUsersPage } from '../../../src/components/AdminUsersPage';
import '../../../src/styles.css';
import '../../../src/styles/admin-phase5.css';
import '../../../src/styles/admin-phase6.css';
import '../../../src/styles/admin-phase7.css';
import '../../../src/styles/admin-phase8.css';

const params = new URLSearchParams(window.location.search);
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const view = params.get('view') ?? 'overview';
document.documentElement.dataset.theme = theme;

function navItem(icon, label, active = false) {
  return (
    <button
      className={`admin-console-nav-item${active ? ' active' : ''}`}
      type="button"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function content() {
  if (view === 'users') {
    return <AdminUsersPage navigate={(path) => { window.__adminHarnessNavigation = path; }} />;
  }
  if (view === 'user-detail') {
    return (
      <AdminUserDetailPage
        userId="actor-aaaaaaaa-1111-2222-3333-444444444444"
        navigate={(path) => { window.__adminHarnessNavigation = path; }}
      />
    );
  }
  if (view === 'ai') return <AdminAiApiPage />;
  if (view === 'planning') return <AdminPlanningPage />;
  if (view === 'logs') return <AdminLogsPage />;
  if (view === 'system') return <AdminSystemPage />;
  return <AdminOverviewPage navigate={(path) => { window.__adminHarnessNavigation = path; }} />;
}

function AdminConsoleHarness() {
  return (
    <div className="app-shell admin-app-shell">
      <div className="admin-console-layout">
        <aside className="admin-console-sidebar">
          <div className="admin-console-brand">
            <span className="admin-console-brand-mark" aria-hidden="true">S</span>
            <div>
              <strong>StudyPlanner</strong>
              <small>Admin Console</small>
            </div>
          </div>
          <nav className="admin-console-nav" aria-label="管理者画面ナビゲーション">
            {navItem(<Activity aria-hidden="true" size={19} />, 'Overview', view === 'overview')}
            {navItem(<Users aria-hidden="true" size={19} />, 'Users', view === 'users' || view === 'user-detail')}
            {navItem(<Bot aria-hidden="true" size={19} />, 'AI・API', view === 'ai')}
            {navItem(<CalendarClock aria-hidden="true" size={19} />, 'Planning', view === 'planning')}
            {navItem(<ListTree aria-hidden="true" size={19} />, 'Logs', view === 'logs')}
            {navItem(<Settings aria-hidden="true" size={19} />, 'System', view === 'system')}
          </nav>
          <div className="admin-console-sidebar-footer">
            <a href="#normal" className="admin-console-return-link">
              <ArrowLeft aria-hidden="true" size={18} />
              通常画面へ戻る
            </a>
            <span>read-only console</span>
          </div>
        </aside>
        <div className="admin-console-main">{content()}</div>
      </div>
    </div>
  );
}

const inquiryAuth = {
  available: true,
  getCurrentUser: () => null,
  subscribe(listener) {
    listener(params.get('state') === 'signed-out' ? null : { id: 'fixture-owner', requiresEmailVerification: false });
    window.__inquiryAuthSwitch = listener;
    return () => { delete window.__inquiryAuthSwitch; };
  },
  signOut: async () => {},
};
function ContactHarness() {
  const [visible, setVisible] = React.useState(true);
  React.useEffect(() => { window.__inquiryVisible = setVisible; return () => { delete window.__inquiryVisible; }; }, []);
  return visible ? <ContactPage authSession={inquiryAuth} /> : <p>別画面</p>;
}
function AnnouncementsHarness() {
  const [owner, setOwner] = React.useState('fixture-owner');
  React.useEffect(() => { window.__announcementSwitchOwner = setOwner; return () => { delete window.__announcementSwitchOwner; }; }, []);
  return <main><h1>ホーム</h1><AnnouncementsButton key={owner} userId={owner} /><button type="button">背景の操作</button></main>;
}
if (view === 'announcements-admin' || view === 'admin-return') window.history.replaceState({}, '', `/admin/announcements${window.location.search}`);
if (view === 'inquiries') {
  window.history.replaceState({}, '', `/admin/inquiries${window.location.search}`);
}
ReactDOM.createRoot(document.getElementById('root')).render(
  view === 'admin-return' ? <ApplicationRouteRoot authSession={inquiryAuth} /> : view === 'announcements' ? <AnnouncementsHarness /> : view === 'announcements-admin' ? <AdminApp authSession={inquiryAuth} /> : view === 'contact' ? <ContactHarness />
    : view === 'inquiries' ? <AdminApp authSession={inquiryAuth} /> : <AdminConsoleHarness />,
);
