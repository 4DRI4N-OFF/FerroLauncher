import { Sparkles, X } from 'lucide-react';

// Isla minima: circulo con icono; al pasar el raton se estira el campo;
// la respuesta sale en una burbuja debajo.
export default function DynamicIsland(p) {
  const lastAi = [...(p.aiMsgs || [])].reverse().find((m) => m.role === 'ai');
  return (<>
    <div className={`island${p.open ? ' open' : ''}${p.aiBusy ? ' busy' : ''}`}>
      <span className="island-ico"><Sparkles size={17} /></span>
      <input
        className="island-field"
        value={p.aiInput}
        onChange={(e) => p.setAiInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); p.sendAi(); } }}
        placeholder={p.t('ai.ph')}
      />
      {p.aiBusy && <span className="is-dots"><i /><i /><i /></span>}
    </div>
    {p.open && (
      <div className="island-answer">
        <div className="island-answer-head">
          <span>{p.t('ai.title')}</span>
          <button className="mini" onClick={() => p.setOpen(false)}><X size={13} /></button>
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
