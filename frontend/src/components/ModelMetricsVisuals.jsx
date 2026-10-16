import React from 'react'

export function getVersionStatusLabel(version, status, activeVersion) {
  const normStatus = (status || '').toLowerCase()
  const isActive = activeVersion && version === activeVersion

  if (isActive) {
    return 'Active'
  }
  if (normStatus === 'rejected') {
    return 'Rejected'
  }
  if (normStatus === 'promoted') {
    return 'Previously promoted'
  }
  if (normStatus === 'baseline') {
    return 'Baseline'
  }
  if (normStatus === 'candidate') {
    return 'Candidate'
  }
  if (normStatus === 'evaluated') {
    return 'Evaluated'
  }
  if (!normStatus) {
    return 'Unrecorded'
  }
  return normStatus.charAt(0).toUpperCase() + normStatus.slice(1)
}

export function ConfusionMatrix({ matrix, classes = ['low', 'medium', 'high'], sampleCount = null }) {
  if (!matrix || !Array.isArray(matrix) || matrix.length !== 3) {
    return (
      <div className="rounded-2xl border border-[#DCE6E0] bg-white p-5 text-sm text-[#66736C]">
        <p className="font-semibold text-[#12372A]">Confusion Matrix</p>
        <p className="mt-1 text-xs text-[#8C9A92]">
          Not measured for the active baseline checkpoint. Confusion matrices are recorded during candidate evaluations.
        </p>
      </div>
    )
  }

  const classLabels = {
    low: 'Low Risk',
    medium: 'Medium Risk',
    high: 'High Risk',
  }

  // Row totals from actual matrix cells
  const rowTotals = matrix.map((row) => row.reduce((sum, val) => sum + val, 0))
  const grandTotal = rowTotals.reduce((sum, val) => sum + val, 0)
  const recordedCount = grandTotal > 0 ? grandTotal : (Number.isFinite(sampleCount) ? sampleCount : null)

  return (
    <div className="rounded-2xl border border-[#DCE6E0] bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E8F1EC] pb-3">
        <div>
          <h3 className="text-base font-bold text-[#12372A]">Confusion Matrix</h3>
          <p className="text-xs text-[#66736C]">
            {recordedCount
              ? `Evaluated on ${recordedCount} held-out validation clauses.`
              : 'Evaluated on held-out validation clauses. Sample count not recorded.'}
          </p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-[#66736C]">
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded bg-[#E8F1EC] border border-[#A7F3D0]" />
            Correct classification
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded bg-[#FEE2E2] border border-[#FECACA]" />
            High-risk misclassified as Low
          </span>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-center text-xs">
          <thead>
            <tr>
              <th className="p-2 text-left font-semibold text-[#66736C]">Actual \ Predicted</th>
              {classes.map((cls) => (
                <th key={cls} className="p-2 font-bold text-[#12372A]">
                  {classLabels[cls] || cls}
                </th>
              ))}
              <th className="p-2 font-semibold text-[#66736C]">Row Total</th>
            </tr>
          </thead>
          <tbody>
            {matrix.map((row, rIdx) => {
              const actualClass = classes[rIdx]
              const actualLabel = classLabels[actualClass] || actualClass
              const rowTotal = rowTotals[rIdx] || 1
              return (
                <tr key={actualClass} className="border-t border-[#F0F4F2]">
                  <td className="p-2 text-left font-bold text-[#12372A]">{actualLabel}</td>
                  {row.map((cellValue, cIdx) => {
                    const isDiagonal = rIdx === cIdx
                    const isDangerousError = rIdx === 2 && cIdx === 0 // High risk predicted as low
                    const pct = Math.round((cellValue / rowTotal) * 100)

                    let cellStyle = 'bg-[#F8FAF8] text-[#526058]'
                    if (isDiagonal) {
                      cellStyle = 'bg-[#E8F1EC] text-[#176B4D] font-bold border border-[#A7F3D0]/60'
                    } else if (isDangerousError && cellValue > 0) {
                      cellStyle = 'bg-[#FEE2E2] text-[#991B1B] font-bold border border-[#FECACA]'
                    } else if (cellValue > 0) {
                      cellStyle = 'bg-[#FFFBEB] text-[#92400E]'
                    }

                    return (
                      <td key={cIdx} className="p-2">
                        <div className={`mx-auto flex max-w-[80px] flex-col rounded-lg py-1.5 ${cellStyle}`}>
                          <span className="text-sm font-extrabold">{cellValue}</span>
                          <span className="text-[10px] opacity-75">{pct}%</span>
                        </div>
                      </td>
                    )
                  })}
                  <td className="p-2 font-semibold text-[#66736C]">{rowTotals[rIdx]}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function ModelHistoryGraph({ history, activeVersion = null }) {
  // Extract and normalize measurable points
  const points = (history || [])
    .map((item) => {
      const metrics = item.metrics?.candidate || item.metrics?.baseline || (item.metrics?.accuracy !== undefined ? item.metrics : null)
      if (!metrics || metrics.accuracy === undefined) return null
      return {
        version: item.version,
        status: item.status,
        created_at: item.created_at,
        accuracy: metrics.accuracy,
        macro_f1: metrics.macro_f1,
        high_risk_recall: metrics.high_risk_recall,
        samples: Number.isFinite(item.test_sample_count)
          ? item.test_sample_count
          : Number.isFinite(metrics.test_samples)
          ? metrics.test_samples
          : null,
      }
    })
    .filter(Boolean)
    // Chronological order: oldest to newest
    .reverse()

  if (points.length === 0) {
    return (
      <div className="rounded-2xl border border-[#DCE6E0] bg-white p-6 text-sm text-[#66736C] shadow-sm">
        <p className="font-semibold text-[#12372A]">Model Performance History</p>
        <p className="mt-1 text-xs text-[#8C9A92]">
          No completed model evaluations are available yet. Once a candidate finishes evaluation, its measured scores will appear here.
        </p>
      </div>
    )
  }

  const metricRows = [
    { key: 'accuracy', label: 'Accuracy' },
    { key: 'macro_f1', label: 'Macro F1' },
    { key: 'high_risk_recall', label: 'High-risk recall' },
  ]
  const latest = points[points.length - 1]
  const previous = points.length > 1 ? points[points.length - 2] : null
  const latestStatus = getVersionStatusLabel(latest.version, latest.status, activeVersion)
  const formatPercent = (value) => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—'
  const formatChange = (value, prior) => {
    if (!Number.isFinite(prior)) return 'First recorded result'
    const change = (value - prior) * 100
    if (Math.abs(change) < 0.05) return 'No measurable change'
    return `${change > 0 ? '+' : ''}${change.toFixed(1)} percentage points`
  }
  const statusTone = (point) => {
    const label = getVersionStatusLabel(point.version, point.status, activeVersion)
    if (label === 'Active') return 'bg-[#E8F1EC] text-[#176B4D]'
    if (label === 'Rejected') return 'bg-[#FEE2E2] text-[#B91C1C]'
    if (label === 'Previously promoted') return 'bg-[#EFF6FF] text-[#1D4ED8]'
    return 'bg-[#F1F5F2] text-[#526058]'
  }

  return (
    <div className="rounded-2xl border border-[#DCE6E0] bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E8F1EC] pb-3">
        <div>
          <h3 className="text-base font-bold text-[#12372A]">Model Evaluation Results</h3>
          <p className="text-xs text-[#66736C]">
            Held-out validation scores for the latest evaluated version. Changes compare it with the previous completed evaluation.
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#526058]">
            <span>Latest evaluated version:</span>
            <span className="font-semibold text-[#12372A]">{latest.version}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusTone(latest)}`}>{latestStatus}</span>
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {metricRows.map(({ key, label }) => (
          <div key={key} className="rounded-xl border border-[#E8F1EC] bg-[#F8FAF8] p-4">
            <p className="text-xs font-semibold text-[#66736C]">{label}</p>
            <p className="mt-1 text-2xl font-bold text-[#12372A]">{formatPercent(latest[key])}</p>
            <p className="mt-1 text-xs text-[#66736C]">{formatChange(latest[key], previous?.[key])}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-[#E8F1EC]">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="bg-[#F8FAF8] text-xs text-[#66736C]">
            <tr>
              <th className="px-4 py-3 font-semibold">Evaluated version</th>
              <th className="px-4 py-3 font-semibold">Result</th>
              <th className="px-4 py-3 font-semibold">Accuracy</th>
              <th className="px-4 py-3 font-semibold">Macro F1</th>
              <th className="px-4 py-3 font-semibold">High-risk recall</th>
              <th className="px-4 py-3 font-semibold">Validation set</th>
            </tr>
          </thead>
          <tbody>
            {points.slice(-5).reverse().map((point) => {
              const status = getVersionStatusLabel(point.version, point.status, activeVersion)
              return (
                <tr key={point.version} className="border-t border-[#E8F1EC]">
                  <td className="px-4 py-3 font-medium text-[#12372A]" title={point.version}>
                    <span className="block max-w-[220px] truncate">{point.version}</span>
                  </td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(point)}`}>{status}</span></td>
                  <td className="px-4 py-3 text-[#34443B]">{formatPercent(point.accuracy)}</td>
                  <td className="px-4 py-3 text-[#34443B]">{formatPercent(point.macro_f1)}</td>
                  <td className="px-4 py-3 text-[#34443B]">{formatPercent(point.high_risk_recall)}</td>
                  <td className="px-4 py-3 text-[#66736C]">{point.samples == null ? 'Not recorded' : `${point.samples} clauses`}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 rounded-xl bg-[#F8FAF8] p-3 text-xs leading-relaxed text-[#66736C]">
        These are measured scores, so a candidate can stay flat or decline. A rejected candidate does not replace the active model. Percentage-point changes compare only the two most recent completed evaluations.
      </p>
    </div>
  )
}
