import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { FeedbackProvider } from './ui.tsx';
import { QuickCapture } from './views/QuickCapture.tsx';
import './styles.css';

const capture = window.location.hash === '#capture';
document.documentElement.classList.toggle('capture-window', capture);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FeedbackProvider>{capture ? <QuickCapture /> : <App />}</FeedbackProvider>
  </StrictMode>,
);
