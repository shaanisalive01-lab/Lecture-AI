import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

function base64(bytes: Uint8Array) {
  let binary = ''
  const size = 0x8000
  for (let offset = 0; offset < bytes.length; offset += size) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + size, bytes.length)))
  }
  return btoa(binary)
}

function mimeFor(sourceType: string, path: string) {
  if (sourceType === 'pdf') return 'application/pdf'
  const extension = path.toLowerCase().split('.').pop()
  const audio: Record<string, string> = { mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', wav: 'audio/wav', aac: 'audio/aac', ogg: 'audio/ogg', webm: 'audio/webm' }
  return audio[extension || ''] || 'audio/mpeg'
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization?.startsWith('Bearer ')) return json({ error: 'Sign in to process study material.' }, 401)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } })
    const token = authorization.slice('Bearer '.length)
    const { data: { user }, error: authError } = await userClient.auth.getUser(token)
    if (authError || !user) return json({ error: 'Your session expired. Sign in and try again.' }, 401)

    const body = await request.json()
    const sourceType = String(body.source_type || '')
    if (!['pdf', 'ppt', 'audio', 'youtube', 'topic'].includes(sourceType)) return json({ error: 'Unsupported material type.' }, 400)
    let sourceText = typeof body.source_text === 'string' ? body.source_text.slice(0, 120_000) : ''
    let inlineData: { mime_type: string; data: string } | undefined

    if (sourceType === 'pdf' || sourceType === 'audio') {
      const path = String(body.storage_path || '')
      if (!path.startsWith(`${user.id}/`) || path.includes('..')) return json({ error: 'This file does not belong to your account.' }, 403)
      const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
      const { data: signed, error: signedError } = await admin.storage.from('lecture-files').createSignedUrl(path, 90)
      if (signedError || !signed?.signedUrl) return json({ error: 'Could not access the uploaded file.' }, 400)
      const fileResponse = await fetch(signed.signedUrl)
      if (!fileResponse.ok) return json({ error: 'Could not download the uploaded file for processing.' }, 400)
      const bytes = new Uint8Array(await fileResponse.arrayBuffer())
      if (bytes.byteLength > 15 * 1024 * 1024) return json({ error: 'The AI processing limit for this prototype is 15 MB. Try a smaller or shorter file.' }, 413)
      inlineData = { mime_type: mimeFor(sourceType, path), data: base64(bytes) }
    }
    if (sourceType === 'topic' && !sourceText.trim()) return json({ error: 'Enter a topic to start learning.' }, 400)
    if (sourceType === 'youtube' && !sourceText.trim()) return json({ error: 'Add a transcript or notes so we can create source-grounded study materials.' }, 400)
    if (!sourceText.trim() && !inlineData) return json({ error: 'Add source material so we can create study materials.' }, 400)
    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) return json({ error: 'The server is missing GEMINI_API_KEY. Add it to Supabase Edge Function secrets.' }, 503)

    const prompt = `You are Lecture-AI, a careful learning assistant. For uploaded lecture material, stay grounded only in the supplied source; do not invent unsupported details or source references. For a topic request without lecture material, teach accurate foundations and mark that outside knowledge was used. Explain clearly for a college learner and build beginner steps from prerequisite ideas. Return JSON only with this exact shape: {"summary":"short overview","topics":[{"title":"...","explanation":"...","source":"page/slide if visible, otherwise empty string"}],"flashcards":[{"front":"...","back":"..."}],"quiz":[{"question":"...","options":["...","...","...","..."],"answer":0,"explanation":"..."}],"beginner_steps":[{"title":"...","explanation":"...","check":"optional understanding question"}]}. Create 3-8 topics, 5-12 flashcards, 4-8 quiz questions and 3-6 beginner steps. Make wrong quiz options plausible, use zero-based answer indexes, and avoid false precision. For YouTube inputs, the text is a transcript supplied by the student; do not claim you watched the video. Source type: ${sourceType}.\n\n${sourceText ? `Student-provided transcript or extracted slides / topic request:\n${sourceText}` : ''}`
    const parts: Record<string, unknown>[] = [{ text: prompt }]
    if (inlineData) parts.push({ inline_data: inlineData })
    const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.8-flash'
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json' } }),
    })
    const result = await response.json()
    if (!response.ok) return json({ error: result?.error?.message || 'The AI provider could not process this material.' }, response.status)
    const text = result?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('')
    if (!text) return json({ error: 'The AI returned an empty response. Try a shorter file.' }, 502)
    let materials: unknown
    try { materials = JSON.parse(text) } catch { return json({ error: 'The AI response was not valid study material. Please try again.' }, 502) }
    return json({ materials })
  } catch (error) {
    console.error('generate-study-materials error:', error)
    return json({ error: error instanceof Error ? error.message : 'Unexpected processing error.' }, 500)
  }
})
