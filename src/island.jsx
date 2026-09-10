import { useEffect, useRef } from 'react';
import { Sparkles, X, Upload } from 'lucide-react';

// Dynamic Island: pildora flotante arriba que se expande en chat IA.
export default function DynamicIsland(p) {
  const inputRef = useRef(null);
  useEffect(() => {
    if (p.open) {
      const t = setTimeout(() => { try { inputRef.current?.focus(); } catch {} }, 350);
      return () => clearTimeout(t);
    }
  }, [p.open]);
  return (<>
    {p.open && <div className="island-dim" onClick={() => p.setOpen(false)} />}
    <div className={`island${p.open ? ' open' : ''}`}>
      <button className="island-pill" onClick={() => p.setOpen(true)} title={p.t('ai.title')}>
        <Sparkles size={15} />
        {p.aiBusy
          ? <span className="is-dots"><i /><i /><i /></span>
          : <span className="is-hint">{p.t('ai.tab')} · {p.t('ai.ph')}</span>}
      </button>
      <div className="island-body" aria-hidden={!p.open}>
        <div className="island-head">
          <span className="is-title"><Sparkles size={14} /> {p.t('ai.title')}</span>
          {p.aiBuiltIn
            ? <span className="pill green">✓ {p.t('ai.builtin')}</span>
            : (p.aiKey
              ? <span className="pill green">✓ {p.t('ai.keySaved')}</span>
              : <span className="pill">{p.t('ai.needKey')}</span>)}
          <button className="mini" onClick={() => p.setOpen(false)}><X size={14} /></button>
        </div>
        {!p.aiBuiltIn && (
          <div className="row is-config">
            <input type="password" value={p.aiKeyInput} onChange={(e) => p.setAiKeyInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); p.saveAiKey(); } }} placeholder={p.aiKey ? '••••••••' : p.t('ai.keyPh')} />
            <button className="ghost" onClick={p.saveAiKey}>{p.t('ai.save')}</button>
          </div>
        )}
        <div className="row is-config">
          {p.aiModels.length > 0 ? (
            <select value={p.aiModel} onChange={(e) => { p.setAiModel(e.target.value); try { localStorage.setItem('ferro-ai-model', e.target.value); } catch {} }}>
              {p.aiModels.map((m) => <option key={m.id} value={m.id}>{m.label || m.id}</option>)}
            </select>
          ) : (
            <input value={p.aiModel} onChange={(e) => { p.setAiModel(e.target.value); try { localStorage.setItem('ferro-ai-model', e.target.value); } catch {} }} placeholder="gemini-2.5-flash" />
          )}
          <button className="ghost" onClick={() => p.loadAiModels()}>{p.t('ai.refreshModels')}</button>
        </div>
        <div className="ai-chat is-chat">
          {p.aiMsgs.length === 0 && <div className="ai-msg ai-bot">{p.t('ai.hello')}</div>}
          {p.aiMsgs.map((m, ix) => (<div key={ix} className={`ai-msg ai-${m.role === 'ai' ? 'bot' : 'you'}`}>{m.text}</div>))}
          {p.aiBusy && <div className="ai-msg ai-bot"><span className="spinner" /> {p.t('ai.thinking')}</div>}
          <div ref={p.aiEndRef} />
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <input ref={inputRef} value={p.aiInput} onChange={(e) => p.setAiInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); p.sendAi(); } }} placeholder={p.t('ai.ph')} style={{ flex: 1 }} />
          <button className="primary" onClick={p.sendAi} disabled={p.aiBusy}>{p.t('ai.send')}</button>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="ghost" onClick={p.attachLog}><Upload size={14} /> {p.t('ai.attachLog')}</button>
          <button className="ghost" onClick={p.clearAi}>{p.t('ai.clear')}</button>
        </div>
      </div>
    </div>
  </>);
}
