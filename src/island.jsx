import { useEffect, useRef } from 'react';
import { Sparkles, X } from 'lucide-react';

// Isla discreta: escondida salvo hover arriba, Ctrl+K, trabajo o respuesta.
export default function DynamicIsland(p) {
  const inputRef = useRef(null);
  useEffect(() => {
    if (!p.focusSignal) return;
    const t = setTimeout(() => { try { inputRef.current?.focus(); } catch {} }, 60);
    return () => clearTimeout(t);
  }, [p.focusSignal]);
  const lastAi = [...(p.aiMsgs || [])].reverse().find((m) => m.role === 'ai');
  const maybeHide = (e) => {
    try {
      if (e?.relatedTarget?.closest?.('.island, .island-answer')) return;
    } catch {}
    if (!p.aiBusy && !p.open) p.setVisible(false);
  };
  return (<>
    <div className="island-trigger" onMouseEnter={() => p.setVisible(true)} />
    <div
      className={`island${p.open ? ' open' : ''}${p.aiBusy ? ' busy' : ''}${p.visible ? '' : ' gone'}`}
      onMouseLeave={maybeHide}
      onMouseEnter={() => { p.setVisible(true); p.dismissGreet(); }}
    >
      <span className="island-ico"><Sparkles size={17} /></span>
      <input
        ref={inputRef}
        className="island-field"
        value={p.aiInput}
        onChange={(e) => p.setAiInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); p.sendAi(); } }}
        onFocus={p.dismissGreet}
        placeholder={p.t('ai.ph')}
      />
      {p.aiBusy && <span className="is-dots"><i /><i /><i /></span>}
    </div>
    {p.greet && !p.open && (
      <div className="island-hello" onClick={p.summon}>
        <Sparkles size={13} /> {p.t('ai.greet')}
      </div>
    )}
    {p.open && (
      <div className="island-answer" onMouseLeave={maybeHide}>
        <div className="island-answer-head">
          <span>{p.t('ai.title')}</span>
          <button className="mini" onClick={() => { p.setOpen(false); p.setVisible(false); }}><X size={13} /></button>
        </div>
        {!p.aiBuiltIn && (
          <>
            <div className="row" style={{ marginTop: 8 }}>
              <input type="password" value={p.aiKeyInput} onChange={(e) => p.setAiKeyInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); p.saveAiKey(); } }} placeholder={p.aiKey ? '••••••••' : p.t('ai.keyPh')} style={{ flex: 1 }} />
              <button className="ghost" onClick={p.saveAiKey}>{p.t('ai.save')}</button>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              {p.aiModels.length > 0 ? (
                <select value={p.aiModel} onChange={(e) => { p.setAiModel(e.target.value); try { localStorage.setItem('ferro-ai-model', e.target.value); } catch {} }}>
                  {p.aiModels.map((m) => <option key={m.id} value={m.id}>{m.label || m.id}</option>)}
                </select>
              ) : (
                <input value={p.aiModel} onChange={(e) => { p.setAiModel(e.target.value); try { localStorage.setItem('ferro-ai-model', e.target.value); } catch {} }} placeholder="gemini-3.5-flash-lite" style={{ flex: 1 }} />
              )}
              <button className="ghost" onClick={() => p.loadAiModels()}>{p.t('ai.refreshModels')}</button>
            </div>
          </>
        )}
        <div className="island-answer-body">
          {lastAi ? lastAi.text : ''}
          {p.aiBusy && (<div style={{ marginTop: 8 }}><span className="spinner" /> {p.t('ai.thinking')}</div>)}
        </div>
      </div>
    )}
  </>);
}
