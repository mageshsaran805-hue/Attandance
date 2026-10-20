/**
 * Small CSV download helper used by the report screens. No server round-trip
 * is needed: reports are already loaded in the browser, so we build the file
 * locally and let the browser save it.
 */

export type CsvCell = string | number | boolean | null | undefined

function escapeCell(value: CsvCell): string {
  if (value === null || value === undefined) {
    return ''
  }

  const text = String(value)
  // Prevent spreadsheet formula injection from user-controlled names/emails.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replaceAll('"', '""')}"`
  }
  return safe
}

function safeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-')
}

/** Download rows as an RFC 4180-style CSV file. */
export function downloadCsv(filename: string, rows: CsvCell[][]): void {
  const content = rows.map((row) => row.map(escapeCell).join(',')).join('\r\n')
  // The BOM makes Excel open UTF-8 files correctly.
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = safeFilename(filename)
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
