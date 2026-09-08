import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

function App() {
  return (
    <main>
      <p>AgendaPro</p>
      <h1>A base para uma agenda profissional.</h1>
      <p>A interface de reservas chega na Entrega 5.</p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

