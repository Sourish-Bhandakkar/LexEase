let currentDocumentFile = null

export function setCurrentDocumentFile(file) {
  currentDocumentFile = file || null
}

export function getCurrentDocumentFile() {
  return currentDocumentFile
}
