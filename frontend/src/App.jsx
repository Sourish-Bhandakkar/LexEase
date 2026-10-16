import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import WhyLexEase from './pages/WhyLexEase'
import About from './pages/About'
import AdaptiveLearning from './pages/AdaptiveLearning'
import AdaptiveLearningAdmin from './pages/AdaptiveLearningAdmin'
import ClauseDraftingPage from './pages/ClauseDraftingPage'

function App() {
  return (
    <Router>
      <div className="flex flex-col min-h-screen bg-[#F8FAF8] text-[#16221C] font-sans selection:bg-[#176B4D]/15">
        <main className="flex-grow">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/why-lexease" element={<WhyLexEase />} />
            <Route path="/about" element={<About />} />
            <Route path="/adaptive-learning" element={<AdaptiveLearning />} />
            <Route path="/adaptive-learning/admin" element={<AdaptiveLearningAdmin />} />
            <Route path="/clause-drafting" element={<ClauseDraftingPage />} />
            <Route path="/draft" element={<ClauseDraftingPage />} />
          </Routes>
        </main>
      </div>
    </Router>
  )
}

export default App
