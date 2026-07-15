import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AdminApp } from './components/AdminApp';
import { scheduleAppViewPreload } from './lib/preloadAppViews';
import './styles.css';

const currentPath = window.location.pathname;
const isAdminRoute = currentPath === '/admin' || currentPath.startsWith('/admin/');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isAdminRoute ? <AdminApp /> : <App />}
  </React.StrictMode>,
);

if (!isAdminRoute) {
  scheduleAppViewPreload();
}
