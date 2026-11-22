import React from 'react';
import ReactDOM from 'react-dom/client';
import { SingleFileApp } from './SingleFileApp.js';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SingleFileApp />
  </React.StrictMode>
);
