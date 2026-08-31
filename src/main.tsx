import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import { isTauri } from './lib/platform';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Only the browser build is installable; inside the Tauri window a service
// worker would sit between the app and its own assets for no benefit.
if (!isTauri() && 'serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((e) => {
      console.warn('offline support unavailable', e);
    });
  });
}
