import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App.tsx'
import { ArcanaDefs } from './components/Arcana.tsx'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ArcanaDefs />
    <App />
  </React.StrictMode>,
)
