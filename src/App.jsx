import { useEffect, useMemo, useRef, useState } from 'react';
import brand from './assets/brand.png';

export default function App() {
  const [tab, setTab] = useState('jugar');
  const [versions, setVersions] = useState([]);
  const [instances, setInstances] = useState([]);
  const [java, setJava] = useState(null);
  const [username, setUsername] = useState('Ferro');
  const [versionId, setVersionId] = useState('1.21.1');
  const [instanceName, setInstanceName] = useState('Mi instancia');
  const [instanceType, setInstanceType] = useState('vanilla');
  const [loaders, setLoaders] = useState([]);
  const [loaderVersion, setLoaderVersion] = useState('');
  const [modQuery, setModQuery] = useState('fabric api');
  const [modHits, setModHits] = useState([]);
  const [mods, setMods] = useState([]);
  const [modsFor, setModsFor] = useState('');
  const [searching, setSearching] = useState(false);
  const [installingId, setInstallingId] = useState(null);
  const [installedIds, setInstalledIds] = useState([]);
  const [packMc, setPackMc] = useState('1.21.1');
  const [packQuery, setPackQuery] = useState('fabulously optimized');
  const [packHits, setPackHits] = useState([]);
  const [packVers, setPackVers] = useState({});
  const [packBusy, setPackBusy] = useState(null);
  const [clientId, setClientId] = useState('');
  const [account, setAccount] = useState(null);
  const [authStep, setAuthStep] = useState(null);
  const [browserWaiting, setBrowserWaiting] = useState(false);
  const [pollCount, setPollCount] = useState(0);
  const pollRef = useRef(null);
  const [launchInstance, setLaunchInstance] = useState('');
  const [log, setLog] = useState('[ferro] listo\n');
  const [running, setRunning] = useState(false);
  const [logLevel, setLogLevel] = useState('todo');
  const [logSearch, setLogSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [settingsFor, setSettingsFor] = useState('');
  const [sRam, setSRam] = useState(2048);
  const [sW, setSW] = useState(854);
  const [sH, setSH] = useState(480);
  const [sJavaMode, setSJavaMode] = useState('auto');
  const [sJavaPath, setSJavaPath] = useState('');
  const [saving, setSaving] = useState(false);
  const logRef = useRef(null);

  const refresh = async () => {
    try {
      setVersions(await window.ferro.versions());
      const inst = await window.ferro.instances();
      setInstances(inst);
      if (inst[0] && !launchInstance) setLaunchInstance(inst[0].name);
      if (inst[0] && !modsFor) setModsFor(inst[0].name);
      setJava(await window.ferro.java());
      try { setAccount(await window.ferro.authStatus()); } catch {}
    } catch (e) {
      setLog((l) => l + `[error] ${e.message}\n`);
    }
  };

  const loadMods = async (name) => {
    if (!name) return;
    try { setMods(await window.ferro.mods({ instanceName: name })); }
    catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
  };

  useEffect(() => { if (tab === 'mods' && modsFor) loadMods(modsFor); }, [modsFor]);

  const doSearch = async () => {
    setSearching(true);
    try {
      const inst = instances.find((i) => i.name === modsFor);
      const hits = await window.ferro.modSearch({ query: modQuery, mcVersion: inst?.versionId || versionId });
      setModHits(hits);
      setInstalledIds([]);
    } catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
    finally { setSearching(false); }
  };

  const doInstall = async (projectId, title) => {
    if (installingId) return;
    setInstallingId(projectId);
    try {
      setLog((l) => l + `[ferro] instalando ${title} en ${modsFor}...\n`);
      const r = await window.ferro.modInstall({ instanceName: modsFor, projectId });
      setLog((l) => l + `[ferro] instalado ${r.file}\n`);
      setInstalledIds((s) => [...s, projectId]);
      await loadMods(modsFor);
    } catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
    finally { setInstallingId(null); }
  };

  const doPackSearch = async () => {
    try { setPackHits(await window.ferro.packSearch({ query: packQuery, mcVersion: packMc })); setPackVers({}); }
    catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
  };

  const doPackVers = async (projectId) => {
    try {
      const vers = await window.ferro.packVersions({ projectId, mcVersion: packMc });
      setPackVers((p) => ({ ...p, [projectId]: vers }));
    }
    catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
  };

  const doPackInstall = async (pack, v) => {
    if (packBusy) return;
    setPackBusy(v.id);
    try {
      setTab('jugar');
      const r = await window.ferro.packInstall({ name: `${pack.title} ${v.number}`, projectId: pack.id, packVersionId: v.id, mcVersion: packMc });
      setLog((l) => l + `[ferro] instancia ${r.name} creada desde modpack\n`);
      await refresh();
      setLaunchInstance(r.name);
    } catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
    finally { setPackBusy(null); }
  };

  const loadAuth = async () => {
    try {
      setClientId(await window.ferro.clientId() || '');
      setAccount(await window.ferro.authStatus());
    } catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
  };

  const stopPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  useEffect(() => stopPoll, []);

  useEffect(() => {
    window.ferro.onAuthResult?.((err, data) => {
      setBrowserWaiting(false);
      if (err) setLog((l) => l + `[error] ${err.error || err}\n`);
      else {
        setLog((l) => l + `[ferro] sesión iniciada: ${data.name}\n`);
        loadAuth();
      }
    });
  }, []);

  const doBrowserAuth = async () => {
    try {
      setBrowserWaiting(true);
      await window.ferro.authWindow();
      setLog((l) => l + '[ferro] completa el login en la ventana de Microsoft…\n');
    } catch (e) { setBrowserWaiting(false); setLog((l) => l + `[error] ${e.message}\n`); }
  };

  const cancelBrowserAuth = async () => {
    setBrowserWaiting(false);
    try { await window.ferro.authBrowserCancel(); } catch {}
    try { await window.ferro.authWindowCancel(); } catch {}
  };

  const doAuthPollOnce = async (s) => {
    const r = await window.ferro.authPoll({ deviceCode: (s || authStep)?.deviceCode });
    setPollCount((c) => c + 1);
    if (r.status === 'done') {
      stopPoll(); setAuthStep(null);
      setLog((l) => l + `[ferro] sesión iniciada: ${r.name}\n`);
      loadAuth();
    } else if (r.status === 'error') {
      stopPoll(); setAuthStep(null);
      setLog((l) => l + `[error] ${r.error}\n`);
    }
    return r;
  };

  const doAuthStart = async () => {
    try {
      const s = await window.ferro.authStart();
      setAuthStep(s);
      setPollCount(0);
      setLog((l) => l + `[ferro] autoriza con el código ${s.userCode} en ${s.verificationUri}\n`);
      stopPoll();
      pollRef.current = setInterval(async () => {
        try { await doAuthPollOnce(s); }
        catch (e) { stopPoll(); setAuthStep(null); setLog((l) => l + `[error] ${e.message}\n`); }
      }, s.interval);
    } catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
  };

  const doLogout = async () => {
    stopPoll(); setAuthStep(null);
    await window.ferro.authLogout();
    setAccount(null);
    setLog((l) => l + '[ferro] sesión cerrada\n');
  };

  useEffect(() => {
    window.ferro.onLog((t) => {
      setLog((l) => l + t);
      if (/proceso terminado|error al arrancar/i.test(t)) setRunning(false);
    });
    refresh();
    window.ferro.status?.().then((s) => setRunning(!!s?.running)).catch(()=>{});
  }, []);

  useEffect(() => {
    if (instanceType !== 'fabric') return;
    window.ferro.fabricLoaders(versionId).then((l) => {
      setLoaders(l);
      if (l[0]) setLoaderVersion(l[0].loader);
    }).catch((e) => setLog((x) => x + `[error fabric] ${e.message}\n`));
  }, [instanceType, versionId]);

  const create = async () => {
    try {
      await window.ferro.createInstance({ name: instanceName, versionId, type: instanceType, loaderVersion: instanceType === 'fabric' ? loaderVersion : undefined });
      setLog((l) => l + `[ferro] instancia creada: ${instanceName} (${versionId}${instanceType === 'fabric' ? ` + fabric ${loaderVersion}` : ''})\n`);
      refresh();
    } catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
  };

  const play = async () => {
    try {
      setTab('jugar');
      setLog((l) => l + `[ferro] lanzando ${launchInstance} como ${username}...\n`);
      setRunning(true);
      await window.ferro.launch({ instanceName: launchInstance, username });
    } catch (e) { setLog((l) => l + `[error] ${e.message}\n`); setRunning(false); }
  };

  const stop = async () => {
    try { await window.ferro.stop(); }
    catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
  };

  const filteredLog = useMemo(() => {
    const lines = log.split('\n');
    return lines.filter((ln) => {
      if (logLevel === 'error' && !/error|exception|caused|fail|FATAL/i.test(ln)) return false;
      if (logLevel === 'warn' && !/warn|aviso/i.test(ln)) return false;
      if (logLevel === 'ferro' && !/^\[ferro\]|^\[error\]/i.test(ln)) return false;
      if (logSearch && !ln.toLowerCase().includes(logSearch.toLowerCase())) return false;
      return true;
    }).join('\n');
  }, [log, logLevel, logSearch]);

  useEffect(() => {
    if (autoScroll && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [filteredLog, autoScroll]);

  const editSettings = (name) => {
    setSettingsFor(name);
    const i = instances.find((x) => x.name === name);
    if (i?.settings) {
      setSRam(i.settings.ramMb); setSW(i.settings.width); setSH(i.settings.height);
      setSJavaMode(i.settings.javaMode); setSJavaPath(i.settings.javaPath || '');
    }
  };

  const saveSettings = async () => {
    if (!settingsFor || saving) return;
    setSaving(true);
    try {
      await window.ferro.updateSettings({ instanceName: settingsFor, patch: { ramMb: sRam, width: sW, height: sH, javaMode: sJavaMode, javaPath: sJavaPath } });
      setLog((l) => l + `[ferro] ajustes guardados en ${settingsFor}\n`);
      refresh();
    } catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
    finally { setSaving(false); }
  };

  return (
    <div className="layout">
      <div className="side">
        <img className="brand-logo" src={brand} alt="FerroLauncher" />
        <button className={tab==='jugar'?'active':''} onClick={()=>setTab('jugar')}>▶ Jugar</button>
        <button className={tab==='versiones'?'active':''} onClick={()=>setTab('versiones')}>🧊 Versiones</button>
        <button className={tab==='instancias'?'active':''} onClick={()=>setTab('instancias')}>📦 Instancias</button>
        <button className={tab==='mods'?'active':''} onClick={()=>{setTab('mods'); if(modsFor) loadMods(modsFor);}}>🧩 Mods</button>
        <button className={tab==='packs'?'active':''} onClick={()=>setTab('packs')}>🎁 Modpacks</button>
        <button className={tab==='cuenta'?'active':''} onClick={()=>{setTab('cuenta'); loadAuth();}}>👤 Cuenta</button>
        <button className={tab==='ajustes'?'active':''} onClick={()=>setTab('ajustes')}>⚙️ Ajustes</button>
        <div className="ver">v0.3.0 · ajustes + consola</div>
      </div>
      <div className="main">
        {tab==='jugar' && (
          <div className="card">
            <h2>Jugar (offline)</h2>
            <div className="row">
              <input value={username} onChange={(e)=>setUsername(e.target.value)} placeholder="Usuario" />
              <select value={launchInstance} onChange={(e)=>setLaunchInstance(e.target.value)}>
                {instances.map((i)=><option key={i.name} value={i.name}>{i.name} ({i.versionId}{i.type==='fabric'?' · fabric':''})</option>)}
              </select>
              {!running
                ? <button className="primary" onClick={play} disabled={!launchInstance}>▶ JUGAR</button>
                : <button className="primary" onClick={stop} style={{filter:'hue-rotate(140deg)'}}>⏹ DETENER</button>}
              <button className="ghost" onClick={refresh}>Recargar</button>
              {running && <span className="pill green"><span className="spinner" />en ejecución</span>}
              {account ? <span className="pill green">✓ {account.name} (online)</span> : <span className="pill">offline</span>}
            </div>
            {instances.length===0 && <p>Crea tu primera instancia en 📦 Instancias.</p>}
            <h3>Consola</h3>
            <div className="row" style={{marginBottom:8}}>
              <select value={logLevel} onChange={(e)=>setLogLevel(e.target.value)}>
                <option value="todo">Todo</option>
                <option value="ferro">Solo Ferro</option>
                <option value="warn">Avisos</option>
                <option value="error">Errores</option>
              </select>
              <input value={logSearch} onChange={(e)=>setLogSearch(e.target.value)} placeholder="Filtrar texto..." />
              <button className="ghost" onClick={()=>setAutoScroll(!autoScroll)}>{autoScroll ? '✓ Autoscroll' : 'Autoscroll'}</button>
              <button className="ghost" onClick={()=>setLog('')}>Limpiar</button>
            </div>
            <div className="log" ref={logRef}>{filteredLog}</div>
          </div>
        )}
        {tab==='versiones' && (
          <div className="card">
            <h2>Versiones release (Mojang)</h2>
            <div className="grid">
              {versions.map((v)=><div key={v.id} className="card"><b>{v.id}</b> <span className="pill">{v.type}</span><div style={{fontSize:12, opacity:.7}}>{new Date(v.releaseTime).toLocaleDateString()}</div></div>)}
            </div>
          </div>
        )}
        {tab==='instancias' && (
          <div className="card">
            <h2>Crear instancia</h2>
            <div className="row">
              <input value={instanceName} onChange={(e)=>setInstanceName(e.target.value)} placeholder="Nombre" />
              <select value={versionId} onChange={(e)=>setVersionId(e.target.value)}>
                {versions.map((v)=><option key={v.id} value={v.id}>{v.id}</option>)}
              </select>
              <select value={instanceType} onChange={(e)=>setInstanceType(e.target.value)}>
                <option value="vanilla">Vanilla</option>
                <option value="fabric">Fabric</option>
              </select>
              {instanceType==='fabric' && (
                <select value={loaderVersion} onChange={(e)=>setLoaderVersion(e.target.value)}>
                  {loaders.map((l)=><option key={l.loader} value={l.loader}>{l.loader}{l.stable?' (estable)':''}</option>)}
                </select>
              )}
              <button className="primary" onClick={create}>Crear</button>
            </div>
            <h3>Instaladas ({instances.length})</h3>
            <div className="grid">
              {instances.map((i)=><div key={i.name} className="card"><b>{i.name}</b><div className="pill">{i.versionId}{i.type==='fabric' ? ` + fabric ${i.loaderVersion||''}` : ''}</div><div className="pill">{(i.settings?.ramMb||2048)/1024} GB · {i.settings?.width||854}×{i.settings?.height||480}</div><div className="row"><button className="ghost" onClick={()=>editSettings(i.name)}>⚙ Ajustes</button></div></div>)}
            </div>
            {settingsFor && (
              <>
                <h3>Ajustes de {settingsFor}</h3>
                <div className="row">
                  <label>RAM (MB) <input type="number" value={sRam} min={512} max={16384} step={512} onChange={(e)=>setSRam(Number(e.target.value))} style={{width:110}} /></label>
                  <label>Ancho <input type="number" value={sW} min={320} max={7680} onChange={(e)=>setSW(Number(e.target.value))} style={{width:90}} /></label>
                  <label>Alto <input type="number" value={sH} min={240} max={4320} onChange={(e)=>setSH(Number(e.target.value))} style={{width:90}} /></label>
                  <select value={sJavaMode} onChange={(e)=>setSJavaMode(e.target.value)}>
                    <option value="auto">Java auto</option>
                    <option value="custom">Java personalizado</option>
                  </select>
                  {sJavaMode==='custom' && <input value={sJavaPath} onChange={(e)=>setSJavaPath(e.target.value)} placeholder="C:\...\bin\java.exe" style={{minWidth:260}} />}
                  <button className="primary" onClick={saveSettings} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
                </div>
              </>
            )}
          </div>
        )}
        {tab==='mods' && (
          <div className="card">
            <h2>Mods (Modrinth + Fabric)</h2>
            <div className="row">
              <select value={modsFor} onChange={(e)=>{setModsFor(e.target.value); loadMods(e.target.value);}}>
                {instances.map((i)=><option key={i.name} value={i.name}>{i.name} ({i.versionId}{i.type==='fabric'?' fabric':''})</option>)}
              </select>
              <input value={modQuery} onChange={(e)=>setModQuery(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter') doSearch();}} placeholder="Buscar mod..." />
              <button className="primary" onClick={doSearch} disabled={searching || !modsFor}>{searching ? 'Buscando…' : 'Buscar'}</button>
              <button className="ghost" onClick={()=>loadMods(modsFor)} disabled={!modsFor}>Ver instalados</button>
            </div>
            {!modsFor && <p>Crea primero una instancia Fabric en 📦 Instancias.</p>}
            <h3>Resultados</h3>
            {modHits.length===0 && <p style={{opacity:.6}}>Sin resultados todavía — busca algo arriba.</p>}
            <div className="grid">
              {modHits.map((m)=>{
                const busy = installingId===m.id;
                const done = installedIds.includes(m.id);
                return (
                <div key={m.id} className="card">
                  <div className="mod-head">{m.icon && <img className="mod-icon" src={m.icon} alt="" />}<b>{m.title}</b></div>
                  <div className="desc">{m.description?.slice(0,120)}</div>
                  <div className="row">
                    <span className="pill">⬇ {m.downloads?.toLocaleString?.() || m.downloads}</span>
                    <button className={done ? 'ghost ok' : 'ghost'} disabled={busy || done || !modsFor} onClick={()=>doInstall(m.id, m.title)}>
                      {busy ? <><span className="spinner" />Instalando…</> : done ? '✓ Instalado' : 'Instalar'}
                    </button>
                  </div>
                </div>);
              })}
            </div>
            <h3>Instalados ({mods.length})</h3>
            <div className="grid">
              {mods.map((m)=><div key={m.file} className="card"><b>{m.file}</b><div className="pill">{(m.size/1048576).toFixed(1)} MB{m.disabled?' · desactivado':''}</div><div className="row">
                <button className="ghost" onClick={async()=>{await window.ferro.modToggle({instanceName:modsFor, file:m.file, disable:!m.disabled}); loadMods(modsFor);}}>{m.disabled?'Activar':'Desactivar'}</button>
                <button className="ghost" onClick={async()=>{await window.ferro.modRemove({instanceName:modsFor, file:m.file}); loadMods(modsFor);}}>Quitar</button>
              </div></div>)}
            </div>
          </div>
        )}
        {tab==='packs' && (
          <div className="card">
            <h2>Modpacks (1 clic)</h2>
            <div className="row">
              <select value={packMc} onChange={(e)=>setPackMc(e.target.value)}>
                {versions.map((v)=><option key={v.id} value={v.id}>{v.id}</option>)}
              </select>
              <input value={packQuery} onChange={(e)=>setPackQuery(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter') doPackSearch();}} placeholder="Buscar modpack..." />
              <button className="primary" onClick={doPackSearch}>Buscar</button>
            </div>
            <p style={{opacity:.65}}>Crea una instancia Fabric nueva con el MC + loader que pida el pack y descarga sus {` `}mods y configs. El progreso sale en ▶ Jugar.</p>
            <div className="grid">
              {packHits.map((p)=>(
                <div key={p.id} className="card">
                  <div className="mod-head">{p.icon && <img className="mod-icon" src={p.icon} alt="" />}<b>{p.title}</b></div>
                  <div className="desc">{p.description?.slice(0,120)}</div>
                  <div className="row">
                    <span className="pill">⬇ {p.downloads?.toLocaleString?.() || p.downloads}</span>
                    <button className="ghost" onClick={()=>doPackVers(p.id)}>Versiones</button>
                  </div>
                  {(packVers[p.id]||[]).map((v)=>(
                    <div className="row" key={v.id} style={{marginTop:8}}>
                      <span className="pill">{v.number}</span>
                      <button className="ghost" disabled={!!packBusy} onClick={()=>doPackInstall(p, v)}>
                        {packBusy===v.id ? <><span className="spinner" />Instalando…</> : 'Instalar'}
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
        {tab==='cuenta' && (
          <div className="card">
            <h2>Cuenta Microsoft</h2>
            <p>Sesión integrada: pulsa iniciar, autoriza en el navegador y listo. Sin cuenta, el launcher sigue en modo offline.</p>
            <div className="row">
              <input value={clientId} onChange={(e)=>setClientId(e.target.value)} placeholder="Client ID (por defecto el oficial)" style={{minWidth:300}} />
              <button className="ghost" onClick={async()=>{await window.ferro.setClientId({ clientId }); setLog((l)=>l+'[ferro] client ID guardado\n');}}>Guardar</button>
            </div>
            <h3>Estado</h3>
            {account
              ? <div className="row"><span className="pill green">✓ {account.name}</span><button className="ghost danger" onClick={doLogout}>Cerrar sesión</button></div>
              : browserWaiting
                ? <div className="card">
                    <p><span className="spinner" />Completa el login en la ventana de Microsoft y acepta los permisos…</p>
                    <button className="ghost" onClick={cancelBrowserAuth}>Cancelar</button>
                  </div>
                : !authStep
                  ? <div className="row">
                      <button className="primary" onClick={doBrowserAuth}>Iniciar sesión</button>
                    </div>
                  : null}
            {!account && !browserWaiting && (
              !authStep
                ? <p style={{marginTop:12}}><button className="ghost" onClick={doAuthStart} disabled={!clientId}>Método alternativo: código manual</button></p>
                : <div className="card">
                    <p>1. Abre <b>{authStep.verificationUri}</b></p>
                    <p>2. Introduce el código <b style={{fontSize:22, letterSpacing:2}}>{authStep.userCode}</b></p>
                    <p style={{opacity:.65}}><span className="spinner" />Esperando autorización… (comprobación {pollCount})</p>
                    <div className="row">
                      <button className="ghost" onClick={()=>doAuthPollOnce()}>Comprobar ahora</button>
                      <button className="ghost" onClick={()=>{stopPoll(); setAuthStep(null);}}>Cancelar</button>
                    </div>
                  </div>)}
          </div>
        )}
        {tab==='ajustes' && (
          <div className="card">
            <h2>Java</h2>
            <pre>{JSON.stringify(java, null, 2) || 'no encontrado'}</pre>
            <p style={{opacity:.7}}>Se usa el Java del sistema si cumple el requisito de la versión; si no, se descarga Temurin auto a runtimes/.</p>
          </div>
        )}
      </div>
    </div>
  );
}
