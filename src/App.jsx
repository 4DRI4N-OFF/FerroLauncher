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
  const [modTotal, setModTotal] = useState(0);
  const [fVersion, setFVersion] = useState('1.21.1');
  const [fLoader, setFLoader] = useState('fabric');
  const [fSort, setFSort] = useState('relevance');
  const [kind, setKind] = useState('mod');
  const kindName = kind === 'shader' ? 'shaders' : kind === 'resourcepack' ? 'resource packs' : 'mods';
  const [mods, setMods] = useState([]);
  const [modsFor, setModsFor] = useState('');
  const [searching, setSearching] = useState(false);
  const [installingId, setInstallingId] = useState(null);
  const [installedIds, setInstalledIds] = useState([]);
  const [packMc, setPackMc] = useState('1.21.1');
  const [packLoader, setPackLoader] = useState('');
  const [packSort, setPackSort] = useState('relevance');
  const [packTotal, setPackTotal] = useState(0);
  const [packQuery, setPackQuery] = useState('fabulously optimized');
  const [packHits, setPackHits] = useState([]);
  const [packVers, setPackVers] = useState({});
  const [packBusy, setPackBusy] = useState(null);
  const [clientId, setClientId] = useState('');
  const [account, setAccount] = useState(null);
  const [accts, setAccts] = useState([]);
  const [authStep, setAuthStep] = useState(null);
  const [browserWaiting, setBrowserWaiting] = useState(false);
  const [pollCount, setPollCount] = useState(0);
  const [appVer, setAppVer] = useState('');
  const [upd, setUpd] = useState({ state: 'idle' });
  const [skinInfo, setSkinInfo] = useState(null);
  const [skinName, setSkinName] = useState('');
  const [skinUrl, setSkinUrl] = useState('');
  const [skinVariant, setSkinVariant] = useState('classic');
  const [skinBusy, setSkinBusy] = useState(false);
  const [bkFor, setBkFor] = useState('');
  const [bkList, setBkList] = useState([]);
  const [intro, setIntro] = useState(true);
  const introImgRef = useRef(null);
  const sideLogoRef = useRef(null);
  const overlayRef = useRef(null);
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
      if (inst[0] && !bkFor) { setBkFor(inst[0].name); loadBackups(inst[0].name); }
      setJava(await window.ferro.java());
      try { setAccount(await window.ferro.authStatus()); } catch {}
    } catch (e) {
      setLog((l) => l + `[error] ${e.message}\n`);
    }
  };

  const loadMods = async (name, k) => {
    if (!name) return;
    try { setMods(await window.ferro.mods({ instanceName: name, kind: k || kind })); }
    catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
  };

  const loadBackups = async (name) => {
    if (!name) return;
    try { setBkList(await window.ferro.backups({ instanceName: name })); }
    catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
  };

  useEffect(() => { if (tab === 'mods' && modsFor) loadMods(modsFor); }, [modsFor]);

  useEffect(() => {
    const inst = instances.find((i) => i.name === modsFor);
    if (inst) {
      setFVersion(inst.versionId);
      if (inst.type !== 'vanilla') setFLoader(inst.type);
    }
  }, [modsFor]);

  const doSearch = async () => {
    setSearching(true);
    try {
      const r = await window.ferro.modSearch({ query: modQuery, mcVersion: fVersion, loader: fLoader, sort: fSort, kind });
      setModHits(r.hits || r);
      setModTotal(r.total || (r.hits || r).length);
      setInstalledIds([]);
    } catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
    finally { setSearching(false); }
  };

  const doInstall = async (projectId, title) => {
    if (installingId) return;
    setInstallingId(projectId);
    try {
      setLog((l) => l + `[ferro] instalando ${title} en ${modsFor}...\n`);
      const r = await window.ferro.modInstall({ instanceName: modsFor, projectId, kind });
      setLog((l) => l + `[ferro] instalado ${r.file}\n`);
      setInstalledIds((s) => [...s, projectId]);
      await loadMods(modsFor);
    } catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
    finally { setInstallingId(null); }
  };

  const doPackSearch = async () => {
    try {
      const r = await window.ferro.packSearch({ query: packQuery, mcVersion: packMc, loader: packLoader || undefined, sort: packSort });
      setPackHits(r.hits || r);
      setPackTotal(r.total || (r.hits || r).length);
      setPackVers({});
    }
    catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
  };

  const doPackVers = async (projectId) => {
    try {
      const vers = await window.ferro.packVersions({ projectId, mcVersion: packMc, loader: packLoader || undefined });
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
      setAccts(await window.ferro.accounts());
    } catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
  };

  const stopPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };

  const loadSkin = async (name) => {
    try { setSkinInfo(await window.ferro.skin({ name: name ?? skinName ?? username ?? 'Ferro' })); }
    catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
  };

  const applySkin = async () => {
    if (skinBusy) return;
    setSkinBusy(true);
    try {
      const r = await window.ferro.skinApply({ variant: skinVariant, url: skinUrl });
      setSkinInfo({ online: true, ...r });
      setLog((l) => l + `[ferro] skin actualizada (${skinVariant})\n`);
    } catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
    finally { setSkinBusy(false); }
  };

  const resetSkin = async () => {
    try {
      await window.ferro.skinReset();
      setLog((l) => l + '[ferro] skin restablecida\n');
      loadSkin();
    } catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
  };
  useEffect(() => stopPoll, []);

  // Intro: el logo vuela del centro (donde estaba el splash) al sidebar
  useEffect(() => {
    document.body.classList.add('intro-lock');
    const unlock = () => document.body.classList.remove('intro-lock');
    let done = false;
    const fly = async () => {
      if (done) return;
      done = true;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const img = introImgRef.current, target = sideLogoRef.current, ov = overlayRef.current;
      if (!img || !target) { unlock(); setIntro(false); return; }
      const r1 = img.getBoundingClientRect(), r2 = target.getBoundingClientRect();
      const dx = r2.left + r2.width / 2 - (r1.left + r1.width / 2);
      const dy = r2.top + r2.height / 2 - (r1.top + r1.height / 2);
      const s = r2.width / r1.width;
      try {
        const anim = img.animate([
          { transform: 'translate(0, 0) scale(1) rotate(0deg)' },
          { transform: `translate(${dx}px, ${dy}px) scale(${s}) rotate(-360deg)` },
        ], { duration: 1100, easing: 'cubic-bezier(.65, 0, .35, 1)', fill: 'forwards' });
        await anim.finished;
      } catch {}
      // Corte seco al logo real: sin fundido que delate 1px de diferencia
      unlock();
      setIntro(false);
    };
    if (window.ferro?.onShown) {
      let fallback;
      // El vuelo arranca cuando la ventana deja de crecer (medidas ya estables)
      window.ferro.onSettled?.(() => fly());
      window.ferro.onShown(() => {
        fallback = setTimeout(fly, 2000); // por si settled no llega
      });
      const t = setTimeout(fly, 9000); // salvavidas
      return () => { clearTimeout(t); clearTimeout(fallback); unlock(); };
    }
    const t = setTimeout(fly, 600); // fuera de Electron
    return () => { clearTimeout(t); unlock(); };
  }, []);

  useEffect(() => {
    window.ferro.onAuthResult?.((err, data) => {
      setBrowserWaiting(false);
      if (err) setLog((l) => l + `[error] ${err.error || err}\n`);
      else {
        setLog((l) => l + `[ferro] sesión iniciada: ${data.name}\n`);
        loadAuth();
      }
    });
    window.ferro.onUpdate?.((d) => setUpd(d));
    window.ferro.appVersion?.().then(setAppVer).catch(()=>{});
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
    if (instanceType === 'vanilla') return;
    window.ferro.loaders({ mcVersion: versionId, type: instanceType }).then((l) => {
      setLoaders(l);
      if (l[0]) setLoaderVersion(l[0].loader);
    }).catch((e) => setLog((x) => x + `[error ${instanceType}] ${e.message}\n`));
  }, [instanceType, versionId]);

  const create = async () => {
    try {
      await window.ferro.createInstance({ name: instanceName, versionId, type: instanceType, loaderVersion: instanceType === 'vanilla' ? undefined : loaderVersion });
      setLog((l) => l + `[ferro] instancia creada: ${instanceName} (${versionId}${instanceType === 'vanilla' ? '' : ` + ${instanceType} ${loaderVersion}`})\n`);
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
        <img ref={sideLogoRef} className="brand-logo" src={brand} alt="FerroLauncher" />
        <button className={tab==='jugar'?'active':''} onClick={()=>setTab('jugar')}>▶ Jugar</button>
        <button className={tab==='versiones'?'active':''} onClick={()=>setTab('versiones')}>🧊 Versiones</button>
        <button className={tab==='instancias'?'active':''} onClick={()=>setTab('instancias')}>📦 Instancias</button>
        <button className={tab==='mods'?'active':''} onClick={()=>{setTab('mods'); if(modsFor) loadMods(modsFor);}}>🧩 Contenido</button>
        <button className={tab==='packs'?'active':''} onClick={()=>setTab('packs')}>🎁 Modpacks</button>
        <button className={tab==='cuenta'?'active':''} onClick={()=>{setTab('cuenta'); loadAuth();}}>👤 Cuenta</button>
        <button className={tab==='skin'?'active':''} onClick={()=>{setTab('skin'); loadSkin();}}>🎨 Skin</button>
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
                {instances.map((i)=><option key={i.name} value={i.name}>{i.name} ({i.versionId}{i.type==='vanilla'?'':' · '+i.type})</option>)}
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
              {versions.map((v)=><div key={v.id} className="card"><div className="card-title">{v.id}</div><div className="meta"><span className="pill">{v.type}</span><span className="pill">{new Date(v.releaseTime).toLocaleDateString()}</span></div></div>)}
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
                <option value="quilt">Quilt</option>
                <option value="forge">Forge</option>
                <option value="neoforge">NeoForge</option>
              </select>
              {instanceType!=='vanilla' && (
                <select value={loaderVersion} onChange={(e)=>setLoaderVersion(e.target.value)}>
                  {loaders.map((l)=><option key={l.loader} value={l.loader}>{l.loader}{l.tag?` (${l.tag})`:''}{l.stable && !l.tag?' (estable)':''}</option>)}
                </select>
              )}
              <button className="primary" onClick={create}>Crear</button>
            </div>
            <h3>Instaladas ({instances.length})</h3>
            <div className="grid">
              {instances.map((i)=><div key={i.name} className="card"><div className="card-title" title={i.name}>{i.name}</div><div className="meta"><span className="pill">{i.versionId}{i.type==='vanilla' ? '' : ` + ${i.type} ${i.loaderVersion||''}`}</span><span className="pill">{(i.settings?.ramMb||2048)/1024} GB · {i.settings?.width||854}×{i.settings?.height||480}</span></div><div className="actions"><button className="ghost" onClick={()=>editSettings(i.name)}>⚙ Ajustes</button><button className="ghost" onClick={async()=>{await window.ferro.exportInstance({instanceName:i.name});}}>Exportar</button></div></div>)}
            </div>
            <div className="row" style={{marginTop:12}}>
              <button className="primary" onClick={async()=>{const n=await window.ferro.importInstance(); if(n){setLog((l)=>l+`[ferro] importada ${n}\n`); refresh();}}}>Importar .ferro</button>
            </div>
            <h3>Copias de {bkFor || '…'}</h3>
            <div className="row">
              <select value={bkFor} onChange={(e)=>{setBkFor(e.target.value); loadBackups(e.target.value);}}>
                {instances.map((i)=><option key={i.name} value={i.name}>{i.name}</option>)}
              </select>
              <button className="ghost" onClick={async()=>{await window.ferro.backupCreate({instanceName:bkFor}); loadBackups(bkFor);}} disabled={!bkFor}>Crear copia</button>
            </div>
            {bkList.length===0 && <p style={{opacity:.6}}>Sin copias todavía.</p>}
            <div className="grid" style={{marginTop:10}}>
              {bkList.map((b)=><div key={b.file} className="card"><div className="card-title" title={b.file}>{b.file}</div><div className="meta"><span className="pill">{(b.size/1048576).toFixed(1)} MB</span></div><div className="actions">
                <button className="ghost" onClick={async()=>{await window.ferro.backupRestore({instanceName:bkFor, file:b.file});}}>Restaurar</button>
                <button className="ghost danger" onClick={async()=>{await window.ferro.backupDelete({instanceName:bkFor, file:b.file}); loadBackups(bkFor);}}>Eliminar</button>
              </div></div>)}
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
            <h2>Contenido (Modrinth)</h2>
            <div className="row">
              <select value={modsFor} onChange={(e)=>{setModsFor(e.target.value); loadMods(e.target.value);}}>
                {instances.map((i)=><option key={i.name} value={i.name}>{i.name} ({i.versionId}{i.type==='vanilla'?'':' '+i.type})</option>)}
              </select>
              <select value={kind} onChange={(e)=>{setKind(e.target.value); setModHits([]); setInstalledIds([]); loadMods(modsFor, e.target.value);}} title="Tipo">
                <option value="mod">Mods</option>
                <option value="shader">Shaders</option>
                <option value="resourcepack">Resource packs</option>
              </select>
              <input value={modQuery} onChange={(e)=>setModQuery(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter') doSearch();}} placeholder={`Buscar ${kindName}...`} />
              <select value={fVersion} onChange={(e)=>setFVersion(e.target.value)} title="Versión de Minecraft">
                {versions.map((v)=><option key={v.id} value={v.id}>{v.id}</option>)}
              </select>
              {kind==='mod' && (
              <select value={fLoader} onChange={(e)=>setFLoader(e.target.value)} title="Loader">
                <option value="fabric">Fabric</option>
                <option value="quilt">Quilt</option>
                <option value="forge">Forge</option>
                <option value="neoforge">NeoForge</option>
              </select>
              )}
              <select value={fSort} onChange={(e)=>setFSort(e.target.value)} title="Orden">
                <option value="relevance">Relevancia</option>
                <option value="downloads">Descargas</option>
                <option value="follows">Seguidores</option>
                <option value="newest">Novedades</option>
                <option value="updated">Actualizados</option>
              </select>
              <button className="primary" onClick={doSearch} disabled={searching || !modsFor}>{searching ? 'Buscando…' : 'Buscar'}</button>
              <button className="ghost" onClick={()=>loadMods(modsFor)} disabled={!modsFor}>Ver instalados</button>
            </div>
            {!modsFor && <p>Crea primero una instancia con loader (Fabric, Quilt, Forge o NeoForge) en 📦 Instancias.</p>}
            <h3>Resultados{modTotal>0 && ` (${modTotal.toLocaleString()})`} · {fVersion} · {fLoader}</h3>
            {modHits.length===0 && <p style={{opacity:.6}}>Sin resultados todavía — busca algo arriba.</p>}
            <div className="grid">
              {modHits.map((m)=>{
                const busy = installingId===m.id;
                const done = installedIds.includes(m.id);
                return (
                <div key={m.id} className="card">
                  <div className="mod-head">{m.icon && <img className="mod-icon" src={m.icon} alt="" />}<b>{m.title}</b></div>
                  <div className="desc">{m.description?.slice(0,120)}</div>
                  <div className="meta"><span className="pill">⬇ {m.downloads?.toLocaleString?.() || m.downloads}</span>{m.updated && <span className="pill">↻ {new Date(m.updated).toLocaleDateString()}</span>}{m.client==='required' && <span className="pill green">cliente</span>}</div>
                  <div className="actions">
                    <button className={done ? 'ghost ok' : 'ghost'} disabled={busy || done || !modsFor} onClick={()=>doInstall(m.id, m.title)}>
                      {busy ? <><span className="spinner" />Instalando…</> : done ? '✓ Instalado' : 'Instalar'}
                    </button>
                  </div>
                </div>);
              })}
            </div>
            <h3>Instalados ({mods.length})</h3>
            <div className="grid">
              {mods.map((m)=><div key={m.file} className="card"><div className="card-title" title={m.file}>{m.file}</div><div className="meta"><span className="pill">{(m.size/1048576).toFixed(1)} MB{m.disabled?' · desactivado':''}</span></div><div className="actions">
                <button className="ghost" onClick={async()=>{await window.ferro.modToggle({instanceName:modsFor, file:m.file, disable:!m.disabled, kind}); loadMods(modsFor);}}>{m.disabled?'Activar':'Desactivar'}</button>
                <button className="ghost danger" onClick={async()=>{await window.ferro.modRemove({instanceName:modsFor, file:m.file, kind}); loadMods(modsFor);}}>Quitar</button>
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
              <select value={packLoader} onChange={(e)=>setPackLoader(e.target.value)} title="Loader">
                <option value="">Todos</option>
                <option value="fabric">Fabric</option>
                <option value="quilt">Quilt</option>
                <option value="forge">Forge</option>
                <option value="neoforge">NeoForge</option>
              </select>
              <select value={packSort} onChange={(e)=>setPackSort(e.target.value)} title="Orden">
                <option value="relevance">Relevancia</option>
                <option value="downloads">Descargas</option>
                <option value="follows">Seguidores</option>
                <option value="newest">Novedades</option>
                <option value="updated">Actualizados</option>
              </select>
              <button className="primary" onClick={doPackSearch}>Buscar</button>
            </div>
            <p style={{opacity:.65}}>{packTotal>0 ? `${packTotal.toLocaleString()} resultados · ` : ''}{packMc}{packLoader ? ` · ${packLoader}` : ''}. Crea una instancia nueva con el MC + loader que pida el pack. El progreso sale en ▶ Jugar.</p>
            <div className="grid">
              {packHits.map((p)=>(
                <div key={p.id} className="card">
                  <div className="mod-head">{p.icon && <img className="mod-icon" src={p.icon} alt="" />}<b>{p.title}</b></div>
                  <div className="desc">{p.description?.slice(0,120)}</div>
                  <div className="meta"><span className="pill">⬇ {p.downloads?.toLocaleString?.() || p.downloads}</span>{p.updated && <span className="pill">↻ {new Date(p.updated).toLocaleDateString()}</span>}</div>
                  <div className="actions"><button className="ghost" onClick={()=>doPackVers(p.id)}>Versiones</button></div>
                  {(packVers[p.id]||[]).map((v)=>(
                    <div className="meta" key={v.id}>
                      <span className="pill">{v.number}</span>
                      {(v.loaders||[]).map((ld)=><span className="pill" key={ld}>{ld}</span>)}
                      {(v.game||[]).slice(0,3).map((g)=><span className="pill" key={g}>{g}</span>)}
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
            <h3>Cuentas ({accts.length})</h3>
            {accts.length===0 && <p style={{opacity:.6}}>Sin cuentas. Inicia sesión abajo para añadir la primera.</p>}
            <div className="grid">
              {accts.map((a)=><div key={a.uuid} className="card"><div className="card-title">{a.name}</div><div className="meta">{a.active && <span className="pill green">✓ activa</span>}</div><div className="actions">
                {!a.active && <button className="ghost" onClick={async()=>{await window.ferro.authSelect({uuid:a.uuid}); loadAuth();}}>Usar</button>}
                <button className="ghost danger" onClick={async()=>{await window.ferro.authRemove({uuid:a.uuid}); loadAuth();}}>Quitar</button>
              </div></div>)}
            </div>
            <h3>Estado</h3>
            {account
              ? <><div className="row"><span className="pill green">✓ {account.name}</span><button className="ghost danger" onClick={doLogout}>Cerrar sesión</button></div>
                {!browserWaiting && !authStep && <p style={{marginTop:10}}><button className="ghost" onClick={doBrowserAuth}>Añadir otra cuenta</button></p>}</>
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
        {tab==='skin' && (
          <div className="card">
            <h2>Apariencia</h2>
            <div className="row">
              <input value={skinName} onChange={(e)=>setSkinName(e.target.value)} placeholder="Nombre (offline)" />
              <button className="ghost" onClick={()=>loadSkin()}>Ver</button>
              {skinInfo?.online && <span className="pill green">✓ sesión online</span>}
            </div>
            {!skinInfo && <p style={{opacity:.65}}>Pulsa Ver para cargar la skin.</p>}
            {skinInfo?.note && <p style={{opacity:.65}}>{skinInfo.note}</p>}
            {skinInfo?.renders && (
              <div className="row" style={{alignItems:'flex-start', marginTop:12}}>
                <div className="card" style={{margin:0}}><div className="card-title">{skinInfo.name}</div><div className="meta"><span className="pill">{skinInfo.variant || 'classic'}</span>{skinInfo.cape && <span className="pill">🧥 {skinInfo.cape.alias || 'capa'}</span>}</div><img src={skinInfo.renders.face} alt="cara" width={64} height={64} style={{borderRadius:12}} /></div>
                <div className="card" style={{margin:0}}><div className="card-title">Cuerpo</div><img src={skinInfo.renders.full} alt="cuerpo" style={{maxHeight:280}} onError={(e)=>{e.currentTarget.src=`https://minotar.net/armor/body/${skinInfo.uuid}/150.png`;}} /></div>
                {skinInfo.cape && <div className="card" style={{margin:0}}><div className="card-title">Capa</div><img src={skinInfo.cape.url} alt="capa" style={{maxHeight:200}} /></div>}
              </div>
            )}
            <h3>Cambiar skin (online)</h3>
            <p style={{opacity:.65}}>Pega la URL directa de la textura (p. ej. botón derecho → copiar enlace en minecraftskins o NameMC). Sin sesión no se puede aplicar.</p>
            <div className="row">
              <input value={skinUrl} onChange={(e)=>setSkinUrl(e.target.value)} placeholder="https://…/skin.png" style={{minWidth:280}} />
              <select value={skinVariant} onChange={(e)=>setSkinVariant(e.target.value)}>
                <option value="classic">Clásica (4px)</option>
                <option value="slim">Delgada (3px)</option>
              </select>
              <button className="primary" onClick={applySkin} disabled={skinBusy || !skinUrl}>{skinBusy ? 'Aplicando…' : 'Aplicar'}</button>
              <button className="ghost danger" onClick={resetSkin}>Restablecer</button>
            </div>
          </div>
        )}
        {tab==='ajustes' && (
          <>
          <div className="card">
            <h2>Actualizaciones {appVer && <span className="pill">v{appVer}</span>}</h2>
            <div className="row">
              <button className="ghost" onClick={async()=>{setUpd({state:'checking'}); try{await window.ferro.checkUpdate();}catch(e){setUpd({state:'error',error:e.message});}}}>Buscar actualizaciones</button>
              {upd.state==='checking' && <span className="pill"><span className="spinner" />buscando…</span>}
              {upd.state==='available' && <span className="pill">Nueva versión {upd.version}: descargando…</span>}
              {upd.state==='downloading' && <span className="pill"><span className="spinner" />{(upd.percent||0).toFixed(0)}%</span>}
              {upd.state==='downloaded' && <><span className="pill green">✓ v{upd.version} lista</span><button className="primary" onClick={()=>window.ferro.quitAndInstall()}>Reiniciar e instalar</button></>}
              {upd.state==='error' && <span className="pill">Sin conexión con releases{upd.error?`: ${upd.error.slice(0,80)}`:''}</span>}
              {upd.state==='dev' && <span className="pill">Modo desarrollo</span>}
            </div>
          </div>
          <div className="card">
            <h2>Java</h2>
            <pre>{JSON.stringify(java, null, 2) || 'no encontrado'}</pre>
            <p style={{opacity:.7}}>Se usa el Java del sistema si cumple el requisito de la versión; si no, se descarga Temurin auto a runtimes/.</p>
          </div>
          </>
        )}
      </div>
      {intro && (
        <div className="intro-overlay" ref={overlayRef}>
          <img ref={introImgRef} className="intro-logo" src={brand} alt="" />
        </div>
      )}
    </div>
  );
}
