import JSZip from 'jszip'

export type ExtractedSlide = { slide: number; text: string }

export async function extractPowerPointText(file: File): Promise<ExtractedSlide[]> {
  const zip = await JSZip.loadAsync(file)
  const slidePaths = Object.keys(zip.files)
    .filter(path => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => Number(a.match(/slide(\d+)/)?.[1]) - Number(b.match(/slide(\d+)/)?.[1]))
  const parser = new DOMParser()
  const output: ExtractedSlide[] = []
  for (const path of slidePaths) {
    const xml = await zip.file(path)?.async('text')
    if (!xml) continue
    const doc = parser.parseFromString(xml, 'application/xml')
    const text = Array.from(doc.getElementsByTagName('a:t')).map(node => node.textContent?.trim()).filter(Boolean).join(' ')
    if (text) output.push({ slide: Number(path.match(/slide(\d+)/)?.[1]), text })
  }
  return output
}

export function getSourceType(file: File): 'pdf' | 'ppt' | 'audio' | null {
  const name = file.name.toLowerCase()
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf'
  if (/\.pptx$/.test(name)) return 'ppt'
  if (file.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|webm)$/.test(name)) return 'audio'
  return null
}
