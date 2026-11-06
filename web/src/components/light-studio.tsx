import { DurationEntry, EntryRange } from "./data-entry";
import { haptic } from "./haptics";
import { useEffect, useRef, useState } from "react";
import { Copy, LightbulbOff, Pause, Play, Plus, Save, Sparkles, Square, Trash2 } from "lucide-react";
import { lightRecipes, maxPaletteColors, parsePalette, previewFrame, validRecipe, type LightBlend, type LightEffects, type LightRecipe } from "./light-recipes";
import type { RoomState, Scene } from "./types";
import type { DeviceIntent } from "./room-state";
import { PhotoPalettePicker } from "./photo-palette";

const storageKey = "sound-room-light-presets-v1";
function readPresets(): LightRecipe[] {
  try { const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]"); return Array.isArray(value) ? value.filter(validRecipe).slice(0,40).map(r=>({...r,nativeLightId:undefined})) : []; } catch { return []; }
}
function solidRecipe(light: RoomState["light"]): LightRecipe {
  const color = /^#[\da-f]{6}$/i.test(light.color) && light.color !== "#000000" ? light.color : "#ff8800";
  return { version:1, id:"room-color", title:"Custom Color", mood:"", brightness:light.brightness || 60, pace:1, motion:"steady", stops:[{color,seconds:6},{color,seconds:6}] };
}
const percent = (value:number) => value ? `${Math.round(value*100)}%` : "Off";
function hasEffects(fx?: LightEffects) { return Boolean(fx && ((fx.blend && fx.blend!=="rgb") || fx.hold || fx.drift || fx.layer || fx.bloom || fx.breath)); }
function Range({ id, label, value, display, min, max, step, onChange }: { id:string; label:string; value:number; display:string; min:number; max:number; step:number; onChange:(value:number)=>void }) {
  return <EntryRange id={id} label={label} value={value} display={display} min={min} max={max} step={step} preciseScale={max<=1?100:1} onChange={onChange}/>;
}

export function LightStudio({ scenes, light, disabled, onSolid, onDirty, onSequence, onStopSequence, onOff, sequence, pending, intent }: {
  scenes: Scene[]; light: RoomState["light"]; disabled: boolean; pending: string; sequence: RoomState["lightSequence"]; intent?: DeviceIntent | null;
  onSolid: (scene: Scene)=>void; onSequence: (recipe: LightRecipe)=>void; onStopSequence: ()=>void; onOff: ()=>void; onDirty: (dirty: boolean)=>void;
}) {
  const sequenceActive = sequence?.status === "running" || sequence?.status === "starting";
  const [saved,setSaved] = useState(readPresets);
  const [recipe,setRecipe] = useState<LightRecipe>(()=>structuredClone((sequenceActive ? readPresets().find(p=>p.id===sequence?.id) : undefined) ?? solidRecipe(light)));
  const [group,setGroup] = useState("mine");
  const [following,setFollowing] = useState(!sequenceActive);
  const [followPower,setFollowPower] = useState(false);
  const [running,setRunning] = useState(false);
  const [reduced,setReduced] = useState(()=>matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [message,setMessage] = useState("");
  const [dirty,setDirty] = useState(false);
  const [saveOpen,setSaveOpen] = useState(false);
  const [optionsOpen,setOptionsOpen] = useState(false);
  const [shimmerOpen,setShimmerOpen] = useState(false);
  const [plain,setPlain] = useState(false);
  const [paletteText,setPaletteText] = useState("");
  const [paletteError,setPaletteError] = useState("");
  const paletteInput = useRef<HTMLTextAreaElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const saveToggle = useRef<HTMLButtonElement>(null);
  const elapsed = useRef(0);
  const savedBaseline = useRef(JSON.stringify(recipe));
  const steady = recipe.motion === "steady";
  const lightIntent = intent && (intent.turnOff || intent.light || intent.key.startsWith("studio-"));
  const offRequested = Boolean(intent?.turnOff || intent?.light?.on === false);
  const previewOff = offRequested || (followPower && !light.on);
  const onHatch = lightIntent ? (intent.phase === "sending" ? "Sending…" : "Confirming…") : sequenceActive ? `${sequence.title}${sequence.status === "starting" ? " · Starting…" : ""}` : light.effectName || (light.on ? "On" : "Off");

  useEffect(()=>{
    if(offRequested)setFollowPower(true);
    if(intent?.key === "studio-play")setRunning(!reduced);
    if(offRequested || intent?.key === "studio-stop")setRunning(false);
  },[intent?.key,offRequested,reduced]);
  useEffect(()=>{ if(following) setRecipe(solidRecipe(light)); },[light.color,light.brightness,following]);
  useEffect(()=>{
    const media=matchMedia("(prefers-reduced-motion: reduce)"); const change=()=>{setReduced(media.matches);setRunning(false);};
    const visibility=()=>{if(document.hidden)setRunning(false);};
    media.addEventListener("change",change); document.addEventListener("visibilitychange",visibility);
    return ()=>{media.removeEventListener("change",change);document.removeEventListener("visibilitychange",visibility);};
  },[]);
  useEffect(()=>{
    const update=(event:StorageEvent)=>{if(event.key===storageKey){setSaved(readPresets());setMessage("Saved presets updated.");}};
    window.addEventListener("storage",update); return ()=>window.removeEventListener("storage",update);
  },[]);
  useEffect(()=>{onDirty(dirty);},[dirty,onDirty]);
  useEffect(()=>()=>onDirty(false),[onDirty]);
  useEffect(()=>{if(saveOpen)nameInput.current?.focus();},[saveOpen]);
  useEffect(()=>{
    let frame=0, previous=performance.now();
    const layer=stage.current?.querySelector<HTMLElement>(".light-color-layer");
    const shown=plain ? {...recipe,effects:undefined} : recipe;
    const paint=(now:number)=>{
      if(running && !reduced && !steady)elapsed.current+=(now-previous)/1000;
      previous=now;
      const value=previewFrame(shown,elapsed.current);
      layer?.style.setProperty("--light",value.channels.join(" "));
      if(layer)layer.style.opacity=String(previewOff ? 0 : value.intensity);
      if(running && !reduced && !steady)frame=requestAnimationFrame(paint);
    };
    paint(previous); return ()=>cancelAnimationFrame(frame);
  },[recipe,running,reduced,steady,previewOff,plain]);
  function edit(patch:Partial<LightRecipe>) {
    setFollowPower(false);
    setFollowing(false); setRecipe(r=>({...r,...patch,nativeLightId:undefined})); setDirty(true); setMessage("");
  }
  function editEffects(patch:Partial<LightEffects>) {
    const next=Object.fromEntries(Object.entries({...recipe.effects,...patch}).filter(([,value])=>value!==undefined)) as LightEffects;
    edit({effects:Object.keys(next).length ? next : undefined}); setPlain(false);
  }
  function choose(next:LightRecipe) {
    if(dirty && !confirm("Discard unsaved changes to this light preset?"))return;
    setFollowPower(false);
    const custom = {...structuredClone(next),nativeLightId:undefined};
    savedBaseline.current=JSON.stringify(custom);setRecipe(custom);setFollowing(false);setDirty(false);setRunning(false);elapsed.current=0;setMessage("");setSaveOpen(false);setOptionsOpen(false);setShimmerOpen(false);setPlain(false);setPaletteText("");setPaletteError("");
    editor.current?.focus({preventScroll:true});
    editor.current?.scrollIntoView({behavior:reduced?"instant":"smooth",block:"start"});
  }
  function usePalette(colors: string[]) {
    const stops = colors.length === 1 ? [colors[0], colors[0]] : colors;
    edit({ motion: colors.length === 1 ? "steady" : steady ? "flow" : recipe.motion, stops: stops.map((color,i)=>({color,seconds:recipe.stops[i]?.seconds ?? 6})) });
    setRunning(false); elapsed.current=0; setPaletteError("");
    setMessage(`${colors.length} ${colors.length === 1 ? "color" : "colors"} added. Save your preset or play it on Hatch.`);
  }
  function importPalette() {
    try {
      usePalette(parsePalette(paletteText));
    } catch (error) {
      haptic("error"); setPaletteError((error as Error).message); paletteInput.current?.focus();
    }
  }
  async function copyRecipe() {
    const {nativeLightId:_,...copy}=recipe;
    try { await navigator.clipboard.writeText(JSON.stringify(copy)); haptic("success"); setMessage("Recipe copied."); }
    catch { haptic("error"); setMessage("Could not copy. Allow clipboard access and try again."); }
  }
  function persist(next:LightRecipe[]) {
    try { localStorage.setItem(storageKey,JSON.stringify(next));setSaved(next);return true; }
    catch {haptic("error");setMessage("Could not save. Free some browser storage and try again.");return false;}
  }
  function finishPrecision() {
    const input=editor.current?.querySelector<HTMLInputElement>(".precise-editor input");
    if(!input)return true;
    setMessage("Tap Done to finish the precise value first.");input.focus();return false;
  }
  function save() {
    if(!finishPrecision())return;
    if(!recipe.title.trim()){haptic("error");setMessage("Name your preset first.");nameInput.current?.focus();return;}
    const id=recipe.id.startsWith("custom-")?recipe.id:`custom-${crypto.randomUUID()}`;
    const next={...recipe,id,title:recipe.title.trim(),nativeLightId:undefined};
    const latest=readPresets(), existing=latest.find(p=>p.id===id);
    if(existing && savedBaseline.current && JSON.stringify(existing)!==savedBaseline.current && !confirm("This preset changed in another tab. Replace it with your edits?"))return;
    const list=latest.filter(p=>p.id!==id);
    if(list.length>=40){haptic("error");setMessage("Remove a preset before saving another. The limit is 40.");return;}
    if(persist([...list,next])){haptic("success");savedBaseline.current=JSON.stringify(next);setRecipe(next);setDirty(false);setSaveOpen(false);setGroup("mine");setMessage("Preset saved.");saveToggle.current?.focus();}
  }
  function apply() {
    if(!finishPrecision())return;
    setFollowPower(false);
    if(!validRecipe(recipe)){haptic("error");setSaveOpen(true);setMessage("Name your preset first.");nameInput.current?.focus();return;}
    if(steady)onSolid({id:recipe.id,title:recipe.title,color:recipe.stops[0].color,brightness:recipe.brightness,description:recipe.mood});
    else onSequence(recipe);
  }
  const options=group==="mine"?saved:group==="solid"?scenes.map(scene=>({...solidRecipe({on:true,color:scene.color,brightness:scene.brightness}),id:scene.id,title:scene.title})):lightRecipes;
  return <div className="light-studio">
    <section ref={editor} tabIndex={-1} className="light-editor" aria-labelledby="light-editor-title">
      <div className={`light-preview ${running && !reduced && !steady ? "is-animating" : ""}`} ref={stage}>
        <div aria-hidden="true"><div className="light-color-layer" /><div className="preview-dome"><span/></div><span className="preview-surface"/></div>
        <span className="light-preview-label">{plain ? "Without Effects" : "Preview"}</span>
        {!steady && hasEffects(recipe.effects) && <button className="preview-compare" aria-pressed={plain} onClick={()=>setPlain(v=>!v)}>Compare</button>}
        {!steady && <button className="preview-toggle" aria-label={running?"Pause preview":"Animate preview"} aria-pressed={running} disabled={reduced} onClick={()=>setRunning(v=>!v)}>{running?<Pause size={18} aria-hidden="true"/>:<Play size={18} aria-hidden="true"/>}</button>}
      </div>
      <div className="light-editor-body">
        <header className="light-editor-heading"><h2 id="light-editor-title">{recipe.title || "Untitled Light"}</h2><span role="status" className="hint">Hatch · {onHatch}</span></header>
        <div className="light-mode" role="group" aria-label="Light movement">{[["steady","Solid"],["flow","Flow"],["breathe","Breathe"]].map(([id,label])=><button key={id} aria-pressed={recipe.motion===id} onClick={()=>edit({motion:id as LightRecipe["motion"]})}>{label}</button>)}</div>
        <div className="light-palette" role="group" aria-label={steady?"Light color":"Palette"}>
          {(steady?recipe.stops.slice(0,1):recipe.stops).map((stop,i)=><label key={i} className="color-well"><span className="sr-only">{steady?"Light color":`Color ${i+1}`}</span><input name={`light-color-${i}`} type="color" autoComplete="off" value={stop.color} onChange={e=>edit({stops:recipe.stops.map((s,j)=>j===i?{...s,color:e.target.value}:s)})}/></label>)}
          {!steady && recipe.stops.length<maxPaletteColors && <button className="key palette-add" aria-label="Add color" onClick={()=>edit({stops:[...recipe.stops,{color:"#eda1ba",seconds:6}]})}><Plus size={20} aria-hidden="true"/></button>}
          {steady && <span className="hint" translate="no">{recipe.stops[0].color.toUpperCase()}</span>}
        </div>
        <EntryRange id="recipe-brightness" label="Brightness" value={recipe.brightness} min={1} onChange={brightness=>edit({brightness})}/>
        <div className="light-primary-actions"><button className="key key-ink" disabled={disabled} onClick={apply}><Play size={16} aria-hidden="true"/>{pending==="studio-play"||pending==="studio-solid"?"Applying…":steady?"Apply Color":"Play on Hatch"}</button><button className="key" disabled={disabled || (!light.on && !sequenceActive)} onClick={onOff}><LightbulbOff size={16} aria-hidden="true"/>{pending==="light-off"?"Turning Off…":"Off"}</button></div>
        {sequenceActive && <button className="light-stop" disabled={Boolean(pending)} onClick={onStopSequence}><Square size={13} aria-hidden="true"/>{pending==="studio-stop"?"Stopping…":"Stop Motion"}</button>}
        {sequence?.status==="failed" && <p role="status" className="hint">Sequence stopped. {sequence.reason}</p>}
        <div className="light-secondary-actions"><button ref={saveToggle} className="text-key" aria-expanded={saveOpen} aria-controls="save-light-preset" onClick={()=>setSaveOpen(v=>!v)}><Save size={15} aria-hidden="true"/>Save Preset</button>{!steady && <button className="text-key" aria-expanded={shimmerOpen} aria-controls="light-shimmer" onClick={()=>setShimmerOpen(v=>!v)}><Sparkles size={15} aria-hidden="true"/>Shimmer</button>}<button className="text-key" aria-expanded={optionsOpen} aria-controls="light-options" onClick={()=>setOptionsOpen(v=>!v)}>More Options</button></div>
        {saveOpen && <form id="save-light-preset" className="light-save" onSubmit={e=>{e.preventDefault();save();}}><label className="recipe-field" htmlFor="recipe-title">Preset Name<input ref={nameInput} id="recipe-title" name="preset-name" autoComplete="off" autoCapitalize="words" autoCorrect="on" enterKeyHint="done" maxLength={80} value={recipe.title} onChange={e=>edit({title:e.target.value})}/></label><button className="key" type="submit">Save</button><span className="hint">Saved in this browser.</span></form>}
        {shimmerOpen && !steady && <div id="light-shimmer" className="light-options">
          <div className="recipe-field"><span id="blend-label">Color Blend</span><div className="light-mode" role="group" aria-labelledby="blend-label">{([["rgb","Classic"],["vivid","Vivid"],["spectrum","Spectrum"]] as [LightBlend,string][]).map(([id,label])=><button key={id} aria-pressed={(recipe.effects?.blend ?? "rgb")===id} onClick={()=>editEffects({blend:id==="rgb"?undefined:id})}>{label}</button>)}</div></div>
          <Range id="effect-hold" label="Rest on Each Color" value={recipe.effects?.hold ?? 0} display={percent(recipe.effects?.hold ?? 0)} min={0} max={.8} step={.05} onChange={v=>editEffects({hold:v||undefined})}/>
          <Range id="effect-drift" label="Drift" value={recipe.effects?.drift ?? 0} display={percent(recipe.effects?.drift ?? 0)} min={0} max={1} step={.05} onChange={v=>editEffects({drift:v||undefined})}/>
          <Range id="effect-layer" label="Layer" value={recipe.effects?.layer ?? 0} display={percent(recipe.effects?.layer ?? 0)} min={0} max={1} step={.05} onChange={v=>editEffects({layer:v||undefined})}/>
          <Range id="effect-bloom" label="Bloom" value={recipe.effects?.bloom ?? 0} display={percent(recipe.effects?.bloom ?? 0)} min={0} max={1} step={.05} onChange={v=>editEffects({bloom:v||undefined})}/>
          {Boolean(recipe.effects?.bloom) && <div className="light-palette" role="group" aria-label="Bloom tint"><label className="color-well"><span className="sr-only">Bloom tint</span><input name="bloom-color" type="color" autoComplete="off" value={recipe.effects?.bloomColor ?? "#ffffff"} onChange={e=>editEffects({bloomColor:e.target.value})}/></label><button className="text-key" aria-pressed={!recipe.effects?.bloomColor} onClick={()=>editEffects({bloomColor:undefined})}>Match Light</button></div>}
          {recipe.motion==="breathe" && <><div className="recipe-field"><span id="breath-label">Breath</span><div className="light-mode" role="group" aria-labelledby="breath-label"><button aria-pressed={!recipe.effects?.breath} onClick={()=>editEffects({breath:undefined})}>Per Color</button><button aria-pressed={Boolean(recipe.effects?.breath)} onClick={()=>editEffects({breath:recipe.effects?.breath ?? {seconds:10,depth:.45,inhale:.38}})}>Rhythm</button></div></div>
            {recipe.effects?.breath && <><Range id="breath-seconds" label="Breath Length" value={recipe.effects.breath.seconds} display={`${recipe.effects.breath.seconds}\u00a0s`} min={8} max={30} step={1} onChange={v=>editEffects({breath:{...recipe.effects!.breath!,seconds:v}})}/>
              <Range id="breath-depth" label="Depth" value={recipe.effects.breath.depth} display={percent(recipe.effects.breath.depth)} min={.1} max={.8} step={.05} onChange={v=>editEffects({breath:{...recipe.effects!.breath!,depth:v}})}/></>}</>}
          <p className="hint">Hatch shows about one frame every 2 seconds.</p>
        </div>}
        {optionsOpen && <div id="light-options" className="light-options">
          <PhotoPalettePicker onUse={colors=>{usePalette(colors);haptic("success");editor.current?.focus({preventScroll:true});editor.current?.scrollIntoView({behavior:reduced?"instant":"smooth",block:"start"});}}/>
          <form className="palette-import" onSubmit={e=>{e.preventDefault();importPalette();}}>
            <label className="recipe-field" htmlFor="palette-colors">Paste Hex Colors<textarea ref={paletteInput} id="palette-colors" name="palette-colors" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} rows={4} placeholder={"#334217, #2E2D1C, #9C8734…"} value={paletteText} aria-invalid={Boolean(paletteError)} aria-describedby={`palette-help${paletteError ? " palette-error" : ""}`} onChange={e=>{setPaletteText(e.target.value);setPaletteError("");}}/></label>
            <p id="palette-help" className="hint">2–{maxPaletteColors} colors. Commas, tabs or new lines. Replaces the palette; Solid becomes Flow.</p>
            {paletteError && <p id="palette-error" role="alert" className="studio-message">{paletteError}</p>}
            <button className="key" type="submit">Use Colors</button>
          </form>
          {!steady && <><EntryRange id="recipe-pace" label="Pace" value={recipe.pace} display={recipe.pace===1?"Normal":`${recipe.pace}×`} min={.5} max={2} step={.1} onChange={pace=>edit({pace})}/><ol className="recipe-timings">{recipe.stops.map((stop,i)=><li key={i}><span className="timing-dot" style={{background:stop.color}} aria-hidden="true"/><DurationEntry key={stop.color} index={i} value={stop.seconds} onChange={seconds=>edit({stops:recipe.stops.map((s,j)=>j===i?{...s,seconds}:s)})}/><button className="key" aria-label={`Remove color ${i+1}`} disabled={recipe.stops.length<=2} onClick={()=>edit({stops:recipe.stops.filter((_,j)=>i!==j)})}><Trash2 size={16} aria-hidden="true"/></button></li>)}</ol><p className="hint">Minimum 4 seconds per color on Hatch.</p></>}
          <label className="recipe-field" htmlFor="recipe-mood">Notes<textarea id="recipe-mood" name="notes" autoComplete="off" autoCapitalize="sentences" autoCorrect="on" maxLength={280} rows={2} value={recipe.mood} onChange={e=>edit({mood:e.target.value})}/></label>
          <button className="text-key" onClick={copyRecipe}><Copy size={15} aria-hidden="true"/>Copy Recipe</button>
          {recipe.id.startsWith("custom-")&&<button className="text-key" onClick={()=>{if(confirm(`Delete “${recipe.title}” from this browser?`)&&persist(readPresets().filter(p=>p.id!==recipe.id))){chooseWithoutWarning();}}}><Trash2 size={15} aria-hidden="true"/>Delete Preset</button>}
        </div>}
        <p role="status" className="studio-message">{message}</p>
      </div>
    </section>
    <section className="light-library" aria-labelledby="light-library-title">
      <h2 id="light-library-title">Presets</h2>
      <div className="light-library-tabs" role="group" aria-label="Preset collection">{[["mine","Mine"],["dynamic","Dynamic"],["solid","Solid"]].map(([id,label])=><button key={id} className="key" aria-pressed={group===id} onClick={()=>setGroup(id)}>{label}</button>)}</div>
      <ul className="light-recipe-grid">{options.map(item=><li key={item.id}><button className="light-recipe-card" aria-pressed={recipe.id===item.id} onClick={()=>choose(item)}><span className="light-recipe-orb" style={{background:item.motion==="steady"?item.stops[0].color:`conic-gradient(from 30deg,${item.stops.map(s=>s.color).join(",")},${item.stops[0].color})`}}/><strong>{item.title}</strong></button></li>)}</ul>
      {!options.length && <p className="hint">Save a light to keep it here.</p>}
    </section>
  </div>;
  function chooseWithoutWarning() { haptic("success"); setRecipe(solidRecipe(light));setFollowing(true);setDirty(false);setRunning(false);setOptionsOpen(false);setSaveOpen(false);setMessage("Preset deleted.");editor.current?.focus({preventScroll:true}); }
}
