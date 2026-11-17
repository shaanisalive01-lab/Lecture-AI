import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  ArrowLeft, ArrowRight, BookOpen, CalendarDays, Check, CircleHelp, FileAudio, FilePlus2, FileText,
  GraduationCap, LayoutDashboard, Library, LoaderCircle, LogOut, Moon, MoreHorizontal, Plus,
  Settings, Sparkles, Sun, Upload, Youtube,
} from 'lucide-react'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { addDemoSignal, getDemoExams, getDemoLectures, getDemoSignals, removeDemoExam, removeDemoLecture, sampleMaterial, saveDemoExam, saveDemoLecture } from './lib/demo'
import { extractPowerPointText, getSourceType } from './lib/files'
import { cloudEnabled, supabase } from './lib/supabase'
import type { Exam, Lecture, LearningSignal, StudyMaterial } from './types'

type Page = 'today' | 'courses' | 'calendar' | 'suggestions' | 'preferences'
type Theme = 'light' | 'dark' | 'system'
type Notice = { tone: 'good' | 'warn' | 'error'; text: string }

const navigation: { id: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'today', label: 'Today', icon: LayoutDashboard },
  { id: 'courses', label: 'My courses', icon: BookOpen },
  { id: 'calendar', label: 'Study calendar', icon: CalendarDays },
  { id: 'suggestions', label: 'Study suggestions', icon: Sparkles },
]

function uid() { return crypto.randomUUID() }
function dateString(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
function prettyDate(date: string) { return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }
function daysUntil(date: string) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const target = new Date(`${date}T00:00:00`)
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!cloudEnabled)
  const [demoMode, setDemoMode] = useState(!cloudEnabled)
  const [page, setPage] = useState<Page>('today')
  const [theme, setThemeState] = useState<Theme>((localStorage.getItem('lectureAI.theme') as Theme) || 'light')
  const [lectures, setLectures] = useState<Lecture[]>([])
  const [exams, setExams] = useState<Exam[]>([])
  const [signals, setSignals] = useState<LearningSignal[]>([])
  const [selectedLecture, setSelectedLecture] = useState<Lecture | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)
  const [showExamForm, setShowExamForm] = useState(false)
  const [startLesson, setStartLesson] = useState(false)
  const isDemo = demoMode || !session

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); setDemoMode(false) })
    const { data: listener } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, next) => {
      setSession(next); setDemoMode(false); setAuthReady(true)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  const loadData = useCallback(async () => {
    if (isDemo || !supabase || !session) {
      setLectures(getDemoLectures()); setExams(getDemoExams()); setSignals(getDemoSignals()); return
    }
    const [lectureResult, examResult, signalResult] = await Promise.all([
      supabase.from('lectures').select('*').order('created_at', { ascending: false }),
      supabase.from('exams').select('*').order('exam_date', { ascending: true }),
      supabase.from('study_events').select('lecture_id,topic,method,action,correct,confidence,duration_seconds').order('created_at', { ascending: false }).limit(250),
    ])
    if (lectureResult.error || examResult.error || signalResult.error) {
      setNotice({ tone: 'error', text: lectureResult.error?.message || examResult.error?.message || signalResult.error?.message || 'Could not load your study space.' })
      return
    }
    setLectures((lectureResult.data || []).map(row => ({ ...row, materials: row.materials || sampleMaterial })) as Lecture[])
    setExams((examResult.data || []) as Exam[])
    setSignals((signalResult.data || []) as LearningSignal[])
  }, [isDemo, session])

  useEffect(() => { if (authReady) void loadData() }, [authReady, loadData])
  useEffect(() => {
    if (!session || !supabase) return
    let active = true
    void (async () => {
      const { data } = await supabase.from('profiles').select('theme').eq('id', session.user.id).maybeSingle()
      if (!active) return
      if (data?.theme) setThemeState(data.theme as Theme)
      else await supabase.from('profiles').upsert({ id: session.user.id, display_name: session.user.email?.split('@')[0] || null, theme }, { onConflict: 'id' })
    })()
    return () => { active = false }
  }, [session?.user.id])
  useEffect(() => {
    const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    localStorage.setItem('lectureAI.theme', theme)
  }, [theme])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 5200)
    return () => window.clearTimeout(timer)
  }, [notice])

  const recordSignal = useCallback(async (signal: LearningSignal) => {
    if (isDemo || !supabase || !session) { addDemoSignal(signal); setSignals(previous => [signal, ...previous]); return }
    const { error } = await supabase.from('study_events').insert({
      user_id: session.user.id, lecture_id: signal.lecture_id || null, topic: signal.topic || null,
      method: signal.method, action: signal.action, correct: signal.correct ?? null,
      confidence: signal.confidence ?? null, duration_seconds: signal.duration_seconds ?? null,
    })
    if (error) console.warn('Could not save private study signal:', error.message)
    else setSignals(previous => [signal, ...previous])
  }, [isDemo, session])

  function ensureAiConsent() {
    if (sessionStorage.getItem('lectureAI.ai-data-consent') === 'yes') return true
    const accepted = window.confirm('Lecture-AI will send this material to Google Gemini through a private server function to generate study tools. Google’s current free-tier terms may use submitted content to improve its products. Continue only with material you are comfortable sharing. Continue?')
    if (accepted) sessionStorage.setItem('lectureAI.ai-data-consent', 'yes')
    return accepted
  }

  async function handleFile(file?: File) {
    if (!file) return
    const type = getSourceType(file)
    if (!type) { setNotice({ tone: 'warn', text: 'Choose a PDF, .pptx slide deck, or audio file. Older .ppt files are not supported yet.' }); return }
    if (file.size > 25 * 1024 * 1024) { setNotice({ tone: 'warn', text: 'This prototype accepts files up to 25 MB.' }); return }
    if (!isDemo && !ensureAiConsent()) return
    setBusy(true)
    const id = uid()
    const title = file.name.replace(/\.[^.]+$/, '')
    try {
      if (isDemo || !supabase || !session) {
        const lecture: Lecture = { id, title, course_name: 'My course', source_type: type, source_name: file.name, status: 'ready', materials: sampleMaterial, created_at: new Date().toISOString() }
        saveDemoLecture(lecture); setLectures(getDemoLectures()); setSelectedLecture(lecture); setNotice({ tone: 'warn', text: 'Demo mode: this file name is saved locally; generated materials are sample content. Connect Supabase and Gemini for real processing.' })
        setPage('courses')
        return
      }
      let pptText: string | undefined
      if (type === 'ppt') {
        const slides = await extractPowerPointText(file)
        pptText = slides.map(slide => `[Slide ${slide.slide}] ${slide.text}`).join('\n\n')
        if (!pptText) throw new Error('No slide text was found in this PowerPoint file.')
      }
      const path = `${session.user.id}/${id}/${file.name.replace(/[^\w.-]/g, '_')}`
      const { error: uploadError } = await supabase.storage.from('lecture-files').upload(path, file, { upsert: false, contentType: file.type || undefined })
      if (uploadError) throw uploadError
      const row = { id, user_id: session.user.id, title, course_name: 'My course', source_type: type, source_name: file.name, storage_path: path, status: 'processing', materials: {} }
      const { error: insertError } = await supabase.from('lectures').insert(row)
      if (insertError) throw insertError
      setNotice({ tone: 'good', text: 'Lecture uploaded. Finding the key ideas…' })
      const { data, error: functionError } = await supabase.functions.invoke('generate-study-materials', { body: { lecture_id: id, storage_path: path, source_type: type, source_text: pptText } })
      if (functionError) throw functionError
      const generated = (data?.materials || data) as StudyMaterial
      const { error: updateError } = await supabase.from('lectures').update({ materials: generated, status: 'ready' }).eq('id', id)
      if (updateError) throw updateError
      await loadData()
      setSelectedLecture({ ...row, status: 'ready', materials: generated, created_at: new Date().toISOString() } as Lecture); setPage('courses')
      setNotice({ tone: 'good', text: 'Your study materials are ready. Take a look and check them against your slides.' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Something went wrong while processing this file.'
      if (supabase && session && !isDemo) await supabase.from('lectures').update({ status: 'error' }).eq('id', id)
      setNotice({ tone: 'error', text: message })
    } finally { setBusy(false) }
  }

  async function handleYoutube(url: string, transcript: string, title: string) {
    if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url)) { setNotice({ tone: 'warn', text: 'Paste a valid YouTube video URL.' }); return }
    if (!transcript.trim()) { setNotice({ tone: 'warn', text: 'Paste the video transcript or your notes first. This prototype does not claim to inspect arbitrary YouTube videos.' }); return }
    if (!isDemo && !ensureAiConsent()) return
    setBusy(true)
    const id = uid()
    try {
      if (isDemo || !supabase || !session) {
        const lecture: Lecture = { id, title: title || 'YouTube lesson', course_name: 'My course', source_type: 'youtube', source_name: 'YouTube lesson + pasted transcript', source_url: url, status: 'ready', materials: sampleMaterial, created_at: new Date().toISOString() }
        saveDemoLecture(lecture); setLectures(getDemoLectures()); setSelectedLecture(lecture); setPage('courses'); setNotice({ tone: 'warn', text: 'Demo mode uses sample study content. The transcript is not uploaded or saved.' }); return
      }
      const row = { id, user_id: session.user.id, title: title || 'YouTube lesson', course_name: 'My course', source_type: 'youtube', source_name: 'YouTube lesson + pasted transcript', source_url: url, status: 'processing', materials: {} }
      const { error } = await supabase.from('lectures').insert(row)
      if (error) throw error
      const { data, error: functionError } = await supabase.functions.invoke('generate-study-materials', { body: { lecture_id: id, source_type: 'youtube', source_text: transcript } })
      if (functionError) throw functionError
      const generated = (data?.materials || data) as StudyMaterial
      await supabase.from('lectures').update({ materials: generated, status: 'ready' }).eq('id', id)
      await loadData(); setSelectedLecture({ ...row, status: 'ready', materials: generated, created_at: new Date().toISOString() } as Lecture); setPage('courses')
      setNotice({ tone: 'good', text: 'Study materials are ready from the transcript you provided.' })
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not process this transcript.' })
    } finally { setBusy(false) }
  }

  async function addExam(title: string, course: string, date: string) {
    const exam: Exam = { id: uid(), title, course_name: course, exam_date: date, created_at: new Date().toISOString() }
    if (isDemo || !supabase || !session) saveDemoExam(exam)
    else {
      const { error } = await supabase.from('exams').insert({ ...exam, user_id: session.user.id })
      if (error) { setNotice({ tone: 'error', text: error.message }); return }
    }
    await loadData(); setShowExamForm(false); setNotice({ tone: 'good', text: 'Exam added. Your upcoming study plan is ready.' })
  }

  async function deleteExam(exam: Exam) {
    if (isDemo || !supabase || !session) removeDemoExam(exam.id)
    else { const { error } = await supabase.from('exams').delete().eq('id', exam.id); if (error) { setNotice({ tone: 'error', text: error.message }); return } }
    setExams(prev => prev.filter(item => item.id !== exam.id))
  }

  async function deleteLecture(lecture: Lecture) {
    if (isDemo || !supabase || !session) removeDemoLecture(lecture.id)
    else {
      if (lecture.storage_path) await supabase.storage.from('lecture-files').remove([lecture.storage_path])
      const { error } = await supabase.from('lectures').delete().eq('id', lecture.id)
      if (error) { setNotice({ tone: 'error', text: error.message }); return }
    }
    setLectures(prev => prev.filter(item => item.id !== lecture.id)); setSelectedLecture(null); setNotice({ tone: 'good', text: 'Lecture removed from your study space.' })
  }

  async function signOut() {
    if (supabase) await supabase.auth.signOut()
    setSession(null); setDemoMode(!cloudEnabled); setPage('today')
  }
  function changeTheme(value: Theme) {
    setThemeState(value)
    if (session && supabase) void supabase.from('profiles').upsert({ id: session.user.id, theme: value }, { onConflict: 'id' })
  }

  if (!authReady) return <div className="loading-screen"><LoaderCircle className="spin" size={26} /><span>Opening your study space…</span></div>
  if (cloudEnabled && !session && !demoMode) return <AuthScreen onDemo={() => setDemoMode(true)} />

  const nearestExam = exams.filter(item => daysUntil(item.exam_date) >= 0).sort((a, b) => a.exam_date.localeCompare(b.exam_date))[0]

  return <div className="app-shell">
    <aside className="sidebar">
      <button className="brand" onClick={() => { setPage('today'); setSelectedLecture(null) }} aria-label="Lecture home"><span className="brand-icon">L</span><span>lecture<span className="brand-dot">.</span></span></button>
      <div className="side-caption">WORKSPACE</div>
      <nav className="side-nav">{navigation.map(item => <button key={item.id} className={page === item.id && !selectedLecture ? 'selected' : ''} onClick={() => { setPage(item.id); setSelectedLecture(null) }}><item.icon size={17} strokeWidth={1.7} /><span>{item.label}</span></button>)}</nav>
      <div className="sidebar-bottom"><div className="side-caption">YOUR SPACE</div><button className={`side-link ${page === 'preferences' ? 'selected' : ''}`} onClick={() => { setPage('preferences'); setSelectedLecture(null) }}><Settings size={17} strokeWidth={1.7} /><span>Preferences</span></button><div className="profile-row"><div className="avatar">{(session?.user.email?.[0] || 'S').toUpperCase()}</div><div className="profile-copy"><strong>{session?.user.email?.split('@')[0] || 'Your study space'}</strong><span>{isDemo ? 'Demo mode' : 'Synced across devices'}</span></div>{session && <button className="icon-only" title="Sign out" onClick={() => void signOut()}><LogOut size={15} /></button>}</div></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="crumb"><span>My workspace</span><b>/</b><strong>{selectedLecture?.title || pageTitle(page)}</strong></div><div className="topbar-right">{isDemo && cloudEnabled && <span className="demo-indicator">Local demo</span>}<button className="avatar avatar-small" onClick={() => { setPage('preferences'); setSelectedLecture(null) }} aria-label="Preferences">{(session?.user.email?.[0] || 'S').toUpperCase()}</button></div></header>
      <div className="content">
        {!selectedLecture && page === 'today' && <TodayPage lectures={lectures} exams={exams} nearestExam={nearestExam} busy={busy} onUpload={handleFile} onYoutube={handleYoutube} onPickLecture={setSelectedLecture} onStartTopic={async title => {
          const lecture: Lecture = { id: uid(), title, course_name: 'Start from zero', source_type: 'topic', source_name: 'Topic lesson', status: 'ready', materials: { ...sampleMaterial, summary: `This local demo uses sample biology steps. Connect the AI service to generate a true lesson about “${title}”.` }, created_at: new Date().toISOString() }
          if (isDemo || !supabase || !session) { saveDemoLecture(lecture); setLectures(getDemoLectures()); setSelectedLecture(lecture); return }
          if (!ensureAiConsent()) return
          setBusy(true)
          try {
            const row = { id: lecture.id, user_id: session.user.id, title, course_name: 'Start from zero', source_type: 'topic', source_name: 'Topic lesson', status: 'processing', materials: {} }
            const { error: insertError } = await supabase.from('lectures').insert(row)
            if (insertError) throw insertError
            const { data, error } = await supabase.functions.invoke('generate-study-materials', { body: { lecture_id: lecture.id, source_type: 'topic', source_text: `Teach a complete beginner about this topic: ${title}` } })
            if (error) throw error
            const materials = (data?.materials || data) as StudyMaterial
            const { error: updateError } = await supabase.from('lectures').update({ materials, status: 'ready' }).eq('id', lecture.id)
            if (updateError) throw updateError
            await loadData(); setSelectedLecture({ ...lecture, materials })
          } catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not create this beginner lesson.' }) }
          finally { setBusy(false) }
        }} onCalendar={() => setPage('calendar')} onCourses={() => setPage('courses')} />}
        {!selectedLecture && page === 'courses' && <CoursesPage lectures={lectures} busy={busy} onUpload={handleFile} onOpen={setSelectedLecture} onDelete={deleteLecture} />}
        {selectedLecture && <LecturePage lecture={selectedLecture} onBack={() => setSelectedLecture(null)} onDelete={() => deleteLecture(selectedLecture)} onSignal={recordSignal} startLesson={startLesson} setStartLesson={setStartLesson} />}
        {!selectedLecture && page === 'calendar' && <CalendarPage exams={exams} lectures={lectures} onAdd={() => setShowExamForm(true)} onDelete={deleteExam} onSignal={recordSignal} />}
        {!selectedLecture && page === 'suggestions' && <SuggestionsPage lectures={lectures} exams={exams} signals={signals} />}
        {!selectedLecture && page === 'preferences' && <PreferencesPage theme={theme} setTheme={changeTheme} session={session} onSignOut={signOut} />}
      </div>
    </main>
    {showExamForm && <ExamModal onClose={() => setShowExamForm(false)} onSave={addExam} />}
    {notice && <div className={`toast ${notice.tone}`} role="status"><span>{notice.text}</span><button onClick={() => setNotice(null)} aria-label="Dismiss">×</button></div>}
  </div>
}

function pageTitle(page: Page) { return ({ today: 'Today', courses: 'My courses', calendar: 'Study calendar', suggestions: 'Study suggestions', preferences: 'Preferences' })[page] }

function AuthScreen({ onDemo }: { onDemo: () => void }) {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!supabase) return; setBusy(true); setMessage('')
    const result = mode === 'sign-in' ? await supabase.auth.signInWithPassword({ email, password }) : await supabase.auth.signUp({ email, password })
    if (result.error) setMessage(result.error.message)
    else if (mode === 'sign-up' && !result.data.session) setMessage('Check your email to confirm the account, then sign in.')
    setBusy(false)
  }
  return <div className="auth-screen"><div className="auth-card"><div className="brand auth-brand"><span className="brand-icon">L</span><span>lecture<span className="brand-dot">.</span></span></div><div className="eyebrow">YOUR CALM STUDY SPACE</div><h1>{mode === 'sign-in' ? 'Welcome back.' : 'Make this space yours.'}</h1><p>Sign in to keep lectures, plans, and learning progress with you across devices.</p><form onSubmit={submit}><label>Email<input autoComplete="email" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" /></label><label>Password<input autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} type="password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" /></label><button className="primary full" disabled={busy}>{busy ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : 'Create account'} <ArrowRight size={15} /></button></form>{message && <div className="form-message">{message}</div>}<button className="auth-switch" onClick={() => { setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in'); setMessage('') }}>{mode === 'sign-in' ? 'New here? Create an account' : 'Already have an account? Sign in'}</button><div className="auth-divider"><span>or</span></div><button className="secondary full" onClick={onDemo}>Explore the local demo</button><small className="auth-foot">Demo data stays in this browser. Add Supabase setup for synced accounts.</small></div></div>
}

function TodayPage({ lectures, exams, nearestExam, busy, onUpload, onYoutube, onPickLecture, onStartTopic, onCalendar, onCourses }: {
  lectures: Lecture[]; exams: Exam[]; nearestExam?: Exam; busy: boolean; onUpload: (file?: File) => void
  onYoutube: (url: string, transcript: string, title: string) => Promise<void>; onPickLecture: (lecture: Lecture) => void; onStartTopic: (title: string) => Promise<void>; onCalendar: () => void; onCourses: () => void
}) {
  const [mode, setMode] = useState<'upload' | 'topic' | 'youtube'>('upload')
  const [topic, setTopic] = useState(''); const [url, setUrl] = useState(''); const [transcript, setTranscript] = useState(''); const [showTranscript, setShowTranscript] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  async function startTopic(event: FormEvent) { event.preventDefault(); await onStartTopic(topic.trim()); setTopic('') }
  function startYoutube(event: FormEvent) { event.preventDefault(); if (!showTranscript) { setShowTranscript(true); return } void onYoutube(url, transcript, '') }
  return <>
    <div className="home-head"><div className="eyebrow">A LITTLE PROGRESS, AT YOUR PACE</div><h1>What are we learning today?</h1><p>Start with a lecture, a topic, or something that’s been confusing you.</p></div>
    <div className="capture-panel">
      <div className="capture-tabs"><button className={mode === 'upload' ? 'active' : ''} onClick={() => setMode('upload')}><Upload size={14} /> Upload</button><button className={mode === 'topic' ? 'active' : ''} onClick={() => setMode('topic')}><Sparkles size={14} /> Start from zero</button><button className={mode === 'youtube' ? 'active' : ''} onClick={() => setMode('youtube')}><Youtube size={14} /> YouTube</button></div>
      {mode === 'upload' && <div className="upload-row"><label className="capture-input-wrap" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); onUpload(event.dataTransfer.files?.[0]) }}><FilePlus2 size={19} /><span><strong>Drop a lecture here</strong><small>PDF, .pptx slide deck, or audio · up to 25 MB</small></span><input ref={inputRef} type="file" accept=".pdf,.pptx,audio/*,.mp3,.wav,.m4a" onChange={event => { onUpload(event.target.files?.[0]); event.currentTarget.value = '' }} /></label><button className="primary" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? <><LoaderCircle className="spin" size={15} /> Working</> : <>Choose a file <ArrowRight size={15} /></>}</button></div>}
      {mode === 'topic' && <form className="capture-form" onSubmit={startTopic}><Sparkles size={19} /><input value={topic} onChange={event => setTopic(event.target.value)} placeholder="What topic would you like to understand?" required /><button className="primary">Teach me <ArrowRight size={15} /></button></form>}
      {mode === 'youtube' && <form className="youtube-form" onSubmit={startYoutube}><div className="capture-form"><Youtube size={19} /><input value={url} onChange={event => setUrl(event.target.value)} type="url" placeholder="Paste a YouTube video link" required /><button className="primary">{showTranscript ? 'Create study tools' : 'Continue'} <ArrowRight size={15} /></button></div>{showTranscript && <textarea value={transcript} onChange={event => setTranscript(event.target.value)} placeholder="Paste the video transcript or your notes. We only analyze text you provide in this prototype." rows={4} required />}</form>}
      <div className="capture-foot"><span>{mode === 'youtube' ? 'Transcript required for source-grounded study tools' : mode === 'topic' ? 'No lecture needed · we’ll build the foundations' : 'Your lecture and study materials stay in your private space'}</span><span>{busy ? 'Preparing your study space…' : 'No pressure. One thing at a time.'}</span></div>
    </div>
    <p className="privacy-line"><CircleHelp size={13} /> Study signals help adjust recommendations in the background. You won’t see a performance score.</p>
    {nearestExam && <section className="home-section"><div className="section-heading"><div><h2>Coming up</h2><p>A gentle plan for what’s next.</p></div><button className="text-button" onClick={onCalendar}>Open calendar <ArrowRight size={14} /></button></div><button className="exam-highlight" onClick={onCalendar}><span className="icon-tile sand"><CalendarDays size={18} /></span><span className="grow"><strong>{nearestExam.title}</strong><small>{nearestExam.course_name || 'Course'} · {prettyDate(nearestExam.exam_date)}</small></span><span className="countdown">{daysUntil(nearestExam.exam_date)}<small>days to go</small></span></button></section>}
    <section className="home-section"><div className="section-heading"><div><h2>Continue learning</h2><p>{lectures.length ? 'Pick up where you left off.' : 'Your lectures will live here.'}</p></div><button className="text-button" onClick={onCourses}>All materials <ArrowRight size={14} /></button></div>
      {lectures.slice(0, 3).length ? <div className="lecture-list">{lectures.slice(0, 3).map(lecture => <LectureRow key={lecture.id} lecture={lecture} onClick={() => onPickLecture(lecture)} />)}</div> : <div className="empty-inline"><div className="empty-icon"><Library size={19} /></div><span><strong>No lectures yet</strong><small>Upload course material to create your first study set.</small></span></div>}
    </section>
    {exams.length === 0 && <div className="gentle-banner"><div className="banner-spark"><Sparkles size={18} /></div><div className="grow"><strong>Learning without an exam in sight?</strong><p>Start from the foundations and build understanding at your own pace.</p></div><button className="secondary" onClick={() => setMode('topic')}>Choose a topic</button></div>}
  </>
}

function LectureRow({ lecture, onClick }: { lecture: Lecture; onClick: () => void }) {
  const Icon = lecture.source_type === 'audio' ? FileAudio : lecture.source_type === 'youtube' ? Youtube : FileText
  return <button className="lecture-row" onClick={onClick}><span className="icon-tile green"><Icon size={17} /></span><span className="grow"><strong>{lecture.title}</strong><small>{lecture.course_name || 'My course'} · {lecture.source_name}</small></span><span className={`status status-${lecture.status}`}>{lecture.status === 'ready' ? 'Ready' : lecture.status === 'processing' ? 'Processing' : 'Needs attention'}</span><ArrowRight size={15} className="muted-arrow" /></button>
}

function CoursesPage({ lectures, busy, onUpload, onOpen, onDelete }: { lectures: Lecture[]; busy: boolean; onUpload: (file?: File) => void; onOpen: (lecture: Lecture) => void; onDelete: (lecture: Lecture) => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null)
  return <><PageHeader eyebrow="YOUR MATERIALS, IN ONE PLACE" title="My courses" description="Open a lecture, review what you’ve learned, or start again from the basics." action={<><input ref={input} type="file" hidden accept=".pdf,.pptx,audio/*" onChange={event => { onUpload(event.target.files?.[0]); event.currentTarget.value = '' }} /><button className="primary" disabled={busy} onClick={() => input.current?.click()}><Plus size={15} /> Add lecture</button></>} />
    {lectures.length ? <div className="materials-grid">{lectures.map(lecture => <article className="material-card" key={lecture.id}><div className="material-card-top"><span className="icon-tile green"><BookOpen size={17} /></span><button className="icon-only" aria-label="Delete lecture" onClick={() => void onDelete(lecture)}><MoreHorizontal size={18} /></button></div><button className="material-open" onClick={() => onOpen(lecture)}><strong>{lecture.title}</strong><small>{lecture.course_name || 'My course'} · {lecture.source_name}</small><span className="material-count">{lecture.materials.topics?.length || 0} topics <span>·</span> {lecture.materials.flashcards?.length || 0} flashcards <span>·</span> {lecture.materials.quiz?.length || 0} quiz questions</span></button><div className="material-bottom"><span className={`status status-${lecture.status}`}>{lecture.status === 'ready' ? 'Study tools ready' : lecture.status === 'processing' ? 'Processing' : 'Processing failed'}</span><button className="text-button" onClick={() => onOpen(lecture)}>Open <ArrowRight size={14} /></button></div></article>)}</div> : <div className="empty-card"><div className="empty-icon"><FileText size={22} /></div><h3>Your first lecture goes here</h3><p>Upload a PDF, slide deck, or recording to turn it into a focused study set.</p><button className="primary" onClick={() => input.current?.click()}><Upload size={15} /> Add lecture</button></div>}
  </>
}

function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-header"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>
}

function LecturePage({ lecture, onBack, onDelete, onSignal, startLesson, setStartLesson }: { lecture: Lecture; onBack: () => void; onDelete: () => Promise<void>; onSignal: (signal: LearningSignal) => Promise<void>; startLesson: boolean; setStartLesson: (open: boolean) => void }) {
  const [tab, setTab] = useState<'notes' | 'flashcards' | 'quiz'>('notes')
  const [cardIndex, setCardIndex] = useState(0); const [showAnswer, setShowAnswer] = useState(false); const [quizIndex, setQuizIndex] = useState(0); const [chosen, setChosen] = useState<number | null>(null)
  const [lessonIndex, setLessonIndex] = useState(0); const [lessonHelp, setLessonHelp] = useState(false)
  const materials = lecture.materials || sampleMaterial
  const cards = materials.flashcards || []; const quiz = materials.quiz || []; const steps = materials.beginner_steps || []
  const currentQuestion = quiz[quizIndex]
  useEffect(() => { setLessonIndex(0); setLessonHelp(false) }, [lecture.id])
  if (startLesson) {
    const step = steps[lessonIndex] || { title: 'Connect it back to your lecture', explanation: materials.summary }
    return <div className="lesson-page"><button className="back-link" onClick={() => setStartLesson(false)}><ArrowLeft size={15} /> Back to lecture</button><div className="lesson-shell"><div className="lesson-progress-label">START FROM ZERO <span>STEP {Math.min(lessonIndex + 1, steps.length)} OF {steps.length}</span></div><div className="step-track"><span style={{ width: `${Math.min(100, ((lessonIndex + 1) / Math.max(1, steps.length)) * 100)}%` }} /></div><span className="lesson-orb"><Sparkles size={20} /></span><h1>{step.title}</h1><p className="lesson-copy">{lessonHelp ? `Let’s make it smaller: ${step.explanation.split('.').slice(0, 1).join('.')}. You can take a moment and try again when you’re ready.` : step.explanation}</p>{step.check && <div className="check-question"><span>QUICK CHECK · OPTIONAL</span><strong>{step.check}</strong><p>Try answering in your own words, or just choose how this explanation felt.</p></div>}<div className="lesson-actions"><button className="secondary" onClick={() => { setLessonHelp(true); void onSignal({ lecture_id: lecture.id, method: 'start-from-zero', action: 'asked-for-simpler-explanation', confidence: 1 }) }}>Explain another way</button><button className="primary" onClick={() => { void onSignal({ lecture_id: lecture.id, method: 'start-from-zero', action: 'step-understood', confidence: lessonHelp ? 2 : 4 }); if (lessonIndex + 1 >= steps.length) { setStartLesson(false); setTab('notes') } else { setLessonIndex(lessonIndex + 1); setLessonHelp(false) } }}>{lessonIndex + 1 >= steps.length ? 'Back to the lecture' : 'That makes sense · Continue'} <ArrowRight size={15} /></button></div><div className="gentle-tip"><CircleHelp size={14} />Your pace is yours. You can pause or return to the original notes anytime.</div></div></div>
  }
  return <>
    <button className="back-link" onClick={onBack}><ArrowLeft size={15} /> All materials</button>
    <div className="lecture-header"><div className="icon-tile green large"><BookOpen size={21} /></div><div className="grow"><div className="eyebrow">{lecture.course_name || 'MY COURSE'} · {lecture.source_type.toUpperCase()}</div><h1>{lecture.title}</h1><p>{lecture.source_name} · {lecture.status === 'ready' ? `${materials.topics?.length || 0} key topics` : 'Materials are being processed'}</p></div><button className="secondary" onClick={() => void onDelete()}>Remove</button></div>
    <div className="summary-callout"><span className="summary-icon"><Sparkles size={16} /></span><div><strong>In a nutshell</strong><p>{materials.summary || 'Your lecture summary will appear here.'}</p></div></div>
    <div className="study-layout"><section className="study-main card-surface"><div className="study-tabs"><button className={tab === 'notes' ? 'active' : ''} onClick={() => setTab('notes')}><FileText size={15} /> Notes</button><button className={tab === 'flashcards' ? 'active' : ''} onClick={() => setTab('flashcards')}><Library size={15} /> Flashcards <span>{cards.length}</span></button><button className={tab === 'quiz' ? 'active' : ''} onClick={() => setTab('quiz')}><CircleHelp size={15} /> Quiz <span>{quiz.length}</span></button></div>
      {tab === 'notes' && <div className="notes-content">{materials.topics?.map((topic, index) => <article className="note-topic" key={`${topic.title}-${index}`}><div className="topic-number">{String(index + 1).padStart(2, '0')}</div><div><h3>{topic.title}</h3><p>{topic.explanation}</p>{topic.source && <span className="source-chip">{topic.source}</span>}</div></article>)}</div>}
      {tab === 'flashcards' && <div className="practice-content">{cards.length ? <><div className="practice-counter">CARD {cardIndex + 1} OF {cards.length}</div><button className={`flashcard ${showAnswer ? 'revealed' : ''}`} onClick={() => setShowAnswer(!showAnswer)}><span>{showAnswer ? 'ANSWER' : 'PROMPT'}</span><strong>{showAnswer ? cards[cardIndex]?.back : cards[cardIndex]?.front}</strong><small>Click to {showAnswer ? 'see the prompt' : 'reveal the answer'}</small></button><div className="practice-controls"><button className="secondary" onClick={() => { setShowAnswer(false); setCardIndex((cardIndex - 1 + cards.length) % cards.length) }}>Previous</button><button className="primary" onClick={() => { void onSignal({ lecture_id: lecture.id, method: 'flashcards', action: showAnswer ? 'recalled' : 'revealed' }); setShowAnswer(false); setCardIndex((cardIndex + 1) % cards.length) }}>Next card <ArrowRight size={14} /></button></div><div className="confidence-row"><span>How did that feel?</span><button onClick={() => void onSignal({ lecture_id: lecture.id, method: 'flashcards', action: 'confidence', confidence: 1 })}>Still learning</button><button onClick={() => void onSignal({ lecture_id: lecture.id, method: 'flashcards', action: 'confidence', confidence: 3 })}>Getting there</button><button onClick={() => void onSignal({ lecture_id: lecture.id, method: 'flashcards', action: 'confidence', confidence: 5 })}>Got it</button></div></> : <div className="empty-inline">No flashcards were generated for this lecture.</div>}</div>}
      {tab === 'quiz' && <div className="practice-content">{currentQuestion ? <><div className="practice-counter">QUESTION {quizIndex + 1} OF {quiz.length}</div><h2 className="quiz-prompt">{currentQuestion.question}</h2><div className="quiz-options">{currentQuestion.options.map((option, index) => <button className={`quiz-option ${chosen === index ? (index === currentQuestion.answer ? 'correct' : 'incorrect') : ''}`} key={option} onClick={() => { setChosen(index); void onSignal({ lecture_id: lecture.id, method: 'quiz', action: 'answered', correct: index === currentQuestion.answer }) }}><span>{String.fromCharCode(65 + index)}</span>{option}{chosen === index && index === currentQuestion.answer && <Check size={15} />}</button>)}</div>{chosen !== null && <div className={`quiz-feedback ${chosen === currentQuestion.answer ? 'right' : 'try-again'}`}><strong>{chosen === currentQuestion.answer ? 'That’s right.' : 'Not quite, and that’s okay.'}</strong><p>{currentQuestion.explanation}</p></div>}<div className="practice-controls"><span className="muted-copy">Answer first, then read the explanation.</span><button className="primary" onClick={() => { setQuizIndex((quizIndex + 1) % quiz.length); setChosen(null) }}>Next question <ArrowRight size={14} /></button></div></> : <div className="empty-inline">No quiz questions were generated yet.</div>}</div>}
    </section>
    <aside className="study-aside"><article className="start-card"><span className="eyebrow">NO BACKGROUND NEEDED</span><span className="start-icon"><Sparkles size={18} /></span><h3>Start from zero</h3><p>We’ll begin with the simplest building blocks and build back up to this lecture at your pace.</p><button className="primary full" onClick={() => setStartLesson(true)}>Build my foundation <ArrowRight size={15} /></button></article><article className="source-card"><span className="eyebrow">YOUR SOURCE</span><div className="source-file"><FileText size={16} /><span><strong>{lecture.source_name}</strong><small>{lecture.source_type.toUpperCase()} · Added to your library</small></span></div>{lecture.source_url && <a className="source-link" href={lecture.source_url} target="_blank" rel="noreferrer"><Youtube size={14} />Open YouTube video <ArrowRight size={13} /></a>}<p>Generated notes are grounded in the material you added. Check source pages when details matter.</p></article></aside></div>
  </>
}

function CalendarPage({ exams, lectures, onAdd, onDelete, onSignal }: { exams: Exam[]; lectures: Lecture[]; onAdd: () => void; onDelete: (exam: Exam) => Promise<void>; onSignal: (signal: LearningSignal) => Promise<void> }) {
  const upcoming = useMemo(() => exams.filter(exam => daysUntil(exam.exam_date) >= 0).sort((a, b) => a.exam_date.localeCompare(b.exam_date)), [exams])
  const nearest = upcoming[0]
  const plan = nearest ? buildPlan(nearest, lectures) : []
  return <><PageHeader eyebrow="A FLEXIBLE PLAN FOR REAL LIFE" title="Study calendar" description="Add exams manually. Your plan makes room for short sessions and adjusts as you study." action={<button className="primary" onClick={onAdd}><Plus size={15} /> Add exam</button>} />
    <div className="calendar-layout"><section className="card-surface calendar-main"><div className="calendar-month"><div><h2>{new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2><p>Your upcoming exams and study rhythm.</p></div><span className="calendar-mark"><CalendarDays size={21} /></span></div><div className="mini-calendar">{weekDates().map(day => <div className={`mini-day ${dateString(day) === dateString(new Date()) ? 'today' : ''} ${exams.some(exam => exam.exam_date === dateString(day)) ? 'has-exam' : ''}`} key={dateString(day)}><span>{day.toLocaleDateString(undefined, { weekday: 'short' })}</span><b>{day.getDate()}</b></div>)}</div>{upcoming.length ? <div className="exam-list">{upcoming.map(exam => <div className="exam-item" key={exam.id}><span className="icon-tile sand"><GraduationCap size={17} /></span><span className="grow"><strong>{exam.title}</strong><small>{exam.course_name || 'Course'} · {prettyDate(exam.exam_date)}</small></span><span className="exam-count">{daysUntil(exam.exam_date)}<small>days</small></span><button className="icon-only" onClick={() => void onDelete(exam)} aria-label={`Delete ${exam.title}`}><MoreHorizontal size={18} /></button></div>)}</div> : <div className="empty-inline calendar-empty"><span className="icon-tile sand"><CalendarDays size={17} /></span><span><strong>No exams on the calendar</strong><small>Add a date and we’ll help you decide what to study next.</small></span></div>}</section>
      <section className="card-surface plan-main"><div className="plan-title"><div><span className="eyebrow">YOUR NEXT STEPS</span><h2>{nearest ? `Plan for ${nearest.title}` : 'A steady learning rhythm'}</h2></div><span className="time-chip">{plan.length ? `${plan.reduce((sum, item) => sum + item.minutes, 0)} min total` : 'Flexible'}</span></div>{nearest ? <><p className="plan-description">{daysUntil(nearest.exam_date) === 0 ? 'Your exam is today. Keep this light and take care of yourself.' : `${daysUntil(nearest.exam_date)} days until the exam. We spread a few manageable sessions across the time you have.`}</p><div className="task-list">{plan.map((task, index) => <PlanTask key={`${task.day}-${index}`} task={task} index={index} lecture={lectures[index % Math.max(1, lectures.length)]} onSignal={onSignal} />)}</div></> : <><p className="plan-description">No exam nearby? Keep building from the ground up, one topic at a time.</p><div className="plan-empty"><Sparkles size={18} /><span><strong>Start with a foundation lesson</strong><small>Add a lecture or choose a topic from the home screen.</small></span></div></>}</section></div>
  </>
}

type PlanItem = { title: string; details: string; date: string; minutes: number; day: number }
function buildPlan(exam: Exam, lectures: Lecture[]): PlanItem[] {
  const remaining = Math.max(0, daysUntil(exam.exam_date))
  if (remaining === 0) return []
  const title = lectures[0]?.title || `${exam.course_name || 'Course'} foundations`
  const count = Math.min(4, remaining)
  return Array.from({ length: count }, (_, index) => {
    const day = Math.max(0, remaining - count + index)
    const sessions = [
      { title: 'Build the basics', details: `${title} · Start from zero`, minutes: 15 },
      { title: 'Quick recall practice', details: `${title} · Flashcards`, minutes: 10 },
      { title: 'Connect the ideas', details: `${title} · Notes and a short quiz`, minutes: 20 },
      { title: 'Gentle review', details: `${title} · Review tricky topics`, minutes: 15 },
    ]
    const session = sessions[index % sessions.length]
    return { ...session, day, date: dateString(new Date(Date.now() + day * 86_400_000)) }
  })
}

function PlanTask({ task, index, lecture, onSignal }: { task: PlanItem; index: number; lecture?: Lecture; onSignal: (signal: LearningSignal) => Promise<void> }) {
  const [done, setDone] = useState(false)
  return <div className={`plan-task ${done ? 'completed' : ''}`}><button className={`task-check ${done ? 'done' : ''}`} onClick={() => { setDone(!done); void onSignal({ lecture_id: lecture?.id, method: 'study-plan', action: done ? 'task-reopened' : 'task-completed' }) }} aria-label={done ? 'Reopen task' : 'Complete task'}>{done && <Check size={13} />}</button><span className="task-index">{String(index + 1).padStart(2, '0')}</span><span className="grow"><strong>{task.title}</strong><small>{task.details}</small></span><span className="task-time"><b>{task.day === 0 ? 'Today' : prettyDate(task.date)}</b><small>{task.minutes} min</small></span></div>
}

function weekDates() {
  const now = new Date(); const first = new Date(now); first.setDate(now.getDate() - ((now.getDay() + 6) % 7))
  return Array.from({ length: 7 }, (_, index) => { const day = new Date(first); day.setDate(first.getDate() + index); return day })
}

function ExamModal({ onClose, onSave }: { onClose: () => void; onSave: (title: string, course: string, date: string) => Promise<void> }) {
  const [title, setTitle] = useState(''); const [course, setCourse] = useState(''); const [date, setDate] = useState(''); const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); await onSave(title.trim(), course.trim() || 'My course', date); setBusy(false) }
  return <div className="modal-shade" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><form className="modal-card" onSubmit={submit}><div className="modal-top"><span className="icon-tile sand"><GraduationCap size={18} /></span><button type="button" className="icon-only close-button" onClick={onClose}>×</button></div><div className="eyebrow">MAKE A LITTLE ROOM TO PREPARE</div><h2>Add an exam</h2><p>We’ll use the date to suggest a realistic review rhythm. You can change it anytime.</p><label>Exam name<input value={title} onChange={e => setTitle(e.target.value)} placeholder="Biology midterm" required /></label><label>Course<input value={course} onChange={e => setCourse(e.target.value)} placeholder="Introduction to Biology" /></label><label>Date<input value={date} onChange={e => setDate(e.target.value)} type="date" min={dateString(new Date())} required /></label><div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Add exam'} <ArrowRight size={14} /></button></div></form></div>
}

function SuggestionsPage({ lectures, exams, signals }: { lectures: Lecture[]; exams: Exam[]; signals: LearningSignal[] }) {
  const upcoming = exams.filter(exam => daysUntil(exam.exam_date) >= 0).sort((a, b) => a.exam_date.localeCompare(b.exam_date))[0]
  const latestConfidence = signals.find(signal => signal.action === 'confidence')
  const latestQuizAnswer = signals.find(signal => signal.method === 'quiz' && signal.action === 'answered')
  const lowConfidence = latestConfidence?.confidence !== undefined && latestConfidence.confidence <= 2 ? latestConfidence : undefined
  const missedQuiz = latestQuizAnswer?.correct === false ? latestQuizAnswer : undefined
  const signalLecture = lectures.find(lecture => lecture.id === (lowConfidence?.lecture_id || missedQuiz?.lecture_id))
  const nextStudy = lowConfidence
    ? { title: `Take a slower pass through ${signalLecture?.title || 'your recent topic'}`, body: 'Your recent confidence check suggests another short explanation and a low-pressure review could help.' }
    : missedQuiz
      ? { title: `Revisit the explanation for ${signalLecture?.title || 'your recent quiz'}`, body: 'You missed a recent quiz question. Review the idea, then try recalling it again without looking.' }
      : signals.length
        ? { title: 'A short recall check is a good next step', body: 'Keep building a little at a time. We’ll continue adjusting suggestions as you share practice and confidence signals.' }
        : { title: lectures.length ? 'Try a short practice quiz after your next lesson' : 'Start with one topic you want to understand', body: lectures.length ? 'A quick recall check helps us learn which explanations and study formats are useful for you.' : 'You don’t need to upload notes to get started. Choose a subject and we’ll build the foundations together.' }
  return <>
    <PageHeader eyebrow="A STUDY PLAN THAT LEARNS WITH YOU" title="Study suggestions" description="Your practice quietly shapes the next useful step. We keep individual performance out of this view." />
    <div className="suggestion-list">
      <article className="suggestion-card"><span className="suggestion-icon"><Sparkles size={17} /></span><div><span className="eyebrow">TRY THIS NEXT</span><h3>{nextStudy.title}</h3><p>{nextStudy.body}</p></div></article>
      <article className="suggestion-card"><span className="suggestion-icon warm"><CalendarDays size={17} /></span><div><span className="eyebrow">PLAN AHEAD</span><h3>{upcoming ? `Keep a little space for ${upcoming.title}` : 'No exam coming up?'}</h3><p>{upcoming ? `Your exam is ${daysUntil(upcoming.exam_date)} days away. Short sessions leave room for rest and catch-up.` : 'Use the calendar to build a gentle learning rhythm without a deadline.'}</p></div></article>
      <article className="suggestion-card"><span className="suggestion-icon blue"><BookOpen size={17} /></span><div><span className="eyebrow">BUILD CONFIDENCE</span><h3>{lowConfidence || missedQuiz ? `Continue with ${signalLecture?.title || 'a recent topic'}` : lectures.length ? 'Revisit an earlier idea before moving on' : 'Learn one prerequisite at a time'}</h3><p>{lowConfidence || missedQuiz ? 'A recent answer or confidence check suggests another short practice session may help.' : 'We’ll bring back earlier material at useful intervals, then adapt based on how you respond.'}</p></div></article>
    </div>
    <p className="privacy-note">Recommendations use lightweight rules based on recent practice signals. Individual performance is not shown on this page.</p>
  </>
}

function PreferencesPage({ theme, setTheme, session, onSignOut }: { theme: Theme; setTheme: (theme: Theme) => void; session: Session | null; onSignOut: () => Promise<void> }) {
  return <><PageHeader eyebrow="MAKE THIS SPACE YOURS" title="Preferences" description="Small choices to make studying feel a little more comfortable." /><section className="settings-section card-surface"><div className="settings-heading"><span className="settings-icon"><Sun size={17} /></span><div><strong>Appearance</strong><small>Choose a theme for your study space.</small></div></div><div className="theme-picker">{(['light', 'dark', 'system'] as Theme[]).map(value => <button key={value} className={theme === value ? 'chosen' : ''} onClick={() => setTheme(value)}>{value === 'light' ? <Sun size={15} /> : value === 'dark' ? <Moon size={15} /> : <Settings size={15} />}{value[0].toUpperCase() + value.slice(1)}</button>)}</div></section><section className="settings-section card-surface"><div className="settings-heading"><span className="settings-icon"><GraduationCap size={17} /></span><div><strong>Learning profile</strong><small>Study signals help tailor recommendations by subject.</small></div></div><p className="settings-note">Your answers, review choices, and confidence feedback are used to improve your plan. We don’t display a single score for your learning ability.</p></section>{session && <section className="settings-section card-surface"><div className="settings-heading"><span className="settings-icon"><LogOut size={17} /></span><div><strong>Account</strong><small>{session.user.email} · synced across devices</small></div></div><button className="secondary" onClick={() => void onSignOut()}>Sign out</button></section>}<div className="integration-note"><strong>Connected services</strong><p>Supabase stores your account and study library. The Gemini API key stays on the server. Check your configured services’ data policies before adding sensitive lecture content.</p></div></>
}

export default App
