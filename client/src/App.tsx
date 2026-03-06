import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { WorkspacePage } from './pages/WorkspacePage'
import { ProcessingPage } from './pages/ProcessingPage'
import { EditorPage } from './pages/EditorPage'
import './index.css'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<WorkspacePage />} />
        <Route path="/processing/:jobId" element={<ProcessingPage />} />
        <Route path="/editor/:jobId" element={<EditorPage />} />
      </Routes>
    </BrowserRouter>
  )
}
