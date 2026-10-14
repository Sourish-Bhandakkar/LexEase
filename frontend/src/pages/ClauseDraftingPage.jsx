import { useLocation, useNavigate } from 'react-router-dom'
import ClauseDrafting from '../components/ClauseDrafting'
import { getCurrentDocumentFile } from '../documentFileStore'

function ClauseDraftingPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const workspace = location.state?.workspace
  const documentData = workspace?.documentData

  if (!documentData?.clauses?.length) {
    return (
      <main className="min-h-screen bg-[#F8FAF8] px-4 py-12 text-[#16221C]">
        <section className="mx-auto max-w-xl space-y-4 rounded-2xl border border-[#D6E1D9] bg-white p-6 text-center shadow-sm">
          <h1 className="text-2xl font-bold">Draft Safer Clauses</h1>
          <p className="text-sm leading-relaxed text-[#526058]">
            Upload and analyze a document first. Then open this page from the document workspace to choose clauses for revision.
          </p>
          <button type="button" onClick={() => navigate('/')} className="rounded-lg bg-[#176B4D] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#10563D]">
            Go to document workspace
          </button>
        </section>
      </main>
    )
  }

  const sourceFile = workspace?.sourceFile || workspace?.selectedFile || getCurrentDocumentFile()
  const returnToAnalysis = () => navigate('/', { state: { workspace: { ...workspace, selectedFile: sourceFile, sourceFile } } })

  return (
    <div className="min-h-screen bg-[#F8FAF8] text-[#16221C]">
      <header className="border-b border-[#DCE6E0] bg-white">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#176B4D]">LexEase · Clause drafting</p>
            <h1 className="mt-1 text-lg font-bold">{documentData.filename}</h1>
          </div>
          <button type="button" onClick={returnToAnalysis} className="shrink-0 rounded-lg border border-[#D6E1D9] bg-white px-3.5 py-2 text-sm font-semibold text-[#176B4D] hover:bg-[#F3F7F5]">
            Back to analysis
          </button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl space-y-5 px-4 py-8 sm:px-6 lg:px-8">
        <section className="rounded-2xl border border-[#C8DECE] bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-2xl font-extrabold tracking-tight">Make selected clauses safer for your side</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[#526058]">
            Choose the medium or high risk clauses you want to renegotiate. LexEase will draft alternatives for your selected party; you can edit each suggestion before downloading the original PDF with a proposed wording addendum.
          </p>
        </section>
        <ClauseDrafting
          analysisData={workspace.clauseAnalysisData}
          clauses={documentData.clauses}
          filename={documentData.filename}
          sourceFile={sourceFile}
        />
      </main>
    </div>
  )
}

export default ClauseDraftingPage
